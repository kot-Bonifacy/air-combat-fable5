import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  NormalBlending,
  Points,
  PointsMaterial,
  Scene,
  Vector3,
} from 'three';

// Smuga dymu. Każdy „kłąb" to mała chmura punktów rzucana co interwał w bieżącej
// pozycji samolotu; maszyna ucieka do przodu, kłęby zostają w tyle i razem rysują
// smugę. Kłąb unosi się lekko, rośnie i gaśnie. Integracja na CPU jak w explosion.ts;
// Math.random OK — czysty efekt wizualny, nie symulacja.
//
// Intensywność i barwa zależą od stanu maszyny (caller dobiera profil): trafiony, ale
// żywy samolot dymi tym mocniej i ciemniej, im mniej HP (biały → szary → ciemnoszary),
// a spadający wrak ciągnie gęstą, niemal czarną smugę. Caller decyduje, KIEDY emitować
// i z jakim profilem; tu żyją tylko parametry wyglądu i integracja.

/** Parametry wyglądu pojedynczego poziomu dymu (od lekkiego, białego, po czarny wrak). */
export interface SmokeProfile {
  /** Liczba cząstek w kłębie. */
  particlesPerPuff: number;
  /** Czas życia kłębu [s]. */
  lifetimeS: number;
  /** Początkowy promień rozrzutu cząstek kłębu [m]. */
  spawnRadiusM: number;
  /** Wyporność dymu (unosi się) [m/s]. */
  riseSpeedMs: number;
  /** Losowy rozrzut prędkości wokół wyporności [m/s]. */
  spreadSpeedMs: number;
  /** Rozmiar punktu na starcie i końcu życia [px] — dym pęcznieje, rozrzedzając się. */
  sizeStart: number;
  sizeEnd: number;
  /** Krycie u progu życia — gaśnie do 0. */
  opacityStart: number;
  /** Barwa świeżego dymu i rozrzedzonego (lerp po czasie życia). */
  colorStart: Color;
  colorEnd: Color;
  /**
   * Mieszanie addytywne zamiast normalnego — dla OGNIA (jasne, świecące języki rozjaśniają tło).
   * Dym zostaje na NormalBlending (bywa ciemny → addytywne by go rozjaśniło). Domyślnie false.
   */
  additive?: boolean;
}

/** Poziom dymu = wygląd (profil) + częstość emisji kłębów. */
export interface SmokeTier {
  profile: SmokeProfile;
  /** Odstęp między kłębami [s] — gęściej = mocniejszy dym. */
  intervalS: number;
}

// --- Profile poziomów (rosnąco wg powagi uszkodzeń) ---

/** Lekkie uszkodzenia: cienka, jasna (biała) smużka. */
const LIGHT_PROFILE: SmokeProfile = {
  particlesPerPuff: 4,
  lifetimeS: 0.9,
  spawnRadiusM: 0.5,
  riseSpeedMs: 3,
  spreadSpeedMs: 1.2,
  sizeStart: 3,
  sizeEnd: 7,
  opacityStart: 0.3,
  colorStart: new Color(0xd8d8d8), // jasny, niemal biały
  colorEnd: new Color(0xf2f2f2), // blaknie do bieli i znika
};

/** Średnie uszkodzenia: wyraźniejszy, szary dym. */
const MEDIUM_PROFILE: SmokeProfile = {
  particlesPerPuff: 6,
  lifetimeS: 1.2,
  spawnRadiusM: 0.7,
  riseSpeedMs: 3.5,
  spreadSpeedMs: 1.8,
  sizeStart: 4,
  sizeEnd: 10,
  opacityStart: 0.45,
  colorStart: new Color(0x808080), // średnia szarość
  colorEnd: new Color(0xb4b4b4),
};

/** Ciężkie uszkodzenia: gęsty, ciemnoszary dym (krok przed czernią wraku). */
const HEAVY_PROFILE: SmokeProfile = {
  particlesPerPuff: 8,
  lifetimeS: 1.5,
  spawnRadiusM: 0.95,
  riseSpeedMs: 4,
  spreadSpeedMs: 2.4,
  sizeStart: 4.5,
  sizeEnd: 13,
  opacityStart: 0.6,
  colorStart: new Color(0x3a3a3a), // ciemna szarość
  colorEnd: new Color(0x707070),
};

/** Wrak po zestrzeleniu: najgęstsza, niemal czarna smuga. */
const WRECK_PROFILE: SmokeProfile = {
  particlesPerPuff: 10,
  lifetimeS: 1.8,
  spawnRadiusM: 1.2,
  riseSpeedMs: 4,
  spreadSpeedMs: 3,
  sizeStart: 5,
  sizeEnd: 16,
  opacityStart: 0.75,
  colorStart: new Color(0x161616), // świeży, niemal czarny
  colorEnd: new Color(0x5a5a5a), // rozrzedzony, szary
};

/** Spadający wrak: gęsta, ciągła czarna smuga. */
export const WRECK_TIER: SmokeTier = { profile: WRECK_PROFILE, intervalS: 0.05 };

