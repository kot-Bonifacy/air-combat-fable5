import { Vector3 } from 'three';
import {
  BULLET_POOL_CAPACITY,
  BulletPool,
  INTERP_DELAY_MS,
  Instructor,
  LAGCOMP_HISTORY_TICKS,
  LAGCOMP_MAX_REWIND_MS,
  MATCH_END_VIEW_DELAY_S,
  MATCH_RESULTS_LINGER_S,
  MAX_EVENTS_PER_FRAME,
  MAX_PLAYERS_PER_ROOM,
  PHYSICS_HZ,
  DEFAULT_PLANE_TYPE,
  PositionHistory,
  SPAWN_PROTECTION_S,
  applyDamage,
  chooseSpawnIndex,
  compareFfa,
  createFireControl,
  createHealth,
  createPilotDemands,
  createRng,
  createSimPlane,
  createTerrain,
  createEmplacements,
  applyDispersion,
  AA_BALLISTICS,
  EMPLACEMENT_BULLET_OWNER,
  EMPLACEMENT_DISPERSION_MRAD,
  EMPLACEMENT_HIT_RADIUS_M,
  MRAD_TO_RAD,
  encodeEvents,
  encodeSnapshot,
  eventsByteLength,
  factionsInPlay,
  getForward,
  MATCH_LIVES,
  nearestToroidalImage,
  pilotStep,
  PLANE_TYPES,
  planeConfigOf,
  planesCollide,
  resetFireControl,
  resetHealth,
  segmentSphereHit,
  smallerTeamIndex,
  snapshotByteLength,
  stepPilotedPlane,
  stepWreckPiloted,
  TEAM_COUNT,
  totalAmmo,
  updateFire,
  updateLifecycle,
  validatePlaneState,
  wrapToArena,
  ZoneControl,
  type AaFire,
  type AaTarget,
  type Emplacement,
  type ChatMessage,
  type ControlMessage,
  type DifficultyLevel,
  type FireControl,
  type GameEvent,
  type Health,
  type InputFrame,
  type MatchEndReason,
  type MatchMember,
  type MatchMode,
  type PilotCommand,
  type PilotDemands,
  type PlaneConfig,
  type PlaneState,
  type PlaneType,
  type RoomPlayer,
  type RoomState,
  type RoomSummary,
  type SimPlane,
  type SnapshotEntitySource,
  type StandingRow,
  type Terrain,
  type ZoneOccupant,
} from '@air-combat/shared';
import { BOT_THINK_INTERVAL, BotManager, MAX_BOTS_PER_ROOM } from './bot-manager';

// Autorytatywny pokój gry. Faza 8 wprowadziła symulację (niezmiennik nr 5: serwer jest
// autorytetem), faza 10 dokłada maszynę stanów lobby: waiting (poczekalnia, nikt nie lata)
// → playing (mecz, fizyka + snapshoty) → ended. Pokój zna swoich CZŁONKÓW (połączenia),
// żeby rozsyłać im wiadomości lobby (JSON) i snapshoty (binarnie). Faza 11 dokłada WALKĘ:
// pociski symulowane TU (balistyka z shared), hit detection z lag-compensation, HP/kill
// credit po stronie serwera (niezmiennik nr 5), eventy MUZZLE/HIT/KILL do klientów.
// Faza 13 dokłada PĘTLĘ MECZU FFA: zegar meczu i wynik liczone TU (niezmiennik: klient
// tylko wyświetla), koniec przy limicie zestrzeleń albo czasu (shared/world/ffa), tabela
// wyników (standings, JSON poza hot pathem), respawn z ochroną + wyborem miejsca z dala od
// wrogów (shared/world/spawn), rewanż (ended → playing) i auto-powrót ended → waiting.

const SPAWN_ALTITUDE_M = 800;
const SPAWN_SPEED_MS = 120;
const SPAWN_THROTTLE = 0.8;
/** Gaz krążenia samolotu bez pilota (rozłączony gracz) — podtrzymuje energię w locie auto-poziomym. */
const DISCONNECT_CRUISE_THROTTLE = 0.7;
/** Promień pierścienia spawnów [m] (jak w kliencie: start na obrzeżach, nosem do środka). */
const SPAWN_RING_RADIUS_M = 8000;
/** Liczba slotów na pierścieniu = budżet snapshotu (do MAX_PLAYERS_PER_ROOM encji). */
const SPAWN_RING_SLOTS = MAX_PLAYERS_PER_ROOM;

const FORWARD_Z = new Vector3(0, 0, 1);

/** Bufor interpolacji klienta w tickach — składnik rewindu lag-comp (faza 11). */
const INTERP_DELAY_TICKS = Math.round((INTERP_DELAY_MS / 1000) * PHYSICS_HZ);
/** Cap rewindu lag-comp w tickach (decyzja designerska z faza-11.md). */
const MAX_REWIND_TICKS = Math.round((LAGCOMP_MAX_REWIND_MS / 1000) * PHYSICS_HZ);

/**
 * Kolejka inputów gracza: jeden input = jeden krok fizyki (niezmiennik reconciliation —
 * patrz piloted-plane.ts). Klient predykuje DOKŁADNIE jeden krok na wysłany input; serwer musi
 * skonsumować ten sam ciąg. Model „latest wins" gubił/powtarzał inputy przy dryfie faz zegarów
 * klient↔serwer (oba 60 Hz, ale niezsynchronizowane) → stały rozjazd ~1 tick (~1,5 m co snapshot
 * nawet przy 2 ms ping) → drżenie kamery pościgowej. TARGET = docelowa głębokość bufora jittera:
 * w normalnej grze kolejka ma 0–2 wpisy (drain się nie odpala, każdy input zużyty raz → korekty
 * ~mm). Po przestoju klienta (burst do ~15 ramek) nextInput odrzuca nadmiar ponad TARGET, by nie
 * narastało opóźnienie inputu. MAX = twardy limit pamięci (gdy gracz martwy/respawn nie konsumuje;
 * spawn i tak czyści kolejkę). */
const INPUT_QUEUE_TARGET = 3;
const INPUT_QUEUE_MAX = 64;

/** Sentinel „brak strzelca" w evencie KILL (śmierć od ziemi/kolizji). */
const NO_KILLER = 0;

/** Limit historii czatu pokoju (poczekalnia) — tyle ostatnich wiadomości dostaje nowy gracz. */
const CHAT_HISTORY_MAX = 30;

const scratchHitCenter = new Vector3();
/** Bufor zawinięcia torusa dla kroku bota (caller `wrapToArena` go nie czyta). */
const scratchBotWrap = new Vector3();
/** Bufory kierunku/prędkości pocisku AA (zero alokacji per strzał stanowiska). */
const scratchAaDir = new Vector3();
const scratchAaVel = new Vector3();
/** Bufor kierunku auto-poziomowania samolotu bez pilota (zero alokacji per tick). */
const scratchAutopilotDir = new Vector3();
/** Reużywalna komenda auto-stabilizacji (jeden wątek, sekwencyjnie) — pola aim nadpisywane per tick. */
const autopilotCommand: PilotCommand = {
  throttle: DISCONNECT_CRUISE_THROTTLE,
  pitchUp: 0,
  rollRight: 0,
  yawRight: 0,
  aimX: 0,
  aimY: 0,
  aimZ: 1,
};

/**
 * Buduje pierścień slotów startowych: pozycja na obrzeżach areny, nos poziomo ku środkowi
 * (strefa kontroli w centrum). Wysokość rośnie ze slotem, żeby spawny się nie nakładały w
 * pionie. Sloty są jednocześnie kandydatami wyboru miejsca respawnu (shared/world/spawn).
 */
function buildSpawnRing(): { pos: Vector3; dir: Vector3 }[] {
  const ring: { pos: Vector3; dir: Vector3 }[] = [];
  for (let slot = 0; slot < SPAWN_RING_SLOTS; slot++) {
    const angle = (slot / SPAWN_RING_SLOTS) * Math.PI * 2;
    const pos = new Vector3(
      Math.cos(angle) * SPAWN_RING_RADIUS_M,
      SPAWN_ALTITUDE_M + slot * 60,
      Math.sin(angle) * SPAWN_RING_RADIUS_M,
    );
    const dir = new Vector3(-Math.cos(angle), 0, -Math.sin(angle)).normalize();
    ring.push({ pos, dir });
  }
  return ring;
}

/**
 * Połączenie widziane przez pokój — tylko to, co potrzebne do rozsyłki. Interfejs
 * (zamiast importu Connection) przecina cykl zależności: connection.ts importuje GameRoom.
 */
export interface RoomMember {
  sendControl(msg: ControlMessage): void;
  /** Wysyła ramkę binarną (snapshot lub paczka EVENT — klient rozróżnia po pierwszym bajcie). */
  sendSnapshotBytes(bytes: Uint8Array): void;
  /** Zamknięcie połączenia z inicjatywy serwera (przejęcie slotu przez świeży reconnect zamyka
   *  stare „zombie"-połączenie). Opcjonalne — mocki testowe go nie implementują. */
  close?(): void;
}

/** Stan gracza po stronie serwera: symulacja + filtr instruktora + ostatni input + tożsamość lobby. */
interface ServerPlayer {
  readonly id: number;
  /** Frakcja/drużyna (faza 18). FFA: frakcja = id (każdy osobno). Drużynowy: 0..TEAM_COUNT−1.
   *  Ustawiana przy wejściu i przy starcie meczu (auto-balans); stabilna w trakcie meczu. */
  faction: number;
  /** Pozostałe życia w trybie eliminacyjnym (drużynowy, faza 18): MATCH_LIVES na samolot, jak SP.
   *  0 = brak respawnu (gracz przechodzi w obserwatora). W FFA bez znaczenia (respawn nieskończony). */
  livesLeft: number;
  /** Wybór samolotu gracza z poczekalni (faza 19b). Bot: losowany przy dodaniu. Stosowany przy
   *  (re)spawnie w OBU trybach — od 2026-06-25 drużyna i samolot są rozdzielone (dowolny samolot
   *  w dowolnej drużynie), więc także w drużynowym leci się wybranym płatowcem. */
  selectedType: PlaneType;
  /** Preferowana DRUŻYNA w trybie drużynowym (rozdzielenie drużyna↔samolot 2026-06-25): gracz
   *  wybiera ją niezależnie od samolotu (selectTeam), by dwóch ludzi mogło grać razem. null = bez
   *  wyboru → auto-balans. Choosery są utrwalani w assignFactions, resztę (boty, niewybierający)
   *  balansuje serwer. W FFA bez znaczenia (frakcja = id). */
  teamPref: number | null;
  /** Typ samolotu, którym encja LATA w bieżącym życiu (faza 19b) — ustawiany w spawn(); kodowany
   *  do snapshotu (v4) i do roster. */
  planeType: PlaneType;
  /** Konfiguracja fizyki/uzbrojenia bieżącego samolotu (faza 19b) — per gracz, nie per pokój. */
  plane: PlaneConfig;
  readonly sim: SimPlane;
  readonly instructor: Instructor;
  readonly demands: PilotDemands;
  /** HP — autorytet serwera (niezmiennik nr 5). Kodowane do snapshotu jako ułamek. */
  health: Health;
  /** Kontrola ognia (kadencja + amunicja) liczona serwerowo — klient nie może jej oszukać.
   *  Re-tworzona przy zmianie typu samolotu (liczba grup broni różni się: Spitfire 1, Bf 109 2). */
  fire: FireControl;
  /** Strumień RNG rozrzutu (osobny per gracz). */
  readonly rng: () => number;
  /** Zestrzelenia wrogów (kredyt), asysty i śmierci w bieżącym meczu (tabela wyników, faza 13). */
  kills: number;
  assists: number;
  deaths: number;
  /** Zniszczone naziemne stanowiska ogniowe (po EMPLACEMENT_POINTS pkt; v6). */
  groundKills: number;
  /** Czas pozostałej ochrony po (re)spawnie [s] — nietykalny i nie zadaje sam (faza 13). */
  protectionTimerS: number;
  /** Szacowany ping [ms] (EMA z echa ticku) — diagnostyka w standings; bot = 0. */
  pingMs: number;
  /** Id strzelców, którzy trafili tę maszynę w bieżącym życiu (kredyt asyst); czyszczone przy spawnie. */
  readonly damagedBy: Set<number>;
  nick: string;
  readonly sessionToken: string;
  /** Połączenie gracza; null = rozłączony, slot trzymany na reconnect do wygaśnięcia okna. */
  member: RoomMember | null;
  /** Moment rozłączenia [ms]; null gdy podłączony. Po RECONNECT_WINDOW_MS slot zwalniany. */
  disconnectedAtMs: number | null;
  /** Kolejka FIFO nieskonsumowanych inputów (jeden input = jeden krok fizyki — niezmiennik
   *  reconciliation). WS gwarantuje porządek dostarczania, więc kolejność przyjścia = kolejność
   *  sekwencji. Zastępuje model „latest wins", który gubił/powtarzał inputy → drżenie kamery. */
  readonly inputQueue: InputFrame[];
  /** Ostatni SKONSUMOWANY input: podtrzymywany przy pustej kolejce (klient się spóźnia) i źródło
   *  spustu w fireWeapon. null = brak inputu w tym życiu (lot prosto neutralnymi żądaniami). */
  lastInput: InputFrame | null;
  /** Numer ostatniego INPUT uwzględnionego w fizyce — odsyłany jako ack w snapshocie. */
  lastProcessedSeq: number;
  /** Najnowszy serverTick potwierdzony przez klienta (z INPUT.ackServerTick) — baza rewindu lag-comp. */
  lastAckServerTick: number;
  readonly spawnPos: Vector3;
  readonly spawnDir: Vector3;
  /** Slot pierścienia startowego. Wstępnie nextSlot++ % SPAWN_RING_SLOTS, ale start() przydziela go
   *  na nowo (assignStartSlots) dla kolizyjnie-bezpiecznego, równomiernego rozrzutu uczestników. */
  slot: number;
  /** Pozycja na POCZĄTKU bieżącego ticku — początek zamiatanego odcinka kolizji (faza 15);
   *  po zawinięciu torusa korygowana do obrazu najbliższego pozycji końcowej. */
  readonly prevPos: Vector3;
  /** Bot serwerowy (faza 12): sterowany przez AI, member zawsze null. */
  readonly isBot: boolean;
  /** Gracz wycofał się z BIEŻĄCEGO meczu, zostając w pokoju (powrót do poczekalni bez kończenia gry
   *  innym — leaveMatch). Samolot martwy i bez respawnu; flaga znika przy starcie kolejnego meczu. */
  withdrawn: boolean;
  /** Gotowość do startu (system „Gotów" 2026-06-26): host widzi licznik gotowych. Boty zawsze true.
   *  Zerowana przy zmianie samolotu/drużyny i na starcie meczu (gracz potwierdza AKTUALNY skład). */
  ready: boolean;
  /** Poziom trudności bota (lobby slotowe RTS 2026-06-26): host edytuje per slot, więc boty mogą mieć
   *  różne poziomy. Tylko dla botów; dla ludzi pole istnieje, ale jest nieużywane. Kodowane do roster
   *  (RoomPlayer.botDifficulty) i używane przy odtworzeniu kontrolera AI (BotManager.setDifficulty). */
  botDifficulty: DifficultyLevel;
}

