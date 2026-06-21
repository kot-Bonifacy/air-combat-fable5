import { PlaneConfigError } from '../errors';
import spitfireMk2Raw from './spitfire-mk2.json';
import bf109Raw from './bf109-e.json';

/**
 * Parametry samolotu — schemat z docs/fizyka-lotu.md rozdz. 9.
 * Liczby żyją WYŁĄCZNIE w JSON (niezmiennik nr 3). Jednostki w JSON są
 * "ludzkie" tam, gdzie służą strojeniu (km/h, °/s, °) — konwersja do SI
 * następuje w modułach, które ich używają (envelope/stall/instructor).
 */
export interface PlaneConfig {
  name: string;
  massKg: number;
  wingAreaM2: number;
  aspectRatio: number;
  oswaldE: number;
  cd0: number;
  clMax: number;
  clAlphaPerRad: number;
  enginePowerW: number;
  fullThrottleHeightM: number;
  propEfficiency: number;
  staticThrustN: number;
  /**
   * Wytrzymałość pełnego baku przy 100% gazu [s] — czas do wyczerpania paliwa lecąc
   * na pełnym gazie (zużycie jest proporcjonalne do gazu, więc 50% gazu = 2× dłużej).
   * Po wyczerpaniu silnik gaśnie (T=0). 900 = 15 min na pełnym gazie.
   */
  fuelEnduranceFullThrottleS: number;
  /** Limit strukturalny przeciążenia dodatniego [G]. */
  nMaxG: number;
  /** Limit strukturalny przeciążenia ujemnego [G] (liczba ujemna). */
  nMinG: number;
  /**
   * Krzywa roll rate vs IAS: punkty [IAS km/h, °/s], interpolacja liniowa,
   * poza zakresem wartości brzegowe (fizyka-lotu.md rozdz. 6.2).
   */
  rollRateCurve: readonly (readonly [iasKmh: number, rollRateDegS: number])[];
  /** Stała czasowa weathervaningu nosa do toru lotu [s] (rozdz. 6.4). */
  alignTauS: number;
  /**
   * Limit tempa weathervaningu [°/s] — przy dużym błędzie nos↔tor (tailslide,
   * błąd ~180°) kąt/τ dawałby setki °/s; limit robi z tego płynny przewrót.
   */
  weathervaneMaxRateDegS: number;
  /** Stała czasowa wygaszania ślizgu bocznego [s] (rozdz. 6.3). */
  sideslipDampingS: number;
  /** Limit przyspieszenia bocznego od siły kadłuba gaszącej ślizg [G]. */
  sideslipMaxAccelG: number;
  /** Globalna pula HP płatowca (model bezstrefowy MVP; strefy → faza 17). */
  hpPool: number;
  /** Promień sfery trafień płatowca [m] (model jednosferowy MVP; strefy → faza 17). */
  hitRadiusM: number;
  /**
   * Promień sfery KOLIZJI płatowiec↔płatowiec [m]. Dwa samoloty zderzają się, gdy
   * odległość ich środków spadnie poniżej sumy promieni (dwa Spitfire'y: 3+3 = 6 m).
   * Osobny od hitRadiusM (sfera trafień pociskami) — fizyczny obrys kadłuba jest
   * ciaśniejszy niż kula, w którą „liczą się" pociski.
   */
  collisionRadiusM: number;
  stall: StallConfig;
  gTolerance: GToleranceConfig;
  instructor: InstructorConfig;
  armament: Armament;
  wreck: WreckConfig;
}

/** Parametry tolerancji przeciążenia pilota / G-LOC (physics/g-load.ts). */
export interface GToleranceConfig {
  /** Próg [G], powyżej którego ubywa rezerwy i zaczyna się szarzenie; poniżej rezerwa wraca. */
  onsetG: number;
  /** Budżet [G·s nadwyżki ponad onsetG] na pełne wyczerpanie rezerwy (mniejszy = szybsze zaciemnienie). */
  toleranceGS: number;
  /** Tempo odbudowy rezerwy poniżej onsetG [1/s] (wzrok wraca po odpuszczeniu). */
  recoveryRatePerS: number;
  /** Poziom rezerwy [0..1], od którego (w dół) narasta zaciemnienie obrazu. */
  greyoutReserve: number;
}

