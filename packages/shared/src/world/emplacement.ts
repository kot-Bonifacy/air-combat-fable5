import { Vector3 } from 'three';
import {
  EMPLACEMENT_AIM_BIAS_MRAD,
  EMPLACEMENT_AIM_LAG_TAU_S,
  EMPLACEMENT_BARRELS,
  EMPLACEMENT_BELT_SIZE,
  EMPLACEMENT_BURST_GAP_S,
  EMPLACEMENT_BURST_ON_S,
  EMPLACEMENT_LOS_SAMPLES,
  EMPLACEMENT_MUZZLE_HEIGHT_M,
  EMPLACEMENT_RANGE_M,
  EMPLACEMENT_RELOAD_S,
  GRAVITY_MS2,
  MRAD_TO_RAD,
} from '../constants';
import { createRng } from '../math/rng';
import { SPITFIRE_MK2 } from '../planes/loader';
import type { Terrain } from './terrain';

// Stanowiska ogniowe naziemne (cele naziemne na zboczach góry). Autorytatywnie żyją na
// serwerze (niezmiennik nr 5): skanują niebo w zasięgu EMPLACEMENT_RANGE_M, sprawdzają
// widoczność (czy góra nie przesłania linii ognia), wyprzedzają cel z CELOWYM błędem (lag
// namiaru + dryf na serię), żeby pilot manewrujący mógł uniknąć pocisków, i prują seriami z
// taśmy ~400 pocisków, po czym przeładowują (~30 s). Niszczy je jeden pocisk samolotu.
//
// Ta warstwa jest CZYSTA (bez Node/DOM, bez puli pocisków) i testowalna: update() decyduje
// O ILE i W JAKIM kierunku strzelić, a serwer spawnuje z tego pociski w puli + emituje event
// AA_FIRE (klient odtwarza tracery, by dało się unikać wzrokowo). Balistyka = .303 Spitfire'a
// (decyzja usera: ten sam kaem, tylko 2 lufy zamiast 8) — bez duplikacji liczb (czytane z JSON).

const DOT303 = SPITFIRE_MK2.armament.groups[0];
if (!DOT303) throw new Error('emplacement: brak grupy .303 w konfiguracji Spitfire (loader powinien to złapać)');

/** Balistyka pocisku AA = .303 Spitfire'a (ten sam kaem). Serwer używa do spawnu pocisków. */
export const AA_BALLISTICS = {
  muzzleVelocityMs: DOT303.muzzleVelocityMs,
  bulletDragK: DOT303.bulletDragK,
  bulletLifetimeS: DOT303.bulletLifetimeS,
  damagePerHit: DOT303.damagePerHit,
} as const;

/** Odstęp między salwami (wszystkie lufy naraz) z kadencji jednej lufy .303 [s]. */
const VOLLEY_INTERVAL_S = 60 / DOT303.fireRateRpmPerGun;

const DEG = Math.PI / 180;

/**
 * Miejsca stanowisk: kąt w płaszczyźnie XZ (pozycja = r·[cos, _, sin]) + promień od środka wyspy.
 * Dobrane na RÓŻNYCH bokach góry, POZA sektorem plaży (głębokie −Z, „dół" mapy) i zatoki (głębokie
 * +Z, „góra"). Wysokość bierzemy z terenu w danym punkcie (ten sam seed po obu stronach sieci, więc
 * klient liczy identyczne pozycje bez protokołu). Walidowane testem (na lądzie, rozrzucone).
 */
const EMPLACEMENT_SITES: readonly { angleRad: number; radiusM: number }[] = [
  { angleRad: 0 * DEG, radiusM: 1900 }, // wschodnie zbocze
  { angleRad: 150 * DEG, radiusM: 1700 }, // północno-zachodnie
  { angleRad: 210 * DEG, radiusM: 1800 }, // południowo-zachodnie
];

