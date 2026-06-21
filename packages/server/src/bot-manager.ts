import { Vector3 } from 'three';
import {
  BOT_CONFIG,
  Bot,
  MAX_PLAYERS_PER_ROOM,
  SPOT_RANGE_M,
  ZONE_CENTER_X_M,
  ZONE_CENTER_Z_M,
  ZONE_LOITER_ALT_M,
  lookaheadSurfaceM,
  selectNearestTarget,
  type DifficultyLevel,
  type PilotDemands,
  type PlaneConfig,
  type PlaneState,
  type PlaneType,
  type Terrain,
} from '@air-combat/shared';

// Boty na serwerze (faza 12). Bot jest pełnoprawną encją pokoju (ServerPlayer bez
// połączenia) — przechodzi DOKŁADNIE tymi samymi ścieżkami co gracz: fizyka, ogień,
// hit detection, HP, kredyt, snapshot (kryterium fazy: protokołowo nieodróżnialny).
// Ten moduł trzyma TYLKO kontrolery AI (decyzja FSM z fazy 6) i decymację myślenia.
// GameRoom decyduje KIEDY bot myśli (zna licznik ticków); BotManager wykonuje decyzję
// i pamięta sterowanie między decyzjami (10 Hz myślenie, 60 Hz sterowanie).

/** Maks. botów w pokoju = pojemność snapshotu − 1 slot dla hosta-człowieka. */
export const MAX_BOTS_PER_ROOM = MAX_PLAYERS_PER_ROOM - 1;

/**
 * Decymacja myślenia: AI decyduje co tyle ticków fizyki (60 Hz / 6 = 10 Hz), a steruje
 * co tick (powtarzając ostatnie żądania). Pułapka fazy: 7 botów × pełen potok decyzji
 * (FSM + raycast unikania ziemi) co tick zjada budżet — myślenie rzadziej, ruch płynny,
 * bo żądania instruktora to STAWKI (rolka/pitch), które fizyka wygładza każdą klatką.
 */
export const BOT_THINK_INTERVAL = 6;

/**
 * Dystanse lookahead unikania ziemi [m] — bot omija grań z przodu, nie tylko ziemię pod
 * sobą (jak offline w fazie 6). Liczone tylko w ticku myślenia (10 Hz), więc 7× raycast
 * nie obciąża każdej klatki (pułapka faza-12.md).
 */
const GROUND_LOOKAHEAD_M = [300, 600, 1000, 1500];

/**
 * Waypoint patrolu = środek strefy nad szczytem (jak offline). Bot bez pilnego celu
 * (FSM patrol) ciąży ku centrum → boty kontestują strefę zamiast rozłazić się po mapie.
 * Niemutowalny współdzielony wektor (Bot tylko go czyta).
 */
const PATROL_WAYPOINTS: readonly Vector3[] = [
  new Vector3(ZONE_CENTER_X_M, ZONE_LOITER_ALT_M, ZONE_CENTER_Z_M),
];

// Pule nicków botów wg samolotu (decyzja użytkownika 2026-06-21): polsko brzmiące nazwiska na
// Spitfire'ach (dywizjony RAF z polskimi pilotami), niemiecko brzmiące na Bf 109 — żeby skład
// pasował do strony konfliktu. Historyczni asi (krótkie nazwiska, by zmieścić prefiks [BOT]).
// Przydzielane po kolei z osobnym kursorem per pula; po wyczerpaniu zawijają z numerem.
const BOT_NAMES_PL: readonly string[] = [
  'Skalski',
  'Urbanowicz',
  'Król',
  'Horbaczewski',
  'Gabszewicz',
  'Żumbach',
  'Łokuciewski',
  'Główczyński',
  'Drobiński',
  'Ferić',
];
const BOT_NAMES_DE: readonly string[] = [
  'Marseille',
  'Galland',
  'Mölders',
  'Hartmann',
  'Rall',
  'Barkhorn',
  'Steinhoff',
  'Priller',
  'Nowotny',
  'Lützow',
];

const BOT_NAMES_PL_SET = new Set(BOT_NAMES_PL);
const BOT_NAMES_DE_SET = new Set(BOT_NAMES_DE);

/** Pula nicków dla danego typu samolotu: Bf 109 → niemieckie, reszta (Spitfire) → polskie. */
function namePoolFor(type: PlaneType): readonly string[] {
  return type === 'bf109' ? BOT_NAMES_DE : BOT_NAMES_PL;
}

/** Sterowanie bota wyznaczone w ticku myślenia, powtarzane do kolejnej decyzji. */
export interface BotControl {
  throttle: number;
  fire: boolean;
}

interface BotRuntime {
  readonly bot: Bot;
  readonly control: BotControl;
}