/** Parametry zachowania zestrzelonego wraku (zniszczenie w powietrzu). */
export interface WreckConfig {
  /**
   * Bazowe przeciążenie wraku bez inputu pilota [G]. MUSI być < 1, inaczej wrak
   * utrzymywałby lot poziomy (szybowanie) zamiast opadać. 0 = brak siły nośnej
   * (czysty opad balistyczny + opór), ~0.35 = łagodny, narastający opad.
   */
  baseLoadG: number;
  /**
   * Sterowność wysokości spadającego wraku [0..1]: ułamek, o jaki ster wysokości
   * gracza odchyla żądane n od baseLoadG. 0 = ster wysokości martwy (gracz nie
   * wyprowadza), 1 = pełny. Lotki działają zawsze w pełni (niezależnie od tej wartości).
   */
  pitchAuthority: number;
}

/**
 * Jedna GRUPA broni (faza 5; faza 19: wiele typów uzbrojenia na samolocie).
 * Grupa = zestaw luf tego samego typu (np. wszystkie .303, albo 2× MG FF 20 mm)
 * o wspólnej balistyce, kadencji i zapasie. Samolot ma ≥1 grupę (Spitfire: jedna
 * z 8 kaemami; Bf 109 E-3: MG 17 + MG FF). Każda grupa strzela niezależnie własną
 * kadencją i wytwarza pociski o własnej balistyce (prędkość/opór/dmg/czas życia).
 */
export interface WeaponGroup {
  /** Nazwa typu broni do HUD/debug (np. ".303 Browning", "MG 17", "MG FF"). */
  name: string;
  /** Prędkość wylotowa pocisku względem samolotu [m/s] (.303 ≈ 744, MG FF ≈ 600). */
  muzzleVelocityMs: number;
  /** Odległość konwergencji luf [m] — punkt, w którym schodzą się strumienie. */
  convergenceM: number;
  /**
   * Podniesienie punktu celowania nad oś [m] — kompensacja opadu grawitacyjnego
   * na dystansie zbieżności (≈ opad pocisku na convergenceM), żeby trafienia
   * siadały NA linii celownika, nie pod nią. 0 = brak kompensacji.
   */
  convergenceRiseM: number;
  /** Kadencja POJEDYNCZEJ lufy [pocisków/min]; salwa = wszystkie lufy grupy naraz. */
  fireRateRpmPerGun: number;
  /** Zapas amunicji na lufę [szt.]. */
  ammoPerGun: number;
  /** Rozrzut: promień stożka losowego odchylenia kierunku [milliradiany]. */
  dispersionMrad: number;
  /** Obrażenia jednego trafienia [HP]. */
  damagePerHit: number;
  /** Współczynnik oporu kwadratowego pocisku k [1/m] (a = −k·|v|·v). */
  bulletDragK: number;
  /** Czas życia pocisku [s] — po nim gaśnie (cap zasięgu). */
  bulletLifetimeS: number;
  /**
   * Pozycje wylotów luf w body frame [m] (+Z nos, +Y góra, +X LEWE skrzydło).
   * Liczba pozycji = liczba luf w grupie. Kierunek każdego pocisku: do punktu konwergencji.
   */
  muzzles: readonly (readonly [x: number, y: number, z: number])[];
}

/**
 * Uzbrojenie samolotu = lista grup broni (faza 19). Pierwsza grupa jest „główna"
 * (primaryGroup) — używana tam, gdzie potrzeba jednej reprezentatywnej broni
 * (wyprzedzenie bota, kosmetyczne smugacze online). Strzelają WSZYSTKIE grupy.
 */
export interface Armament {
  groups: readonly WeaponGroup[];
}

/** Parametry przeciągnięcia (fizyka-lotu.md rozdz. 6.5). */
export interface StallConfig {
  /** Udział |Cl wymaganego|/clMax, od którego zaczyna się buffet (~0.9 = 10% przed progiem). */
  buffetOnsetRatio: number;
  /** Mnożnik sterowności lotek w przeciągnięciu (~0.3). */
  aileronEffectiveness: number;
  /** Czas trzymania przeciągnięcia do wing dropu [s]. */
  wingDropDelayS: number;
  /** Tempo przewrotu wing dropu [°/s]. */
  wingDropRateDegS: number;
}