/** Pozycje podstaw stanowisk (na gruncie) — wspólne dla serwera i klienta (deterministyczne z seeda). */
export function emplacementBasePositions(terrain: Terrain): Vector3[] {
  return EMPLACEMENT_SITES.map((s) => {
    const x = Math.cos(s.angleRad) * s.radiusM;
    const z = Math.sin(s.angleRad) * s.radiusM;
    return new Vector3(x, terrain.heightAt(x, z), z);
  });
}

const losSpan = new Vector3();

/**
 * Czy odcinek `from`→`to` nie jest przesłonięty terenem (góra między działem a samolotem).
 * Próbkuje wysokość terenu wzdłuż odcinka; jeśli w którymś punkcie teren jest powyżej linii
 * wzroku → brak widoczności. Pomija same końce (przy dziale teren = jego podstawa).
 */
export function hasTerrainLineOfSight(
  from: Vector3,
  to: Vector3,
  terrain: Terrain,
  samples = EMPLACEMENT_LOS_SAMPLES,
): boolean {
  losSpan.subVectors(to, from);
  for (let i = 1; i < samples; i++) {
    const t = i / samples;
    const x = from.x + losSpan.x * t;
    const y = from.y + losSpan.y * t;
    const z = from.z + losSpan.z * t;
    if (terrain.heightAt(x, z) > y + 0.5) return false; // teren ponad linią ognia → przesłonięcie
  }
  return true;
}

/** Cel widziany przez stanowisko (żywy samolot): id + bieżąca pozycja i prędkość. */
export interface AaTarget {
  id: number;
  position: Vector3;
  velocity: Vector3;
}

/** Wynik kroku stanowiska, gdy oddało ogień: ile pocisków i bazowy (jednostkowy) kierunek salwy. */
export interface AaFire {
  shots: number;
  /** Kierunek bazowy (jednostkowy); serwer dokłada rozrzut per pocisk, klient odtwarza tracery. */
  dir: Vector3;
}

const scratchAim = new Vector3();
const scratchDesired = new Vector3();
const scratchE1 = new Vector3();
const scratchE2 = new Vector3();
const scratchRef = new Vector3();
const FALLBACK_FWD = new Vector3(0, 0, 1);

/**
 * Czas lotu pocisku na dystans `distanceM` z prędkością wylotową `v0`, dla oporu kwadratowego
 * a = −k·|v|·v (jak `stepBullet`). Bez oporu (k≈0) to po prostu D/v0; z oporem pocisk hamuje, więc
 * x(t) = (1/k)·ln(1 + k·v0·t) ⇒ t = (e^{k·D} − 1)/(k·v0). Liczenie ze stałej v0 zaniżałoby czas lotu
 * (na 1000 m ~1,3 s zamiast ~2,3 s) → działo celowałoby za krótko i za nisko. Ważne dla celności na
 * dużym dystansie; grawitacja sprzęga się słabo i jest pomijana w tym 1-D przybliżeniu (korekta opadu
 * niżej używa już poprawnego t).
 */
function aaTimeOfFlight(distanceM: number, v0: number, dragK: number): number {
  if (dragK <= 1e-9) return distanceM / v0;
  return (Math.exp(dragK * distanceM) - 1) / (dragK * v0);
}

/**
 * Punkt wyprzedzenia: rozwiązuje czas przelotu pocisku do celu (2 iteracje, z oporem) i celuje w
 * pozycję, gdzie cel będzie. Dolicza kompensację opadu grawitacyjnego na czasie lotu. Zwraca jednostkowy
 * kierunek dział→punkt. To „idealny" namiar; dodawalność daje dopiero lag + dryf w update().
 */
function aaLead(muzzle: Vector3, target: AaTarget, bulletSpeed: number, dragK: number, out: Vector3): Vector3 {
  let t = aaTimeOfFlight(muzzle.distanceTo(target.position), bulletSpeed, dragK);
  for (let i = 0; i < 2; i++) {
    scratchAim.copy(target.position).addScaledVector(target.velocity, t);
    t = aaTimeOfFlight(muzzle.distanceTo(scratchAim), bulletSpeed, dragK);
  }
  scratchAim.copy(target.position).addScaledVector(target.velocity, t);
  scratchAim.y += 0.5 * GRAVITY_MS2 * t * t; // pocisk opada o ½·g·t² → podnieś namiar
  out.copy(scratchAim).sub(muzzle);
  const len = out.length();
  return len > 1e-6 ? out.multiplyScalar(1 / len) : out.copy(FALLBACK_FWD);
}