export class GameRoom {
  readonly terrain: Terrain;
  state: RoomState = 'waiting';
  /** Tryb meczu (faza 18): 'ffa' (deathmatch + respawn, faza 13) albo 'team' (drużynowy,
   *  eliminacja jak SP). Ustawiany przez lobby przy tworzeniu pokoju; stały przez życie pokoju. */
  mode: MatchMode = 'ffa';
  /** Poziom trudności botów. Ustawiany przy tworzeniu pokoju (lobby) i zmienialny przez HOSTA w
   *  poczekalni (applyRoomSettings). Stosowany przy przebudowie rosteru botów (setBots). */
  difficulty: DifficultyLevel = 'normalny';
  hostId: number | null = null;
  private readonly players = new Map<number, ServerPlayer>();
  /** Ostatnie wiadomości czatu pokoju (poczekalnia) — wysyłane nowemu graczowi po wejściu, by
   *  widział kontekst rozmowy. Bufor pierścieniowy o pojemności CHAT_HISTORY_MAX. */
  private readonly chatHistory: ChatMessage[] = [];
  private nextId = 0;
  private nextSlot = 0;
  /** Licznik ticków fizyki (u32 w protokole) — monotoniczny, znacznik snapshotu. */
  tick = 0;

  /** Bufor źródeł snapshotu — przebudowywany przy zmianie składu (zero alokacji per tick). */
  private snapshotSources: SnapshotEntitySource[] = [];

  // --- pętla meczu (faza 13; P1 2026-06-19: oba tryby eliminacyjne jak SP) ---
  /** Czas spędzony w stanie 'ended' [s] — po MATCH_RESULTS_LINGER_S pokój wraca do 'waiting'. */
  private endedTimerS = 0;
  /**
   * Mecz rozstrzygnięty, ale matchEnded WSTRZYMANE na MATCH_END_VIEW_DELAY_S: pokój zostaje
   * 'playing' (fizyka + snapshoty lecą), więc klienci widzą, jak ostatni pokonany wróg dymi
   * i spada, zanim dostaną tabelę. null = brak oczekującego końca; werdykt zamrożony przy
   * rozstrzygnięciu. Parytet z SP (matchEndPending w main.ts).
   */
  private pendingEnd: { winnerId: number | null; winningFaction: number | null; reason: MatchEndReason } | null = null;
  private pendingEndTimerS = 0;
  /** Wynik ostatniego meczu (ekran wyników / diagnostyka). */
  winnerId: number | null = null;
  /** Zwycięska drużyna ostatniego meczu drużynowego (faza 18); null w FFA i przy remisie. */
  winningFaction: number | null = null;
  lastEndReason: MatchEndReason | null = null;
  /** Pierścień slotów startowych (pozycja + nos ku środkowi) — kandydaci wyboru spawnu. */
  private readonly spawnRing: { pos: Vector3; dir: Vector3 }[] = buildSpawnRing();
  private readonly spawnRingPositions: Vector3[] = this.spawnRing.map((s) => s.pos);
  /** Scratch pozycji żywych wrogów do wyboru spawnu (zero alokacji per respawn). */
  private readonly occupantScratch: Vector3[] = [];
  /** Scratch uczestników do oceny eliminacji (faza 18 / P1; factionsInPlay, zero alokacji). */
  private readonly teamMembersScratch: MatchMember[] = [];

  // --- kontrola strefy KotH (faza 17): dodatkowy warunek zwycięstwa, parytet z SP ---
  /** Autorytatywny stan przejmowania strefy (KotH bez cofania); reset przy starcie meczu. */
  private readonly zone = new ZoneControl();
  /** Bufor okupantów strefy wielokrotnego użytku (zero alokacji per tick). */
  private readonly zoneOccupantScratch: ZoneOccupant[] = Array.from(
    { length: MAX_PLAYERS_PER_ROOM },
    () => ({ faction: 0, alive: false, xM: 0, zM: 0 }),
  );
  /** Frakcja kontrolująca strefę teraz albo null (pusta/sporna) — do statusu paska klienta. */
  private zoneControlling: number | null = null;
  /** Czy w strefie jest żywy samolot (pauza spornej ≠ pusta) — do statusu paska klienta. */
  private zoneOccupied = false;

  // --- walka (faza 11): autorytatywne pociski + lag-comp + kolejka eventów ---
  /** Pociski autorytatywne (wszyscy gracze w pokoju dzielą pulę — kill credit po ownerId). */
  private readonly pool = new BulletPool(BULLET_POOL_CAPACITY);
  /** Historia pozycji do rewindu celów przy hit-detekcji. */
  private readonly history = new PositionHistory(LAGCOMP_HISTORY_TICKS, MAX_PLAYERS_PER_ROOM);
  /** Zdarzenia walki uzbierane w tej klatce, rozsyłane razem ze snapshotem (binarnie). */
  private pendingEvents: GameEvent[] = [];
  /** Bufor wyjściowy ramki EVENT (alokowany leniwie pod największą paczkę). */
  private eventScratch = new Uint8Array(0);

  // --- naziemne stanowiska ogniowe (AA, v6): autorytatywne cele naziemne na zboczach góry ---
  /** Stanowiska — pozycje deterministyczne z seeda terenu (klient liczy je sam, bez snapshotu). */
  private readonly emplacements: Emplacement[];
  /** Strumień RNG rozrzutu pocisków AA (osobny od strumieni graczy). */
  private readonly aaRng = createRng(0xa1a1 >>> 0);
  /** Scratch celów dla stanowisk (żywe, nietykalne samoloty) — zero alokacji wpisów per tick. */
  private readonly aaTargetScratch: AaTarget[] = Array.from({ length: MAX_PLAYERS_PER_ROOM }, () => ({
    id: 0,
    position: new Vector3(),
    velocity: new Vector3(),
  }));

  // --- boty (faza 12): kontrolery AI dla encji bez połączenia ---
  private readonly botManager = new BotManager();
  /** Scratch listy celów bota (żywe stany innych uczestników) — zero alokacji per decyzja. */
  private readonly botTargetScratch: PlaneState[] = [];
  /** Scratch listy żywych, nietykalnych encji do testu kolizji (faza 15) — zero alokacji per tick. */
  private readonly collisionScratch: ServerPlayer[] = [];

  constructor(
    readonly code: string,
    seed?: number,
    private readonly onError?: (msg: string) => void,
    /** Kanał logów informacyjnych (start/koniec meczu) — konsola serwera. */
    private readonly onInfo?: (msg: string) => void,
  ) {
    this.terrain = createTerrain(seed);
    this.emplacements = createEmplacements(this.terrain);
  }

  get playerCount(): number {
    return this.players.size;
  }

  /** Liczba podłączonych (nie czekających na reconnect) graczy — do sprzątania pustych pokoi. */
  get connectedCount(): number {
    let n = 0;
    for (const p of this.players.values()) if (p.member) n++;
    return n;
  }

  /** Czy jest jeszcze miejsce na kolejnego gracza (z uwzględnieniem slotów trzymanych na reconnect). */
  get hasFreeSlot(): boolean {
    return this.players.size < MAX_PLAYERS_PER_ROOM;
  }

  /** Liczba ludzi (graczy z połączeniem lub w oknie reconnectu) — boty NIE trzymają pokoju przy życiu. */
  get humanCount(): number {
    let n = 0;
    for (const p of this.players.values()) if (!p.isBot) n++;
    return n;
  }

  /** Liczba botów w pokoju — diagnostyka/testy. */
  get botCount(): number {
    return this.botManager.count;
  }

  summary(): RoomSummary {
    return {
      code: this.code,
      playerCount: this.players.size,
      maxPlayers: MAX_PLAYERS_PER_ROOM,
      state: this.state,
      mode: this.mode,
    };
  }

  roomPlayers(): RoomPlayer[] {
    // planeType = wybór gracza (effectiveType = selectedType w obu trybach od 2026-06-25); faction =
    // drużyna do grupowania/kolorowania w poczekalni. Pokazuje, czym i po której stronie gracz poleci.
    return [...this.players.values()].map((p) => ({
      id: p.id,
      nick: p.nick,
      planeType: this.effectiveType(p),
      faction: p.faction,
      isBot: p.isBot,
      ready: p.ready,
      // poziom bota tylko dla botów (lobby slotowe RTS): host edytuje go per slot w poczekalni
      ...(p.isBot ? { botDifficulty: p.botDifficulty } : {}),
    }));
  }

  /**
   * Dołącza nowego gracza. W 'waiting' samolot dostaje pozycję spoczynkową; w 'playing'
   * (late join) spawnuje się po RESPAWN_DELAY_S (life='dead' z wyzerowanym timerem — pułapka:
   * MVP fazy 10 nie czeka na koniec meczu). Pierwszy gracz w pokoju zostaje hostem.
   */
  addPlayer(nick: string, sessionToken: string, member: RoomMember | null): number {
    const player = this.createPlayer(nick, sessionToken, member, false);
    if (this.hostId === null) this.hostId = player.id;
    this.enterWorld(player);
    return player.id;
  }

  /**
   * Dokłada bota jako pełnoprawną encję pokoju (member=null, sterowany przez AI). Bot NIGDY
   * nie zostaje hostem ani nie trzyma pokoju przy życiu (patrz humanCount). Nick z puli [BOT].
   * `planeType` wymusza samolot (sesje balansowe/testy); bez niego bot losuje typ (faza 19b).
   */
  addBot(difficulty: DifficultyLevel, planeType?: PlaneType, team?: number): number {
    // neutralny nick nadaje refreshBotName() w spawn() (2026-06-26: nazwy botów nie zależą już od
    // samolotu/strony); pusty startowy nick zostaje zastąpiony pierwszym callsignem z puli.
    const player = this.createPlayer('', '', null, true, planeType);
    player.botDifficulty = difficulty;
    // Lobby slotowe RTS (2026-06-26): bot dodany do KONKRETNEJ drużyny dostaje jawne teamPref —
    // assignFaction(s) honoruje je jak wybór człowieka (umożliwia dowolne składy, np. „2 vs 6 botów").
    // Bez team (stary addBot / FFA) teamPref=null → bot jest wypełniaczem auto-balansu (jak dotąd).
    if (team !== undefined && this.mode === 'team' && team >= 0 && team < TEAM_COUNT) {
      player.teamPref = team;
    }
    // strumień RNG bota osobny od strumienia rozrzutu ognia (inna stała mieszająca)
    this.botManager.add(player.id, difficulty, this.botSeed(player.id));
    this.enterWorld(player); // spawn() zresetuje też kontroler AI (isBot) i nada nick wg typu
    return player.id;
  }

  /** Deterministyczny seed strumienia RNG bota (stały dla danego id) — używany przy add i przy
   *  odtworzeniu kontrolera po zmianie poziomu (setBotDifficulty), żeby zachowanie było powtarzalne. */
  private botSeed(id: number): number {
    return (id + 1) ^ 0x0b07;
  }

