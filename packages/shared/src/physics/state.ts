import { Quaternion, Vector3 } from 'three';

/**
 * Kinematyczne prędkości kątowe w body frame [rad/s].
 * Konwencja znaków (z perspektywy pilota): pitch > 0 = nos w górę,
 * roll > 0 = przechylenie w prawo, yaw > 0 = nos w prawo.
 */
export interface AngularRates {
  pitch: number;
  roll: number;
  yaw: number;
}

/** Cykl życia (faza 4): respawning = czeka, aż autorytet ustawi spawn i 'alive'. */
export type LifePhase = 'alive' | 'dead' | 'respawning';

/** Stan symulowanego obiektu (w fazie 1: sześcian testowy; od fazy 2: samolot). */
export interface PlaneState {
  /** Pozycja w układzie świata [m]. */
  position: Vector3;
  /** Prędkość w układzie świata [m/s]. */
  velocity: Vector3;
  /** Orientacja body→world. */
  orientation: Quaternion;
  angularRates: AngularRates;
  /** Przepustnica 0..1. */
  throttle: number;
  /** Prędkość wskazywana [m/s] (pochodna, liczona od fazy 2). */
  iasMs: number;
  /** Bieżące przeciążenie [G] (pochodne, liczone od fazy 2). */
  loadFactor: number;
  stalled: boolean;
  life: LifePhase;
  /** Czas w stanie 'dead' [s] — odlicza do respawnu. */
  lifeTimerS: number;
}

export function createPlaneState(): PlaneState {
  return {
    position: new Vector3(),
    velocity: new Vector3(),
    orientation: new Quaternion(),
    angularRates: { pitch: 0, roll: 0, yaw: 0 },
    throttle: 0,
    iasMs: 0,
    loadFactor: 1,
    stalled: false,
    life: 'alive',
    lifeTimerS: 0,
  };
}

/** Głęboka kopia stanu (m.in. snapshot „prev" do interpolacji renderu). */
export function copyPlaneState(src: PlaneState, dst: PlaneState): PlaneState {
  dst.position.copy(src.position);
  dst.velocity.copy(src.velocity);
  dst.orientation.copy(src.orientation);
  dst.angularRates.pitch = src.angularRates.pitch;
  dst.angularRates.roll = src.angularRates.roll;
  dst.angularRates.yaw = src.angularRates.yaw;
  dst.throttle = src.throttle;
  dst.iasMs = src.iasMs;
  dst.loadFactor = src.loadFactor;
  dst.stalled = src.stalled;
  dst.life = src.life;
  dst.lifeTimerS = src.lifeTimerS;
  return dst;
}
