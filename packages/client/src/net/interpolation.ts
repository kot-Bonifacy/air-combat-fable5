import { Quaternion, Vector3 } from 'three';
import {
  INTERP_DELAY_MS,
  INTERP_EXTRAPOLATION_MAX_MS,
  PHYSICS_HZ,
  SNAPSHOT_HZ,
  nearestToroidalImage,
  type EntitySnapshot,
  type LifePhase,
} from '@air-combat/shared';

// Interpolacja obcych samolotów (faza-09.md krok 3). Renderujemy obce encje „w
// przeszłości" o INTERP_DELAY_MS — między DWOMA snapshotami (lerp pozycji, slerp
// orientacji) — żeby jitter sieci nie dawał teleportów. Zegar odtwarzania jedzie po
// TICKU SERWERA z snapshotów (nie po Date.now między maszynami — pułapka faza-09.md):
// płynie realnym czasem, a miękko koryguje się do (najnowszy tick − opóźnienie). Gdy
// bufor się opróżni (zgubiony snapshot), ekstrapolujemy z ostatniej prędkości, max
// INTERP_EXTRAPOLATION_MAX_MS, zamiast zamrażać albo strzelać po stycznej.

const MS_PER_TICK = 1000 / PHYSICS_HZ;
/** Ticki fizyki na jeden snapshot (oczekiwany odstęp serverTick). */
const TICKS_PER_SNAPSHOT = PHYSICS_HZ / SNAPSHOT_HZ;
/** Jak agresywnie zegar odtwarzania goni cel (na klatkę) — mała wartość = stabilne tempo. */
const CLOCK_CATCHUP = 0.08;
/** Encję bez nowego sample'a dłużej niż to (po czasie renderu) usuwamy z bufora [ms]. */
const STALE_MS = 1500;

interface Sample {
  timeMs: number;
  position: Vector3;
  orientation: Quaternion;
  velocity: Vector3;
  life: LifePhase;
  stalled: boolean;
  throttle: number;
}

/** Wynik próbkowania jednej encji w czasie renderu (bufor przekazywany przez caller). */
export interface InterpolatedState {
  position: Vector3;
  orientation: Quaternion;
  velocity: Vector3;
  life: LifePhase;
  stalled: boolean;
  throttle: number;
  /** true = poza buforem, pozycja ekstrapolowana (sygnał dla overlay/debug). */
  extrapolated: boolean;
}

export function createInterpolatedState(): InterpolatedState {
  return {
    position: new Vector3(),
    orientation: new Quaternion(),
    velocity: new Vector3(),
    life: 'alive',
    stalled: false,
    throttle: 0,
    extrapolated: false,
  };
}

const scratchImg = new Vector3();

export class SnapshotInterpolator {
  private readonly buffers = new Map<number, Sample[]>();
  private renderTimeMs = 0;
  private newestTimeMs = 0;
  private started = false;
  private lastTick = -1;

  // metryki dla overlay
  lostSnapshots = 0;
  /** Zajętość bufora = najnowszy czas serwera − czas renderu [ms] (≈ INTERP_DELAY_MS). */
  bufferMs = 0;

  /** Bieżący czas odtwarzania [ms] w skali ticku serwera (overlay/diagnostyka). */
  get renderClockMs(): number {
    return this.renderTimeMs;
  }

  /**
   * Wchłania snapshot: dopisuje sample'y dla podanych encji (BEZ lokalnej — ta jest
   * predykowana). `serverTick` z snapshotu wyznacza czas; reordering po jitterze jest
   * odrzucany per encja (sample starszy od ostatniego). Wykrywa luki ticków = utrata.
   */
  ingest(serverTick: number, entities: readonly EntitySnapshot[]): void {
    const tMs = serverTick * MS_PER_TICK;

    if (this.lastTick >= 0 && tickNewer(serverTick, this.lastTick)) {
      const dTicks = (serverTick - this.lastTick + 0x100000000) % 0x100000000;
      if (dTicks > TICKS_PER_SNAPSHOT * 1.5) {
        this.lostSnapshots += Math.round(dTicks / TICKS_PER_SNAPSHOT) - 1;
      }
    }
    if (this.lastTick < 0 || tickNewer(serverTick, this.lastTick)) this.lastTick = serverTick;
    if (tMs > this.newestTimeMs) this.newestTimeMs = tMs;
    if (!this.started) {
      this.renderTimeMs = tMs - INTERP_DELAY_MS;
      this.started = true;
    }

    for (const e of entities) {
      let buf = this.buffers.get(e.id);
      if (!buf) {
        buf = [];
        this.buffers.set(e.id, buf);
      }
      const last = buf[buf.length - 1];
      if (last && tMs <= last.timeMs) continue; // duplikat / starszy po reorderingu
      buf.push({
        timeMs: tMs,
        position: e.position.clone(),
        orientation: e.orientation.clone(),
        velocity: e.velocity.clone(),
        life: e.life,
        stalled: e.stalled,
        throttle: e.throttle,
      });
      // przytnij historię: zostaw jeden sample przed czasem renderu (do interpolacji wstecz)
      while (buf.length > 2) {
        const second = buf[1];
        if (second && second.timeMs < this.renderTimeMs) buf.shift();
        else break;
      }
    }
  }