  /** Nadaje botowi neutralny nick (callsign), jeśli jeszcze go nie ma. Nazwy NIE zależą już od
   *  samolotu/strony (2026-06-26: koniec historycznego dobierania narodowości do płatowca) — nick
   *  jest stabilny między respawnami i zmianami trybu (no-op, gdy bot ma już nick z puli). */
  private refreshBotName(player: ServerPlayer): void {
    if (!player.isBot) return;
    if (!this.botManager.hasBotName(player.nick)) {
      player.nick = this.botManager.nextName();
    }
  }

  /** Wariant samolotu bota losowany deterministycznie z id (różnorodność w pokoju + powtarzalność
   *  testów; faza 19b). W trybie drużynowym i tak nadpisywany sprzętem strony (effectiveType). */
  private randomBotType(id: number): PlaneType {
    const h = ((id + 1) * 2654435761) >>> 0;
    return PLANE_TYPES[h % PLANE_TYPES.length] ?? DEFAULT_PLANE_TYPE;
  }

  /** Tworzy encję (gracz lub bot) i wpisuje do mapy; nie spawnuje ani nie ustawia hosta. */
  private createPlayer(
    nick: string,
    sessionToken: string,
    member: RoomMember | null,
    isBot: boolean,
    forcedType?: PlaneType,
  ): ServerPlayer {
    const id = this.nextId++;
    const slot = this.nextSlot++ % SPAWN_RING_SLOTS;
    // typ startowy: wymuszony (testy/balans) > losowy (bot) > domyślny Spitfire (gracz). Efektywny
    // typ na życie ustala spawn()→applyPlaneSelection (drużynowy nadpisuje wg strony).
    const initType = forcedType ?? (isBot ? this.randomBotType(id) : DEFAULT_PLANE_TYPE);
    const initPlane = planeConfigOf(initType);
    const player: ServerPlayer = {
      id,
      faction: id, // FFA domyślnie; tryb drużynowy nadpisze w assignFaction (auto-balans)
      livesLeft: MATCH_LIVES,
      selectedType: initType,
      teamPref: null, // brak wyboru drużyny → auto-balans (drużynowy); ustawiany przez selectTeam
      planeType: initType,
      plane: initPlane,
      sim: createSimPlane(id + 1),
      instructor: new Instructor(),
      demands: createPilotDemands(),
      health: createHealth(initPlane.hpPool),
      fire: createFireControl(initPlane.armament),
      rng: createRng((id + 1) ^ 0x9e37),
      kills: 0,
      assists: 0,
      deaths: 0,
      groundKills: 0,
      protectionTimerS: 0,
      pingMs: 0,
      damagedBy: new Set<number>(),
      nick,
      sessionToken,
      member,
      disconnectedAtMs: null,
      inputQueue: [],
      lastInput: null,
      lastProcessedSeq: 0,
      lastAckServerTick: 0,
      spawnPos: new Vector3(),
      spawnDir: new Vector3(),
      slot,
      prevPos: new Vector3(),
      isBot,
      withdrawn: false,
      ready: isBot, // boty zawsze gotowe; człowiek potwierdza przyciskiem „Gotów"
      botDifficulty: 'normalny', // nadpisywane przez addBot dla botów; dla ludzi nieużywane
    };
    this.players.set(id, player);
    return player;
  }

  /** Spawnuje świeżą encję; w trakcie meczu wchodzi jako late join (dead → spawn po RESPAWN_DELAY_S). */
  private enterWorld(player: ServerPlayer): void {
    this.assignFaction(player); // auto-balans drużyn (faza 18); w FFA → frakcja = id
    this.spawn(player);
    if (this.state === 'playing') {
      player.sim.state.life = 'dead';
      player.sim.state.lifeTimerS = 0;
    }
    this.rebuildSnapshotSources();
  }

  /**
   * Przydziela frakcję pojedynczej encji (auto-balans, faza 18). FFA: frakcja = id (każdy
   * osobno, zgodnie ze strefą f17). Drużynowy: do MNIEJSZEJ drużyny (host, boty i late-join
   * trafiają na zmianę) — istniejący gracze mają już frakcje drużyn 0..TEAM_COUNT−1.
   */
  private assignFaction(player: ServerPlayer): void {
    if (this.mode !== 'team') {
      player.faction = player.id;
      return;
    }
    // gracz, który wybrał drużynę (selectTeam), trafia na nią; reszta do mniejszej drużyny
    if (player.teamPref !== null && player.teamPref >= 0 && player.teamPref < TEAM_COUNT) {
      player.faction = player.teamPref;
      return;
    }
    const counts = new Array<number>(TEAM_COUNT).fill(0);
    for (const p of this.players.values()) {
      if (p !== player && p.faction >= 0 && p.faction < TEAM_COUNT) counts[p.faction] = (counts[p.faction] ?? 0) + 1;
    }
    player.faction = smallerTeamIndex(counts);
  }

  /**
   * Przydziela frakcje WSZYSTKIM uczestnikom (start/rewanż meczu). FFA: frakcja = id. Drużynowy:
   * honoruje drużynę, którą KAŻDY CZŁOWIEK JUŻ WIDZI w poczekalni (jawny wybór selectTeam ALBO bieżąca,
   * prawidłowa frakcja z auto-przydziału przy wejściu), a boty dokłada do mniejszej drużyny.
   *
   * Zasada „co widać w poczekalni, to startuje" (WYSIWYG) — fix buga 2026-06-26: poprzednia wersja
   * honorowała TYLKO jawne `teamPref`, a wszystkich bez wyboru (w tym ludzi auto-przydzielonych do
   * drużyny widocznej w poczekalni) wyrównywała od nowa. Gdy jeden gracz wybrał drużynę jawnie, a drugi
   * tylko „wylądował" na tej samej stronie (teamPref=null), start przerzucał tego drugiego na przeciwną
   * drużynę „dla balansu" — choć poczekalnia pokazywała ich razem. Efekt: znajomi startowali po przeciwnych
   * stronach. Teraz frakcja widoczna w poczekalni = frakcja na starcie; balansują tylko boty i świeżo
   * dołączający bez przydziału (np. po zmianie trybu FFA→drużynowy, gdy frakcja=id jest poza zakresem).
   * Wolny wybór: dwóch ludzi może być w tej samej drużynie (nie wymuszamy balansu między ludźmi).
   */
  private assignFactions(): void {
    if (this.mode !== 'team') {
      for (const p of this.players.values()) p.faction = p.id;
      return;
    }
    const counts = new Array<number>(TEAM_COUNT).fill(0);
    const unassignedHumans: ServerPlayer[] = [];
    const fillerBots: ServerPlayer[] = [];
    // 1) JAWNE wybory drużyn (WYSIWYG): ludzie (teamPref albo bieżąca, prawidłowa frakcja) ORAZ boty
    //    z jawnie przypisaną drużyną (lobby slotowe RTS 2026-06-26 — host postawił bota po konkretnej
    //    stronie). To honorowanie botów umożliwia dowolne składy (np. „2 ludzi vs 6 botów"); wcześniej
    //    boty były wyłącznie wypełniaczem auto-balansu, więc nie dało się ich skupić po jednej stronie.
    for (const p of this.players.values()) {
      let team: number | null = null;
      if (p.teamPref !== null && p.teamPref >= 0 && p.teamPref < TEAM_COUNT) team = p.teamPref;
      else if (!p.isBot && p.faction >= 0 && p.faction < TEAM_COUNT) team = p.faction;
      if (team !== null) {
        p.faction = team;
        counts[team] = (counts[team] ?? 0) + 1;
      } else if (p.isBot) {
        fillerBots.push(p); // bot bez przypisanej drużyny → wypełniacz auto-balansu (jak dotąd)
      } else {
        unassignedHumans.push(p); // człowiek bez prawidłowej drużyny (np. świeże przejście z FFA: frakcja = id)
      }
    }
    // 2) ludzie bez prawidłowej drużyny → do mniejszej (pierwszy przydział po zmianie trybu)
    for (const p of unassignedHumans) {
      const t = smallerTeamIndex(counts);
      p.faction = t;
      counts[t] = (counts[t] ?? 0) + 1;
    }
    // 3) BOTY-wypełniacze: równoważą drużyny wokół jawnych wyborów (deterministycznie w kolejności id)
    for (const p of fillerBots) {
      const t = smallerTeamIndex(counts);
      p.faction = t;
      counts[t] = (counts[t] ?? 0) + 1;
    }
  }

  /** Typ samolotu, którym gracz poleci (faza 19b): od 2026-06-25 w OBU trybach = wybór gracza
   *  (selectedType) — drużyna i samolot są rozdzielone. Jedno źródło dla roster i (re)spawnu. */
  private effectiveType(player: ServerPlayer): PlaneType {
    return player.selectedType;
  }

  /**
   * Ustawia samolot gracza na bieżące życie wg typu efektywnego (faza 19b). Gdy typ się zmienił
   * (zmiana wyboru, przydział drużyny, late-join): podmienia konfigurację, RE-TWORZY kontrolę ognia
   * (liczba grup broni różni się: Spitfire 1, Bf 109 2 — resetFireControl nie zmienia długości)
   * i HP, po czym przebudowuje źródła snapshotu (ammoMax/planeType/ref fire). Zwraca true, gdy
   * doszło do zmiany (caller nie musi już resetować HP/ognia — są świeże).
   */
  private applyPlaneSelection(player: ServerPlayer): boolean {
    const type = this.effectiveType(player);
    if (type === player.planeType) return false;
    player.planeType = type;
    player.plane = planeConfigOf(type);
    player.health = createHealth(player.plane.hpPool);
    player.fire = createFireControl(player.plane.armament);
    this.rebuildSnapshotSources(); // nowe ref fire/health + ammoMax + planeType per encja
    return true;
  }

  /**
   * Wybór samolotu gracza w poczekalni (faza 19b). Od 2026-06-25 w OBU trybach wprost wybór płatowca
   * (selectedType) — drużyna i samolot są rozdzielone (dowolny samolot w dowolnej drużynie), więc
   * wybór samolotu NIE zmienia już frakcji. Drużynę gracz wybiera osobno (selectTeam). Stosowane
   * przy najbliższym (re)spawnie (start meczu). Boty/nieznani ignorowani (niezm. nr 11: clamp w connection).
   */
  selectPlane(id: number, type: PlaneType): void {
    const player = this.players.get(id);
    if (!player || player.isBot) return;
    if (player.selectedType === type) return;
    player.selectedType = type;
    player.ready = false; // zmiana składu → ponowne potwierdzenie gotowości (system „Gotów")
    this.broadcastRoomUpdate(); // roster pokazuje nowy typ w poczekalni
  }

  /**
   * Wybór DRUŻYNY gracza w poczekalni (rozdzielenie drużyna↔samolot 2026-06-25): pozwala dwóm ludziom
   * celowo grać po tej samej stronie. Zapamiętuje preferencję (teamPref) i od razu przenosi gracza na
   * tę frakcję — natychmiast widoczne w roster/kolorach poczekalni. WOLNY WYBÓR: nie wymuszamy balansu
   * między ludźmi (boty wyrównują w assignFactions). Tylko tryb drużynowy; poza nim / dla bota / nieznanego
   * gracza = no-op. `team` jest już zwalidowany/zklampowany w connection (niezm. nr 11).
   */
  selectTeam(id: number, team: number): void {
    if (this.mode !== 'team') return;
    const player = this.players.get(id);
    if (!player || player.isBot) return;
    if (team < 0 || team >= TEAM_COUNT) return; // obrona — connection klampuje wcześniej
    if (player.teamPref === team) return;
    player.teamPref = team;
    player.ready = false; // zmiana składu → ponowne potwierdzenie gotowości (system „Gotów")
    // utrwal wybór i rebalansuj boty na żywo: poczekalnia pokazuje DOKŁADNIE skład, który wystartuje
    // (WYSIWYG) — ludzie zostają tam, gdzie ich widać, boty wyrównują wokół nich. assignFactions ustawia
    // faction tego gracza z teamPref; przy starcie jest wołane ponownie (idempotentnie).
    this.assignFactions();
    this.broadcastRoomUpdate();
  }

  /**
   * Gracz oznacza GOTOWOŚĆ do startu (system „Gotów" 2026-06-26). Host widzi licznik gotowych i
   * startuje świadomie (nie czeka na wszystkich — AFK nie blokuje gry). Tylko człowiek; bot/nieznany
   * gracz = no-op (boty są gotowe z definicji). Zerowane przy zmianie samolotu/drużyny i na starcie.
   */
  setReady(id: number, ready: boolean): void {
    const player = this.players.get(id);
    if (!player || player.isBot) return;
    if (player.ready === ready) return;
    player.ready = ready;
    this.broadcastRoomUpdate();
  }