/**
 * Zwęglony wrak leżący na lądzie po uderzeniu — „lekko dymi": rzadka, cienka, ciemna
 * smużka unosząca się ze szczątków (dłużej żyjące kłęby niż przy spadającym wraku, ale
 * dużo rzadziej emitowane → kolumna dymu zamiast gęstej smugi). Emitowany aż do końca meczu.
 */
const GROUND_FIRE_PROFILE: SmokeProfile = {
  particlesPerPuff: 5,
  lifetimeS: 2.2,
  spawnRadiusM: 0.9,
  riseSpeedMs: 4.5,
  spreadSpeedMs: 1.4,
  sizeStart: 4,
  sizeEnd: 14,
  opacityStart: 0.4,
  colorStart: new Color(0x242424), // ciemny dym palącego się płatowca
  colorEnd: new Color(0x707070), // rozrzedza się do szarości i znika
};

/** Lekki, stały dym zwęglonego wraku na lądzie (rzadki interwał → cienka kolumna). */
export const GROUND_FIRE_TIER: SmokeTier = { profile: GROUND_FIRE_PROFILE, intervalS: 0.2 };

/**
 * Pożar płatowca (faza 22 cz.4): krótkie, jasne, ADDYTYWNE języki ognia migoczące u źródła
 * (silnik / urwana końcówka). Kurczą się i gasną szybko (sizeEnd<sizeStart), więc kolejne kłęby
 * czytają się jako trzepoczący płomień, a nie kula dymu. Towarzyszy mu ciężki, czarny dym (caller
 * podbija poziom dymu kadłuba przy pożarze). Współdzieli budżet MAX_PUFFS — bez nieograniczonego
 * narastania (w odróżnieniu od ponawianych wybuchów Explosions, które nie mają limitu).
 */
const FIRE_PROFILE: SmokeProfile = {
  particlesPerPuff: 6,
  lifetimeS: 0.45,
  spawnRadiusM: 0.5,
  riseSpeedMs: 6,
  spreadSpeedMs: 2.4,
  sizeStart: 8,
  sizeEnd: 2, // płomień kurczy się i gaśnie, zamiast pęcznieć jak dym
  opacityStart: 0.9,
  colorStart: new Color(0xffd070), // jasny, żółto-pomarańczowy rdzeń
  colorEnd: new Color(0xc02808), // ciemnieje do czerwieni i gaśnie
  additive: true,
};

/** Ogień u źródła (silnik / urwana końcówka skrzydła) — gęsto emitowane, krótkie języki. */
export const FIRE_TIER: SmokeTier = { profile: FIRE_PROFILE, intervalS: 0.05 };

const LIGHT_TIER: SmokeTier = { profile: LIGHT_PROFILE, intervalS: 0.16 };
const MEDIUM_TIER: SmokeTier = { profile: MEDIUM_PROFILE, intervalS: 0.11 };
const HEAVY_TIER: SmokeTier = { profile: HEAVY_PROFILE, intervalS: 0.07 };

/** Poziom dymu (0..3) → profil żywej, trafionej maszyny; 0 = brak dymu. Wrak ('dying') używa
 *  osobnego WRECK_TIER. Indeks = poziom (HP albo strefy), wspólny dla wszystkich źródeł. */
const LIVING_TIERS: readonly (SmokeTier | null)[] = [null, LIGHT_TIER, MEDIUM_TIER, HEAVY_TIER];

/** Progi HP (ułamek maxHp) wyznaczające poziom dymu trafionego, ale żywego samolotu. */
const SMOKE_START_FRAC = 0.75; // powyżej — maszyna jeszcze nie dymi
const SMOKE_MEDIUM_FRAC = 0.5;
const SMOKE_HEAVY_FRAC = 0.25;

/** Poziom dymu (0..3) z ułamka HP — wspólny rdzeń damageSmokeTier/livingSmokeTier. */
function hpSmokeLevel(frac: number): number {
  if (frac > SMOKE_START_FRAC) return 0;
  if (frac > SMOKE_MEDIUM_FRAC) return 1;
  if (frac > SMOKE_HEAVY_FRAC) return 2;
  return 3;
}

function clampLevel(level: number): number {
  const n = Math.round(level);
  return n < 0 ? 0 : n > 3 ? 3 : n;
}

/**
 * Dobiera poziom dymu żywego samolotu wg ułamka HP. Zwraca null, gdy maszyna jest
 * mało uszkodzona (HP powyżej progu) i nie powinna dymić. Wrak (po zestrzeleniu)
 * używa osobnego WRECK_TIER — tu obsługujemy tylko żywe, trafione maszyny.
 */
export function damageSmokeTier(hp: number, maxHp: number): SmokeTier | null {
  const frac = maxHp > 0 ? hp / maxHp : 0;
  return LIVING_TIERS[hpSmokeLevel(frac)] ?? null;
}

/**
 * Poziom dymu kadłuba żywej maszyny (faza 22 cz.4): bierze GORSZY z dwóch sygnałów — ogólnej
 * integralności (ułamek HP) i poziomu uszkodzenia SILNIKA (0..3 ze snapshotu v8). Dzięki temu dym
 * „narasta" wraz z degradacją silnika, nawet gdy globalne HP jeszcze wysokie (uszkodzenia modułowe).
 */