const NO_CONTROL: BotControl = { throttle: BOT_CONFIG.tuning.cruiseThrottle, fire: false };

export class BotManager {
  private readonly runtimes = new Map<number, BotRuntime>();
  /** Osobny kursor nadawania per pula (PL/DE), żeby numeracja nadwyżek była ciągła w obu. */
  private readonly nameCursors = new Map<readonly string[], number>();

  get count(): number {
    return this.runtimes.size;
  }

  has(id: number): boolean {
    return this.runtimes.has(id);
  }

  /** Kolejny nick z puli właściwej dla typu samolotu, z prefiksem [BOT]; nadwyżkę numeruje
   *  (np. „[BOT] Galland 2"). Bf 109 → pula niemiecka, Spitfire → polska (skład pasuje do strony). */
  nextName(type: PlaneType): string {
    const pool = namePoolFor(type);
    const i = this.nameCursors.get(pool) ?? 0;
    this.nameCursors.set(pool, i + 1);
    const base = pool[i % pool.length];
    const round = Math.floor(i / pool.length);
    return round === 0 ? `[BOT] ${base}` : `[BOT] ${base} ${String(round + 1)}`;
  }

  /** Czy nick bota należy już do puli właściwej dla typu (nie trzeba go zmieniać). Pozwala
   *  utrzymać stabilny nick między respawnami i nadać nowy dopiero, gdy zmieni się strona. */
  nickMatchesType(nick: string, type: PlaneType): boolean {
    const set = type === 'bf109' ? BOT_NAMES_DE_SET : BOT_NAMES_PL_SET;
    const base = nick.replace(/^\[BOT\]\s+/, '').replace(/\s+\d+$/, '');
    return set.has(base);
  }

  /** Bota trafiono (resolveHits) — przekazuje sygnał do kontrolera AI (zryw na „trudnym"). */
  notifyHit(id: number): void {
    this.runtimes.get(id)?.bot.notifyHit();
  }

  /** Tworzy kontroler AI dla istniejącej już encji pokoju. */
  add(id: number, difficulty: DifficultyLevel, seed: number): void {
    const bot = new Bot(BOT_CONFIG.tuning, BOT_CONFIG.levels[difficulty], seed, PATROL_WAYPOINTS);
    this.runtimes.set(id, { bot, control: { throttle: BOT_CONFIG.tuning.cruiseThrottle, fire: false } });
  }

  remove(id: number): void {
    this.runtimes.delete(id);
  }

  /** Po (re)spawnie: zeruje filtry kontrolera i celownik na bieżący nos, gasi spust. */
  reset(id: number, state: PlaneState): void {
    const rt = this.runtimes.get(id);
    if (!rt) return;
    rt.bot.reset(state);
    rt.control.throttle = BOT_CONFIG.tuning.cruiseThrottle;
    rt.control.fire = false;
  }

  /** Bieżące sterowanie (powtarzane między decyzjami). Brak kontrolera → neutralne. */
  controlOf(id: number): BotControl {
    return this.runtimes.get(id)?.control ?? NO_CONTROL;
  }

  /** Czy bot trzyma spust — czytane przez pokój w fazie ognia (jak `input.fire` gracza). */
  fireOf(id: number): boolean {
    return this.runtimes.get(id)?.control.fire ?? false;
  }

  /**
   * Jedna DECYZJA bota (wołać co BOT_THINK_INTERVAL ticków): geometria + FSM + sterowanie
   * + degradacja + unikanie ziemi → wypełnia `demands` (do pilotStep) i zapamiętuje
   * throttle/fire. `candidates` = żywe stany INNYCH uczestników (FFA: każdy poza tym botem).
   * `dtS` to czas, który UPŁYNĄŁ od ostatniej decyzji (= fixedDt × interwał), żeby filtry
   * czasowe (reakcja, szum, jink) szły zgodnie z realnym tempem decyzji.
   */
  think(
    id: number,
    self: PlaneState,
    plane: PlaneConfig,
    candidates: readonly PlaneState[],
    terrain: Terrain,
    demands: PilotDemands,
    dtS: number,
  ): void {
    const rt = this.runtimes.get(id);
    if (!rt) return;
    const surf = lookaheadSurfaceM(
      terrain,
      self.position.x,
      self.position.z,
      self.velocity.x,
      self.velocity.z,
      GROUND_LOOKAHEAD_M,
    );
    const target = selectNearestTarget(self.position, candidates, SPOT_RANGE_M);
    const out = rt.bot.update(self, plane, target, { surfaceHeightM: surf }, dtS, demands);
    rt.control.throttle = out.throttle;
    rt.control.fire = out.fire;
  }
}
