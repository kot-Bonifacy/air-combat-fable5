import { Quaternion, Vector3 } from 'three';
import {
  FIXED_DT_S,
  Instructor,
  RECONCILE_SMOOTH_TAU_S,
  RECONCILE_SNAP_DIST_M,
  airDensityKgM3,
  createPilotDemands,
  createSimPlane,
  nearestToroidalImage,
  stepPilotedPlane,
  stepWreckPiloted,
  tasToIasMs,
  toroidalDistanceSqM,
  type EntitySnapshot,
  type PilotCommand,
  type PilotDemands,
  type PlaneConfig,
  type SimPlane,
  type Terrain,
} from '@air-combat/shared';

// Predykcja własnego samolotu + reconciliation (faza-09.md kroki 2). Input działa
// NATYCHMIAST na lokalnej fizyce (ta sama stepPilotedPlane co serwer); każdy
// zastosowany input ląduje w buforze. Snapshot serwera niesie ack → przyjmujemy stan
// autorytetu dla SWOJEJ encji i odtwarzamy inputy nowsze niż ack. Bo silniki JS nie są
// bitowo identyczne, korekta poniżej progu snap jest WYGŁADZANA zanikającym offsetem
// renderu (fizyka zostaje autorytatywna, „dogania" ją tylko obraz) — inaczej mikro-dryf
// = wieczne drganie. Duży błąd (respawn, seria strat) = twardy snap.

interface PendingInput {
  sequence: number;
  command: PilotCommand;
}

export interface ReconcileMetrics {
  /** Liczba zliczonych korekt (oba stany żywe, poza pierwszym/spawnem). */
  count: number;
  /** Ostatnia korekta [m]. */
  lastM: number;
  /** Średnia korekt [m]. */
  avgM: number;
  /** Maksymalna korekta [m] od startu. */
  maxM: number;
  /** Udział korekt < próg snap [0..1] — kryterium fazy 9 (cel ≥ 0,99). */
  belowSnapFraction: number;
}

const IDENTITY_Q = new Quaternion();

export class Predictor {
  /** Autorytatywny (lokalnie predykowany) stan — fizyka, nie render. */
  readonly sim: SimPlane = createSimPlane(1);
  /** Wygładzona pozycja do renderu = sim.position ⊕ zanikający offset. */
  readonly renderPosition = new Vector3();
  /** Wygładzona orientacja do renderu = offset ⊗ sim.orientation. */
  readonly renderOrientation = new Quaternion();

  private readonly instructor = new Instructor();
  private readonly demands: PilotDemands = createPilotDemands();
  private readonly pending: PendingInput[] = [];

  // offset wygładzania: render = autorytet + (posError, quatError), oba zanikają do zera
  private readonly posError = new Vector3();
  private readonly quatError = new Quaternion();

  // scratch (jedna instancja predyktora, sekwencyjnie)
  private readonly renderedPos = new Vector3();
  private readonly renderedQuat = new Quaternion();
  private readonly oldPos = new Vector3();
  private readonly tmpQ = new Quaternion();

  private hasServer = false;
  private corrCount = 0;
  private corrSum = 0;
  private corrMax = 0;
  private corrBelow = 0;
  readonly metrics: ReconcileMetrics = {
    count: 0,
    lastM: 0,
    avgM: 0,
    maxM: 0,
    belowSnapFraction: 1,
  };

  constructor(
    private readonly plane: PlaneConfig,
    private readonly terrain: Terrain,
  ) {}

  /** Czy mamy już pierwszy autorytatywny stan z serwera (zanim — nie predykujemy). */
  get ready(): boolean {
    return this.hasServer;
  }

  get alive(): boolean {
    return this.sim.state.life === 'alive';
  }

  /**
   * Tick predykcji: zastosuj komendę lokalnie (ta sama ścieżka co serwer) i dopisz
   * do bufora replay. Żywy samolot → stepPilotedPlane; spadający wrak gracza ('dying',
   * faza 16) → stepWreckPiloted (sterowanie wprost wychyleniami, bez instruktora/myszy —
   * jak na serwerze). No-op zanim przyjdzie pierwszy snapshot oraz gdy martwy/respawn
   * (autorytatywne — czekamy na serwer).
   */
  predict(command: PilotCommand, sequence: number): void {
    if (!this.hasServer) return;
    const life = this.sim.state.life;
    if (life === 'alive') {
      stepPilotedPlane(
        this.sim,
        this.instructor,
        this.plane,
        this.demands,
        command,
        this.terrain,
        FIXED_DT_S,
        'predykcja',
      );
    } else if (life === 'dying') {
      stepWreckPiloted(this.sim, this.plane, this.demands, command, this.terrain, FIXED_DT_S, 'predykcja-wrak');
    } else {
      return; // dead/respawning: stan autorytatywny serwera, brak predykcji
    }
    this.pending.push({ sequence, command: { ...command } });
  }