  /**
   * HOST zmienia ustawienia pokoju w poczekalni: tryb meczu / liczba botów / poziom trudności
   * (decyzja użytkownika 2026-06-21: ustawienia ustala host; reszta przez czat). Tylko w stanie
   * 'waiting' — w trakcie meczu no-op (caller w connection sprawdza też, czy to host). Pola
   * opcjonalne (undefined = bez zmian); wartości już zwalidowane/zklampowane w connection.
   * Zmiana liczby/poziomu botów przebudowuje roster botów (brak pojedynczego removeBot).
   */
  applyRoomSettings(opts: { mode?: MatchMode; bots?: number; difficulty?: DifficultyLevel }): void {
    if (this.state !== 'waiting') return;
    let changed = false;
    if (opts.mode !== undefined && opts.mode !== this.mode) {
      this.mode = opts.mode;
      // tryb wpływa na frakcje (drużynowy → auto-balans / utrwalone wybory drużyn). Frakcje i tak
      // przydziela assignFactions() przy start(), ale przydzielamy je już teraz, żeby poczekalnia
      // od razu pokazała poprawny podział na drużyny (kolumny + kolory).
      this.assignFactions();
      // zmiana trybu = istotna zmiana składu (FFA↔drużyny) → ludzie potwierdzają gotowość od nowa
      for (const p of this.players.values()) if (!p.isBot) p.ready = false;
      changed = true;
    }
    let diffChanged = false;
    if (opts.difficulty !== undefined && opts.difficulty !== this.difficulty) {
      this.difficulty = opts.difficulty;
      diffChanged = true;
    }
    // przebuduj boty tylko gdy faktycznie zmienia się liczba ALBO poziom (poziom „zapieka się"
    // w bocie przy dodaniu) — bez tego sama zmiana trybu churn'owałaby id botów bez potrzeby.
    const wantBots = opts.bots !== undefined ? Math.floor(opts.bots) : this.botCount;
    if (wantBots !== this.botCount || diffChanged) {
      this.setBots(wantBots, this.difficulty);
      changed = true;
    }
    if (!changed) return;
    this.broadcastRoomUpdate();
    // komunikat systemowy na czacie — wszyscy widzą wynegocjowane ustawienia (wspólne ustalanie)
    const modeLabel = this.mode === 'team' ? 'Drużynowy' : 'FFA';
    this.systemChat(`Ustawienia pokoju: ${modeLabel}, boty ${String(this.botCount)} (${this.difficulty}).`);
  }

  /**
   * Ustawia liczbę botów w pokoju na `count` (poziom `difficulty`) przez PRZEBUDOWĘ rosteru:
   * usuwa wszystkie istniejące boty i dodaje od nowa. Liczba jest klampowana do wolnych slotów
   * (MAX_PLAYERS_PER_ROOM − ludzie) oraz MAX_BOTS_PER_ROOM (niezm. nr 11). Tylko poczekalnia.
   */
  private setBots(count: number, difficulty: DifficultyLevel): void {
    for (const p of [...this.players.values()]) {
      if (!p.isBot) continue;
      this.players.delete(p.id);
      this.botManager.remove(p.id);
      // bot nigdy nie jest hostem (addBot tego pilnuje), więc reassignHost zbędny
    }
    const freeForBots = Math.max(0, MAX_PLAYERS_PER_ROOM - this.players.size);
    const target = Math.max(0, Math.min(MAX_BOTS_PER_ROOM, freeForBots, Math.floor(count)));
    for (let i = 0; i < target; i++) this.addBot(difficulty); // addBot odbudowuje też źródła snapshotu
    this.rebuildSnapshotSources();
  }

  /**
   * HOST dodaje pojedynczego bota do slotu (lobby slotowe RTS 2026-06-26). W trybie drużynowym do
   * wskazanej `team` (jawny teamPref → honorowany przez assignFactions, dowolne składy jak „2 vs 6"),
   * w FFA bez drużyny. Klamp pojemności: pełny pokój / limit botów = no-op. Tylko w 'waiting'
   * (egzekucja host/stan w connection). Po dodaniu rebalansujemy frakcje, by poczekalnia == start
   * (WYSIWYG: wypełniacze ułożą się wokół jawnie postawionych slotów).
   */
  hostAddBot(team: number | null, difficulty: DifficultyLevel): void {
    if (this.state !== 'waiting') return;
    if (this.players.size >= MAX_PLAYERS_PER_ROOM || this.botCount >= MAX_BOTS_PER_ROOM) return;
    this.addBot(difficulty, undefined, team ?? undefined);
    if (this.mode === 'team') this.assignFactions();
    this.broadcastRoomUpdate();
  }

  /** HOST usuwa konkretnego bota ze slotu (lobby slotowe RTS 2026-06-26). No-op poza 'waiting' / dla
   *  nie-bota. Rebalans frakcji po usunięciu (wypełniacze mogą się przesunąć), żeby poczekalnia == start. */
  hostRemoveBot(botId: number): void {
    if (this.state !== 'waiting') return;
    const player = this.players.get(botId);
    if (!player || !player.isBot) return;
    this.players.delete(botId);
    this.botManager.remove(botId);
    if (this.mode === 'team') this.assignFactions();
    this.rebuildSnapshotSources();
    this.broadcastRoomUpdate();
  }

  /**
   * HOST edytuje slot bota (lobby slotowe RTS 2026-06-26): przenosi go do innej drużyny (`team`, tylko
   * tryb drużynowy) i/lub zmienia poziom (`difficulty`). Oba pola opcjonalne (null = bez zmian). No-op
   * poza 'waiting' / dla nie-bota. Zmiana drużyny ustawia jawne teamPref (honorowane przy starcie) i
   * rebalansuje frakcje; zmiana poziomu odtwarza kontroler AI z tym samym seedem (BotManager).
   */
  hostEditBot(botId: number, team: number | null, difficulty: DifficultyLevel | null): void {
    if (this.state !== 'waiting') return;
    const player = this.players.get(botId);
    if (!player || !player.isBot) return;
    let changed = false;
    if (team !== null && this.mode === 'team' && team >= 0 && team < TEAM_COUNT) {
      player.teamPref = team;
      player.faction = team;
      this.assignFactions(); // wypełniacze ułożą się wokół przeniesionego slotu (WYSIWYG)
      changed = true;
    }
    if (difficulty !== null) {
      player.botDifficulty = difficulty;
      this.botManager.setDifficulty(botId, difficulty, this.botSeed(botId));
      changed = true;
    }
    if (changed) this.broadcastRoomUpdate();
  }

  /**
   * Rozsyła wiadomość czatu gracza do członków pokoju i dopisuje ją do historii (dla nowych
   * graczy). `text` musi być już zsanityzowany (sanitizeChat w connection); pusty/nieznany gracz
   * → no-op. Klient renderuje treść WYŁĄCZNIE przez textContent (XSS) — historia też jest czysta.
   */
  broadcastChat(senderId: number, text: string): void {
    const player = this.players.get(senderId);
    if (!player || text.length === 0) return;
    const msg: ChatMessage = { t: 'chat', id: senderId, nick: player.nick, text };
    this.pushChatHistory(msg);
    this.broadcastControl(msg);
  }

  /** Ostatnie wiadomości czatu (kontekst dla nowego gracza) — connection wysyła je po roomJoined. */
  recentChat(): readonly ChatMessage[] {
    return this.chatHistory;
  }

  /** Komunikat systemowy czatu (id=null) — np. zmiana ustawień pokoju przez hosta. */
  private systemChat(text: string): void {
    const msg: ChatMessage = { t: 'chat', id: null, nick: '', text };
    this.pushChatHistory(msg);
    this.broadcastControl(msg);
  }

  private pushChatHistory(msg: ChatMessage): void {
    this.chatHistory.push(msg);
    if (this.chatHistory.length > CHAT_HISTORY_MAX) this.chatHistory.shift();
  }

  /** Czy gracz o tym id istnieje (np. po reconnect/leave). */
  hasPlayer(id: number): boolean {
    return this.players.has(id);
  }

  nick(id: number): string | undefined {
    return this.players.get(id)?.nick;
  }

  /** Czy w pokoju jest już gracz o tym nicku (ignorując rozłączonych — slot na reconnect). */
  isNickTaken(nick: string): boolean {
    const lower = nick.toLowerCase();
    for (const p of this.players.values()) {
      if (p.member && p.nick.toLowerCase() === lower) return true;
    }
    return false;
  }

  /**
   * Host startuje mecz (waiting → playing) albo rewanż (ended → playing, faza 13). Zeruje
   * wynik, zegar meczu i licznik ekranu wyników; wszyscy gracze spawnują od nowa na swoich
   * slotach (rozrzut), z ochroną respawnu. Z innych stanów = no-op (idempotentne).
   */
  start(): void {
    if (this.state !== 'waiting' && this.state !== 'ended') return;
    this.state = 'playing';
    this.endedTimerS = 0;
    this.pendingEnd = null; // świeży mecz — bez zalegającej zwłoki końca z poprzedniego
    this.pendingEndTimerS = 0;
    this.winnerId = null;
    this.lastEndReason = null;
    // czysty stan walki na nowy mecz: żadnych zalegających pocisków ani eventów
    for (const b of this.pool.bullets) b.active = false;
    this.pendingEvents.length = 0;
    // świeża strefa kontroli: zerowe liczniki, brak przejęcia (faza 17)
    this.zone.reset();
    this.zoneControlling = null;
    this.zoneOccupied = false;
    this.winningFaction = null;
    // przydział drużyn na nowy mecz (faza 18): zbalansowane frakcje przed rozliczaniem życia
    this.assignFactions();
    // świeży, kolizyjnie-bezpieczny rozrzut slotów: sticky player.slot churnuje się (nextSlot++
    // przy przebudowie botów w poczekalni) i dwie encje mogły dostać ten sam slot → spawn w tym
    // samym punkcie → zderzenie po wygaśnięciu ochrony. Przydzielamy odrębne sloty na każdy start.
    this.assignStartSlots();
    // odbudowane stanowiska ogniowe na nowy mecz (pełne taśmy, bez celu)
    for (const e of this.emplacements) e.reset();
    for (const player of this.players.values()) {
      player.kills = 0;
      player.assists = 0;
      player.deaths = 0;
      player.groundKills = 0;
      player.livesLeft = MATCH_LIVES; // pełna pula żyć na nowy mecz (drużynowy: 1/samolot jak SP)
      player.withdrawn = false; // wycofani z poprzedniego meczu wracają do gry przy starcie kolejnego
      player.ready = player.isBot; // gotowość „skonsumowana" — po powrocie do poczekalni człowiek potwierdza od nowa
      this.spawn(player);
    }
    this.broadcastControl({ t: 'matchStarted' });
    this.broadcastRoomUpdate();
    // P1: oba tryby eliminacyjne jak SP — last-man-standing (FFA) / ostatnia drużyna (team) + strefa
    const goal = this.mode === 'team' ? 'eliminacja drużyny / strefa' : 'last-man-standing / strefa';
    this.onInfo?.(`pokój ${this.code}: start meczu (${this.mode}, ${goal}, ${String(this.players.size)} uczestników)`);
  }

  /**
   * Host PRZERYWA trwający mecz (gra z samymi botami — życzenie usera 2026-06-23): playing →
   * waiting BEZ ekranu wyników. Gracz wraca prosto do poczekalni (klient reaguje na roomUpdate
   * state='waiting'). Czyści walkę i strefę jak świeży reset. No-op poza 'playing'. Egzekwowanie
   * „tylko host + brak innych ludzi" jest w connection (klient i tak pokazuje tę opcję tylko z botami).
   */
  abortMatch(): void {
    if (this.state !== 'playing') return;
    this.state = 'waiting';
    this.endedTimerS = 0;
    this.pendingEnd = null;
    this.pendingEndTimerS = 0;
    this.winnerId = null;
    this.winningFaction = null;
    this.lastEndReason = null;
    for (const b of this.pool.bullets) b.active = false;
    this.pendingEvents.length = 0;
    this.zone.reset();
    this.zoneControlling = null;
    this.zoneOccupied = false;
    this.broadcastRoomUpdate();
    this.onInfo?.(`pokój ${this.code}: mecz przerwany (powrót do poczekalni)`);
  }

  /**
   * Gracz WYCOFUJE się z trwającego meczu, ale ZOSTAJE w pokoju (życzenie usera 2026-06-23: gdy
   * grają jeszcze inni ludzie, powrót do poczekalni bez kończenia im gry). Samolot natychmiast
   * wypada z walki: martwy, 0 żyć (nie trzyma frakcji „w grze" → eliminacja może rozstrzygnąć w
   * step()), bez respawnu (withdrawn). Wraca do gry przy następnym starcie meczu (start() zeruje
   * withdrawn + życia i spawnuje od nowa). No-op poza 'playing' / dla nieznanego gracza.
   */
  withdrawToLobby(id: number): void {
    if (this.state !== 'playing') return;
    const player = this.players.get(id);
    if (!player) return;
    player.withdrawn = true;
    player.livesLeft = 0;
    player.sim.state.life = 'dead';
    player.sim.state.lifeTimerS = 0;
    player.protectionTimerS = 0;
    player.inputQueue.length = 0;
    player.lastInput = null;
    player.damagedBy.clear();
  }