/** Parametry instruktora mouse-aim (fizyka-lotu.md rozdz. 7). */
export interface InstructorConfig {
  /** Wzmocnienie P pętli roll [1/s]: rad/s żądania na rad błędu przechylenia. */
  aggressivenessRoll: number;
  /** Wzmocnienie P ciągnięcia [G/rad]: żądane n ponad bazę na rad błędu w płaszczyźnie symetrii. */
  aggressivenessPitch: number;
  /**
   * Bank-and-pull [°]: poniżej tego błędu przechylenia ciągnięcie pełne,
   * powyżej wygaszane liniowo do zera przy 2× progu.
   */
  bankThresholdDeg: number;
  /** Stożek wokół nosa [°], w którym cel poniżej toru koryguje się pchnięciem zamiast beczki. */
  pushoverConeDeg: number;
  /** Stała czasowa wygładzania żądań (filtr 1. rzędu) [s]. */
  smoothingTauS: number;
  /** Wzmocnienie P doważania yaw [1/s]. */
  yawGain: number;
  /** Limit żądania yaw [°/s]. */
  maxYawRateDegS: number;
}

type NumericKey = Exclude<
  keyof PlaneConfig,
  'name' | 'rollRateCurve' | 'stall' | 'gTolerance' | 'instructor' | 'armament' | 'wreck'
>;

/** Pola skalarne grupy broni (bez `name`/`muzzles`, walidowanych osobno). */
type WeaponGroupNumericKey = Exclude<keyof WeaponGroup, 'name' | 'muzzles'>;

// Zakresy sanity per pole — łapią literówki i pomyłki jednostek
// (np. moc w kW zamiast W wypada poniżej minimum).
const NUMERIC_RANGES: Record<NumericKey, readonly [min: number, max: number]> = {
  massKg: [100, 200_000],
  wingAreaM2: [1, 1000],
  aspectRatio: [1, 20],
  oswaldE: [0.1, 1],
  cd0: [0.001, 0.2],
  clMax: [0.5, 5],
  clAlphaPerRad: [1, 10],
  enginePowerW: [10_000, 100_000_000],
  fullThrottleHeightM: [0, 20_000],
  propEfficiency: [0.1, 1],
  staticThrustN: [100, 10_000_000],
  fuelEnduranceFullThrottleS: [60, 36_000],
  nMaxG: [1, 20],
  nMinG: [-10, 0],
  alignTauS: [0.05, 5],
  weathervaneMaxRateDegS: [10, 720],
  sideslipDampingS: [0.05, 5],
  sideslipMaxAccelG: [0.05, 2],
  hpPool: [1, 100_000],
  hitRadiusM: [1, 50],
  collisionRadiusM: [0.5, 30],
};

const WEAPON_GROUP_RANGES: Record<WeaponGroupNumericKey, readonly [min: number, max: number]> = {
  muzzleVelocityMs: [100, 1500],
  convergenceM: [50, 1000],
  convergenceRiseM: [0, 5],
  fireRateRpmPerGun: [100, 2000],
  ammoPerGun: [10, 5000],
  dispersionMrad: [0, 50],
  damagePerHit: [0.1, 1000],
  bulletDragK: [0, 0.02],
  bulletLifetimeS: [0.5, 10],
};

const STALL_RANGES: Record<keyof StallConfig, readonly [min: number, max: number]> = {
  buffetOnsetRatio: [0.5, 1],
  aileronEffectiveness: [0, 1],
  wingDropDelayS: [0.1, 10],
  wingDropRateDegS: [1, 180],
};

const G_TOLERANCE_RANGES: Record<keyof GToleranceConfig, readonly [min: number, max: number]> = {
  onsetG: [1, 12],
  toleranceGS: [0.5, 60],
  recoveryRatePerS: [0.01, 5],
  greyoutReserve: [0, 1],
};

const WRECK_RANGES: Record<keyof WreckConfig, readonly [min: number, max: number]> = {
  baseLoadG: [0, 1],
  pitchAuthority: [0, 1],
};

const INSTRUCTOR_RANGES: Record<keyof InstructorConfig, readonly [min: number, max: number]> = {
  aggressivenessRoll: [0.1, 30],
  aggressivenessPitch: [0.1, 30],
  bankThresholdDeg: [1, 90],
  pushoverConeDeg: [0, 90],
  smoothingTauS: [0.01, 2],
  yawGain: [0, 10],
  maxYawRateDegS: [0, 45],
};