/** Pojedyncze stanowisko ogniowe — autorytatywny stan ognia (serwer). */
export class Emplacement {
  readonly index: number;
  readonly basePosition: Vector3;
  /** Pozycja wylotu luf (podstawa + wysokość) — źródło pocisków i sfera trafień. */
  readonly muzzlePosition: Vector3;
  destroyed = false;

  private beltRemaining = EMPLACEMENT_BELT_SIZE;
  private reloadTimerS = 0;
  private volleyAccumS = 0;
  private firingPhase = true;
  private phaseTimerS = 0;
  private targetId: number | null = null;
  private readonly aimDir = new Vector3(0, 0, 1);
  private aimReady = false;
  private biasA = 0;
  private biasB = 0;
  private readonly rng: () => number;

  constructor(index: number, basePosition: Vector3) {
    this.index = index;
    this.basePosition = basePosition.clone();
    this.muzzlePosition = basePosition.clone();
    this.muzzlePosition.y += EMPLACEMENT_MUZZLE_HEIGHT_M;
    this.rng = createRng((index + 1) ^ 0x5a1d);
  }

  /** Pełny reset na start meczu: odbudowane, taśma pełna, bez celu. */
  reset(): void {
    this.destroyed = false;
    this.beltRemaining = EMPLACEMENT_BELT_SIZE;
    this.reloadTimerS = 0;
    this.volleyAccumS = 0;
    this.firingPhase = true;
    this.phaseTimerS = 0;
    this.targetId = null;
    this.aimReady = false;
    this.biasA = 0;
    this.biasB = 0;
  }

  /** Bieżący (wygładzony) kierunek namiaru — diagnostyka/testy. */
  get aimDirection(): Vector3 {
    return this.aimDir;
  }
  /** Pozostała amunicja w taśmie — diagnostyka/testy. */
  get belt(): number {
    return this.beltRemaining;
  }
  /** Czy trwa zmiana taśmy — diagnostyka/testy. */
  get reloading(): boolean {
    return this.reloadTimerS > 0;
  }

  /**
   * Jeden krok stanowiska. Zwraca opis ognia (ile pocisków + bazowy kierunek) albo null, gdy nie
   * strzela w tym ticku (zniszczone / przeładowuje / brak widocznego celu / przerwa między seriami).
   */
  update(dtS: number, targets: readonly AaTarget[], terrain: Terrain): AaFire | null {
    if (this.destroyed) return null;

    // zmiana taśmy — w tym czasie milczy; po jej upływie taśma pełna i strzela dalej
    if (this.reloadTimerS > 0) {
      this.reloadTimerS -= dtS;
      if (this.reloadTimerS > 0) return null;
      this.reloadTimerS = 0;
      this.beltRemaining = EMPLACEMENT_BELT_SIZE;
    }

    const target = this.selectTarget(targets, terrain);
    if (!target) {
      // brak celu: nie strzela, nie traci taśmy; namiar „zastyga" na ostatnim kierunku
      this.volleyAccumS = 0;
      this.targetId = null;
      return null;
    }

    // namiar z wyprzedzeniem + LAG (kluczowe dla dodawalności: przy manewrze celu namiar trafia
    // tam, gdzie cel BYŁ, więc pociski mijają — pilot lecący prosto i przewidywalnie obrywa)
    aaLead(this.muzzlePosition, target, AA_BALLISTICS.muzzleVelocityMs, AA_BALLISTICS.bulletDragK, scratchDesired);
    if (!this.aimReady) {
      this.aimDir.copy(scratchDesired);
      this.aimReady = true;
    } else {
      const k = 1 - Math.exp(-dtS / Math.max(1e-3, EMPLACEMENT_AIM_LAG_TAU_S));
      this.aimDir.lerp(scratchDesired, k);
      if (this.aimDir.lengthSq() > 1e-9) this.aimDir.normalize();
    }

    // maszyna serii: ON_S ognia, GAP_S ciszy; przy wejściu w nową serię losujemy stały błąd namiaru
    this.phaseTimerS += dtS;
    if (this.firingPhase && this.phaseTimerS >= EMPLACEMENT_BURST_ON_S) {
      this.firingPhase = false;
      this.phaseTimerS = 0;
    } else if (!this.firingPhase && this.phaseTimerS >= EMPLACEMENT_BURST_GAP_S) {
      this.firingPhase = true;
      this.phaseTimerS = 0;
      this.rollBias();
    }
    if (!this.firingPhase) return null;

    // kadencja .303 × liczba luf (salwa = wszystkie lufy naraz)
    this.volleyAccumS += dtS;
    let shots = 0;
    for (let guard = 0; guard < 8 && this.volleyAccumS >= VOLLEY_INTERVAL_S && this.beltRemaining > 0; guard++) {
      const rounds = Math.min(EMPLACEMENT_BARRELS, this.beltRemaining);
      this.beltRemaining -= rounds;
      shots += rounds;
      this.volleyAccumS -= VOLLEY_INTERVAL_S;
    }
    if (this.beltRemaining <= 0) {
      this.reloadTimerS = EMPLACEMENT_RELOAD_S;
      this.volleyAccumS = 0;
    }
    if (shots === 0) return null;

    return { shots, dir: this.biasedAim(scratchAim) };
  }