  /** Odłącza połączenie gracza, trzymając slot na reconnect (okno RECONNECT_WINDOW_MS). `member`
   *  (opcjonalny) = połączenie zgłaszające rozłączenie: odpinamy TYLKO gdy to wciąż ono trzyma slot.
   *  Bez tego strażnika spóźniony `close` STAREGO (zombie) połączenia wyzerowałby member świeżo
   *  wróconego gracza (reconnect podmienił już member) → kopnięcie tuż po powrocie. */
  detachMember(id: number, nowMs: number, member?: RoomMember): void {
    const player = this.players.get(id);
    if (!player) return;
    if (member !== undefined && player.member !== member) return; // slot przejęło już nowe połączenie
    player.member = null;
    player.disconnectedAtMs = nowMs;
    if (this.hostId === id) this.reassignHost();
    this.broadcastRoomUpdate();
  }

  /**
   * Próbuje wznowić sesję po tokenie: ponownie podpina połączenie do istniejącego gracza. Token to
   * sekret sesji — jego okaziciel JEST tym graczem, więc przejmujemy slot TAKŻE gdy stare połączenie
   * wciąż wisi (`member !== null`). Przy zerwaniu PO STRONIE KLIENTA serwer nie zauważa go od razu
   * (jego TCP czeka na timeout — sekundy/minuty), więc świeża próba wznowienia trafiałaby na „zajęty"
   * slot, dostawała `null` → klient lądował w lobby ze ŚWIEŻYM tokenem (zatruwał zapisany) i pętlił
   * wznawianie. Zombie-połączenie zamykamy (jeśli umie), a strażnik w detachMember broni przed jego
   * spóźnionym `close`.
   */
  reconnectByToken(token: string, member: RoomMember): ServerPlayer | null {
    for (const player of this.players.values()) {
      if (player.sessionToken !== token) continue;
      const stale = player.member;
      if (stale && stale !== member) stale.close?.(); // domknij stare „zombie"-połączenie tego slotu
      player.member = member;
      player.disconnectedAtMs = null;
      if (this.hostId === null) this.hostId = player.id;
      this.broadcastRoomUpdate();
      return player;
    }
    return null;
  }

  /** Trwałe usunięcie gracza (wyjście z pokoju albo wygaśnięcie okna reconnectu). */
  removePlayer(id: number): void {
    if (!this.players.delete(id)) return;
    this.botManager.remove(id); // no-op dla człowieka
    if (this.hostId === id) this.reassignHost();
    this.rebuildSnapshotSources();
    this.broadcastRoomUpdate();
  }

  /** Zwalnia sloty graczy, których okno reconnectu wygasło. Zwraca liczbę usuniętych. */
  pruneExpiredReconnects(nowMs: number, windowMs: number): number {
    let removed = 0;
    for (const player of [...this.players.values()]) {
      if (player.member === null && player.disconnectedAtMs !== null && nowMs - player.disconnectedAtMs >= windowMs) {
        this.players.delete(player.id);
        if (this.hostId === player.id) this.reassignHost();
        removed++;
      }
    }
    if (removed > 0) {
      this.rebuildSnapshotSources();
      this.broadcastRoomUpdate();
    }
    return removed;
  }

  private reassignHost(): void {
    this.hostId = null;
    for (const player of this.players.values()) {
      if (player.member) {
        this.hostId = player.id;
        break;
      }
    }
  }

  /** Dokłada input do kolejki gracza (już zwalidowany przez warstwę połączenia). `lastAckServerTick`
   *  (świeżość widoku klienta dla rewindu lag-comp) bierzemy z NAJŚWIEŻSZEGO odbioru — niezależnie
   *  od kolejki ruchu. Konsumpcja (jeden input = jeden krok) dzieje się w nextInput podczas stepu. */
  applyInput(id: number, frame: InputFrame): void {
    const player = this.players.get(id);
    if (player) {
      player.inputQueue.push(frame);
      // twardy limit pamięci: gracz martwy/respawn nie konsumuje, a klient nadal śle (spawn czyści)
      if (player.inputQueue.length > INPUT_QUEUE_MAX) player.inputQueue.shift();
      player.lastAckServerTick = frame.ackServerTick >>> 0;
    }
  }

  /**
   * Kolejny input do kroku fizyki: zdejmij jeden z kolejki FIFO (jeden input = jeden krok —
   * niezmiennik reconciliation). Gdy kolejka głębsza niż TARGET (burst po przestoju klienta /
   * dryf zegara) — przeskocz nadmiar, by nie narastało opóźnienie inputu (bierz najświeższe
   * intencje). Pusta kolejka → podtrzymaj ostatni skonsumowany (klient chwilowo się spóźnia).
   * Aktualizuje `lastProcessedSeq` (ack rekonsyliacji) ze SKONSUMOWANEGO inputu.
   */
  private nextInput(player: ServerPlayer): InputFrame | null {
    const q = player.inputQueue;
    while (q.length > INPUT_QUEUE_TARGET) q.shift();
    const next = q.shift();
    if (next) {
      player.lastInput = next;
      player.lastProcessedSeq = next.sequence;
    }
    return player.lastInput;
  }

  /** Liczba zestrzeleń gracza (kredyt) — diagnostyka/testy; tabela wyników w fazie 13. */
  killsOf(id: number): number {
    return this.players.get(id)?.kills ?? 0;
  }

  /** Liczba asyst gracza — diagnostyka/testy. */
  assistsOf(id: number): number {
    return this.players.get(id)?.assists ?? 0;
  }

  /** Bieżące HP gracza — diagnostyka/testy (HP jest autorytetem serwera). */
  healthOf(id: number): number {
    return this.players.get(id)?.health.hp ?? 0;
  }

  /** Pozostała amunicja gracza — diagnostyka/testy (kadencja i zapas liczone serwerowo). */
  ammoOf(id: number): number {
    return this.players.get(id)?.fire.ammoRemaining ?? 0;
  }

  /** Liczba aktywnych pocisków w pokoju — diagnostyka/testy. */
  get activeBulletCount(): number {
    return this.pool.activeCount;
  }

  lastProcessedSeq(id: number): number {
    return this.players.get(id)?.lastProcessedSeq ?? 0;
  }

  /** Jeden krok fizyki świata (stały dt). No-op poza stanem 'playing' (poza odliczaniem 'ended'). */
  step(dtS: number): void {
    if (this.state === 'ended') {
      // ekran wyników utrzymujemy MATCH_RESULTS_LINGER_S, potem pokój wraca do poczekalni
      this.endedTimerS += dtS;
      if (this.endedTimerS >= MATCH_RESULTS_LINGER_S) this.returnToWaiting();
      return;
    }
    if (this.state !== 'playing') return;
    this.tick = (this.tick + 1) >>> 0;

    // 1) ruch wszystkich uczestników (alive: fizyka+cykl-życia; dead: timer respawnu).
    // Bot i gracz różnią się TYLKO źródłem sterowania (AI vs input) — dalej identyczna ścieżka.
    for (const player of this.players.values()) {
      try {
        if (player.isBot) this.stepBot(player, dtS);
        else this.stepPlayer(player, dtS);
      } catch (err) {
        // Niezmiennik nr 7: NaN/Infinity wykryty i zrzucony (validatePlaneState),
        // ale spreparowany input jednego gracza (lub pech bota) NIE kładzie serwera dla
        // pozostałych (niezmiennik nr 11). Logujemy zrzut i respawnujemy winowajcę.
        this.onError?.(`pokój ${this.code} gracz ${String(player.id)}: ${err instanceof Error ? err.message : String(err)}`);
        this.spawn(player, true);
      }
    }

    // 1b) kolizje samolot↔samolot (faza 15): zamiatany test prevPos→pozycja; zderzeni → wrak
    // 'dying'. PRZED historią/ogniem, by encja zderzona w tym ticku nie była celem ani nie strzelała.
    this.resolvePlaneCollisions();

    // 1c) kontrola strefy KotH (faza 17): po ruchu i kolizjach (pozycje ostateczne, świeże wraki
    // już 'dying' i strefy nie kontestują). Akumuluje czas; przejęcie rozstrzyga checkMatchEnd.
    this.updateZone(dtS);

    // 2) historia pozycji TEGO ticku (tylko żywi mogą oberwać) — baza rewindu lag-comp
    this.history.beginTick(this.tick);
    for (const player of this.players.values()) {
      if (player.sim.state.life === 'alive') this.history.record(player.id, player.sim.state.position);
    }

    // 3) ogień autorytatywny (kadencja + amunicja serwerowo) → pociski na puli + event MUZZLE
    for (const player of this.players.values()) this.fireWeapon(player, dtS);

    // 3b) ogień naziemnych stanowisk (AA, v6): pociski do tej samej puli + event AA_FIRE
    this.stepEmplacements(dtS);

    // 4) ruch pocisków + 5) hit detection z cofnięciem celów (lag compensation)
    this.pool.update(dtS); // balistyka per pocisk (dragK/lifetime z grupy broni przy strzale)
    this.resolveHits();

    // 6) rozstrzygnięcie końca meczu (po rozliczeniu trafień tego ticku) — strefa albo eliminacja
    this.checkMatchEnd();

    // 7) zwłoka przed tabelą wyników: gdy mecz rozstrzygnięty, matchEnded wstrzymujemy o
    // MATCH_END_VIEW_DELAY_S (pokój wciąż 'playing' → fizyka i snapshoty lecą, widać upadek wroga).
    this.advancePendingEnd(dtS);
  }

  /** Po rozstrzygnięciu odlicza zwłokę i — po jej upływie — faktycznie kończy mecz (matchEnded). */
  private advancePendingEnd(dtS: number): void {
    if (!this.pendingEnd) return;
    this.pendingEndTimerS += dtS;
    if (this.pendingEndTimerS < MATCH_END_VIEW_DELAY_S) return;
    const e = this.pendingEnd;
    this.pendingEnd = null;
    this.endMatch(e.winnerId, e.winningFaction, e.reason);
  }

  /** Samolot bez pilota: żywy gracz-człowiek z zerwanym połączeniem (slot trzymany na reconnect).
   *  Boty mają member=null, ale isBot je wyklucza; wycofani/martwi nie wchodzą w gałąź 'alive'. */
  private isPilotless(player: ServerPlayer): boolean {
    return !player.isBot && player.member === null;
  }

  /**
   * Komenda auto-stabilizacji dla samolotu bez pilota (życzenie usera: po utracie pilota maszyna ma
   * własny, możliwy do odzyskania tor lotu — nie spada w spirali). Instruktor prowadzi nos na POZIOMY
   * kierunek na wprost (rzut nosa na płaszczyznę poziomą) → wyrównuje skrzydła i lot poziomy; gaz
   * krążenia podtrzymuje energię. Przy nosie niemal pionowym rzut się degeneruje → bierzemy poziomą
   * prędkość, a w ostateczności kierunek startowy. Stery klawiatury zerowe, więc stepPilotedPlane
   * wybiera ścieżkę instruktora (jak mysz). Zachowanie WYŁĄCZNIE serwerowe (klient rozłączony nie
   * predykuje) — bez wpływu na reconciliation.
   */
  private autopilotCommandFor(player: ServerPlayer): PilotCommand {
    const dir = getForward(player.sim.state.orientation, scratchAutopilotDir);
    dir.y = 0;
    if (dir.lengthSq() < 1e-6) {
      const vel = player.sim.state.velocity;
      dir.set(vel.x, 0, vel.z);
      if (dir.lengthSq() < 1e-6) dir.copy(player.spawnDir);
    }
    dir.normalize();
    autopilotCommand.throttle = DISCONNECT_CRUISE_THROTTLE;
    autopilotCommand.aimX = dir.x;
    autopilotCommand.aimY = dir.y;
    autopilotCommand.aimZ = dir.z;
    return autopilotCommand;
  }

  private stepPlayer(player: ServerPlayer, dtS: number): void {
    const state = player.sim.state;
    player.prevPos.copy(state.position); // początek zamiatanego odcinka kolizji (faza 15)

    if (state.life === 'alive') {
      if (player.protectionTimerS > 0) player.protectionTimerS = Math.max(0, player.protectionTimerS - dtS);
      // bez pilota (rozłączony gracz, slot trzymany na reconnect): auto-stabilizacja zamiast trzymania
      // ostatniego inputu — inaczej manewr sprzed zerwania (zakręt/nurkowanie) rozbiłby maszynę, zanim
      // gracz wróci. Z pilotem: jeden input = jeden krok (niezmiennik reconciliation).
      const input = this.isPilotless(player) ? this.autopilotCommandFor(player) : this.nextInput(player);
      // ta sama autorytatywna ścieżka co predykcja klienta (shared/world/piloted-plane).
      const event = stepPilotedPlane(
        player.sim,
        player.instructor,
        player.plane,
        player.demands,
        input,
        this.terrain,
        dtS,
        `serwer ${this.code}: gracz ${String(player.id)}`,
      );
      this.fixWrapPrev(player);
      if (event === 'crashed') this.onGroundDeath(player);
    } else if (state.life === 'dying') {
      // spadający wrak gracza (faza 15): silnik martwy, ster ograniczony; steruje gracz
      // klawiaturą wprost. TA SAMA ścieżka co predykcja wraku u klienta (faza 16,
      // shared/world/piloted-plane: stepWreckPiloted) — niezmiennik reconciliation.
      // Ack sekwencji tu, by replay wraku po stronie klienta miał punkt odniesienia.
      // wreckImpact w środku → 'dead' i start odliczania respawnu (buchalteria była przy zestrzeleniu).
      const input = this.nextInput(player); // jeden input = jeden krok (niezmiennik reconciliation)
      stepWreckPiloted(
        player.sim,
        player.plane,
        player.demands,
        input,
        this.terrain,
        dtS,
        `serwer ${this.code}: wrak ${String(player.id)}`,
      );
      this.fixWrapPrev(player);
    } else if (updateLifecycle(state, this.terrain, dtS) === 'respawnReady' && this.canRespawn(player)) {
      this.spawn(player, true);
    }
  }

