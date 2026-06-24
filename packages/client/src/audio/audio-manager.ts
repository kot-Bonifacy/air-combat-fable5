import { Audio, AudioListener, AudioLoader, Object3D, PerspectiveCamera, PositionalAudio, Vector3 } from 'three';
import type { PlaneType } from '@air-combat/shared';
import { EngineVoice, GunVoice, WindVoice } from './voices';

// Faza 21 — dźwięk. Web Audio przez klasy Three.js (AudioListener na kamerze → 3D pozycyjne
// automatycznie z grafu sceny; PositionalAudio na meshu wroga panuje/tłumi się z odległością).
// Sample dobrane do KONKRETNYCH modeli (życzenie usera): silnik Merlin → Spitfire, Daimler-Benz
// DB 601 → Bf 109; broń 7,7 mm vs działko 20 mm. Dźwięki informacyjne (świst IAS, buffet
// przeciągnięcia) syntetyzowane proceduralnie — patrz `voices.ts`. Atrybucje w assets/LICENSES.md.
//
// Master volume + mute przez wbudowane `listener.setMasterVolume` (skaluje cały graf), zapamiętane
// w localStorage. AudioContext startuje wstrzymany (polityka autoplay) — `unlock()` wznawia go przy
// pierwszym geście użytkownika (klik w lobby). Przed odblokowaniem `ready=false` i pętle audio milczą.

/** Nazwy buforów jednostrzałowych/pętli ładowanych z /audio/*.ogg (publicDir → assets/audio). */
const SFX_FILES = {
  'engine-spitfire': 'engine-spitfire.ogg',
  'engine-bf109': 'engine-bf109.ogg',
  'guns-mg': 'guns-mg.ogg',
  cannon: 'cannon.ogg',
  explosion: 'explosion.ogg',
  'hit-metal': 'hit-metal.ogg',
} as const;
export type SfxName = keyof typeof SFX_FILES;

const VOLUME_KEY = 'air-combat:audio-volume';
const MUTE_KEY = 'air-combat:audio-muted';
const DEFAULT_VOLUME = 0.7;

/** Liczba pozycyjnych źródeł jednostrzałowych w puli (eksplozje, działko wrogów, ricochet). */
const ONESHOT_POOL = 16;

interface OneShot {
  holder: Object3D;
  audio: PositionalAudio;
}

export class AudioManager {
  readonly listener: AudioListener;
  private readonly loader = new AudioLoader();
  private readonly buffers = new Map<SfxName, AudioBuffer>();
  private readonly scene: Object3D;
  private readonly pool: OneShot[] = [];
  private poolNext = 0;
  /** Bufor szumu (2 s) współdzielony przez syntezę świstu/buffetu — generowany raz. */
  private noise: AudioBuffer | null = null;

  private loaded = false;
  private unlocked = false;
  private volume = DEFAULT_VOLUME;
  private muted = false;

  constructor(camera: PerspectiveCamera, scene: Object3D) {
    this.listener = new AudioListener();
    camera.add(this.listener);
    this.scene = scene;
    this.readSettings();
    this.applyMaster();
  }

  /** Załaduj wszystkie sample (≈180 KB łącznie). Wywoływać raz przy starcie — niezależnie od unlock. */
  async load(base = '/audio/'): Promise<void> {
    if (this.loaded) return;
    const entries = Object.entries(SFX_FILES) as [SfxName, string][];
    await Promise.all(
      entries.map(
        (entry) =>
          new Promise<void>((resolve) => {
            this.loader.load(
              base + entry[1],
              (buf) => {
                this.buffers.set(entry[0], buf);
                resolve();
              },
              undefined,
              () => resolve(), // brak sampla nie może wywrócić gry — po prostu cisza tej kategorii
            );
          }),
      ),
    );
    this.noise = makeNoiseBuffer(this.listener.context, 2);
    this.loaded = true;
  }

  /** Wznawia AudioContext przy pierwszym geście (autoplay policy). Idempotentne. */
  unlock(): void {
    if (this.unlocked) return;
    const ctx = this.listener.context;
    if (ctx.state === 'suspended') void ctx.resume();
    this.unlocked = true;
  }

  /** Gotowy do odtwarzania dopiero po załadowaniu sampli I odblokowaniu kontekstu. */
  get ready(): boolean {
    return this.loaded && this.unlocked;
  }

  get context(): AudioContext {
    return this.listener.context;
  }

  buffer(name: SfxName): AudioBuffer | undefined {
    return this.buffers.get(name);
  }

  get noiseBuffer(): AudioBuffer | null {
    return this.noise;
  }

  // --- ustawienia głośności (master + mute, localStorage) ---

  private readSettings(): void {
    try {
      const v = localStorage.getItem(VOLUME_KEY);
      if (v !== null) this.volume = clamp01(parseFloat(v));
      this.muted = localStorage.getItem(MUTE_KEY) === '1';
    } catch {
      /* localStorage niedostępny (tryb prywatny) — domyślne ustawienia */
    }
  }

  private applyMaster(): void {
    this.listener.setMasterVolume(this.muted ? 0 : this.volume);
  }

  setVolume(v: number): void {
    this.volume = clamp01(v);
    if (this.volume > 0) this.muted = false;
    this.applyMaster();
    this.persist();
  }

  toggleMute(): void {
    this.muted = !this.muted;
    this.applyMaster();
    this.persist();
  }

  get isMuted(): boolean {
    return this.muted;
  }
  get masterVolume(): number {
    return this.volume;
  }

