import { Vector3 } from 'three';
import {
  BULLET_POOL_CAPACITY,
  BulletPool,
  INTERP_DELAY_MS,
  Instructor,
  LAGCOMP_HISTORY_TICKS,
  LAGCOMP_MAX_REWIND_MS,
  MAX_EVENTS_PER_FRAME,
  MAX_PLAYERS_PER_ROOM,
  PHYSICS_HZ,
  PositionHistory,
  SPITFIRE_MK2,
  applyDamage,
  createFireControl,
  createHealth,
  createPilotDemands,
  createRng,
  createSimPlane,
  createTerrain,
  encodeEvents,
  encodeSnapshot,
  eventsByteLength,
  resetHealth,
  segmentSphereHit,
  snapshotByteLength,
  stepPilotedPlane,
  totalAmmo,
  updateFire,
  updateLifecycle,
  type ControlMessage,
  type FireControl,
  type GameEvent,
  type Health,
  type InputFrame,
  type PilotDemands,
  type PlaneConfig,
  type RoomPlayer,
  type RoomState,
  type RoomSummary,
  type SimPlane,
  type SnapshotEntitySource,
  type Terrain,
} from '@air-combat/shared';

// Autorytatywny pokój gry. Faza 8 wprowadziła symulację (niezmiennik nr 5: serwer jest
// autorytetem), faza 10 dokłada maszynę stanów lobby: waiting (poczekalnia, nikt nie lata)
// → playing (mecz, fizyka + snapshoty) → ended. Pokój zna swoich CZŁONKÓW (połączenia),
// żeby rozsyłać im wiadomości lobby (JSON) i snapshoty (binarnie). Faza 11 dokłada WALKĘ:
// pociski symulowane TU (balistyka z shared), hit detection z lag-compensation, HP/kill
// credit po stronie serwera (niezmiennik nr 5), eventy MUZZLE/HIT/KILL do klientów.

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
  /** Zestrzelenia wrogów (kredyt) i asysty w bieżącym meczu — pełna buchalteria w fazie 13. */
  kills: number;
  assists: number;
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

  // --- walka (faza 11): autorytatywne pociski + lag-comp + kolejka eventów ---
  /** Pociski autorytatywne (wszyscy gracze w pokoju dzielą pulę — kill credit po ownerId). */
  private readonly pool = new BulletPool(BULLET_POOL_CAPACITY);
  /** Historia pozycji do rewindu celów przy hit-detekcji. */
  private readonly history = new PositionHistory(LAGCOMP_HISTORY_TICKS, MAX_PLAYERS_PER_ROOM);
  /** Zdarzenia walki uzbierane w tej klatce, rozsyłane razem ze snapshotem (binarnie). */
  private pendingEvents: GameEvent[] = [];
  /** Bufor wyjściowy ramki EVENT (alokowany leniwie pod największą paczkę). */
  private eventScratch = new Uint8Array(0);

  constructor(
    readonly code: string,
    seed?: number,
    private readonly onError?: (msg: string) => void,
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
    };
    this.players.set(id, player);
    if (this.hostId === null) this.hostId = id;
    this.spawn(player);
    if (this.state === 'playing') {
      // late join: poczekaj RESPAWN_DELAY_S zanim samolot wejdzie do gry
      player.sim.state.life = 'dead';
      player.sim.state.lifeTimerS = 0;
    }
    this.rebuildSnapshotSources();
    return id;
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

  /** Host startuje mecz: waiting → playing, wszyscy gracze spawnują od nowa. */
  start(): void {
    if (this.state !== 'waiting') return;
    this.state = 'playing';
    // czysty stan walki na nowy mecz: żadnych zalegających pocisków ani eventów
    for (const b of this.pool.bullets) b.active = false;
    this.pendingEvents.length = 0;
    for (const player of this.players.values()) {
      player.kills = 0;
      player.assists = 0;
      this.spawn(player);
    }
    this.broadcastControl({ t: 'matchStarted' });
    this.broadcastRoomUpdate();
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

  /** Jeden krok fizyki świata (stały dt). No-op poza stanem 'playing'. */
  step(dtS: number): void {
    if (this.state !== 'playing') return;
    this.tick = (this.tick + 1) >>> 0;

    // 1) ruch wszystkich graczy (alive: fizyka+ogień-cykl-życia; dead: timer respawnu)
    for (const player of this.players.values()) {
      try {
        this.stepPlayer(player, dtS);
      } catch (err) {
        // Niezmiennik nr 7: NaN/Infinity wykryty i zrzucony (validatePlaneState),
        // ale spreparowany input jednego gracza NIE kładzie serwera dla pozostałych
        // (niezmiennik nr 11). Logujemy zrzut i respawnujemy winowajcę.
        this.onError?.(`pokój ${this.code} gracz ${String(player.id)}: ${err instanceof Error ? err.message : String(err)}`);
        this.spawn(player);
      }
    }

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
  }

  private stepPlayer(player: ServerPlayer, dtS: number): void {
    const state = player.sim.state;

    if (state.life === 'alive') {
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
      if (event === 'crashed') this.onGroundDeath(player);
    } else if (updateLifecycle(state, this.terrain, dtS) === 'respawnReady') {
      this.spawn(player);
    }
  }

  /** Krok kontroli ognia gracza: spust z inputu, rewind lag-comp, event MUZZLE przy salwie. */
  private fireWeapon(player: ServerPlayer, dtS: number): void {
    const state = player.sim.state;
    if (state.life !== 'alive') return;
    const triggerHeld = player.latestInput?.fire ?? false;
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
        if (ts.life !== 'alive' || target.id === b.ownerId) continue;
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

  /** Zestrzelenie w powietrzu: śmierć, event KILL, kredyt zabójcy i asysty. */
  private onAirKill(victim: ServerPlayer, killerId: number): void {
    victim.sim.state.life = 'dead';
    victim.sim.state.lifeTimerS = 0;
    this.queueEvent({ kind: 'kill', killerId, victimId: victim.id, cause: 'air' });
    const killer = this.players.get(killerId);
    if (killer && killer !== victim) killer.kills++;
    this.creditAssists(victim, killerId);
  }

  /** Rozbicie o teren: event KILL bez sprawcy + asysty dla wszystkich wcześniejszych napastników. */
  private onGroundDeath(victim: ServerPlayer): void {
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

  /** Ustawia gracza na jego slocie startowym i zeruje stan symulacji (spawn/respawn). */
  private spawn(player: ServerPlayer): void {
    const angle = (player.slot / SPAWN_RING_SLOTS) * Math.PI * 2;
    player.spawnPos.set(
      Math.cos(angle) * SPAWN_RING_RADIUS_M,
      SPAWN_ALTITUDE_M + player.slot * 60,
      Math.sin(angle) * SPAWN_RING_RADIUS_M,
    );
    // nos poziomo ku środkowi areny (strefa kontroli w centrum)
    player.spawnDir.set(-Math.cos(angle), 0, -Math.sin(angle)).normalize();

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
  }

  private rebuildSnapshotSources(): void {
    this.snapshotSources = [...this.players.values()].map((p) => ({
      id: p.id,
      state: p.sim.state,
      health: p.health,
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