  /** Czy gracz może się odrodzić (P1 2026-06-19: oba tryby eliminacyjne jak SP — respawn tylko
   *  z zapasem żyć, MATCH_LIVES=1/samolot). Bez żyć → obserwator, nie respawnuje; przy normalnej
   *  grze ścieżka „respawn w trakcie" jest więc martwa, zostaje dla LATE-JOIN i guardu NaN
   *  (catch w step → spawn(player, true) z pominięciem tego gatingu). updateLifecycle i tak biegnie. */
  private canRespawn(player: ServerPlayer): boolean {
    return player.livesLeft > 0 && !player.withdrawn;
  }

  /**
   * Po zawinięciu torusa sprowadza `prevPos` do obrazu najbliższego pozycji końcowej. Bez tego
   * encja przeniesiona na drugą stronę areny miałaby zamiatany odcinek kolizji długości ~areny
   * (fałszywe zderzenia z odległymi maszynami). `nearestToroidalImage(p, ref, p)` jest in-place
   * bezpieczne (argumenty `.set` liczone przed zapisem).
   */
  private fixWrapPrev(player: ServerPlayer): void {
    nearestToroidalImage(player.prevPos, player.sim.state.position, player.prevPos);
  }

  /**
   * Jeden tick bota: decyzja AI (z decymacją 10 Hz) → ta sama sekwencja co stepPilotedPlane
   * (pilotStep → zawinięcie torusa → strażnik NaN → cykl życia), tylko żądania pochodzą z
   * instruktora bota, nie z inputu sieciowego. Faza decyzji offsetowana slotem, żeby nie
   * wszystkie boty myślały w tym samym ticku (rozłożenie CPU — pułapka faza-12.md).
   */
  private stepBot(player: ServerPlayer, dtS: number): void {
    const state = player.sim.state;
    player.prevPos.copy(state.position); // początek zamiatanego odcinka kolizji (faza 15)
    if (state.life === 'alive') {
      if (player.protectionTimerS > 0) player.protectionTimerS = Math.max(0, player.protectionTimerS - dtS);
      if ((this.tick + player.slot) % BOT_THINK_INTERVAL === 0) {
        this.botManager.think(
          player.id,
          state,
          player.plane,
          this.collectBotTargets(player),
          this.terrain,
          player.demands,
          dtS * BOT_THINK_INTERVAL,
        );
      }
      state.throttle = this.botManager.controlOf(player.id).throttle;
      pilotStep(player.sim, player.plane, player.demands, dtS);
      wrapToArena(state.position, scratchBotWrap);
      validatePlaneState(state, `serwer ${this.code}: bot ${String(player.id)}`);
      this.fixWrapPrev(player);
      if (updateLifecycle(state, this.terrain, dtS) === 'crashed') this.onGroundDeath(player);
    } else if (state.life === 'dying') {
      // wrak bota: neutralny opad balistyczny (bez AI) — command null; wreckImpact w środku
      // → 'dead' → odliczanie respawnu. Ta sama ścieżka co wrak gracza (stepWreckPiloted).
      stepWreckPiloted(
        player.sim,
        player.plane,
        player.demands,
        null,
        this.terrain,
        dtS,
        `serwer ${this.code}: wrak ${String(player.id)}`,
      );
      this.fixWrapPrev(player);
    } else if (updateLifecycle(state, this.terrain, dtS) === 'respawnReady' && this.canRespawn(player)) {
      this.spawn(player, true);
    }
  }

  /** Żywe stany WROGÓW jako kandydaci na cel bota: FFA — każdy poza nim; drużynowy — inna drużyna
   *  (bot nie bierze na cel sojuszników, parytet z SP enemyCandidates). */
  private collectBotTargets(self: ServerPlayer): readonly PlaneState[] {
    this.botTargetScratch.length = 0;
    for (const p of this.players.values()) {
      if (p === self || p.sim.state.life !== 'alive') continue;
      if (this.mode === 'team' && p.faction === self.faction) continue;
      this.botTargetScratch.push(p.sim.state);
    }
    return this.botTargetScratch;
  }

  /** Krok kontroli ognia: spust z inputu (gracz) albo z decyzji AI (bot); rewind lag-comp, event MUZZLE. */
  private fireWeapon(player: ServerPlayer, dtS: number): void {
    const state = player.sim.state;
    // strzela żywy (gracz/bot) ALBO spadający wrak GRACZA (parytet z SP: wrak pruje do uderzenia
    // w ziemię — bot-wrak nie). Wrak nie jest celem ani się nie zderza (resolveHits/kolizje go
    // pomijają), ale broń wciąż działa z bieżącej pozy.
    const wreckCanFire = state.life === 'dying' && !player.isBot;
    if (state.life !== 'alive' && !wreckCanFire) return;
    // samolot bez pilota (rozłączony) nie strzela, nawet jeśli spust był wciśnięty w chwili zerwania
    const triggerHeld = player.isBot
      ? this.botManager.fireOf(player.id)
      : !this.isPilotless(player) && (player.lastInput?.fire ?? false);
    // otwarcie ognia oddaje ochronę respawnu (nietykalny nie może też zadawać — faza 13)
    if (triggerHeld && player.protectionTimerS > 0) player.protectionTimerS = 0;
    const rewindTicks = this.computeRewindTicks(player);
    // state spełnia FiringPlatform (position/velocity/orientation); pociski lecą z TERAŹNIEJSZEJ
    // pozycji strzelca (nie cofamy strzelca — pułapka faza-11.md), cele cofamy w resolveHits.
    const fired = updateFire(
      player.fire,
      player.plane.armament,
      state,
      player.id,
      player.rng,
      this.pool,
      triggerHeld,
      dtS,
      rewindTicks,
    );
    if (fired > 0) {
      const seed = ((((player.id + 1) * 0x9e3779b1) >>> 0) ^ this.tick) >>> 0;
      this.queueEvent({ kind: 'muzzle', ownerId: player.id, seed, shots: fired });
    }
  }

  /**
   * Rewind celów dla pocisków tego strzelca [ticki] = (teraz − ostatni potwierdzony tick)
   * + bufor interpolacji, clamp do MAX_REWIND_TICKS. Pierwszy człon ≈ ping/2 + droga w drugą
   * stronę (serwer→klient→serwer), mierzony echem ticku bez synchronizacji zegarów (faza 11).
   */
  private computeRewindTicks(player: ServerPlayer): number {
    const sinceAck = (this.tick - player.lastAckServerTick) >>> 0;
    const rewind = sinceAck + INTERP_DELAY_TICKS;
    return rewind > MAX_REWIND_TICKS ? MAX_REWIND_TICKS : rewind;
  }

  /**
   * Krok naziemnych stanowisk ogniowych (AA, v6). Zbiera żywe, nietykalne samoloty jako cele
   * (stanowisko jest neutralne — strzela do każdego: gracza i bota), po czym każde NIEzniszczone
   * stanowisko decyduje o ogniu (zasięg + widoczność + wyprzedzenie z błędem + seria/taśma). Z wyniku
   * spawnujemy pociski w puli (te same, co broń pokładowa) i emitujemy event AA_FIRE (tracery klienta).
   */
  private stepEmplacements(dtS: number): void {
    let n = 0;
    for (const p of this.players.values()) {
      if (p.sim.state.life !== 'alive' || p.protectionTimerS > 0) continue;
      const slot = this.aaTargetScratch[n];
      if (!slot) break; // bufor = MAX_PLAYERS_PER_ROOM; nigdy nie przekroczone
      slot.id = p.id;
      slot.position.copy(p.sim.state.position);
      slot.velocity.copy(p.sim.state.velocity);
      n++;
    }
    const targets = this.aaTargetScratch.slice(0, n);
    for (const e of this.emplacements) {
      if (e.destroyed) continue;
      const fire = e.update(dtS, targets, this.terrain);
      if (fire) this.spawnAaBullets(e, fire);
    }
  }

  /** Spawnuje pociski jednej salwy stanowiska (rozrzut per pocisk) i kolejkuje event AA_FIRE. */
  private spawnAaBullets(e: Emplacement, fire: AaFire): void {
    const dispersionRad = EMPLACEMENT_DISPERSION_MRAD * MRAD_TO_RAD;
    for (let i = 0; i < fire.shots; i++) {
      scratchAaDir.copy(fire.dir);
      applyDispersion(scratchAaDir, dispersionRad, this.aaRng);
      scratchAaVel.copy(scratchAaDir).multiplyScalar(AA_BALLISTICS.muzzleVelocityMs);
      // ownerId = sentinel (nie samolot): pocisk AA trafia każdy samolot i nie niszczy stanowisk.
      // rewindTicks=0 — „strzelcem" jest serwer, cele rażone w teraźniejszej pozycji (bez lag-comp).
      this.pool.spawn(
        e.muzzlePosition,
        scratchAaVel,
        AA_BALLISTICS.damagePerHit,
        EMPLACEMENT_BULLET_OWNER,
        i % 3 === 0,
        AA_BALLISTICS.bulletDragK,
        AA_BALLISTICS.bulletLifetimeS,
        0,
      );
    }
    const seed = ((((e.index + 1) * 0x85ebca6b) >>> 0) ^ this.tick) >>> 0;
    this.queueEvent({ kind: 'aaFire', index: e.index, seed, shots: fire.shots, dir: fire.dir.clone() });
  }

  /**
   * Hit detection: każdy aktywny pocisk vs każdy żywy cel (poza właścicielem). Cel jest
   * cofany do ticku, który strzelec widział (b.rewindTicks); brak danych w oknie → pozycja
   * bieżąca (fallback). HP, kredyt i eventy — wyłącznie tu (niezmiennik nr 5). Friendly fire
   * ON (FFA; drużyny w fazie 13). Pocisk trafia najwyżej jeden cel.
   */
  private resolveHits(): void {
    for (const b of this.pool.bullets) {
      if (!b.active) continue;
      const fromAa = b.ownerId === EMPLACEMENT_BULLET_OWNER;
      let consumed = false;
      for (const target of this.players.values()) {
        const ts = target.sim.state;
        // cel pod ochroną respawnu jest nietykalny (faza 13) — pocisk go ignoruje
        if (ts.life !== 'alive' || target.id === b.ownerId || target.protectionTimerS > 0) continue;
        const targetTick = (this.tick - b.rewindTicks) >>> 0;
        const center = this.history.sample(target.id, targetTick, scratchHitCenter)
          ? scratchHitCenter
          : ts.position;
        // promień sfery trafień per CEL (faza 19b: Bf 109 5,5 m < Spitfire 6 m)
        if (!segmentSphereHit(b.prevPosition, b.position, center, target.plane.hitRadiusM)) continue;
        b.active = false;
        consumed = true;
        target.damagedBy.add(b.ownerId);
        if (applyDamage(target.health, b.damage) === 'destroyed') {
          // pocisk AA → zestrzelenie z ziemi (flak, bez sprawcy-gracza); inaczej zwykłe zestrzelenie
          if (fromAa) this.onAaKill(target);
          else this.onAirKill(target, b.ownerId);
        } else {
          // zwykłe trafienie niesie realnego strzelca (hit marker/ding). Trafienie z ziemi (AA) NIE
          // ma sprawcy-gracza → bez eventu hit (feedback ofiary flaku dorobimy w części 2), ale bot
          // i tak reaguje uskokiem.
          if (!fromAa) this.queueEvent({ kind: 'hit', shooterId: b.ownerId, victimId: target.id });
          // bot trafiony, ale żywy → reakcja AI (zryw obronny na „trudnym"; niższe poziomy ignorują)
          if (target.isBot) this.botManager.notifyHit(target.id);
        }
        break; // jeden pocisk = najwyżej jedno trafienie
      }
      if (consumed || fromAa) continue; // pocisk AA NIE niszczy innych stanowisk
      // pocisk SAMOLOTU może zniszczyć naziemne stanowisko ogniowe (jeden strzał wystarcza)
      for (const e of this.emplacements) {
        if (e.destroyed) continue;
        if (!segmentSphereHit(b.prevPosition, b.position, e.muzzlePosition, EMPLACEMENT_HIT_RADIUS_M)) continue;
        b.active = false;
        e.destroyed = true;
        const shooter = this.players.get(b.ownerId);
        if (shooter) shooter.groundKills++; // +EMPLACEMENT_POINTS w tabeli (scorePoints)
        this.queueEvent({ kind: 'aaDestroyed', index: e.index, killerId: b.ownerId & 0xff });
        break;
      }
    }
  }