  /** Posuwa zegar odtwarzania realnym czasem i miękko goni (najnowszy − opóźnienie). */
  update(frameDtS: number): void {
    if (!this.started) return;
    const target = this.newestTimeMs - INTERP_DELAY_MS;
    this.renderTimeMs += frameDtS * 1000;
    this.renderTimeMs += (target - this.renderTimeMs) * CLOCK_CATCHUP;
    this.bufferMs = this.newestTimeMs - this.renderTimeMs;

    // usuń encje, które przestały nadawać (gracz wyszedł / zestrzelony i sprzątnięty)
    for (const [id, buf] of this.buffers) {
      const last = buf[buf.length - 1];
      if (!last || last.timeMs < this.renderTimeMs - STALE_MS) this.buffers.delete(id);
    }
  }

  /** Czy interpolator ma jakikolwiek bufor dla encji (po jej zniknięciu znika). */
  has(id: number): boolean {
    return this.buffers.has(id);
  }

  /**
   * Próbkuje encję `id` w bieżącym czasie renderu do `out`. Zwraca false, gdy brak
   * danych. Pozycja: lerp między bracketującymi sample'ami (toroidalnie najkrótszy),
   * orientacja: slerp; poza buforem — ekstrapolacja prędkością, max EXTRAPOLATION_MAX_MS.
   */
  sample(id: number, out: InterpolatedState): boolean {
    const buf = this.buffers.get(id);
    if (!buf || buf.length === 0) return false;
    const t = this.renderTimeMs;

    const first = buf[0];
    const last = buf[buf.length - 1];
    if (!first || !last) return false;

    if (t <= first.timeMs) {
      copySample(first, out);
      out.extrapolated = false;
      return true;
    }
    if (t >= last.timeMs) {
      const dtS = Math.min(t - last.timeMs, INTERP_EXTRAPOLATION_MAX_MS) / 1000;
      out.position.copy(last.position).addScaledVector(last.velocity, dtS);
      out.orientation.copy(last.orientation);
      out.velocity.copy(last.velocity);
      out.life = last.life;
      out.stalled = last.stalled;
      out.throttle = last.throttle;
      out.extrapolated = t - last.timeMs > 1;
      return true;
    }
    for (let i = 0; i < buf.length - 1; i++) {
      const a = buf[i];
      const b = buf[i + 1];
      if (!a || !b) break;
      if (t >= a.timeMs && t <= b.timeMs) {
        const span = b.timeMs - a.timeMs;
        const alpha = span > 0 ? (t - a.timeMs) / span : 0;
        const bImg = nearestToroidalImage(b.position, a.position, scratchImg);
        out.position.copy(a.position).lerp(bImg, alpha);
        out.orientation.slerpQuaternions(a.orientation, b.orientation, alpha);
        out.velocity.copy(a.velocity).lerp(b.velocity, alpha);
        // pola dyskretne: stan z wcześniejszego sample'a (bez interpolacji)
        out.life = a.life;
        out.stalled = a.stalled;
        out.throttle = a.throttle;
        out.extrapolated = false;
        return true;
      }
    }
    copySample(last, out);
    out.extrapolated = false;
    return true;
  }
}

function copySample(s: Sample, out: InterpolatedState): void {
  out.position.copy(s.position);
  out.orientation.copy(s.orientation);
  out.velocity.copy(s.velocity);
  out.life = s.life;
  out.stalled = s.stalled;
  out.throttle = s.throttle;
}

/** Czy tick `a` jest nowszy od `b` przy zawijaniu u32. */
function tickNewer(a: number, b: number): boolean {
  return ((a - b) >>> 0) < 0x80000000 && a !== b;
}