const KNOWN_KEYS = new Set<string>([
  'name',
  'rollRateCurve',
  'stall',
  'gTolerance',
  'instructor',
  'armament',
  'wreck',
  ...Object.keys(NUMERIC_RANGES),
]);

const WEAPON_GROUP_KNOWN_KEYS = new Set<string>([
  'name',
  'muzzles',
  ...Object.keys(WEAPON_GROUP_RANGES),
]);

function checkNumericFields(
  obj: Record<string, unknown>,
  ranges: Record<string, readonly [number, number]>,
  prefix: string,
  problems: string[],
): void {
  for (const [key, [min, max]] of Object.entries(ranges)) {
    const value = obj[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      problems.push(`${prefix}${key}: oczekiwano skończonej liczby, jest ${JSON.stringify(value)}`);
    } else if (value < min || value > max) {
      problems.push(
        `${prefix}${key}: ${String(value)} poza zakresem sanity [${String(min)}, ${String(max)}]`,
      );
    }
  }
}

function checkSection(
  obj: Record<string, unknown>,
  key: 'stall' | 'gTolerance' | 'instructor' | 'wreck',
  ranges: Record<string, readonly [number, number]>,
  problems: string[],
): void {
  const section = obj[key];
  if (typeof section !== 'object' || section === null || Array.isArray(section)) {
    problems.push(`${key}: oczekiwano obiektu`);
    return;
  }
  const sectionObj = section as Record<string, unknown>;
  checkNumericFields(sectionObj, ranges, `${key}.`, problems);
  for (const subKey of Object.keys(sectionObj)) {
    if (!(subKey in ranges)) problems.push(`${key}.${subKey}: nieznane pole (literówka?)`);
  }
}

function checkRollRateCurve(obj: Record<string, unknown>, problems: string[]): void {
  const curve = obj['rollRateCurve'];
  if (!Array.isArray(curve) || curve.length < 2) {
    problems.push('rollRateCurve: oczekiwano tablicy ≥2 punktów [IAS km/h, °/s]');
    return;
  }
  let prevIas = -Infinity;
  curve.forEach((point, i) => {
    if (!Array.isArray(point) || point.length !== 2) {
      problems.push(`rollRateCurve[${String(i)}]: oczekiwano pary [IAS km/h, °/s]`);
      return;
    }
    const [ias, rate] = point as [unknown, unknown];
    if (typeof ias !== 'number' || !Number.isFinite(ias) || ias < 0 || ias > 1500) {
      problems.push(`rollRateCurve[${String(i)}][0]: IAS ${JSON.stringify(ias)} poza [0, 1500] km/h`);
    } else if (ias <= prevIas) {
      problems.push(`rollRateCurve[${String(i)}][0]: IAS musi rosnąć monotonicznie`);
    } else {
      prevIas = ias;
    }
    if (typeof rate !== 'number' || !Number.isFinite(rate) || rate < 0 || rate > 720) {
      problems.push(
        `rollRateCurve[${String(i)}][1]: rate ${JSON.stringify(rate)} poza [0, 720] °/s`,
      );
    }
  });
}

function checkMuzzles(group: Record<string, unknown>, prefix: string, problems: string[]): void {
  const muzzles = group['muzzles'];
  if (!Array.isArray(muzzles) || muzzles.length < 1) {
    problems.push(`${prefix}muzzles: oczekiwano tablicy ≥1 pozycji [x,y,z] w body frame [m]`);
    return;
  }
  muzzles.forEach((m, i) => {
    if (!Array.isArray(m) || m.length !== 3) {
      problems.push(`${prefix}muzzles[${String(i)}]: oczekiwano trójki [x,y,z]`);
      return;
    }
    (m as unknown[]).forEach((v, axis) => {
      if (typeof v !== 'number' || !Number.isFinite(v) || v < -15 || v > 15) {
        problems.push(
          `${prefix}muzzles[${String(i)}][${String(axis)}]: ${JSON.stringify(v)} poza [−15, 15] m`,
        );
      }
    });
  });
}

