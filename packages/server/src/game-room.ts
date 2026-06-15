import { Vector3 } from 'three';
import {
  Instructor,
  SPITFIRE_MK2,
  createPilotDemands,
  createSimPlane,
  createTerrain,
  keyboardDemands,
  pilotStep,
  updateLifecycle,
  validatePlaneState,
  wrapToArena,
  type InputFrame,
  type PilotDemands,
  type PlaneConfig,
  type SimPlane,
  type SnapshotEntitySource,
  type Terrain,
} from '@air-combat/shared';

// Autorytatywny pokój gry (faza 8, niezmiennik nr 5: serwer jest autorytetem).
// Symuluje świat TĄ SAMĄ fizyką z `shared` co klient — `pilotStep` + cykl życia.
// CELOWO bez walki: broń online wraca w fazie 11, hit detection w fazie 11,
// boty na serwerze w fazie 12. Tu lata tylko jeden (lub kilku) graczy „przez serwer".

const SPAWN_ALTITUDE_M = 800;
const SPAWN_SPEED_MS = 120;
const SPAWN_THROTTLE = 0.8;
/** Promień pierścienia spawnów [m] (jak w kliencie: start na obrzeżach, nosem do środka). */
const SPAWN_RING_RADIUS_M = 8000;
/** Liczba slotów na pierścieniu = budżet snapshotu (faza 8: do 8 encji). */
const SPAWN_RING_SLOTS = 8;

const FORWARD_Z = new Vector3(0, 0, 1);

/** Stan gracza po stronie serwera: symulacja + filtr instruktora + ostatni input. */
interface ServerPlayer {
  readonly id: number;
  readonly sim: SimPlane;
  readonly instructor: Instructor;
  readonly demands: PilotDemands;
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
  private readonly players = new Map<number, ServerPlayer>();
  private nextId = 0;
  private nextSlot = 0;
  /** Licznik ticków fizyki (u32 w protokole) — monotoniczny, znacznik snapshotu. */
  tick = 0;

  private readonly scratchWrap = new Vector3();
  private readonly scratchAim = new Vector3();
  /** Bufor źródeł snapshotu — przebudowywany przy zmianie składu (zero alokacji per tick). */
  private snapshotSources: SnapshotEntitySource[] = [];

  constructor(
    seed?: number,
    private readonly onError?: (msg: string) => void,
  ) {
    this.terrain = createTerrain(seed);
  }

  get playerCount(): number {
    return this.players.size;
  }

  /** Dołącza nowego gracza, przydziela id i slot startowy, ustawia na spawnie. */
  addPlayer(): number {
    const id = this.nextId++;
    const slot = this.nextSlot++ % SPAWN_RING_SLOTS;
    const player: ServerPlayer = {
      id,
      sim: createSimPlane(id + 1),
      instructor: new Instructor(),
      demands: createPilotDemands(),
      latestInput: null,
      lastProcessedSeq: 0,
      spawnPos: new Vector3(),
      spawnDir: new Vector3(),
      slot,
    };
    this.players.set(id, player);
    this.spawn(player);
    this.rebuildSnapshotSources();
    return id;
  }

  removePlayer(id: number): void {
    if (this.players.delete(id)) this.rebuildSnapshotSources();
  }

  /** Zapamiętuje najnowszy input (już zwalidowany przez warstwę połączenia). */
  applyInput(id: number, frame: InputFrame): void {
    const player = this.players.get(id);
    if (player) player.latestInput = frame;
  }

  lastProcessedSeq(id: number): number {
    return this.players.get(id)?.lastProcessedSeq ?? 0;
  }

  /** Jeden krok fizyki świata (stały dt). Wołane przez pętlę 60 Hz w server.ts. */
  step(dtS: number): void {
    this.tick = (this.tick + 1) >>> 0;
    for (const player of this.players.values()) {
      try {
        this.stepPlayer(player, dtS);
      } catch (err) {
        // Niezmiennik nr 7: NaN/Infinity wykryty i zrzucony (validatePlaneState),
        // ale spreparowany input jednego gracza NIE kładzie serwera dla pozostałych
        // (niezmiennik nr 11). Logujemy zrzut i respawnujemy winowajcę.
        this.onError?.(`gracz ${String(player.id)}: ${err instanceof Error ? err.message : String(err)}`);
        this.spawn(player);
      }
    }
  }

  private stepPlayer(player: ServerPlayer, dtS: number): void {
    const { sim, demands } = player;
    const state = sim.state;

    if (state.life === 'alive') {
      const input = player.latestInput;
      if (input) {
        player.lastProcessedSeq = input.sequence;
        state.throttle = input.throttle;
        const hasKeyboard = input.pitchUp !== 0 || input.rollRight !== 0 || input.yawRight !== 0;
        if (hasKeyboard) {
          // niezerowe wychylenia omijają instruktora (bezpośrednie żądania przez kopertę);
          // instruktor zresetowany, by po powrocie myszy nie strzelił starym stanem filtra
          player.instructor.reset();
          keyboardDemands(
            state,
            this.plane,
            { pitchUp: input.pitchUp, rollRight: input.rollRight, yawRight: input.yawRight },
            demands,
          );
        } else {
          // mysz: instruktor prowadzi nos na kierunek celu (jednostkowy w świecie)
          this.scratchAim.set(input.aimX, input.aimY, input.aimZ).normalize();
          player.instructor.update(state, this.plane, this.scratchAim, dtS, demands);
        }
      } else {
        // brak inputu (chwila po spawnie): trzymaj lot prosto, neutralne żądania
        player.instructor.reset();
        demands.nDemandG = 1;
        demands.rollRateRadS = 0;
        demands.yawRateRadS = 0;
      }

      pilotStep(sim, this.plane, demands, dtS);
      wrapToArena(state.position, this.scratchWrap);
      validatePlaneState(state, `serwer: gracz ${String(player.id)}`);
      // brak walki w fazie 8: jedyna śmierć to rozbicie o ziemię → 'dead', potem respawn
      updateLifecycle(state, this.terrain, dtS);
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
}
