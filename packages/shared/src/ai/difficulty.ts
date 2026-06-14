import { MS_TO_KMH } from '../constants';
import { AiConfigError } from '../errors';
import difficultyRaw from './difficulty.json';

// Strojenie botów i poziomy trudności (faza-06.md): liczby żyją w JSON
// (niezmiennik nr 3). `tuning` to wspólna geometria/zachowanie FSM, `levels` to
// degradacja per poziom (czas reakcji, szum celowania, limit G, throttle,
// dyscyplina ognia). Jednostki w JSON "ludzkie" (°, km/h) — tu konwersja do SI.

const DEG_TO_RAD = Math.PI / 180;
const KMH_TO_MS = 1 / MS_TO_KMH;

/** Wspólne progi FSM/sterowania (SI), niezależne od poziomu trudności. */
export interface BotTuning {
  /** patrol → engage, gdy cel bliżej niż to [m]. */
  detectRangeM: number;
  /** engage → patrol, gdy cel dalej niż to [m] (histereza > detect). */
  disengageRangeM: number;
  /** Cel "na moim ogonie", gdy jego off-boresight < tego [rad]. */
  threatConeRad: number;
  /** ...i mój off-boresight > tego [rad] (cel za linią 3-9). */
  threatBehindRad: number;
  /** ...i dystans < tego [m]. */
  threatRangeM: number;
  /** Pozycja ofensywna (engage trzyma się mimo małej energii), gdy mój off-boresight < tego [rad]. */
  offensiveConeRad: number;
  /** ...i dystans < tego [m]. */
  offensiveRangeM: number;
  /** Poniżej tego dystansu engage zdejmuje gaz (unikanie taranowania) [m]. */
  minRangeM: number;
  /** Minimalny dystans otwarcia ognia [m] (zbyt blisko = ryzyko kolizji). */
  minFireRangeM: number;
  /** Próg "mała energia" → rozważ extend [m/s IAS]. */
  lowEnergyIasMs: number;
  /** Próg "energia odbudowana" → wyjście z extend [m/s IAS]. */
  recoveredEnergyIasMs: number;
  /** Gaz przelotowy w patrol/extend bazie. */
  cruiseThrottle: number;
  /** Kąt zrywu (break) od bieżącego kierunku nosa w evade [rad]. */
  evadeBreakRad: number;
  /** Amplituda zwodu (jink) w evade [rad]. */
  evadeJinkRad: number;
  /** Okres zwodu w evade [s]. */
  evadeJinkPeriodS: number;
  /** Kąt zniżania w extend [rad]. */
  extendDiveRad: number;
  /** Promień zaliczenia waypointu w patrol [m]. */
  waypointReachedM: number;
  /** Margines bezpieczeństwa nad terenem dla predykcji (start wyrównania) [m]. */
  groundSafetyMarginM: number;
  /** Twarda podłoga AGL — poniżej zawsze wznoszenie [m]. */
  groundHardFloorM: number;
  /** Horyzont predykcji zderzenia z terenem [s]. */
  groundLookAheadS: number;
  /** Kąt wznoszenia przy override unikania ziemi [rad]. */
  groundClimbRad: number;
  /** Maksymalny kąt zniżania dozwolony wysoko nad terenem [rad] (sufit AGL go zaostrza nisko). */
  maxDiveRad: number;
}

/** Degradacja per poziom trudności (SI). */
export interface BotDifficulty {
  /** Stała czasowa opóźnienia reakcji / wodzenia celownika [s]. */
  reactionTimeS: number;
  /** Amplituda błądzącego szumu celowania [rad]. */
  aimErrorRad: number;
  /** Limit przeciążenia bota [G] (ogranicza energiczność skrętu przez interfejs instruktora). */
  maxG: number;
  /** Maksymalny gaz bota 0..1. */
  throttle: number;
  /** Maksymalny dystans otwarcia ognia [m]. */
  fireRangeM: number;
  /** Stożek otwarcia ognia [rad]: nos musi być w nim względem rozwiązania wyprzedzenia. */
  fireConeRad: number;
}

export type DifficultyLevel = 'latwy' | 'normalny' | 'trudny';

export const DIFFICULTY_LEVELS: readonly DifficultyLevel[] = ['latwy', 'normalny', 'trudny'];

export interface BotConfig {
  tuning: BotTuning;
  levels: Record<DifficultyLevel, BotDifficulty>;
}

// Zakresy sanity — łapią literówki i pomyłki jednostek (np. dystans w km zamiast m).
const TUNING_RANGES: Record<string, readonly [min: number, max: number]> = {
  detectRangeM: [200, 10000],
  disengageRangeM: [300, 12000],
  threatConeDeg: [5, 90],
  threatBehindDeg: [45, 135],
  threatRangeM: [100, 3000],
  offensiveConeDeg: [3, 60],
  offensiveRangeM: [100, 2000],
  minRangeM: [10, 500],
  minFireRangeM: [10, 500],
  lowEnergyIasKmh: [50, 500],
  recoveredEnergyIasKmh: [80, 700],
  cruiseThrottle: [0.3, 1],
  evadeBreakDeg: [30, 110],
  evadeJinkDeg: [0, 60],
  evadeJinkPeriodS: [0.3, 6],
  extendDiveDeg: [0, 45],
  waypointReachedM: [50, 2000],
  groundSafetyMarginM: [50, 1500],
  groundHardFloorM: [20, 1000],
  groundLookAheadS: [0.5, 15],
  groundClimbDeg: [5, 60],
  maxDiveDeg: [15, 80],
};

