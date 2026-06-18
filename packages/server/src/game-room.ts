import { Vector3 } from 'three';
import {
  BULLET_POOL_CAPACITY,
  BulletPool,
  INTERP_DELAY_MS,
  Instructor,
  LAGCOMP_HISTORY_TICKS,
  LAGCOMP_MAX_REWIND_MS,
  MATCH_DEFAULT_SCORE_LIMIT,
  MATCH_RESULTS_LINGER_S,
  MATCH_TIME_LIMIT_S,
  MAX_EVENTS_PER_FRAME,
  MAX_PLAYERS_PER_ROOM,
  PHYSICS_HZ,
  PositionHistory,
  SPAWN_PROTECTION_S,
  SPITFIRE_MK2,
  applyDamage,
  chooseSpawnIndex,
  compareFfa,
  createFireControl,
  createHealth,
  createPilotDemands,
  createRng,
  createSimPlane,
  createTerrain,
  encodeEvents,
  encodeSnapshot,
  evaluateFfa,
  eventsByteLength,
  keyboardDemands,
  nearestToroidalImage,
  pilotStep,
  planesCollide,
  resetHealth,
  segmentSphereHit,
  snapshotByteLength,
  stepPilotedPlane,
  stepWreck,
  totalAmmo,
  updateFire,
  updateLifecycle,
  validatePlaneState,
  wrapToArena,
  type ControlMessage,
  type DifficultyLevel,
  type FfaScore,
  type FireControl,
  type GameEvent,
  type Health,
  type InputFrame,
  type MatchEndReason,
  type PilotDemands,
  type PlaneConfig,
  type PlaneState,
  type RoomPlayer,
  type RoomState,
  type RoomSummary,
  type SimPlane,
  type SnapshotEntitySource,
  type StandingRow,
  type Terrain,
} from '@air-combat/shared';
import { BOT_THINK_INTERVAL, BotManager } from './bot-manager';

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
/** Promień pierścienia spawnów [m] (jak w kliencie: start na obrzeżach, nosem do środka). */
const SPAWN_RING_RADIUS_M = 8000;
/** Liczba slotów na pierścieniu = budżet snapshotu (do MAX_PLAYERS_PER_ROOM encji). */
const SPAWN_RING_SLOTS = MAX_PLAYERS_PER_ROOM;

const FORWARD_Z = new Vector3(0, 0, 1);

/** Bufor interpolacji klienta w tickach — składnik rewindu lag-comp (faza 11). */
const INTERP_DELAY_TICKS = Math.round((INTERP_DELAY_MS / 1000) * PHYSICS_HZ);
/** Cap rewindu lag-comp w tickach (decyzja designerska z faza-11.md). */
const MAX_REWIND_TICKS = Math.round((LAGCOMP_MAX_REWIND_MS / 1000) * PHYSICS_HZ);

/** Sentinel „brak strzelca" w evencie KILL (śmierć od ziemi/kolizji). */
const NO_KILLER = 0;

const scratchHitCenter = new Vector3();
/** Bufor zawinięcia torusa dla kroku bota/wraku (caller `wrapToArena` go nie czyta). */
const scratchBotWrap = new Vector3();
/** Bufor wychyleń steru do sterowania spadającym wrakiem gracza (zero alokacji per tick). */
const scratchWreckDefl = { pitchUp: 0, rollRight: 0, yawRight: 0 };

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
}