  /**
   * Zestrzelenie w POWIETRZU → spadający wrak (life 'dying', faza 15): buchalteria (śmierć,
   * kredyt, asysty) liczona TERAZ — strzelec zasłużył w chwili zestrzelenia, jak w SP. Wrak
   * spada (stepWreck), a respawn rusza dopiero po uderzeniu w ziemię (updateLifecycle: wreckImpact).
   */
  private onAirKill(victim: ServerPlayer, killerId: number): void {
    this.enterWreck(victim);
    this.queueEvent({ kind: 'kill', killerId, victimId: victim.id, cause: 'air' });
    const killer = this.players.get(killerId);
    // kredyt tylko za zestrzelenie WROGA (faza 18: teamkill bez punktu). W FFA frakcja = id,
    // więc warunek redukuje się do „nie samobójstwo" → zachowanie z fazy 13 bez zmian.
    if (killer && killer !== victim && killer.faction !== victim.faction) killer.kills++;
    this.creditAssists(victim, killerId);
  }

  /** Przejście ofiary w spadający wrak (zestrzelenie/kolizja): life 'dying' + śmierć + zużycie życia. */
  private enterWreck(victim: ServerPlayer): void {
    victim.sim.state.life = 'dying';
    victim.sim.state.lifeTimerS = 0; // licznik spadania (UI/diagnostyka); reset też przy uderzeniu
    victim.deaths++;
    this.loseLife(victim);
  }

  /** Zużycie życia (P1 2026-06-19: eliminacja w OBU trybach, MATCH_LIVES na samolot jak SP).
   *  0 żyć → brak respawnu (canRespawn) → koniec gry dla tej maszyny (FFA: gracz wypada). */
  private loseLife(victim: ServerPlayer): void {
    victim.livesLeft = Math.max(0, victim.livesLeft - 1);
  }

  /**
   * Zderzenia samolot↔samolot (faza 15, parytet z SP): para ŻYWYCH płatowców, których sfery
   * kolizji (collisionRadiusM) zetkną się W TRAKCIE ticku, ulega natychmiastowemu zniszczeniu —
   * oba stają się spadającymi wrakami (cause 'collision', bez kredytu). Test ZAMIATANY
   * (planesCollide na prevPos→pozycja) łapie lot czołowy mimo dużej prędkości zbliżania.
   * Nietykalni po respawnie (protectionTimerS) i nie-żywi są wyłączeni. Pary liczone raz (i<j);
   * gdy `a` zginie, przerywamy pętlę wewnętrzną — martwy płatowiec nie zderza się dalej.
   */
  private resolvePlaneCollisions(): void {
    const live = this.collisionScratch;
    live.length = 0;
    for (const p of this.players.values()) {
      if (p.sim.state.life === 'alive' && p.protectionTimerS <= 0) live.push(p);
    }
    for (let i = 0; i < live.length; i++) {
      const a = live[i]!;
      if (a.sim.state.life !== 'alive') continue; // a zginął w tej klatce (wcześniejsza para)
      for (let j = i + 1; j < live.length; j++) {
        const b = live[j]!;
        if (b.sim.state.life !== 'alive') continue;
        // promień kolizji per płatowiec (faza 19b): suma promieni środków (mix typów dozwolony)
        if (
          !planesCollide(
            a.prevPos,
            a.sim.state.position,
            a.plane.collisionRadiusM,
            b.prevPos,
            b.sim.state.position,
            b.plane.collisionRadiusM,
          )
        )
          continue;
        this.onCollisionDeath(a);
        this.onCollisionDeath(b);
        break;
      }
    }
  }

  /** Śmierć w zderzeniu: spadający wrak bez kredytu (jak rozbicie), event KILL cause 'collision'
   *  (serwer ZACZYNA go emitować — faza 15) + asysty wcześniejszych napastników. */
  private onCollisionDeath(victim: ServerPlayer): void {
    this.enterWreck(victim);
    this.queueEvent({ kind: 'kill', killerId: NO_KILLER, victimId: victim.id, cause: 'collision' });
    this.creditAssists(victim, null);
  }

  /**
   * Zestrzelenie przez naziemne stanowisko ogniowe (flak, v6) → spadający wrak jak przy zestrzeleniu
   * w powietrzu (parytet), ale BEZ sprawcy-gracza (kredytu nie ma). event KILL cause 'flak'.
   */
  private onAaKill(victim: ServerPlayer): void {
    this.enterWreck(victim);
    this.queueEvent({ kind: 'kill', killerId: NO_KILLER, victimId: victim.id, cause: 'flak' });
    this.creditAssists(victim, null);
  }

  /** Rozbicie o teren: śmierć, zużycie życia, event KILL bez sprawcy + asysty dla napastników. */
  private onGroundDeath(victim: ServerPlayer): void {
    victim.deaths++;
    this.loseLife(victim);
    this.queueEvent({ kind: 'kill', killerId: NO_KILLER, victimId: victim.id, cause: 'ground' });
    this.creditAssists(victim, null);
  }

  /** Asysta dla każdego WROGA, kto wcześniej trafił ofiarę — poza zabójcą (ma już zestrzelenie).
   *  Faza 18: trafienie sojusznika (ta sama frakcja) nie daje asysty. FFA bez zmian (frakcja = id). */
  private creditAssists(victim: ServerPlayer, killerId: number | null): void {
    for (const attackerId of victim.damagedBy) {
      if (attackerId === killerId) continue;
      const attacker = this.players.get(attackerId);
      if (attacker && attacker !== victim && attacker.faction !== victim.faction) attacker.assists++;
    }
    victim.damagedBy.clear();
  }

  private queueEvent(ev: GameEvent): void {
    // cap obronny: przy realnych kadencjach nieosiągalny, ale chroni ramkę EVENT (count u8)
    if (this.pendingEvents.length < MAX_EVENTS_PER_FRAME) this.pendingEvents.push(ev);
  }

  /**
   * Ustawia gracza na slocie startowym i zeruje stan symulacji (spawn/respawn). `useSelection`
   * (respawn w trakcie meczu) wybiera slot najdalej od żywych wrogów (anty-spawn-kill, faza 13);
   * bez niego (start meczu / wejście do poczekalni) bierze stały slot gracza (równy rozrzut).
   */
  private spawn(player: ServerPlayer, useSelection = false): void {
    // typ samolotu na to życie (faza 19b): drużynowy wg strony, FFA wg wyboru gracza. Gdy się
    // zmienił, applyPlaneSelection podmienił już plane/fire/health i przebudował źródła snapshotu.
    this.applyPlaneSelection(player);
    const slotIndex = useSelection ? this.chooseSpawnSlot(player) : player.slot;
    const ring = this.spawnRing[slotIndex]!;
    player.spawnPos.copy(ring.pos);
    player.spawnDir.copy(ring.dir);

    const state = player.sim.state;
    state.position.copy(player.spawnPos);
    state.velocity.copy(player.spawnDir).multiplyScalar(SPAWN_SPEED_MS);
    state.orientation.setFromUnitVectors(FORWARD_Z, player.spawnDir);
    state.angularRates.pitch = 0;
    state.angularRates.roll = 0;
    state.angularRates.yaw = 0;
    state.throttle = SPAWN_THROTTLE;
    state.fuelFrac = 1; // nowe życie = pełny bak
    state.iasMs = SPAWN_SPEED_MS;
    state.loadFactor = 1;
    state.stalled = false;
    state.life = 'alive';
    state.lifeTimerS = 0;
    player.instructor.reset();
    // świeże życie: porzuć inputy sprzed śmierci (klient też czyści predykcję przy zmianie fazy) —
    // lot prosto neutralnymi żądaniami, aż przyjdzie pierwszy input nowego życia
    player.inputQueue.length = 0;
    player.lastInput = null;
    player.sim.gLoadMachine.reset();
    player.sim.gLoadEffects.reserve = 1;
    player.sim.gLoadEffects.blackoutFactor = 0;
    player.demands.nDemandG = 1;
    player.demands.rollRateRadS = 0;
    player.demands.yawRateRadS = 0;

    // nowe życie: pełne HP, pełna amunicja, czysta lista napastników (kredyt asyst)
    resetHealth(player.health, player.plane.hpPool);
    resetFireControl(player.fire, player.plane.armament); // pełny zapas wszystkich grup + zerowanie cooldownów
    player.damagedBy.clear();
    // nietykalność po (re)spawnie (anty-spawn-kill); znika po czasie albo gdy gracz strzeli
    player.protectionTimerS = SPAWN_PROTECTION_S;

    // bot: zeruj filtry kontrolera i celownik na nowy nos (nie myśli starym stanem po respawnie)
    // oraz nadaj nick wg samolotu na to życie (efektywny typ jest już ustalony przez applyPlaneSelection)
    if (player.isBot) {
      this.botManager.reset(player.id, state);
      this.refreshBotName(player);
    }
  }

  /**
   * Przydziela każdej encji ODRĘBNY slot startowy, równomiernie rozłożony po pierścieniu, tuż przed
   * masowym spawnem na start meczu. Konieczne, bo sticky `player.slot` (nextSlot++ % SPAWN_RING_SLOTS)
   * churnuje się przy przebudowie botów (zmiana ustawień w poczekalni) i dwie encje mogły wylądować
   * na tym samym slocie → spawn w identycznym punkcie → zderzenie po wygaśnięciu ochrony. Liczba
   * uczestników ≤ MAX_PLAYERS_PER_ROOM = SPAWN_RING_SLOTS, więc round(i·S/n) jest różnowartościowe
   * (krok S/n ≥ 1 ⇒ ściśle rosnące, wartości w [0, S−1]) — także maksymalny rozrzut przy małym n
   * (1v1: przeciwne sloty pierścienia zamiast sąsiednich). */
  private assignStartSlots(): void {
    const n = this.players.size;
    if (n === 0) return;
    let i = 0;
    for (const player of this.players.values()) {
      player.slot = Math.round((i * SPAWN_RING_SLOTS) / n) % SPAWN_RING_SLOTS;
      i++;
    }
  }

  /** Indeks slotu startowego najdalej od żywych wrogów (anty-spawn-kill); fallback = stały slot. */
  private chooseSpawnSlot(player: ServerPlayer): number {
    this.occupantScratch.length = 0;
    for (const p of this.players.values()) {
      if (p !== player && p.sim.state.life === 'alive') this.occupantScratch.push(p.sim.state.position);
    }
    const idx = chooseSpawnIndex(this.spawnRingPositions, this.occupantScratch);
    return idx >= 0 ? idx : player.slot;
  }

  /** Liczba śmierci gracza w meczu — diagnostyka/testy. */
  deathsOf(id: number): number {
    return this.players.get(id)?.deaths ?? 0;
  }

  /** Frakcja/drużyna gracza (faza 18) — diagnostyka/testy (FFA: = id; drużynowy: 0..TEAM_COUNT−1). */
  factionOf(id: number): number {
    return this.players.get(id)?.faction ?? -1;
  }

  /** Poziom trudności bota (lobby slotowe RTS 2026-06-26) — diagnostyka/testy; undefined dla nie-bota. */
  botDifficultyOf(id: number): DifficultyLevel | undefined {
    const p = this.players.get(id);
    return p?.isBot ? p.botDifficulty : undefined;
  }

  /** Pozostałe życia gracza w trybie eliminacyjnym (faza 18) — diagnostyka/testy. */
  livesOf(id: number): number {
    return this.players.get(id)?.livesLeft ?? 0;
  }

  /**
   * Kontrola strefy KotH w jednym ticku (faza 17, parytet z SP/updateZone). Zbiera ŻYWYCH
   * okupantów (FFA: każdy gracz osobną frakcją = jego id; faza 18 wprowadzi drużyny),
   * akumuluje czas WYŁĄCZNEJ kontroli (sporna/pusta pauzuje, bez cofania) i zapisuje bieżącą
   * okupację do statusu paska. Przejęcie (ZONE_CAPTURE_SECONDS) rozstrzyga checkMatchEnd.
   * Spadający wrak ('dying') strefy NIE kontestuje. Bufor okupantów wielokrotnego użytku.
   */
  private updateZone(dtS: number): void {
    let n = 0;
    for (const p of this.players.values()) {
      const o = this.zoneOccupantScratch[n];
      if (!o) break; // bufor = MAX_PLAYERS_PER_ROOM; nigdy nie przekroczone
      o.faction = p.faction; // FFA: frakcja = id; drużynowy: drużyna (skrzydłowi liczą się wspólnie)
      o.alive = p.sim.state.life === 'alive';
      o.xM = p.sim.state.position.x;
      o.zM = p.sim.state.position.z;
      n++;
    }
    const tick = this.zone.update(this.zoneOccupantScratch, dtS, n);
    this.zoneControlling = tick.controlling;
    this.zoneOccupied = tick.occupied;
  }