  private persist(): void {
    try {
      localStorage.setItem(VOLUME_KEY, this.volume.toFixed(2));
      localStorage.setItem(MUTE_KEY, this.muted ? '1' : '0');
    } catch {
      /* tryb prywatny — pomiń zapis */
    }
  }

  // --- jednostrzały ---

  /** Pozycyjny jednostrzał (eksplozja, działko wroga) z puli — bez alokacji w hot-path. */
  playAt(name: SfxName, pos: Vector3, volume = 1, rate = 1): void {
    if (!this.ready) return;
    const buf = this.buffers.get(name);
    if (!buf) return;
    const slot = this.acquire();
    slot.holder.position.copy(pos);
    slot.holder.updateMatrixWorld();
    const a = slot.audio;
    if (a.isPlaying) a.stop();
    a.setBuffer(buf);
    a.setVolume(volume);
    a.setPlaybackRate(rate);
    a.play();
  }

  /** Nie-pozycyjny jednostrzał (trafienie WŁASNEGO samolotu, „ding" potwierdzenia) — zawsze w centrum. */
  play(name: SfxName, volume = 1, rate = 1): void {
    if (!this.ready) return;
    const buf = this.buffers.get(name);
    if (!buf) return;
    const a = new Audio(this.listener);
    a.setBuffer(buf);
    a.setVolume(volume);
    a.setPlaybackRate(rate);
    a.onEnded = () => a.disconnect(); // zwolnij węzły po zakończeniu (jednorazówka nie jest reużywana)
    a.play();
  }

  private acquire(): OneShot {
    if (this.pool.length < ONESHOT_POOL) {
      const holder = new Object3D();
      const audio = new PositionalAudio(this.listener);
      audio.setRefDistance(80);
      audio.setRolloffFactor(0.9);
      audio.setDistanceModel('exponential');
      holder.add(audio);
      this.scene.add(holder);
      const slot = { holder, audio };
      this.pool.push(slot);
      return slot;
    }
    const slot = this.pool[this.poolNext]!;
    this.poolNext = (this.poolNext + 1) % ONESHOT_POOL;
    return slot;
  }

  // --- syntezy proceduralne (ding potwierdzenia + klik UI) ---

  /** Cichy wysoki „ding" — potwierdzenie ZADANIA trafienia (informacja > efekciarstwo). */
  hitConfirm(): void {
    this.blip(1320, 0.06, 0.12);
  }

  /** Delikatny klik interfejsu (przyciski lobby). */
  uiClick(): void {
    this.blip(420, 0.04, 0.08, 'triangle');
  }

  private blip(freq: number, durS: number, gain: number, type: OscillatorType = 'sine'): void {
    if (!this.ready) return;
    const ctx = this.listener.context;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    const t = ctx.currentTime;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + durS);
    osc.connect(g);
    g.connect(this.listener.getInput());
    osc.start(t);
    osc.stop(t + durS + 0.02);
  }

  // --- fabryki głosów ciągłych ---

  /** Pętla silnika danego samolotu. `local=true` (brak `host`) → niepozycyjna (centralna, najważniejszy
   *  dźwięk); obcy → pozycyjna, podpięta do `host` (mesh). */
  createEngine(plane: PlaneType, local: boolean, host?: Object3D): EngineVoice {
    const buf = this.buffers.get(`engine-${plane}` as SfxName);
    return new EngineVoice(this, buf, local, host);
  }

  /** Pętla broni danego samolotu (grzechot 7,7 mm); Bf 109 dokłada dudnienie działka 20 mm. */
  createGun(plane: PlaneType, local: boolean, host?: Object3D): GunVoice {
    return new GunVoice(this, this.buffers.get('guns-mg'), plane, local, host);
  }

  /** Świst opływającego powietrza + buffet przeciągnięcia (tylko własny samolot, niepozycyjne). */
  createWind(): WindVoice {
    return new WindVoice(this);
  }

  // --- panel ustawień (montowany w menu pauzy) ---

  /** Buduje widżet „głośność + wycisz" związany z tym managerem (zapis do localStorage w setterach). */
  createSettingsPanel(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.style.cssText =
      'display:flex;align-items:center;gap:10px;margin-top:14px;font:13px monospace;color:#cdd;';

    const muteBtn = document.createElement('button');
    muteBtn.style.cssText =
      'font:600 13px monospace;padding:7px 12px;cursor:pointer;color:#eef;' +
      'background:rgba(20,32,46,0.95);border:1px solid #4a6c8c;border-radius:6px;min-width:90px;';

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '0';
    slider.max = '100';
    slider.step = '1';
    slider.style.cssText = 'width:150px;cursor:pointer;';

    const pct = document.createElement('span');
    pct.style.cssText = 'min-width:3em;text-align:right;';

    const sync = (): void => {
      muteBtn.textContent = this.muted ? '🔇 wycisz.' : '🔊 dźwięk';
      slider.value = String(Math.round(this.volume * 100));
      pct.textContent = `${Math.round((this.muted ? 0 : this.volume) * 100)}%`;
    };
    muteBtn.addEventListener('click', () => {
      this.toggleMute();
      sync();
    });
    slider.addEventListener('input', () => {
      this.setVolume(parseInt(slider.value, 10) / 100);
      sync();
    });

    const label = document.createElement('span');
    label.textContent = 'głośność';
    wrap.append(muteBtn, label, slider, pct);
    sync();
    return wrap;
  }
}

function clamp01(v: number): number {
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
}

/** Biały szum w buforze mono — baza filtrowanego świstu/buffetu (zapętlany). */
function makeNoiseBuffer(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}