/** Stan gracza po stronie serwera: symulacja + filtr instruktora + ostatni input + tożsamość lobby. */
interface ServerPlayer {
  readonly id: number;
  readonly sim: SimPlane;
  readonly instructor: Instructor;
  readonly demands: PilotDemands;
  /** HP — autorytet serwera (niezmiennik nr 5). Kodowane do snapshotu jako ułamek. */
  readonly health: Health;
  /** Kontrola ognia (kadencja + amunicja) liczona serwerowo — klient nie może jej oszukać. */
  readonly fire: FireControl;
  /** Strumień RNG rozrzutu (osobny per gracz). */
  readonly rng: () => number;
  /** Zestrzelenia wrogów (kredyt), asysty i śmierci w bieżącym meczu (tabela wyników, faza 13). */
  kills: number;
  assists: number;
  deaths: number;
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
  /** Najnowszy zdekodowany input (powtarzany, dopóki nie przyjdzie nowy). */
  latestInput: InputFrame | null;
  /** Numer ostatniego INPUT uwzględnionego w fizyce — odsyłany jako ack w snapshocie. */
  lastProcessedSeq: number;
  /** Najnowszy serverTick potwierdzony przez klienta (z INPUT.ackServerTick) — baza rewindu lag-comp. */
  lastAckServerTick: number;
  readonly spawnPos: Vector3;
  readonly spawnDir: Vector3;
  readonly slot: number;
  /** Pozycja na POCZĄTKU bieżącego ticku — początek zamiatanego odcinka kolizji (faza 15);
   *  po zawinięciu torusa korygowana do obrazu najbliższego pozycji końcowej. */
  readonly prevPos: Vector3;
  /** Bot serwerowy (faza 12): sterowany przez AI, member zawsze null. */
  readonly isBot: boolean;
}

export class GameRoom {
  readonly terrain: Terrain;
  readonly plane: PlaneConfig = SPITFIRE_MK2;
  state: RoomState = 'waiting';
  hostId: number | null = null;
  private readonly players = new Map<number, ServerPlayer>();
  private nextId = 0;
  private nextSlot = 0;
  /** Licznik ticków fizyki (u32 w protokole) — monotoniczny, znacznik snapshotu. */
  tick = 0;

  /** Bufor źródeł snapshotu — przebudowywany przy zmianie składu (zero alokacji per tick). */
  private snapshotSources: SnapshotEntitySource[] = [];

  // --- pętla meczu FFA (faza 13) ---
  /** Limit zestrzeleń kończący mecz (ustawiany przez hosta przy tworzeniu pokoju; klampowany). */
  scoreLimit = MATCH_DEFAULT_SCORE_LIMIT;
  /** Upływ czasu bieżącego meczu [s] — autorytatywny zegar (klient tylko wyświetla). */
  private matchClockS = 0;
  /** Czas spędzony w stanie 'ended' [s] — po MATCH_RESULTS_LINGER_S pokój wraca do 'waiting'. */
  private endedTimerS = 0;
  /** Wynik ostatniego meczu (ekran wyników / diagnostyka). */
  winnerId: number | null = null;
  lastEndReason: MatchEndReason | null = null;
  /** Pierścień slotów startowych (pozycja + nos ku środkowi) — kandydaci wyboru spawnu. */
  private readonly spawnRing: { pos: Vector3; dir: Vector3 }[] = buildSpawnRing();
  private readonly spawnRingPositions: Vector3[] = this.spawnRing.map((s) => s.pos);
  /** Scratch pozycji żywych wrogów do wyboru spawnu (zero alokacji per respawn). */
  private readonly occupantScratch: Vector3[] = [];
  /** Scratch tablicy wyników do oceny końca meczu (zero alokacji per tick). */
  private readonly ffaScratch: FfaScore[] = [];