  /** Losuje stały błąd namiaru bieżącej serii (dwa kąty w stożku EMPLACEMENT_AIM_BIAS_MRAD). */
  private rollBias(): void {
    const mag = EMPLACEMENT_AIM_BIAS_MRAD * MRAD_TO_RAD;
    const phi = 2 * Math.PI * this.rng();
    const r = Math.sqrt(this.rng()) * mag;
    this.biasA = Math.cos(phi) * r;
    this.biasB = Math.sin(phi) * r;
  }

  /** Wygładzony namiar + stały błąd serii → faktyczny kierunek salwy (jednostkowy). */
  private biasedAim(out: Vector3): Vector3 {
    out.copy(this.aimDir);
    scratchRef.set(Math.abs(this.aimDir.x) < 0.9 ? 1 : 0, Math.abs(this.aimDir.x) < 0.9 ? 0 : 1, 0);
    scratchE1.crossVectors(this.aimDir, scratchRef).normalize();
    scratchE2.crossVectors(this.aimDir, scratchE1);
    out.addScaledVector(scratchE1, Math.tan(this.biasA));
    out.addScaledVector(scratchE2, Math.tan(this.biasB));
    return out.normalize();
  }

  /** Najbliższy żywy cel w zasięgu z linią ognia; utrzymuje bieżący, póki ten jest ważny (stabilność). */
  private selectTarget(targets: readonly AaTarget[], terrain: Terrain): AaTarget | null {
    if (this.targetId !== null) {
      const cur = targets.find((t) => t.id === this.targetId);
      if (cur && this.inRange(cur) && hasTerrainLineOfSight(this.muzzlePosition, cur.position, terrain)) return cur;
    }
    const candidates = targets
      .filter((t) => this.inRange(t))
      .sort(
        (a, b) =>
          this.muzzlePosition.distanceToSquared(a.position) - this.muzzlePosition.distanceToSquared(b.position),
      );
    for (const t of candidates) {
      if (hasTerrainLineOfSight(this.muzzlePosition, t.position, terrain)) {
        this.targetId = t.id;
        return t;
      }
    }
    return null;
  }

  private inRange(t: AaTarget): boolean {
    return this.muzzlePosition.distanceToSquared(t.position) <= EMPLACEMENT_RANGE_M * EMPLACEMENT_RANGE_M;
  }
}

/** Buduje stanowiska z pozycji wyznaczonych z terenu (serwer; klient buduje meshe z tych samych pozycji). */
export function createEmplacements(terrain: Terrain): Emplacement[] {
  return emplacementBasePositions(terrain).map((p, i) => new Emplacement(i, p));
}
