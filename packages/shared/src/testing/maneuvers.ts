import { Vector3 } from 'three';
import { dragForce } from '../aero/drag';
import { liftForce } from '../aero/lift';
import { enginePowerW, thrustForce } from '../aero/thrust';
import { FIXED_DT_S, GRAVITY_MS2, PHYSICS_HZ } from '../constants';
import { PhysicsError } from '../errors';
import type { PlaneConfig } from '../planes/loader';
import { airDensityKgM3, dynamicPressurePa } from '../physics/atmosphere';
import { validatePlaneState } from '../physics/nan-guard';
import { nDemandForPitchRate, stepPlane } from '../physics/plane-step';
import { createPlaneState, type PlaneState } from '../physics/state';

// Harness manewrów (fizyka-lotu.md rozdz. 11.5): skryptowane scenariusze
// sterujące stanem bez renderera. Złote testy osiągów porównują wyniki
// z tabelą z rozdz. 10 — refaktoryzacja, która je psuje, psuje grę.

const FORWARD = new Vector3(0, 0, 1);

/** Nos wzdłuż wektora prędkości — skrypt harnessu, nie model (weathervaning to faza 3). */
function alignNoseToVelocity(state: PlaneState): void {
  const vHat = state.velocity.clone().normalize();
  state.orientation.setFromUnitVectors(FORWARD, vHat);
}

/**
 * Rozpędzanie w locie poziomym z pełnym gazem do ustalenia → V_max (TAS, m/s).
 * n=1 zeruje pionową wypadkową w każdym ticku, więc tor pozostaje poziomy
 * bez regulatora wysokości.
 */
export function topSpeedTest(plane: PlaneConfig, altitudeM: number): number {
  const state = createPlaneState();
  state.position.set(0, altitudeM, 0);
  state.velocity.set(0, 0, 60);
  state.throttle = 1;

  const maxTicks = 600 * PHYSICS_HZ;
  const checkEveryTicks = 5 * PHYSICS_HZ;
  let speedAtLastCheck = state.velocity.length();

  for (let i = 1; i <= maxTicks; i++) {
    stepPlane(state, plane, 1, FIXED_DT_S);
    validatePlaneState(state, 'topSpeedTest');
    if (i % checkEveryTicks === 0) {
      const speed = state.velocity.length();
      if (Math.abs(speed - speedAtLastCheck) < 0.05) return speed;
      speedAtLastCheck = speed;
    }
  }
  throw new PhysicsError(
    `topSpeedTest(${String(altitudeM)} m): brak zbieżności po 600 s (V=${state.velocity.length().toFixed(1)} m/s)`,
  );
}

/**
 * Lot poziomy z wytracaniem ~1 km/h na sekundę (throttle dobierany z odwrócenia
 * wzoru na ciąg) aż do pierwszego ticku z flagą przeciągnięcia → IAS [m/s].
 */
export function stallTest(plane: PlaneConfig): number {
  const state = createPlaneState();
  state.position.set(0, 100, 0);
  state.velocity.set(0, 0, 60);
  state.throttle = 0.5;

  const targetDecelMs2 = 1 / 3.6; // 1 km/h na sekundę
  let lastDragN = 0;

  const maxTicks = 600 * PHYSICS_HZ;
  for (let i = 0; i < maxTicks; i++) {
    // throttle z odwrócenia T = η·P·throttle/V przy żądaniu T = D − m·a_target
    const speed = state.velocity.length();
    const requiredThrustN = lastDragN - plane.massKg * targetDecelMs2;
    const availablePowerW = plane.propEfficiency * enginePowerW(plane, state.position.y);
    state.throttle = Math.min(1, Math.max(0, (requiredThrustN * speed) / availablePowerW));

    const result = stepPlane(state, plane, 1, FIXED_DT_S);
    validatePlaneState(state, 'stallTest');
    if (result.lift.stalled) return state.iasMs;

    const drag = result.contributions.find((c) => c.name === 'opór');
    lastDragN = drag ? drag.force.length() : 0;
  }
  throw new PhysicsError('stallTest: brak przeciągnięcia po 600 s');
}

interface SteadyClimbPoint {
  gammaRad: number;
  rocMs: number;
}

/**
 * Ustalone wznoszenie przy zadanej TAS: iteracja punktu stałego
 * sinγ = (T − D)/(m·g) z n = cosγ (zakręt zerowy, tor prosty).
 * Liczone wprost z modułów sił — bez całkowania.
 */