  // --- walka (faza 11): autorytatywne pociski + lag-comp + kolejka eventów ---
  /** Pociski autorytatywne (wszyscy gracze w pokoju dzielą pulę — kill credit po ownerId). */
  private readonly pool = new BulletPool(BULLET_POOL_CAPACITY);
  /** Historia pozycji do rewindu celów przy hit-detekcji. */
  private readonly history = new PositionHistory(LAGCOMP_HISTORY_TICKS, MAX_PLAYERS_PER_ROOM);
  /** Zdarzenia walki uzbierane w tej klatce, rozsyłane razem ze snapshotem (binarnie). */
  private pendingEvents: GameEvent[] = [];
  /** Bufor wyjściowy ramki EVENT (alokowany leniwie pod największą paczkę). */
  private eventScratch = new Uint8Array(0);

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
    };
  }

  roomPlayers(): RoomPlayer[] {
    return [...this.players.values()].map((p) => ({ id: p.id, nick: p.nick }));
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
   */
  addBot(difficulty: DifficultyLevel): number {
    const player = this.createPlayer(this.botManager.nextName(), '', null, true);
    // strumień RNG bota osobny od strumienia rozrzutu ognia (inna stała mieszająca)
    this.botManager.add(player.id, difficulty, (player.id + 1) ^ 0x0b07);
    this.enterWorld(player); // spawn() zresetuje też kontroler AI (isBot)
    return player.id;
  }

  /** Tworzy encję (gracz lub bot) i wpisuje do mapy; nie spawnuje ani nie ustawia hosta. */
  private createPlayer(
    nick: string,
    sessionToken: string,
    member: RoomMember | null,
    isBot: boolean,
  ): ServerPlayer {
    const id = this.nextId++;
    const slot = this.nextSlot++ % SPAWN_RING_SLOTS;
    const player: ServerPlayer = {
      id,
      sim: createSimPlane(id + 1),
      instructor: new Instructor(),
      demands: createPilotDemands(),
      health: createHealth(this.plane.hpPool),
      fire: createFireControl(this.plane.armament),
      rng: createRng((id + 1) ^ 0x9e37),
      kills: 0,
      assists: 0,
      deaths: 0,
      protectionTimerS: 0,
      pingMs: 0,
      damagedBy: new Set<number>(),
      nick,
      sessionToken,
      member,
      disconnectedAtMs: null,
      latestInput: null,
      lastProcessedSeq: 0,
      lastAckServerTick: 0,
      spawnPos: new Vector3(),
      spawnDir: new Vector3(),
      slot,
      prevPos: new Vector3(),
      isBot,
    };
    this.players.set(id, player);
    return player;
  }

  /** Spawnuje świeżą encję; w trakcie meczu wchodzi jako late join (dead → spawn po RESPAWN_DELAY_S). */
  private enterWorld(player: ServerPlayer): void {
    this.spawn(player);
    if (this.state === 'playing') {
      player.sim.state.life = 'dead';
      player.sim.state.lifeTimerS = 0;
    }
    this.rebuildSnapshotSources();
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
    this.matchClockS = 0;
    this.endedTimerS = 0;
    this.winnerId = null;
    this.lastEndReason = null;
    // czysty stan walki na nowy mecz: żadnych zalegających pocisków ani eventów
    for (const b of this.pool.bullets) b.active = false;
    this.pendingEvents.length = 0;
    for (const player of this.players.values()) {
      player.kills = 0;
      player.assists = 0;
      player.deaths = 0;
      this.spawn(player);
    }
    this.broadcastControl({ t: 'matchStarted' });
    this.broadcastRoomUpdate();
    this.onInfo?.(`pokój ${this.code}: start meczu (do ${String(this.scoreLimit)} zestrzeleń, ${String(this.players.size)} uczestników)`);
  }

  /** Odłącza połączenie gracza, trzymając slot na reconnect (okno RECONNECT_WINDOW_MS). */
  detachMember(id: number, nowMs: number): void {
    const player = this.players.get(id);
    if (!player) return;
    player.member = null;
    player.disconnectedAtMs = nowMs;
    if (this.hostId === id) this.reassignHost();
    this.broadcastRoomUpdate();
  }

  /** Próbuje wznowić sesję po tokenie: ponownie podpina połączenie do istniejącego gracza. */
  reconnectByToken(token: string, member: RoomMember): ServerPlayer | null {
    for (const player of this.players.values()) {
      if (player.sessionToken === token && player.member === null) {
        player.member = member;
        player.disconnectedAtMs = null;
        if (this.hostId === null) this.hostId = player.id;
        this.broadcastRoomUpdate();
        return player;
      }
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

  /** Zapamiętuje najnowszy input (już zwalidowany przez warstwę połączenia). */
  applyInput(id: number, frame: InputFrame): void {
    const player = this.players.get(id);
    if (player) {
      player.latestInput = frame;
      player.lastAckServerTick = frame.ackServerTick >>> 0;
    }
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

    // 2) historia pozycji TEGO ticku (tylko żywi mogą oberwać) — baza rewindu lag-comp
    this.history.beginTick(this.tick);
    for (const player of this.players.values()) {
      if (player.sim.state.life === 'alive') this.history.record(player.id, player.sim.state.position);
    }

    // 3) ogień autorytatywny (kadencja + amunicja serwerowo) → pociski na puli + event MUZZLE
    for (const player of this.players.values()) this.fireWeapon(player, dtS);

    // 4) ruch pocisków + 5) hit detection z cofnięciem celów (lag compensation)
    const arm = this.plane.armament;
    this.pool.update(arm.bulletDragK, arm.bulletLifetimeS, dtS);
    this.resolveHits();

    // 6) zegar meczu + rozstrzygnięcie (po rozliczeniu trafień tego ticku) — faza 13
    this.matchClockS += dtS;
    this.checkMatchEnd();
  }

  private stepPlayer(player: ServerPlayer, dtS: number): void {
    const state = player.sim.state;
    player.prevPos.copy(state.position); // początek zamiatanego odcinka kolizji (faza 15)

    if (state.life === 'alive') {
      if (player.protectionTimerS > 0) player.protectionTimerS = Math.max(0, player.protectionTimerS - dtS);
      const input = player.latestInput;
      if (input) player.lastProcessedSeq = input.sequence;
      // ta sama autorytatywna ścieżka co predykcja klienta (shared/world/piloted-plane).
      const event = stepPilotedPlane(
        player.sim,
        player.instructor,
        this.plane,
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
      // klawiaturą (faza 16 doda predykcję wraku po stronie klienta — ta sama ścieżka co tu).
      this.stepWreckEntity(player, dtS);
      this.fixWrapPrev(player);
      // wrak dotknął ziemi → 'dead' i start odliczania respawnu (buchalteria była przy zestrzeleniu)
      updateLifecycle(state, this.terrain, dtS);
    } else if (updateLifecycle(state, this.terrain, dtS) === 'respawnReady') {
      this.spawn(player, true);
    }
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
   * Jeden tick SPADAJĄCEGO WRAKU (life 'dying'): silnik martwy + ster ograniczony (stepWreck).
   * Gracz steruje wrakiem wychyleniami z inputu (jak klawiatura, bez instruktora/myszy); bot-wrak
   * leci neutralnie (czysty opad — jak w SP). Ack sekwencji także tu, żeby reconciliation wraku
   * po stronie klienta (faza 16) miała punkt odniesienia. Po kroku caller koryguje prevPos i cykl życia.
   */
  private stepWreckEntity(player: ServerPlayer, dtS: number): void {
    const state = player.sim.state;
    const input = player.isBot ? null : player.latestInput;
    if (input) {
      player.lastProcessedSeq = input.sequence;
      scratchWreckDefl.pitchUp = input.pitchUp;
      scratchWreckDefl.rollRight = input.rollRight;
      scratchWreckDefl.yawRight = input.yawRight;
      keyboardDemands(state, this.plane, scratchWreckDefl, player.demands);
    } else {
      player.demands.nDemandG = 1;
      player.demands.rollRateRadS = 0;
      player.demands.yawRateRadS = 0;
    }
    stepWreck(player.sim, this.plane, player.demands, dtS);
    wrapToArena(state.position, scratchBotWrap);
    validatePlaneState(state, `serwer ${this.code}: wrak ${String(player.id)}`);
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
          this.plane,
          this.collectBotTargets(player),
          this.terrain,
          player.demands,
          dtS * BOT_THINK_INTERVAL,
        );
      }
      state.throttle = this.botManager.controlOf(player.id).throttle;
      pilotStep(player.sim, this.plane, player.demands, dtS);
      wrapToArena(state.position, scratchBotWrap);
      validatePlaneState(state, `serwer ${this.code}: bot ${String(player.id)}`);
      this.fixWrapPrev(player);
      if (updateLifecycle(state, this.terrain, dtS) === 'crashed') this.onGroundDeath(player);
    } else if (state.life === 'dying') {
      this.stepWreckEntity(player, dtS); // wrak bota: neutralny opad balistyczny (bez AI)
      this.fixWrapPrev(player);
      updateLifecycle(state, this.terrain, dtS); // wreckImpact → 'dead' → odliczanie respawnu
    } else if (updateLifecycle(state, this.terrain, dtS) === 'respawnReady') {
      this.spawn(player, true);
    }
  }

  /** Żywe stany INNYCH uczestników jako kandydaci na cel bota (FFA: każdy poza nim samym). */
  private collectBotTargets(self: ServerPlayer): readonly PlaneState[] {
    this.botTargetScratch.length = 0;
    for (const p of this.players.values()) {
      if (p === self || p.sim.state.life !== 'alive') continue;
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
    const triggerHeld = player.isBot ? this.botManager.fireOf(player.id) : (player.latestInput?.fire ?? false);
    // otwarcie ognia oddaje ochronę respawnu (nietykalny nie może też zadawać — faza 13)
    if (triggerHeld && player.protectionTimerS > 0) player.protectionTimerS = 0;
    const rewindTicks = this.computeRewindTicks(player);
    // state spełnia FiringPlatform (position/velocity/orientation); pociski lecą z TERAŹNIEJSZEJ
    // pozycji strzelca (nie cofamy strzelca — pułapka faza-11.md), cele cofamy w resolveHits.
    const fired = updateFire(
      player.fire,
      this.plane.armament,
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
   * Hit detection: każdy aktywny pocisk vs każdy żywy cel (poza właścicielem). Cel jest
   * cofany do ticku, który strzelec widział (b.rewindTicks); brak danych w oknie → pozycja
   * bieżąca (fallback). HP, kredyt i eventy — wyłącznie tu (niezmiennik nr 5). Friendly fire
   * ON (FFA; drużyny w fazie 13). Pocisk trafia najwyżej jeden cel.
   */
  private resolveHits(): void {
    const hitRadius = this.plane.hitRadiusM;
    for (const b of this.pool.bullets) {
      if (!b.active) continue;
      for (const target of this.players.values()) {
        const ts = target.sim.state;
        // cel pod ochroną respawnu jest nietykalny (faza 13) — pocisk go ignoruje
        if (ts.life !== 'alive' || target.id === b.ownerId || target.protectionTimerS > 0) continue;
        const targetTick = (this.tick - b.rewindTicks) >>> 0;
        const center = this.history.sample(target.id, targetTick, scratchHitCenter)
          ? scratchHitCenter
          : ts.position;
        if (!segmentSphereHit(b.prevPosition, b.position, center, hitRadius)) continue;
        b.active = false;
        target.damagedBy.add(b.ownerId);
        if (applyDamage(target.health, b.damage) === 'destroyed') {
          this.onAirKill(target, b.ownerId);
        } else {
          this.queueEvent({ kind: 'hit', shooterId: b.ownerId, victimId: target.id });
        }
        break; // jeden pocisk = najwyżej jedno trafienie
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
    if (killer && killer !== victim) killer.kills++;
    this.creditAssists(victim, killerId);
  }

  /** Przejście ofiary w spadający wrak (zestrzelenie/kolizja): life 'dying' + zliczenie śmierci. */
  private enterWreck(victim: ServerPlayer): void {
    victim.sim.state.life = 'dying';
    victim.sim.state.lifeTimerS = 0; // licznik spadania (UI/diagnostyka); reset też przy uderzeniu
    victim.deaths++;
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
    const r = this.plane.collisionRadiusM;
    for (let i = 0; i < live.length; i++) {
      const a = live[i]!;
      if (a.sim.state.life !== 'alive') continue; // a zginął w tej klatce (wcześniejsza para)
      for (let j = i + 1; j < live.length; j++) {
        const b = live[j]!;
        if (b.sim.state.life !== 'alive') continue;
        if (!planesCollide(a.prevPos, a.sim.state.position, r, b.prevPos, b.sim.state.position, r)) continue;
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

  /** Rozbicie o teren: śmierć, event KILL bez sprawcy + asysty dla wcześniejszych napastników. */
  private onGroundDeath(victim: ServerPlayer): void {
    victim.deaths++;
    this.queueEvent({ kind: 'kill', killerId: NO_KILLER, victimId: victim.id, cause: 'ground' });
    this.creditAssists(victim, null);
  }

  /** Asysta dla każdego, kto wcześniej trafił ofiarę — poza zabójcą (ma już zestrzelenie). */
  private creditAssists(victim: ServerPlayer, killerId: number | null): void {
    for (const attackerId of victim.damagedBy) {
      if (attackerId === killerId) continue;
      const attacker = this.players.get(attackerId);
      if (attacker && attacker !== victim) attacker.assists++;
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
    state.iasMs = SPAWN_SPEED_MS;
    state.loadFactor = 1;
    state.stalled = false;
    state.life = 'alive';
    state.lifeTimerS = 0;
    player.instructor.reset();
    player.sim.gLoadMachine.reset();
    player.sim.gLoadEffects.reserve = 1;
    player.sim.gLoadEffects.blackoutFactor = 0;
    player.demands.nDemandG = 1;
    player.demands.rollRateRadS = 0;
    player.demands.yawRateRadS = 0;

    // nowe życie: pełne HP, pełna amunicja, czysta lista napastników (kredyt asyst)
    resetHealth(player.health, this.plane.hpPool);
    player.fire.cooldownS = 0;
    player.fire.ammoRemaining = totalAmmo(this.plane.armament);
    player.fire.shotCounter = 0;
    player.damagedBy.clear();
    // nietykalność po (re)spawnie (anty-spawn-kill); znika po czasie albo gdy gracz strzeli
    player.protectionTimerS = SPAWN_PROTECTION_S;

    // bot: zeruj filtry kontrolera i celownik na nowy nos (nie myśli starym stanem po respawnie)
    if (player.isBot) this.botManager.reset(player.id, state);
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

  /** Pozostały czas meczu [s] — autorytatywny zegar; klient tylko wyświetla (faza 13). */
  get timeLeftS(): number {
    return Math.max(0, MATCH_TIME_LIMIT_S - this.matchClockS);
  }

  /** Liczba śmierci gracza w meczu — diagnostyka/testy. */
  deathsOf(id: number): number {
    return this.players.get(id)?.deaths ?? 0;
  }

  /**
   * Rozstrzyga koniec meczu po stanie wyniku i zegarze (shared/world/ffa). Boty są pełnymi
   * uczestnikami (mogą wygrać — protokołowo nieodróżnialne, faza 12). Wołane co tick po
   * rozliczeniu trafień; pierwszy spełniony warunek (limit zestrzeleń / czasu) kończy mecz.
   */
  private checkMatchEnd(): void {
    this.ffaScratch.length = 0;
    for (const p of this.players.values()) {
      this.ffaScratch.push({ id: p.id, kills: p.kills, deaths: p.deaths });
    }
    const result = evaluateFfa(this.ffaScratch, this.matchClockS, this.scoreLimit, MATCH_TIME_LIMIT_S);
    if (result.ended && result.reason) this.endMatch(result.winnerId, result.reason);
  }

  /** Kończy mecz: playing → ended, gasi walkę, rozsyła finalną tabelę i loguje wynik. */
  private endMatch(winnerId: number | null, reason: MatchEndReason): void {
    this.state = 'ended';
    this.endedTimerS = 0;
    this.winnerId = winnerId;
    this.lastEndReason = reason;
    for (const b of this.pool.bullets) b.active = false;
    this.pendingEvents.length = 0;
    const rows = this.buildStandings();
    this.broadcastControl({ t: 'matchEnded', winnerId, reason, rows });
    this.broadcastRoomUpdate();
    const winnerNick = winnerId !== null ? (this.players.get(winnerId)?.nick ?? `#${String(winnerId)}`) : 'brak';
    this.onInfo?.(
      `pokój ${this.code}: koniec meczu (${reason}), zwycięzca ${winnerNick}; ` +
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
      kills: p.kills,
      deaths: p.deaths,
      assists: p.assists,
      pingMs: p.pingMs,
      isBot: p.isBot,
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
      rows: this.buildStandings(),
      scoreLimit: this.scoreLimit,
      timeLeftS: Math.round(this.timeLeftS),
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
    const ammoMax = totalAmmo(this.plane.armament);
    this.snapshotSources = [...this.players.values()].map((p) => ({
      id: p.id,
      state: p.sim.state,
      health: p.health,
      // żywe referencje (state/health/fire) — pole `ammoRemaining` mutuje się co tick,
      // więc snapshot zawsze koduje aktualny stan bez przebudowy źródeł
      fire: p.fire,
      ammoMax,
    }));
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