  /**
   * Rozstrzyga koniec meczu. Boty są pełnymi uczestnikami (mogą wygrać — protokołowo
   * nieodróżnialne, faza 12). Wołane co tick po rozliczeniu trafień; pierwszy spełniony warunek
   * (strefa albo eliminacja) kończy mecz. P1 (2026-06-19): OBA tryby eliminacyjne jak SP — brak
   * limitu zestrzeleń i czasu (usunięte evaluateFfa/zegar).
   */
  private checkMatchEnd(): void {
    // mecz już rozstrzygnięty (czeka na upływ zwłoki przed tabelą) — nie rozstrzygaj ponownie
    if (this.pendingEnd) return;
    // strefa KotH (faza 17) ma pierwszeństwo w OBU trybach: pełne przejęcie = natychmiastowe
    // zwycięstwo frakcji (FFA: gracza; drużynowy: drużyny) — to główny cel gry (parytet z SP).
    if (this.zone.captured !== null) {
      this.endByFaction(this.zone.captured, 'zone');
      return;
    }
    // eliminacja (parytet z SP/match.ts) — ostatnia FRAKCJA z samolotami wygrywa, bez limitu czasu.
    // W FFA frakcja = id → last-man-standing; w drużynowym → ostatnia drużyna.
    this.checkElimination();
  }

  /**
   * Eliminacja w OBU trybach (P1, parytet z SP/match.ts): mecz kończy się, gdy zostaje ≤1 frakcja
   * z samolotami (życiami). Wymaga ≥2 frakcji w grze — degeneracja: pokój z jedną frakcją (FFA solo
   * bez wrogów / drużynowy z 1 drużyną) NIE „wygrywa przez eliminację", czeka na strefę (jak SP
   * wymaga przeciwników). Obustronna eliminacja w tym samym ticku (0 frakcji w grze) → remis.
   * FFA: `winningFaction` = null (brak drużyn), zwycięzcą jest ocalały gracz (= jego id).
   */
  private checkElimination(): void {
    this.teamMembersScratch.length = 0;
    const factions = new Set<number>();
    for (const p of this.players.values()) {
      this.teamMembersScratch.push({ faction: p.faction, livesLeft: p.livesLeft });
      factions.add(p.faction);
    }
    if (factions.size < TEAM_COUNT) return; // <2 frakcji → brak rozstrzygnięcia eliminacją (TEAM_COUNT=2)
    const inPlay = factionsInPlay(this.teamMembersScratch);
    if (inPlay.size > 1) return; // ≥2 frakcje wciąż mają samoloty — mecz trwa
    const survivingFaction = inPlay.size === 1 ? [...inPlay][0]! : null; // null = remis (obustronna)
    if (this.mode === 'team') {
      const winnerId = survivingFaction === null ? null : this.topPlayerOfFaction(survivingFaction);
      this.scheduleEnd(winnerId, survivingFaction, 'score');
    } else {
      // FFA: frakcja = id → ocalała frakcja to id zwycięzcy; brak drużyn (winningFaction = null)
      this.scheduleEnd(survivingFaction, null, 'score');
    }
  }

  /** Planuje koniec meczu z perspektywy zwycięskiej FRAKCJI (przejęcie strefy). FFA: frakcja = id
   *  zwycięzcy; drużynowy: zwycięska drużyna + jej najlepszy gracz jako `winnerId` (do ekranu wyników). */
  private endByFaction(faction: number, reason: MatchEndReason): void {
    if (this.mode === 'team') this.scheduleEnd(this.topPlayerOfFaction(faction), faction, reason);
    else this.scheduleEnd(faction, null, reason);
  }

  /**
   * Planuje koniec meczu z 5-sekundową zwłoką (MATCH_END_VIEW_DELAY_S): pokój zostaje 'playing',
   * więc fizyka i snapshoty lecą dalej (klienci widzą upadek ostatniego wroga), a matchEnded
   * pójdzie dopiero po upływie zwłoki (advancePendingEnd). Idempotentne — werdykt ustalany raz.
   */
  private scheduleEnd(winnerId: number | null, winningFaction: number | null, reason: MatchEndReason): void {
    if (this.pendingEnd) return;
    this.pendingEnd = { winnerId, winningFaction, reason };
    this.pendingEndTimerS = 0;
  }

  /** Id najlepszego gracza danej frakcji (ranking FFA: zestrzelenia↓/śmierci↑/id↑) albo null. */
  private topPlayerOfFaction(faction: number): number | null {
    let best: ServerPlayer | null = null;
    for (const p of this.players.values()) {
      if (p.faction !== faction) continue;
      if (best === null || compareFfa(p, best) < 0) best = p; // ServerPlayer spełnia FfaScore (id/kills/deaths)
    }
    return best ? best.id : null;
  }

  /** Kończy mecz: playing → ended, gasi walkę, rozsyła finalną tabelę i loguje wynik. */
  private endMatch(winnerId: number | null, winningFaction: number | null, reason: MatchEndReason): void {
    this.state = 'ended';
    this.endedTimerS = 0;
    this.pendingEnd = null; // zwłoka domknięta (advancePendingEnd) — wyczyść defensywnie
    this.pendingEndTimerS = 0;
    this.winnerId = winnerId;
    this.winningFaction = winningFaction;
    this.lastEndReason = reason;
    for (const b of this.pool.bullets) b.active = false;
    this.pendingEvents.length = 0;
    const rows = this.buildStandings();
    this.broadcastControl({ t: 'matchEnded', mode: this.mode, winnerId, winningFaction, reason, rows });
    this.broadcastRoomUpdate();
    const winnerLabel =
      this.mode === 'team'
        ? winningFaction !== null
          ? `drużyna ${String(winningFaction)}`
          : 'remis'
        : winnerId !== null
          ? (this.players.get(winnerId)?.nick ?? `#${String(winnerId)}`)
          : 'brak';
    this.onInfo?.(
      `pokój ${this.code}: koniec meczu (${this.mode}/${reason}), zwycięzca ${winnerLabel}; ` +
        rows.map((r) => `${r.nick} ${String(r.kills)}/${String(r.deaths)}`).join(', '),
    );
  }

  /** Po wygaśnięciu ekranu wyników: ended → waiting (pokój znów dołączalny). */
  private returnToWaiting(): void {
    this.state = 'waiting';
    this.endedTimerS = 0;
    this.broadcastRoomUpdate();
  }

  /** Buduje tabelę wyników posortowaną rankingiem FFA (najlepszy pierwszy). */
  buildStandings(): StandingRow[] {
    const rows: StandingRow[] = [...this.players.values()].map((p) => ({
      id: p.id,
      nick: p.nick,
      faction: p.faction, // FFA: frakcja = id; drużynowy: drużyna (faza 18) — klient grupuje/koloruje
      kills: p.kills,
      deaths: p.deaths,
      assists: p.assists,
      groundKills: p.groundKills, // zniszczone stanowiska AA (po EMPLACEMENT_POINTS pkt; v6)
      pingMs: p.pingMs,
      isBot: p.isBot,
      // sekundy wyłącznej kontroli strefy przez frakcję gracza (drużynowy: wspólne dla drużyny); faza 17
      zoneSeconds: Math.round(this.zone.seconds(p.faction)),
    }));
    rows.sort(compareFfa); // StandingRow spełnia FfaScore strukturalnie (id/kills/deaths)
    return rows;
  }

  /**
   * Rozsyła tabelę wyników do podłączonych członków (JSON, poza hot pathem). Wołane przez
   * pętlę serwera z częstotliwością STANDINGS_BROADCAST_HZ. No-op poza 'playing'.
   */
  broadcastStandings(): void {
    if (this.state !== 'playing') return;
    this.updatePings();
    this.broadcastControl({
      t: 'standings',
      mode: this.mode, // klient przełącza render FFA↔drużynowy (kolory markerów, scoreboard) — faza 18
      rows: this.buildStandings(),
      // bieżąca okupacja strefy do statusu paska ZoneBar (faza 17); fronty z zoneSeconds wierszy
      zone: { controlling: this.zoneControlling, occupied: this.zoneOccupied },
      // stan stanowisk AA (v6) — dla późno dołączających: które są już zniszczone (czarne, dymiące)
      aaDestroyed: this.emplacements.map((e) => e.destroyed),
    });
  }

  /**
   * Szacuje ping graczy z echa ticku (sinceAck = tick − ostatni potwierdzony tick): pełna
   * droga serwer→klient→serwer + bufor snapshotu, bez synchronizacji zegarów (jak rewind
   * lag-comp). EMA wygładza jitter (snapshot 30 Hz wprowadza ~±33 ms w echu). Bot = 0.
   */
  private updatePings(): void {
    for (const p of this.players.values()) {
      if (p.isBot) {
        p.pingMs = 0;
        continue;
      }
      if (!p.member || p.lastAckServerTick === 0) continue; // brak danych — trzymaj ostatni
      const sinceTicks = (this.tick - p.lastAckServerTick) >>> 0;
      const sampleMs = Math.min(2000, Math.round(sinceTicks * (1000 / PHYSICS_HZ)));
      p.pingMs = p.pingMs === 0 ? sampleMs : Math.round(p.pingMs * 0.7 + sampleMs * 0.3);
    }
  }

  private rebuildSnapshotSources(): void {
    this.snapshotSources = [...this.players.values()].map((p) => {
      // grupa wtórna (np. działko 20 mm MG FF w Bf 109) — osobny licznik w HUD (protokół v5).
      // Spitfire ma jedną grupę → fireSecondary=null, ammoSecondaryMax=0 (klient pomija licznik).
      const secGroup = p.plane.armament.groups[1];
      const secFire = p.fire.groups[1];
      return {
        id: p.id,
        state: p.sim.state,
        health: p.health,
        // żywe referencje (state/health/fire) — pole `ammoRemaining` mutuje się co tick, więc snapshot
        // zawsze koduje aktualny stan bez przebudowy źródeł. ammoMax/planeType per gracz (faza 19b);
        // przy zmianie typu applyPlaneSelection przebudowuje źródła (świeże ref fire/health + ammoMax).
        fire: p.fire,
        ammoMax: totalAmmo(p.plane.armament),
        fireSecondary: secGroup && secFire ? secFire : null,
        ammoSecondaryMax: secGroup ? secGroup.ammoPerGun * secGroup.muzzles.length : 0,
        planeType: p.planeType,
      };
    });
  }

  /** Źródła do zakodowania snapshotu (referencje do żywych stanów — bez kopii). */
  snapshotEntities(): readonly SnapshotEntitySource[] {
    return this.snapshotSources;
  }

  /** Rozsyła wiadomość lobby (JSON) do wszystkich podłączonych członków. */
  broadcastControl(msg: ControlMessage): void {
    for (const player of this.players.values()) player.member?.sendControl(msg);
  }

  broadcastRoomUpdate(): void {
    if (this.hostId === null) return;
    this.broadcastControl({
      t: 'roomUpdate',
      hostId: this.hostId,
      state: this.state,
      mode: this.mode, // faza 19b: poczekalnia wie, czy pokazać wybór samolotu (FFA)
      difficulty: this.difficulty, // poczekalnia: selektor poziomu botów po stronie hosta
      players: this.roomPlayers(),
    });
  }

  /**
   * Koduje i rozsyła snapshot do podłączonych członków (ack i flaga „własny" są per-gracz).
   * `scratch` to współdzielony bufor serwera — wysyłamy świeżą kopię (ws może buforować).
   * No-op poza 'playing'.
   */
  sendSnapshots(scratch: Uint8Array): void {
    if (this.state !== 'playing') return;
    const view = new DataView(scratch.buffer);
    const entities = this.snapshotSources;
    for (const player of this.players.values()) {
      if (!player.member) continue;
      const len = encodeSnapshot(view, this.tick, player.lastProcessedSeq, player.id, entities);
      player.member.sendSnapshotBytes(scratch.slice(0, len));
    }
    this.flushEvents();
  }

  /**
   * Rozsyła zdarzenia walki uzbierane od ostatniej wysyłki jako jedną ramkę EVENT
   * (binarnie, ten sam kanał co snapshot — klient rozróżnia po pierwszym bajcie). Paczka
   * jest BROADCASTOWA (jeden bufor dla wszystkich); klient filtruje po id. Czyści kolejkę.
   */
  private flushEvents(): void {
    const events = this.pendingEvents;
    if (events.length === 0) return;
    const need = eventsByteLength(events);
    if (this.eventScratch.byteLength < need) this.eventScratch = new Uint8Array(need);
    const len = encodeEvents(new DataView(this.eventScratch.buffer), events);
    for (const player of this.players.values()) {
      if (player.member) player.member.sendSnapshotBytes(this.eventScratch.slice(0, len));
    }
    events.length = 0;
  }

  /** Rozmiar bufora snapshotu potrzebny dla bieżącego składu. */
  get snapshotCapacityBytes(): number {
    return snapshotByteLength(this.players.size);
  }
}