  /**
   * Reconciliation po snapshocie autorytetu dla LOKALNEJ encji. Przyjmuje stan
   * serwera dla widocznych pól (ukryty stan maszyn zostaje — tolerowany mikro-dryf),
   * odtwarza inputy nowsze niż `ackSeq` i ustawia offset wygładzania renderu.
   */
  reconcile(server: EntitySnapshot, ackSeq: number): void {
    // odrzuć potwierdzone inputy (≤ ack) — reszta to bufor do replay
    while (this.pending.length > 0) {
      const head = this.pending[0];
      if (head === undefined || head.sequence > ackSeq) break;
      this.pending.shift();
    }

    const state = this.sim.state;
    const firstState = !this.hasServer;
    // faza życia PRZED przyjęciem autorytetu (decyduje, czy predykcja ma ciągłość)
    const wasAlive = this.hasServer && state.life === 'alive';
    const wasDying = this.hasServer && state.life === 'dying';
    const serverAlive = server.life === 'alive';
    const serverDying = server.life === 'dying';
    // ciągłość predykcji = ta sama faza po obu stronach (żywy→żywy / wrak→wrak): wtedy
    // odtwarzamy bufor inputów tą samą ścieżką. Każda zmiana fazy (spawn, zestrzelenie
    // alive→dying, uderzenie wraku dying→dead, respawn) = brak ciągłości → snap + reset.
    const continuesAlive = serverAlive && wasAlive;
    const continuesDying = serverDying && wasDying;
    const continues = continuesAlive || continuesDying;

    // zapamiętaj bieżący RENDER (autorytet ⊕ offset) — utrzymamy ciągłość obrazu
    this.renderedPos.copy(state.position).add(this.posError);
    this.renderedQuat.copy(this.quatError).multiply(state.orientation);
    this.oldPos.copy(state.position);

    // przyjmij autorytet dla pól widocznych (ukryty stan maszyn zostaje)
    state.position.copy(server.position);
    state.orientation.copy(server.orientation);
    state.velocity.copy(server.velocity);
    state.throttle = server.throttle;
    state.life = server.life;
    state.stalled = server.stalled;
    // iasMs nie jest w snapshocie — odtwórz z prędkości i wysokości (zgodnie z serwerem),
    // bo koperta (maxRollRate) czyta state.iasMs już w PIERWSZYM kroku replay
    state.iasMs = tasToIasMs(server.velocity.length(), airDensityKgM3(server.position.y));

    if (!continues) {
      // zmiana fazy życia (spawn/zestrzelenie/uderzenie wraku/respawn): brak ciągłości
      // predykcji — czyść bufor i odśwież maszyny (mirror serwerowego spawn: instruktor
      // + tolerancja G; stall machine self-corrects)
      this.pending.length = 0;
      this.instructor.reset();
      this.sim.gLoadMachine.reset();
      this.sim.gLoadEffects.reserve = 1;
      this.sim.gLoadEffects.blackoutFactor = 0;
    }

    // replay inputów nowszych niż ack TĄ SAMĄ ścieżką co predict: żywy → stepPilotedPlane,
    // wrak → stepWreckPiloted. Przerwij, gdy przewidziana zmiana fazy w trakcie replay.
    if (continuesAlive) {
      for (const p of this.pending) {
        stepPilotedPlane(
          this.sim,
          this.instructor,
          this.plane,
          this.demands,
          p.command,
          this.terrain,
          FIXED_DT_S,
          'predykcja-replay',
        );
        if (state.life !== 'alive') break; // przewidziana kolizja/zestrzelenie w trakcie replay
      }
    } else if (continuesDying) {
      for (const p of this.pending) {
        stepWreckPiloted(this.sim, this.plane, this.demands, p.command, this.terrain, FIXED_DT_S, 'predykcja-replay-wrak');
        if (state.life !== 'dying') break; // wrak uderzył w ziemię w trakcie replay
      }
    }

    this.hasServer = true;

    // korekta = rozjazd predykcji: stary predykowany-najnowszy vs nowy (po acku + replay).
    // Mierzalna i wygładzana przy ciągłości fazy (żywy lub wrak); metryki Fazy 9 liczymy
    // tylko dla LOTU (żywy), żeby wrak nie zaniżał udziału korekt < próg.
    const measurable = !firstState && continues;
    const correctionM = measurable ? Math.sqrt(toroidalDistanceSqM(this.oldPos, state.position)) : 0;
    const snap = !measurable || correctionM >= RECONCILE_SNAP_DIST_M;

    if (snap) {
      this.posError.set(0, 0, 0);
      this.quatError.identity();
    } else {
      // zachowaj ciągłość: offset = renderowane − nowy autorytet (toroidalnie najkrótszy)
      const target = nearestToroidalImage(this.renderedPos, state.position, this.renderedPos);
      this.posError.copy(target).sub(state.position);
      this.quatError.copy(this.renderedQuat).multiply(this.tmpQ.copy(state.orientation).invert());
    }

    if (continuesAlive) this.recordCorrection(correctionM); // metryki Fazy 9 = lot żywego samolotu
  }

  /** Aktualizacja renderu (każda klatka): offset zanika wykładniczo do zera. */
  updateRender(frameDtS: number): void {
    const decay = Math.exp(-frameDtS / RECONCILE_SMOOTH_TAU_S);
    this.posError.multiplyScalar(decay);
    this.quatError.slerp(IDENTITY_Q, 1 - decay);
    this.renderPosition.copy(this.sim.state.position).add(this.posError);
    this.renderOrientation.copy(this.quatError).multiply(this.sim.state.orientation);
  }

  private recordCorrection(correctionM: number): void {
    this.corrCount++;
    this.corrSum += correctionM;
    if (correctionM > this.corrMax) this.corrMax = correctionM;
    if (correctionM < RECONCILE_SNAP_DIST_M) this.corrBelow++;
    this.metrics.count = this.corrCount;
    this.metrics.lastM = correctionM;
    this.metrics.avgM = this.corrSum / this.corrCount;
    this.metrics.maxM = this.corrMax;
    this.metrics.belowSnapFraction = this.corrBelow / this.corrCount;
  }
}
