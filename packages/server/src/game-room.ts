import { Vector3 } from 'three';
import {
  Instructor,
  MAX_PLAYERS_PER_ROOM,
  SPITFIRE_MK2,
  createPilotDemands,
  createSimPlane,
  createTerrain,
  encodeSnapshot,
  snapshotByteLength,
  stepPilotedPlane,
  updateLifecycle,
  type ControlMessage,
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
// żeby rozsyłać im wiadomości lobby (JSON) i snapshoty (binarnie). CELOWO bez walki —
// broń/hit detection wracają w fazie 11, boty w fazie 12.

const SPAWN_ALTITUDE_M = 800;
const SPAWN_SPEED_MS = 120;
const SPAWN_THROTTLE = 0.8;
/** Promień pierścienia spawnów [m] (jak w kliencie: start na obrzeżach, nosem do środka). */
const SPAWN_RING_RADIUS_M = 8000;
/** Liczba slotów na pierścieniu = budżet snapshotu (do MAX_PLAYERS_PER_ROOM encji). */
const SPAWN_RING_SLOTS = MAX_PLAYERS_PER_ROOM;

const FORWARD_Z = new Vector3(0, 0, 1);

/**
 * Połączenie widziane przez pokój — tylko to, co potrzebne do rozsyłki. Interfejs
 * (zamiast importu Connection) przecina cykl zależności: connection.ts importuje GameRoom.
 */
export interface RoomMember {
  sendControl(msg: ControlMessage): void;
  sendSnapshotBytes(bytes: Uint8Array): void;
}

/** Stan gracza po stronie serwera: symulacja + filtr instruktora + ostatni input + tożsamość lobby. */
interface ServerPlayer {
  readonly id: number;
  readonly sim: SimPlane;
  readonly instructor: Instructor;
  readonly demands: PilotDemands;
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
      nick,
      sessionToken,
      member,
      disconnectedAtMs: null,
      latestInput: null,
      lastProcessedSeq: 0,
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
    for (const player of this.players.values()) this.spawn(player);
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
    if (player) player.latestInput = frame;
  }

  lastProcessedSeq(id: number): number {
    return this.players.get(id)?.lastProcessedSeq ?? 0;
  }

  /** Jeden krok fizyki świata (stały dt). No-op poza stanem 'playing'. */
  step(dtS: number): void {
    if (this.state !== 'playing') return;
    this.tick = (this.tick + 1) >>> 0;
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
  }

  private stepPlayer(player: ServerPlayer, dtS: number): void {
    const state = player.sim.state;

    if (state.life === 'alive') {
      const input = player.latestInput;
      if (input) player.lastProcessedSeq = input.sequence;
      // ta sama autorytatywna ścieżka co predykcja klienta (shared/world/piloted-plane).
      // brak walki w fazie 10: jedyna śmierć to rozbicie o ziemię → 'dead', potem respawn.
      stepPilotedPlane(
        player.sim,
        player.instructor,
        this.plane,
        player.demands,
        input,
        this.terrain,
        dtS,
        `serwer ${this.code}: gracz ${String(player.id)}`,
      );
    } else if (updateLifecycle(state, this.terrain, dtS) === 'respawnReady') {
      this.spawn(player);
    }
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
  }

  private rebuildSnapshotSources(): void {
    this.snapshotSources = [...this.players.values()].map((p) => ({ id: p.id, state: p.sim.state }));
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
  }

  /** Rozmiar bufora snapshotu potrzebny dla bieżącego składu. */
  get snapshotCapacityBytes(): number {
    return snapshotByteLength(this.players.size);
  }
}