export function livingSmokeTier(hpFrac: number, engineLevel: number): SmokeTier | null {
  const level = Math.max(hpSmokeLevel(hpFrac), clampLevel(engineLevel));
  return LIVING_TIERS[level] ?? null;
}

/** Poziom dymu (0..3) konkretnej strefy → profil; 0/1 → brak/lekki (drobne uszkodzenie nie dymi
 *  z końcówki), 2 → średni, 3 → ciężki. Do dymu z urwanej/uszkodzonej końcówki skrzydła. */
export function zoneSmokeTier(level: number): SmokeTier | null {
  const l = clampLevel(level);
  return l >= 2 ? (LIVING_TIERS[l] ?? null) : null;
}

/** Maksymalna liczba żywych kłębów (wszystkie maszyny) — twardy budżet draw calls. */
const MAX_PUFFS = 260;

interface Puff {
  points: Points<BufferGeometry, PointsMaterial>;
  velocities: Float32Array;
  ageS: number;
  /** Profil użyty przy emisji — steruje starzeniem (rozmiar/krycie/barwa). */
  profile: SmokeProfile;
}

export class SmokeTrails {
  private readonly scene: Scene;
  private readonly puffs: Puff[] = [];

  constructor(scene: Scene) {
    this.scene = scene;
  }

  /** Rzuca jeden kłąb dymu danego profilu w punkcie. Caller dawkuje częstotliwość. */
  emit(positionM: Vector3, profile: SmokeProfile): void {
    if (this.puffs.length >= MAX_PUFFS) this.recycleOldest();
    const n = profile.particlesPerPuff;
    const positions = new Float32Array(n * 3);
    const velocities = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const i3 = i * 3;
      positions[i3] = positionM.x + (Math.random() * 2 - 1) * profile.spawnRadiusM;
      positions[i3 + 1] = positionM.y + (Math.random() * 2 - 1) * profile.spawnRadiusM;
      positions[i3 + 2] = positionM.z + (Math.random() * 2 - 1) * profile.spawnRadiusM;
      velocities[i3] = (Math.random() * 2 - 1) * profile.spreadSpeedMs;
      velocities[i3 + 1] = profile.riseSpeedMs + (Math.random() * 2 - 1) * profile.spreadSpeedMs;
      velocities[i3 + 2] = (Math.random() * 2 - 1) * profile.spreadSpeedMs;
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    const material = new PointsMaterial({
      color: profile.colorStart.clone(),
      size: profile.sizeStart,
      transparent: true,
      opacity: profile.opacityStart,
      // dym bywa CIEMNY → NormalBlending (addytywne by go rozjaśniło); ogień jest jasny → addytywne
      blending: profile.additive ? AdditiveBlending : NormalBlending,
      depthWrite: false,
    });
    const points = new Points(geometry, material);
    points.frustumCulled = false; // chmura rozłazi się szybciej niż bounding sphere
    this.scene.add(points);
    this.puffs.push({ points, velocities, ageS: 0, profile });
  }

  /** Natychmiast usuwa wszystkie żywe kłęby dymu (reset meczu / reconnect — bez artefaktów). */
  clear(): void {
    for (let p = this.puffs.length - 1; p >= 0; p--) this.disposePuff(p);
  }

  update(dtS: number): void {
    for (let p = this.puffs.length - 1; p >= 0; p--) {
      const puff = this.puffs[p];
      if (puff === undefined) continue; // nieosiągalne — strict indexed access
      const prof = puff.profile;
      puff.ageS += dtS;
      if (puff.ageS >= prof.lifetimeS) {
        this.disposePuff(p);
        continue;
      }
      const positionAttr = puff.points.geometry.getAttribute('position') as BufferAttribute;
      const positions = positionAttr.array as Float32Array;
      const velocities = puff.velocities;
      for (let i = 0; i < positions.length; i += 3) {
        positions[i] = (positions[i] ?? 0) + (velocities[i] ?? 0) * dtS;
        positions[i + 1] = (positions[i + 1] ?? 0) + (velocities[i + 1] ?? 0) * dtS;
        positions[i + 2] = (positions[i + 2] ?? 0) + (velocities[i + 2] ?? 0) * dtS;
      }
      positionAttr.needsUpdate = true;
      const life01 = puff.ageS / prof.lifetimeS;
      const mat = puff.points.material;
      mat.size = prof.sizeStart + (prof.sizeEnd - prof.sizeStart) * life01;
      mat.opacity = prof.opacityStart * (1 - life01); // liniowe gaśnięcie do zera
      mat.color.copy(prof.colorStart).lerp(prof.colorEnd, life01);
    }
  }

  private recycleOldest(): void {
    if (this.puffs.length > 0) this.disposePuff(0);
  }

  private disposePuff(index: number): void {
    const puff = this.puffs[index];
    if (puff === undefined) return;
    this.scene.remove(puff.points);
    puff.points.geometry.dispose();
    puff.points.material.dispose();
    this.puffs.splice(index, 1);
  }
}
