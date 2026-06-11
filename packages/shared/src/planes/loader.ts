import { PlaneConfigError } from '../errors';
import spitfireMk1Raw from './spitfire-mk1.json';

/**
 * Parametry samolotu — podzbiór schematu z docs/fizyka-lotu.md rozdz. 9
 * używany w fazie 2 (siły). Pola koperty sterowności i instruktora dojdą
 * w fazie 3. Liczby żyją WYŁĄCZNIE w JSON (niezmiennik nr 3).
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
}

type NumericKey = Exclude<keyof PlaneConfig, 'name'>;

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
};

const KNOWN_KEYS = new Set<string>(['name', ...Object.keys(NUMERIC_RANGES)]);

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

  for (const [key, [min, max]] of Object.entries(NUMERIC_RANGES)) {
    const value = obj[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      problems.push(`${key}: oczekiwano skończonej liczby, jest ${JSON.stringify(value)}`);
    } else if (value < min || value > max) {
      problems.push(`${key}: ${String(value)} poza zakresem sanity [${String(min)}, ${String(max)}]`);
    }
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
