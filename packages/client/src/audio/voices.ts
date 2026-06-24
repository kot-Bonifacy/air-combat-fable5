import { Audio, Object3D, PositionalAudio, Vector3 } from 'three';
import type { PlaneType } from '@air-combat/shared';
import type { AudioManager } from './audio-manager';

// Głosy ciągłe fazy 21. EngineVoice/GunVoice owijają jedno źródło zapętlone (Three.js Audio dla
// własnego samolotu — niepozycyjne, centralne; PositionalAudio podpięte do meshu dla obcych —
// panowanie i tłumienie z odległości z grafu sceny). WindVoice syntetyzuje świst/buffet z szumu
// (informacja o IAS i przeciągnięciu — patrz kryteria fazy). Cleanup źródeł przy śmierci/usunięciu
// encji robi wywołujący przez dispose() (pułapka fazy: wiszące PositionalAudio = wyciek).

// --- strojenie (prezentacja, nie fizyka — świadomie poza shared/constants) ---
const ENGINE_RATE_IDLE = 0.78; // playbackRate pętli przy zerowym gazie (niższe obroty = niższy ton)
const ENGINE_RATE_FULL = 1.34; // przy pełnym gazie
const ENGINE_GAIN_IDLE = 0.3;
const ENGINE_GAIN_FULL = 0.92;
const ENGINE_TAU_S = 0.18; // wygładzanie zmian obrotów (bez „zipper noise")
// Per-model wzmocnienie głośności silnika — wyrównuje percepcyjną energię różnych nagrań źródłowych.
// Sample Spitfire'a (Merlin „na postoju") jest energetycznie cichszy niż run-up Bf 109 mimo podobnego
// RMS → podbity, by oba samoloty brzmiały równie obecnie (user 2026-06-24: Spitfire był za cichy).
const ENGINE_GAIN_MUL: Record<PlaneType, number> = { spitfire: 1.3, bf109: 1.0 };

const GUN_RATE_303 = 1.12; // Spitfire: 8× .303 — lekki, szybki grzechot (wyżej)
const GUN_RATE_MG17 = 0.94; // Bf 109: MG 17 — cięższy ton (niżej)
const GUN_GAIN = 0.55;
const GUN_HOLD_S = 0.13; // jak długo pętla gra po ostatnim evencie MUZZLE (spust trzymany → odświeżany)
const CANNON_INTERVAL_S = 0.16; // dudnienie działka 20 mm Bf 109 (MG FF ~520/min ≈ 0,115 s; rozrzedzone dla czytelności)
const CANNON_GAIN_LOCAL = 0.7;
const CANNON_GAIN_REMOTE = 0.95;

const WIND_MAX = 0.5; // maks. głośność świstu (przy bardzo dużej IAS)
const WIND_REF_MS = 165; // IAS [m/s], przy której świst osiąga maksimum (~595 km/h)
const BUFFET_MAX = 0.55; // buffet przeciągnięcia — niski pomruk, MUSI przebić się przez broń (informacja)

function smoothK(dtS: number, tauS: number): number {
  return 1 - Math.exp(-dtS / Math.max(1e-3, tauS));
}

/** Jedno zapętlone źródło: pozycyjne (podpięte do `host`) albo centralne (własny samolot). */
class LoopVoice {
  readonly audio: Audio | PositionalAudio;
  private started = false;

  constructor(am: AudioManager, buffer: AudioBuffer | undefined, host?: Object3D) {
    if (host) {
      const pa = new PositionalAudio(am.listener);
      pa.setRefDistance(70);
      pa.setRolloffFactor(0.85);
      pa.setDistanceModel('exponential');
      host.add(pa);
      this.audio = pa;
    } else {
      // <GainNode> przypina generyk — bez tego kontekst unii celu wnioskuje Audio<GainNode|PannerNode>
      this.audio = new Audio<GainNode>(am.listener);
    }
    if (buffer) {
      this.audio.setBuffer(buffer);
      this.audio.setLoop(true);
    }
    this.audio.setVolume(0);
  }

  start(): void {
    if (this.started || !this.audio.buffer) return;
    this.audio.play();
    this.started = true;
  }

  setGain(g: number): void {
    this.audio.setVolume(g);
  }

  setRate(r: number): void {
    this.audio.setPlaybackRate(r);
  }

  dispose(): void {
    if (this.started) {
      try {
        this.audio.stop();
      } catch {
        /* już zatrzymane */
      }
    }
    this.audio.parent?.remove(this.audio);
    this.audio.disconnect();
  }
}

/** Pętla silnika — pitch i głośność od RPM-proxy (gaz, lekko prędkość). Sample dobrany do modelu. */
export class EngineVoice {
  private readonly loop: LoopVoice;
  private readonly gainMul: number;
  private rate = ENGINE_RATE_IDLE;
  private gain = 0;

  constructor(am: AudioManager, buffer: AudioBuffer | undefined, plane: PlaneType, host?: Object3D) {
    this.loop = new LoopVoice(am, buffer, host);
    this.gainMul = ENGINE_GAIN_MUL[plane];
  }

