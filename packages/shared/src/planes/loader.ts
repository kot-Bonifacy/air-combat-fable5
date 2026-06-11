import { PlaneConfigError } from '../errors';
import spitfireMk1Raw from './spitfire-mk1.json';

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
  /** Stała czasowa wygaszania ślizgu bocznego [s] (rozdz. 6.3). */
  sideslipDampingS: number;
  /** Limit przyspieszenia bocznego od siły kadłuba gaszącej ślizg [G]. */
  sideslipMaxAccelG: number;
  stall: StallConfig;
  instructor: InstructorConfig;
}

/** Parametry przeciągnięcia (fizyka-lotu.md rozdz. 6.5). */
export interface StallConfig {
  /** Udział |Cl wymaganego|/clMax, od którego zaczyna się buffet (~0.9 = 10% przed progiem). */
  buffetOnsetRatio: number;
  /** Wymuszone opadanie nosa w przeciągnięciu [°/s]. */
  noseDropRateDegS: number;
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
  'name' | 'rollRateCurve' | 'stall' | 'instructor'
>;

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
  nMaxG: [1, 20],
  nMinG: [-10, 0],
  alignTauS: [0.05, 5],
  sideslipDampingS: [0.05, 5],
  sideslipMaxAccelG: [0.05, 2],
};

const STALL_RANGES: Record<keyof StallConfig, readonly [min: number, max: number]> = {
  buffetOnsetRatio: [0.5, 1],
  noseDropRateDegS: [1, 60],
  aileronEffectiveness: [0, 1],
  wingDropDelayS: [0.1, 10],
  wingDropRateDegS: [1, 180],
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
  'instructor',
  ...Object.keys(NUMERIC_RANGES),
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
  key: 'stall' | 'instructor',
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
  checkSection(obj, 'instructor', INSTRUCTOR_RANGES, problems);

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

/** Spitfire Mk I — walidowany przy imporcie modułu (fail fast). */
export const SPITFIRE_MK1: PlaneConfig = loadPlaneConfig(spitfireMk1Raw, 'spitfire-mk1.json');

/** Współczynnik oporu indukowanego K = 1/(π·e·AR) z biegunowej Cd = Cd0 + K·Cl². */
export function inducedDragFactor(plane: PlaneConfig): number {
  return 1 / (Math.PI * plane.oswaldE * plane.aspectRatio);
}
