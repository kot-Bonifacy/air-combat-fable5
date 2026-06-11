import { Vector3 } from 'three';
import { GRAVITY_MS2 } from '../constants';
import { getUp } from '../math/frame';
import type { ForceContribution } from '../physics/forces';
import type { PlaneState } from '../physics/state';
import type { PlaneConfig } from '../planes/loader';

// Moduły sił importują tylko state/config/helpery — nigdy siebie nawzajem
// (lekcja z opus4-7: circular import physics↔aero).

const scratchUp = new Vector3();
const scratchVHat = new Vector3();

/** Poniżej tej prędkości kierunek nośnej jest niezdefiniowany (v̂ zdegenerowane). */
const MIN_SPEED_MS = 0.1;

export interface LiftResult {
  contribution: ForceContribution;
  /** Cl wymagany do zadanego n, PRZED obcięciem (może być ±Infinity przy q→0). */
  clRequired: number;
  /** Cl faktyczny, po obcięciu do ±clMax. */
  cl: number;
  /** α_implied = Cl/Clα [rad] — pochodny, nie całkowany (fizyka-lotu.md rozdz. 5.5). */
  alphaImpliedRad: number;
  /** Faktyczne przeciążenie po obcięciu [G], znak zgodny z liftDir. */
  nActual: number;
  /** Przeciągnięcie: |Cl wymagany| przekracza clMax (fizyka-lotu.md rozdz. 6.5). */
  stalled: boolean;
}

/**
 * Kierunek siły nośnej: prostopadle do prędkości, w płaszczyźnie symetrii
 * samolotu: normalize(up − v̂·dot(up, v̂)). Działa też w locie odwróconym
 * i nożowym bez przypadków specjalnych (fizyka-lotu.md rozdz. 5.1).
 * Zwraca false, gdy kierunek zdegenerowany (V≈0 albo up ∥ v̂).
 */
export function liftDirection(state: PlaneState, target: Vector3): boolean {
  if (state.velocity.length() < MIN_SPEED_MS) return false;
  scratchVHat.copy(state.velocity).normalize();
  getUp(state.orientation, scratchUp);
  target.copy(scratchUp).addScaledVector(scratchVHat, -scratchUp.dot(scratchVHat));
  if (target.lengthSq() < 1e-12) return false;
  target.normalize();
  return true;
}

/**
 * Siła nośna z zadanego przeciążenia: Cl = n·m·g/(q·S), obcięty do ±clMax
 * (obcięcie = przeciągnięcie; ujemny zakres symetryczny — uproszczenie simcade).
 * L = q·S·Cl wzdłuż liftDirection.
 */
export function liftForce(
  state: PlaneState,
  plane: PlaneConfig,
  nDemandG: number,
  qPa: number,
): LiftResult {
  const weightN = plane.massKg * GRAVITY_MS2;
  const qS = qPa * plane.wingAreaM2;
  // qS=0 z niezerowym żądaniem → ±Infinity (żądanie niewykonalne, stalled);
  // jawne rozgałęzienie, bo 0/0 dałoby NaN
  const clRequired =
    qS > 0 ? (nDemandG * weightN) / qS : nDemandG === 0 ? 0 : Infinity * Math.sign(nDemandG);
  const cl = Math.min(plane.clMax, Math.max(-plane.clMax, clRequired));
  const stalled = Math.abs(clRequired) > plane.clMax;

  const force = new Vector3();
  let nActual = 0;
  if (liftDirection(state, force)) {
    force.multiplyScalar(qS * cl);
    nActual = (qS * cl) / weightN;
  } else {
    force.set(0, 0, 0);
  }

  return {
    contribution: { name: 'siła nośna', force },
    clRequired,
    cl,
    alphaImpliedRad: cl / plane.clAlphaPerRad,
    nActual,
    stalled,
  };
}