const LEVEL_RANGES: Record<string, readonly [min: number, max: number]> = {
  reactionTimeS: [0.02, 2],
  aimErrorDeg: [0, 15],
  maxG: [1.5, 10],
  throttle: [0.3, 1],
  fireRangeM: [100, 1000],
  fireConeDeg: [0.5, 20],
};

function num(obj: Record<string, unknown>, key: string, prefix: string, problems: string[]): number {
  const v = obj[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    problems.push(`${prefix}${key}: oczekiwano skończonej liczby, jest ${JSON.stringify(v)}`);
    return NaN;
  }
  const range = (prefix.startsWith('levels.') ? LEVEL_RANGES : TUNING_RANGES)[key];
  if (range && (v < range[0] || v > range[1])) {
    problems.push(`${prefix}${key}: ${String(v)} poza zakresem sanity [${String(range[0])}, ${String(range[1])}]`);
  }
  return v;
}

function asObject(value: unknown, label: string, problems: string[]): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    problems.push(`${label}: oczekiwano obiektu`);
    return {};
  }
  return value as Record<string, unknown>;
}

function checkUnknown(
  obj: Record<string, unknown>,
  known: readonly string[],
  prefix: string,
  problems: string[],
): void {
  const set = new Set(known);
  for (const key of Object.keys(obj)) {
    if (!set.has(key)) problems.push(`${prefix}${key}: nieznane pole (literówka?)`);
  }
}

/**
 * Walidacja + konwersja JSON → runtime (SI). Wszystkie problemy zbierane do
 * jednego wyjątku (fail fast przy imporcie modułu, jak loader samolotu).
 */
export function loadBotConfig(raw: unknown, source = 'difficulty.json'): BotConfig {
  const problems: string[] = [];
  const root = asObject(raw, source, problems);
  const t = asObject(root['tuning'], 'tuning', problems);
  checkUnknown(t, Object.keys(TUNING_RANGES), 'tuning.', problems);

  const tuning: BotTuning = {
    detectRangeM: num(t, 'detectRangeM', 'tuning.', problems),
    disengageRangeM: num(t, 'disengageRangeM', 'tuning.', problems),
    threatConeRad: num(t, 'threatConeDeg', 'tuning.', problems) * DEG_TO_RAD,
    threatBehindRad: num(t, 'threatBehindDeg', 'tuning.', problems) * DEG_TO_RAD,
    threatRangeM: num(t, 'threatRangeM', 'tuning.', problems),
    offensiveConeRad: num(t, 'offensiveConeDeg', 'tuning.', problems) * DEG_TO_RAD,
    offensiveRangeM: num(t, 'offensiveRangeM', 'tuning.', problems),
    minRangeM: num(t, 'minRangeM', 'tuning.', problems),
    minFireRangeM: num(t, 'minFireRangeM', 'tuning.', problems),
    lowEnergyIasMs: num(t, 'lowEnergyIasKmh', 'tuning.', problems) * KMH_TO_MS,
    recoveredEnergyIasMs: num(t, 'recoveredEnergyIasKmh', 'tuning.', problems) * KMH_TO_MS,
    cruiseThrottle: num(t, 'cruiseThrottle', 'tuning.', problems),
    evadeBreakRad: num(t, 'evadeBreakDeg', 'tuning.', problems) * DEG_TO_RAD,
    evadeJinkRad: num(t, 'evadeJinkDeg', 'tuning.', problems) * DEG_TO_RAD,
    evadeJinkPeriodS: num(t, 'evadeJinkPeriodS', 'tuning.', problems),
    extendDiveRad: num(t, 'extendDiveDeg', 'tuning.', problems) * DEG_TO_RAD,
    waypointReachedM: num(t, 'waypointReachedM', 'tuning.', problems),
    groundSafetyMarginM: num(t, 'groundSafetyMarginM', 'tuning.', problems),
    groundHardFloorM: num(t, 'groundHardFloorM', 'tuning.', problems),
    groundLookAheadS: num(t, 'groundLookAheadS', 'tuning.', problems),
    groundClimbRad: num(t, 'groundClimbDeg', 'tuning.', problems) * DEG_TO_RAD,
    maxDiveRad: num(t, 'maxDiveDeg', 'tuning.', problems) * DEG_TO_RAD,
  };

  const levelsRaw = asObject(root['levels'], 'levels', problems);
  checkUnknown(levelsRaw, DIFFICULTY_LEVELS, 'levels.', problems);
  const levels = {} as Record<DifficultyLevel, BotDifficulty>;
  for (const lvl of DIFFICULTY_LEVELS) {
    const l = asObject(levelsRaw[lvl], `levels.${lvl}`, problems);
    const prefix = `levels.${lvl}.`;
    checkUnknown(l, Object.keys(LEVEL_RANGES), prefix, problems);
    levels[lvl] = {
      reactionTimeS: num(l, 'reactionTimeS', prefix, problems),
      aimErrorRad: num(l, 'aimErrorDeg', prefix, problems) * DEG_TO_RAD,
      maxG: num(l, 'maxG', prefix, problems),
      throttle: num(l, 'throttle', prefix, problems),
      fireRangeM: num(l, 'fireRangeM', prefix, problems),
      fireConeRad: num(l, 'fireConeDeg', prefix, problems) * DEG_TO_RAD,
    };
  }

  checkUnknown(root, ['tuning', 'levels'], '', problems);

  if (problems.length > 0) {
    throw new AiConfigError(`${source}: niepoprawna konfiguracja:\n- ${problems.join('\n- ')}`);
  }
  return { tuning, levels };
}

/** Konfiguracja botów — walidowana przy imporcie modułu (fail fast). */
export const BOT_CONFIG: BotConfig = loadBotConfig(difficultyRaw, 'difficulty.json');
