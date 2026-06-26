import { Vector3 } from 'three';
import { dragForce } from '../aero/drag';
import { liftDirection, liftForce, type LiftResult } from '../aero/lift';
import { thrustForce } from '../aero/thrust';
import { GRAVITY_MS2 } from '../constants';
import type { PlaneConfig } from '../planes/loader';
import { airDensityKgM3, dynamicPressurePa, tasToIasMs } from './atmosphere';
import { gravityForce, sumForces, type ForceContribution } from './forces';
import { integrateStep } from './loop';
import type { PlaneState } from './state';

export interface PlaneTickResult {
  /** Wkłady sił z tego ticku — do strzałek debug i bilansów w harnessie. */
  contributions: readonly ForceContribution[];
  lift: LiftResult;
  tasMs: number;
  iasMs: number;
  rhoKgM3: number;
  qPa: number;
}

/**
 * Jeden tick fizyki samolotu (fizyka-lotu.md rozdz. 5 i 8):
 * atmosfera → siły (nośna z zadanego n, opór, ciąg, grawitacja) →
 * semi-implicit Euler → aktualizacja pól pochodnych stanu (iasMs,
 * loadFactor, stalled). Prędkości kątowe (kinematyczne) ustawia caller
 * na state.angularRates przed wywołaniem.
 */
export function stepPlane(
  state: PlaneState,
  plane: PlaneConfig,
  nDemandG: number,
  dtS: number,
): PlaneTickResult {
  const tasMs = state.velocity.length();
  const rhoKgM3 = airDensityKgM3(state.position.y);
  const qPa = dynamicPressurePa(rhoKgM3, tasMs);

  const lift = liftForce(state, plane, nDemandG, qPa);
  const contributions: ForceContribution[] = [
    lift.contribution,
    dragForce(state, plane, qPa, lift.cl, lift.clRequired),
    thrustForce(state, plane),
    gravityForce(plane.massKg),
  ];

  integrateStep(state, sumForces(contributions), plane.massKg, dtS);

  state.iasMs = tasToIasMs(tasMs, rhoKgM3);
  state.loadFactor = lift.nActual;
  state.stalled = lift.stalled;

  return { contributions, lift, tasMs, iasMs: state.iasMs, rhoKgM3, qPa };
}

const scratchLiftDir = new Vector3();

/**
 * Tymczasowe sterowanie fazy 2: zamiana żądanego pitch rate [rad/s] na żądane n
 * tak, by tor lotu zakrzywiał się razem z nosem: n = dot(liftDir, ŷ) + ω·V/g
 * (odwrócenie wzoru zakrętu ustalonego z fizyka-lotu.md rozdz. 6.1).
 * Bez inputu (ω=0) nośna równoważy tylko składową grawitacji prostopadłą
 * do toru — tor leci prosto, w dowolnym przechyleniu.
 */
export function nDemandForPitchRate(state: PlaneState, pitchRateRadS: number): number {
  if (!liftDirection(state, scratchLiftDir)) return 1; // V≈0: q≈0, wartość bez znaczenia
  return scratchLiftDir.y + (pitchRateRadS * state.velocity.length()) / GRAVITY_MS2;
}

/**
 * Odwrotność nDemandForPitchRate: pitch rate [rad/s], przy którym nos podąża
 * za torem zakrzywianym przez przeciążenie n (fizyka-lotu.md rozdz. 6.1:
 * ω_pitch = (n − cos(γ/bank)) · g / V; składnik cos to rzut liftDir na pion).
 */
export function pitchRateForLoadFactor(state: PlaneState, nG: number): number {
  if (!liftDirection(state, scratchLiftDir)) return 0;
  return ((nG - scratchLiftDir.y) * GRAVITY_MS2) / state.velocity.length();
}