function checkWeaponGroup(raw: unknown, prefix: string, problems: string[]): void {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    problems.push(`${prefix.slice(0, -1)}: oczekiwano obiektu grupy broni`);
    return;
  }
  const group = raw as Record<string, unknown>;
  const name = group['name'];
  if (typeof name !== 'string' || name.trim() === '') {
    problems.push(`${prefix}name: oczekiwano niepustego stringa, jest ${JSON.stringify(name)}`);
  }
  checkNumericFields(group, WEAPON_GROUP_RANGES, prefix, problems);
  checkMuzzles(group, prefix, problems);
  for (const key of Object.keys(group)) {
    if (!WEAPON_GROUP_KNOWN_KEYS.has(key)) problems.push(`${prefix}${key}: nieznane pole (literówka?)`);
  }
}

function checkArmament(obj: Record<string, unknown>, problems: string[]): void {
  const section = obj['armament'];
  if (typeof section !== 'object' || section === null || Array.isArray(section)) {
    problems.push('armament: oczekiwano obiektu z polem groups');
    return;
  }
  const groups = (section as Record<string, unknown>)['groups'];
  if (!Array.isArray(groups) || groups.length < 1) {
    problems.push('armament.groups: oczekiwano tablicy ≥1 grupy broni');
    return;
  }
  groups.forEach((g, i) => checkWeaponGroup(g, `armament.groups[${String(i)}].`, problems));
  for (const key of Object.keys(section as Record<string, unknown>)) {
    if (key !== 'groups') problems.push(`armament.${key}: nieznane pole (literówka?)`);
  }
}

/**
 * Walidacja schematu przy ładowaniu: wymagane pola, typy, zakresy sanity,
 * brak nieznanych kluczy. Wszystkie problemy zbierane do jednego wyjątku.
 */
export function loadPlaneConfig(raw: unknown, source = 'konfiguracja samolotu'): PlaneConfig {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new PlaneConfigError(`${source}: oczekiwano obiektu JSON`);
  }
  const obj = raw as Record<string, unknown>;
  const problems: string[] = [];

  const name = obj['name'];
  if (typeof name !== 'string' || name.trim() === '') {
    problems.push(`name: oczekiwano niepustego stringa, jest ${JSON.stringify(name)}`);
  }

  checkNumericFields(obj, NUMERIC_RANGES, '', problems);
  checkRollRateCurve(obj, problems);
  checkSection(obj, 'stall', STALL_RANGES, problems);
  checkSection(obj, 'gTolerance', G_TOLERANCE_RANGES, problems);
  checkSection(obj, 'instructor', INSTRUCTOR_RANGES, problems);
  checkSection(obj, 'wreck', WRECK_RANGES, problems);
  checkArmament(obj, problems);

  const nMin = obj['nMinG'];
  if (typeof nMin === 'number' && nMin >= 0) {
    problems.push(`nMinG: ${String(nMin)} — limit ujemny musi być < 0`);
  }

  for (const key of Object.keys(obj)) {
    if (!KNOWN_KEYS.has(key)) problems.push(`${key}: nieznane pole (literówka?)`);
  }

  if (problems.length > 0) {
    throw new PlaneConfigError(`${source}: niepoprawna konfiguracja:\n- ${problems.join('\n- ')}`);
  }
  // po walidacji obiekt spełnia strukturę PlaneConfig
  return obj as unknown as PlaneConfig;
}

/** Spitfire Mk IIa — walidowany przy imporcie modułu (fail fast). */
export const SPITFIRE_MK2: PlaneConfig = loadPlaneConfig(spitfireMk2Raw, 'spitfire-mk2.json');

/** Bf 109 E-3 (DB 601A) — energy-fighter (faza 19), walidowany przy imporcie. */
export const BF109_E: PlaneConfig = loadPlaneConfig(bf109Raw, 'bf109-e.json');

/** Współczynnik oporu indukowanego K = 1/(π·e·AR) z biegunowej Cd = Cd0 + K·Cl². */
export function inducedDragFactor(plane: PlaneConfig): number {
  return 1 / (Math.PI * plane.oswaldE * plane.aspectRatio);
}

/**
 * Rozpiętość skrzydeł [m] z geometrii: b = √(AR·S) (definicja wydłużenia AR = b²/S).
 * Jedyne źródło prawdy do auto-skalowania modelu 3D w kliencie (Spitfire ≈ 11,2 m,
 * Bf 109 E ≈ 9,9 m) — bez osobnego pola w JSON, które mogłoby się rozjechać z aerodynamiką.
 */
export function wingspanM(plane: PlaneConfig): number {
  return Math.sqrt(plane.aspectRatio * plane.wingAreaM2);
}