  /** `active` = żywy samolot z pracującym silnikiem (paliwo). Martwy/wrak → wyciszenie. */
  update(dtS: number, throttle: number, speedMs: number, active: boolean): void {
    if (active) this.loop.start();
    // RPM-proxy: głównie gaz + drobny wkład prędkości (śmigło „rozkręcone" w nurkowaniu)
    const rpm = Math.min(1, Math.max(0, 0.1 + 0.82 * throttle + 0.0006 * speedMs));
    const targetRate = ENGINE_RATE_IDLE + (ENGINE_RATE_FULL - ENGINE_RATE_IDLE) * rpm;
    const targetGain = active ? (ENGINE_GAIN_IDLE + (ENGINE_GAIN_FULL - ENGINE_GAIN_IDLE) * throttle) * this.gainMul : 0;
    const k = smoothK(dtS, ENGINE_TAU_S);
    this.rate += (targetRate - this.rate) * k;
    this.gain += (targetGain - this.gain) * k;
    this.loop.setRate(this.rate);
    this.loop.setGain(this.gain);
  }

  dispose(): void {
    this.loop.dispose();
  }
}

/** Pętla broni — grzechot 7,7 mm (ton zależny od modelu); Bf 109 dokłada dudnienie działka 20 mm. */
export class GunVoice {
  private readonly loop: LoopVoice;
  private readonly am: AudioManager;
  private readonly local: boolean;
  private readonly hasCannon: boolean;
  private fireTimer = 0;
  private cannonAccum = 0;

  constructor(am: AudioManager, buffer: AudioBuffer | undefined, plane: PlaneType, local: boolean, host?: Object3D) {
    this.loop = new LoopVoice(am, buffer, host);
    this.loop.setRate(plane === 'spitfire' ? GUN_RATE_303 : GUN_RATE_MG17);
    this.am = am;
    this.local = local;
    this.hasCannon = plane === 'bf109';
  }

  /** Odśwież z eventu MUZZLE — utrzymuje pętlę grającą jeszcze GUN_HOLD_S po ostatnim strzale. */
  note(): void {
    this.fireTimer = GUN_HOLD_S;
  }

  /** `pos` — pozycja właściciela (do pozycyjnych strzałów działka obcych). */
  update(dtS: number, pos: Vector3): void {
    if (this.fireTimer > 0) {
      this.fireTimer -= dtS;
      this.loop.start();
      this.loop.setGain(GUN_GAIN);
      if (this.hasCannon) {
        this.cannonAccum += dtS;
        while (this.cannonAccum >= CANNON_INTERVAL_S) {
          this.cannonAccum -= CANNON_INTERVAL_S;
          if (this.local) this.am.play('cannon', CANNON_GAIN_LOCAL);
          else this.am.playAt('cannon', pos, CANNON_GAIN_REMOTE);
        }
      }
    } else {
      this.loop.setGain(0);
      this.cannonAccum = 0;
    }
  }

  dispose(): void {
    this.loop.dispose();
  }
}

/** Świst opływu (rośnie z IAS) + buffet przeciągnięcia (niski pomruk) — proceduralne, własny samolot. */
export class WindVoice {
  private readonly am: AudioManager;
  private windGain: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private buffetGain: GainNode | null = null;
  private readonly sources: AudioBufferSourceNode[] = [];
  private started = false;

  constructor(am: AudioManager) {
    this.am = am;
    const noise = am.noiseBuffer;
    if (!noise) return; // sample nie wczytane — głos martwy (no-op)
    const ctx = am.context;
    const dest = am.listener.getInput();

    const windSrc = ctx.createBufferSource();
    windSrc.buffer = noise;
    windSrc.loop = true;
    const windFilter = ctx.createBiquadFilter();
    windFilter.type = 'lowpass';
    windFilter.frequency.value = 400;
    const windGain = ctx.createGain();
    windGain.gain.value = 0;
    windSrc.connect(windFilter).connect(windGain).connect(dest);

    const buffetSrc = ctx.createBufferSource();
    buffetSrc.buffer = noise;
    buffetSrc.loop = true;
    const buffetFilter = ctx.createBiquadFilter();
    buffetFilter.type = 'lowpass';
    buffetFilter.frequency.value = 190; // niski pomruk drżenia płatowca
    const buffetGain = ctx.createGain();
    buffetGain.gain.value = 0;
    buffetSrc.connect(buffetFilter).connect(buffetGain).connect(dest);

    this.windFilter = windFilter;
    this.windGain = windGain;
    this.buffetGain = buffetGain;
    this.sources.push(windSrc, buffetSrc);
  }

  /** `active` — żywy samolot z perspektywy własnej (obserwacja/wrak → świst gaśnie). */
  update(iasMs: number, buffet: number, active: boolean): void {
    if (!this.windGain || !this.windFilter || !this.buffetGain) return;
    if (!this.started) {
      for (const s of this.sources) s.start();
      this.started = true;
    }
    const ctx = this.am.context;
    const now = ctx.currentTime;
    const frac = active ? Math.min(1, Math.max(0, iasMs / WIND_REF_MS)) : 0;
    // kwadrat → świst narasta wyraźnie dopiero przy większych prędkościach (czytelne nurkowanie)
    this.windGain.gain.setTargetAtTime(WIND_MAX * frac * frac, now, 0.12);
    this.windFilter.frequency.setTargetAtTime(300 + 2600 * frac, now, 0.12);
    this.buffetGain.gain.setTargetAtTime(active ? Math.min(1, buffet) * BUFFET_MAX : 0, now, 0.05);
  }

  dispose(): void {
    for (const s of this.sources) {
      try {
        s.stop();
      } catch {
        /* już zatrzymane */
      }
      s.disconnect();
    }
    this.windGain?.disconnect();
    this.windFilter?.disconnect();
    this.buffetGain?.disconnect();
  }
}