function steadyClimbAt(plane: PlaneConfig, tasMs: number, altitudeM: number): SteadyClimbPoint {
  const weightN = plane.massKg * GRAVITY_MS2;
  const rho = airDensityKgM3(altitudeM);
  const qPa = dynamicPressurePa(rho, tasMs);
  const state = createPlaneState();
  state.position.set(0, altitudeM, 0);
  state.throttle = 1;

  let gammaRad = 0;
  for (let iter = 0; iter < 50; iter++) {
    state.velocity.set(0, Math.sin(gammaRad), Math.cos(gammaRad)).multiplyScalar(tasMs);
    alignNoseToVelocity(state);
    const lift = liftForce(state, plane, Math.cos(gammaRad), qPa);
    const dragN = dragForce(state, plane, qPa, lift.cl).force.length();
    const thrustN = thrustForce(state, plane).force.length();
    const sinGamma = Math.min(1, Math.max(-1, (thrustN - dragN) / weightN));
    const next = Math.asin(sinGamma);
    if (Math.abs(next - gammaRad) < 1e-9) {
      gammaRad = next;
      break;
    }
    gammaRad += 0.5 * (next - gammaRad);
  }
  return { gammaRad, rocMs: tasMs * Math.sin(gammaRad) };
}

export interface ClimbTestResult {
  /** Wznoszenie zmierzone symulacją w czasie [m/s]. */
  rocMs: number;
  /** Wznoszenie z bilansu mocy (punkt stały) [m/s]. */
  analyticRocMs: number;
  /** TAS, przy której wznoszenie jest maksymalne [m/s]. */
  bestSpeedMs: number;
}

/**
 * Wznoszenie z V optymalną: przeszukanie prędkości po bilansie mocy,
 * potem 20 s symulacji w czasie od stanu ustalonego (n = cosγ, tor prosty)
 * — średnie vy to wynik; rozjazd z bilansem >5% = błąd modelu/integratora.
 */
export function climbTest(plane: PlaneConfig, altitudeM = 500): ClimbTestResult {
  let best: SteadyClimbPoint & { tasMs: number } = { gammaRad: 0, rocMs: -Infinity, tasMs: 0 };
  for (let tasMs = 50; tasMs <= 130; tasMs += 2) {
    const point = steadyClimbAt(plane, tasMs, altitudeM);
    if (point.rocMs > best.rocMs) best = { ...point, tasMs };
  }

  const state = createPlaneState();
  state.position.set(0, altitudeM, 0);
  state.velocity
    .set(0, Math.sin(best.gammaRad), Math.cos(best.gammaRad))
    .multiplyScalar(best.tasMs);
  state.throttle = 1;

  const seconds = 20;
  const y0 = state.position.y;
  for (let i = 0; i < seconds * PHYSICS_HZ; i++) {
    alignNoseToVelocity(state);
    // n bez inputu pitch = tor prosty (nośna równoważy grawitację prostopadłą do toru)
    stepPlane(state, plane, nDemandForPitchRate(state, 0), FIXED_DT_S);
    validatePlaneState(state, 'climbTest');
  }

  return {
    rocMs: (state.position.y - y0) / seconds,
    analyticRocMs: best.rocMs,
    bestSpeedMs: best.tasMs,
  };
}

export interface DiveEnergyResult {
  /** Największy jednotickowy przyrost energii całkowitej [J] (powinien być ≤ 0). */
  maxTickEnergyGainJ: number;
  /** Zmiana energii całkowitej na końcu [J] (powinna być ujemna). */
  totalEnergyChangeJ: number;
}

/**
 * Nurkowanie −30° bez ciągu: energia całkowita ½mV² + mgh nie ma prawa rosnąć
 * (sanity bilansu — nośna prostopadła do toru nie wykonuje pracy, opór rozprasza).
 */
export function diveEnergyTest(plane: PlaneConfig): DiveEnergyResult {
  const state = createPlaneState();
  const gamma = -Math.PI / 6;
  state.position.set(0, 3000, 0);
  state.velocity.set(0, Math.sin(gamma), Math.cos(gamma)).multiplyScalar(120);
  state.throttle = 0;
  alignNoseToVelocity(state);

  const energyJ = (): number =>
    0.5 * plane.massKg * state.velocity.lengthSq() +
    plane.massKg * GRAVITY_MS2 * state.position.y;

  let prevE = energyJ();
  const initialE = prevE;
  let maxTickEnergyGainJ = -Infinity;

  for (let i = 0; i < 15 * PHYSICS_HZ && state.position.y > 200; i++) {
    alignNoseToVelocity(state);
    stepPlane(state, plane, nDemandForPitchRate(state, 0), FIXED_DT_S);
    validatePlaneState(state, 'diveEnergyTest');
    const e = energyJ();
    maxTickEnergyGainJ = Math.max(maxTickEnergyGainJ, e - prevE);
    prevE = e;
  }

  return { maxTickEnergyGainJ, totalEnergyChangeJ: prevE - initialE };
}
