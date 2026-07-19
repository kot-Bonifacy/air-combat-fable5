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
  /** Czas trwania zrywu obronnego po trafieniu [s] — wspólny dla poziomów, które reagują na ostrzał. */
  hitReactionDurationS: number;
}

/** Degradacja per poziom trudności (SI). Pola „asa" (poziom `as`, 2026-07-12) są knobami
 *  liczbowymi z konwencją 0 = zachowanie wyłączone / użyj wspólnego tuning — dzięki temu
 *  niższe poziomy pozostają BITOWO identyczne z dotychczasowymi (decyzja usera: antykolizja
 *  i cała świadomość sytuacyjna TYLKO na b.trudnym). */
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
  /** Opóźnienie zrywu obronnego po otrzymaniu trafienia [s]; 0 = poziom nie reaguje na ostrzał
   *  (tylko „trudny"+ jink-uje po trafieniu — niższe poziomy lecą prosto). */
  hitReactionDelayS: number;
  /** Bańka separacji od KAŻDEGO samolotu (też sojusznika) [m]; 0 = brak antykolizji.
   *  Bot przewiduje punkt największego zbliżenia (CPA) i odchyla kurs — leczy „sklejanie
   *  się skrzydłami" dwóch botów goniących ten sam cel. */
  separationRangeM: number;
  /** Dystans, poniżej którego przy geometrii czołowej bot robi boczny offset zamiast celować
   *  w przeciwnika [m]; 0 = gra w cykora jak dotąd (unikanie czołówek — tylko as). */
  headOnAvoidRangeM: number;
  /** Zasięg skanu zagrożeń z tylnej półsfery po WSZYSTKICH wrogach (nie tylko bieżącym celu)
   *  [m]; 0 = bot widzi zagrożenie wyłącznie od swojego celu (jak dotąd). */
  checkSixRangeM: number;
  /** WEP bota: >0 = dopalacz ZAWSZE przy pełnym gazie (decyzja usera 2026-07-12 — as lata
   *  na WEP bez limitu; boty są immune na obrażenia z przegrzania, decyzja 2026-06-30);
   *  0 = bot nigdy nie włącza WEP. */
  useWep: number;
  /** Minimalny autorytet lotek (maxRoll(IAS)/szczyt krzywej), poniżej którego bot w walce
   *  MANEWROWEJ redukuje gaz (prędkość bojowa per samolot — Zero zwalnia z „betonu",
   *  Spit/Bf prawie nieodczuwalne); 0 = pełny gaz zawsze. */
  rollAuthorityMinFrac: number;
  /** Próg prędkości zbliżania [m/s], powyżej którego bot w strefie strzału zdejmuje gaz
   *  (i WEP), by NIE wyprzedzić wolniejszego celu, za którym siedzi — zamiast przelecieć
   *  na dopalaczu, dopasowuje prędkość i zostaje na ogonie. Działa TYLKO gdy bot jest z celem
   *  „sam" (żaden inny żywy wróg w promieniu 1 km) — w kłębowisku nadmiar prędkości to
   *  przewaga (dynamiczna sytuacja), więc guard się wyłącza. 0 = bez kontroli przestrzelenia
   *  (niższe poziomy: pełny gaz aż do minRangeM). Poza strefą strzału pełny gaz (energia). */
  overshootGuardClosureMs: number;
  /** Nieprzewidywalność obrony 0..1: losowe okresy/amplitudy jinku + rewers (nożyce) przy
   *  przestrzeleniu wroga; 0 = stary regularny sinus. */
  evadeVariety01: number;
  /** Powyżej tego dystansu do celu [m] bot strzela KRÓTKIMI SERIAMI (przerywany ogień —
   *  nie wystrzeliwuje całej amunicji na dalekim, mniej celnym dystansie); 0 = ogień ciągły
   *  jak niższe poziomy. Bliżej progu (pewny strzał) ogień jest ciągły. */
  burstFireRangeM: number;
  /** Kompensacja opadu grawitacyjnego w celowaniu 0..1 (bot podnosi namiar o
   *  frac·½·g·t² na czasie lotu pocisku). 0 = bez kompensacji (jak dotąd — pocisk pada pod
   *  cel na dalekim dystansie, bo convergenceRise przystrzeliwuje tylko do ~200 m); 1 = pełna
   *  (as celuje z uwzględnieniem grawitacji, jak działka AA). Tylko as — decyzja usera 2026-07-19. */
  leadGravityFrac: number;
  /** Dystans [m], na jaki SKRZYDŁOWY (koordynacja asów, 2026-07-19) trzyma się od wspólnego
   *  wroga, ORAZ włącznik całej koordynacji lider/skrzydłowy. Gdy dwa sojusznicze asy mają tego
   *  samego wroga za cel, jeden atakuje (lider), reszta trzyma ten dystans i ubezpiecza. 0 = brak
   *  koordynacji (asy walczą niezależnie, jak dotąd). */
  wingmanRangeM: number;
  /** Override tuning.detectRangeM [m]; 0 = wspólny. As: 1000 m — wróg dalej → patrol,
   *  czyli lot do strefy (priorytet zajmowania terenu, decyzja usera 2026-07-12). */
  detectRangeM: number;
  /** Override tuning.disengageRangeM [m]; 0 = wspólny (histereza > detect). */
  disengageRangeM: number;
  /** Override tuning.lowEnergyIasMs [m/s]; 0 = wspólny (as wyżej ceni energię). */
  lowEnergyIasMs: number;
  /** Override tuning.recoveredEnergyIasMs [m/s]; 0 = wspólny. */
  recoveredEnergyIasMs: number;
}

export type DifficultyLevel = 'latwy' | 'normalny' | 'trudny' | 'as';

export const DIFFICULTY_LEVELS: readonly DifficultyLevel[] = ['latwy', 'normalny', 'trudny', 'as'];

/**
 * Wspólny tuning z nałożonymi per-poziomowymi override'ami (pola > 0). FSM czyta wyłącznie
 * BotTuning, więc poziomowe progi wykrycia/energii wchodzą tą ścieżką bez zmian w fsm.ts.
 * Bez override'ów zwraca oryginał (zero alokacji dla łatwy/normalny/trudny).
 */
export function effectiveTuning(tuning: BotTuning, d: BotDifficulty): BotTuning {
  if (
    d.detectRangeM <= 0 &&
    d.disengageRangeM <= 0 &&
    d.lowEnergyIasMs <= 0 &&
    d.recoveredEnergyIasMs <= 0
  ) {
    return tuning;
  }
  return {
    ...tuning,
    detectRangeM: d.detectRangeM > 0 ? d.detectRangeM : tuning.detectRangeM,
    disengageRangeM: d.disengageRangeM > 0 ? d.disengageRangeM : tuning.disengageRangeM,
    lowEnergyIasMs: d.lowEnergyIasMs > 0 ? d.lowEnergyIasMs : tuning.lowEnergyIasMs,
    recoveredEnergyIasMs: d.recoveredEnergyIasMs > 0 ? d.recoveredEnergyIasMs : tuning.recoveredEnergyIasMs,
  };
}

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
  hitReactionDurationS: [0.3, 6],
};

const LEVEL_RANGES: Record<string, readonly [min: number, max: number]> = {
  reactionTimeS: [0.02, 2],
  aimErrorDeg: [0, 15],
  maxG: [1.5, 10],
  throttle: [0.3, 1],
  fireRangeM: [100, 1000],
  fireConeDeg: [0.5, 20],
  hitReactionDelayS: [0, 3],
  // knoby „asa" — wszystkie z konwencją 0 = wyłączone / użyj tuning
  separationRangeM: [0, 500],
  headOnAvoidRangeM: [0, 2000],
  checkSixRangeM: [0, 3000],
  useWep: [0, 1],
  rollAuthorityMinFrac: [0, 1],
  overshootGuardClosureMs: [0, 200],
  evadeVariety01: [0, 1],
  burstFireRangeM: [0, 1000],
  leadGravityFrac: [0, 1],
  wingmanRangeM: [0, 3000],
  detectRangeM: [0, 10000],
  disengageRangeM: [0, 12000],
  lowEnergyIasKmh: [0, 500],
  recoveredEnergyIasKmh: [0, 700],
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

/**
 * Wariant `num` dla pola OPCJONALNEGO: gdy klucza nie ma (undefined), zwraca `fallback`
 * bez zgłaszania problemu (zgodność wstecz — stare configi/testy bez nowego pola). Gdy pole
 * jest obecne, waliduje jak `num` (typ + zakres sanity).
 */
function optNum(
  obj: Record<string, unknown>,
  key: string,
  prefix: string,
  problems: string[],
  fallback: number,
): number {
  if (obj[key] === undefined) return fallback;
  return num(obj, key, prefix, problems);
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
    hitReactionDurationS: optNum(t, 'hitReactionDurationS', 'tuning.', problems, 2.2),
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
      hitReactionDelayS: optNum(l, 'hitReactionDelayS', prefix, problems, 0),
      separationRangeM: optNum(l, 'separationRangeM', prefix, problems, 0),
      headOnAvoidRangeM: optNum(l, 'headOnAvoidRangeM', prefix, problems, 0),
      checkSixRangeM: optNum(l, 'checkSixRangeM', prefix, problems, 0),
      useWep: optNum(l, 'useWep', prefix, problems, 0),
      rollAuthorityMinFrac: optNum(l, 'rollAuthorityMinFrac', prefix, problems, 0),
      overshootGuardClosureMs: optNum(l, 'overshootGuardClosureMs', prefix, problems, 0),
      evadeVariety01: optNum(l, 'evadeVariety01', prefix, problems, 0),
      burstFireRangeM: optNum(l, 'burstFireRangeM', prefix, problems, 0),
      leadGravityFrac: optNum(l, 'leadGravityFrac', prefix, problems, 0),
      wingmanRangeM: optNum(l, 'wingmanRangeM', prefix, problems, 0),
      detectRangeM: optNum(l, 'detectRangeM', prefix, problems, 0),
      disengageRangeM: optNum(l, 'disengageRangeM', prefix, problems, 0),
      lowEnergyIasMs: optNum(l, 'lowEnergyIasKmh', prefix, problems, 0) * KMH_TO_MS,
      recoveredEnergyIasMs: optNum(l, 'recoveredEnergyIasKmh', prefix, problems, 0) * KMH_TO_MS,
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
