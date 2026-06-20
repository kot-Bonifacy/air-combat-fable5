import { Vector3 } from 'three';
import { dragForce } from '../aero/drag';
import { liftDirection, liftForce } from '../aero/lift';
import { enginePowerW, thrustForce } from '../aero/thrust';
import { FIXED_DT_S, GRAVITY_MS2, MS_TO_KMH, PHYSICS_HZ } from '../constants';
import { PhysicsError } from '../errors';
import { createPilotDemands } from '../instructor/instructor';
import { inducedDragFactor, type PlaneConfig } from '../planes/loader';
import { airDensityKgM3, dynamicPressurePa } from '../physics/atmosphere';
import { nAvailG } from '../physics/envelope';
import { validatePlaneState } from '../physics/nan-guard';
import { createSimPlane, pilotStep } from '../physics/pilot-step';
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
 * Roll rate w ustalonym przy zadanej IAS: pełna lotka przez PEŁNY pipeline
 * pilota (koperta + maszyna przeciągnięcia), throttle dobrany raz na start
 * z bilansu T=D. Zwraca średni roll rate [°/s] z okna pomiarowego.
 */
export function rollRateTest(plane: PlaneConfig, iasKmh: number, altitudeM = 100): number {
  const speedMs = iasKmh / MS_TO_KMH; // nisko: IAS ≈ TAS (rozjazd <1% na 100 m)
  const sim = createSimPlane(7);
  const { state } = sim;
  state.position.set(0, altitudeM, 0);
  state.velocity.set(0, 0, speedMs);
  state.iasMs = speedMs;

  // throttle z bilansu T = D w locie poziomym (n=1) — trzyma IAS w oknie pomiaru
  const rho = airDensityKgM3(altitudeM);
  const qPa = dynamicPressurePa(rho, speedMs);
  const qS = qPa * plane.wingAreaM2;
  const cl = (plane.massKg * GRAVITY_MS2) / qS;
  const dragN = qS * (plane.cd0 + inducedDragFactor(plane) * cl * cl);
  const availablePowerW = plane.propEfficiency * enginePowerW(plane, altitudeM);
  state.throttle = Math.min(1, (dragN * speedMs) / availablePowerW);

  const demands = createPilotDemands();
  const settleTicks = 1 * PHYSICS_HZ;
  const measureTicks = 2 * PHYSICS_HZ;
  let rolledRad = 0;
  for (let i = 0; i < settleTicks + measureTicks; i++) {
    demands.nDemandG = nDemandForPitchRate(state, 0); // bez ciągnięcia — czysta beczka
    demands.rollRateRadS = 100; // żądanie absurdalne — nasycenie robi koperta
    pilotStep(sim, plane, demands, FIXED_DT_S);
    validatePlaneState(state, 'rollRateTest');
    if (i >= settleTicks) rolledRad += state.angularRates.roll * FIXED_DT_S;
  }
  return ((rolledRad / (measureTicks * FIXED_DT_S)) * 180) / Math.PI;
}

export interface SustainedTurnResult {
  /** Czas pełnego zakrętu 360° zmierzony symulacją [s]. */
  turnTimeS: number;
  /** Czas 360° z bilansu mocy (T = D przy n_sust) [s]. */
  analyticTurnTimeS: number;
  /** Przechylenie w zakręcie ustalonym [°]. */
  bankDeg: number;
  /** TAS optymalna [m/s]. */
  tasMs: number;
  /** Zmiana wysokości w mierzonym okrążeniu [m] (sanity "z utrzymaniem wysokości"). */
  altitudeDriftM: number;
}

/**
 * Zakręt ustalony (fizyka-lotu.md rozdz. 11.5): analitycznie — przeszukanie V
 * po bilansie T(V) = D(V, n_sust), gdzie nadwyżka ciągu nad oporem pasożytniczym
 * idzie w opór indukowany zakrętu; ω = g·√(n²−1)/V. Potem symulacja w czasie:
 * regulator trzymania przechylenia (P na kącie — bez oscylacji, bo roll jest
 * kinematyczny) + n = 1/cosφ z tłumieniem prędkości pionowej (rate feedback,
 * nie pozycyjny — pozycyjny fugoiduje, memory fazy 2).
 */
export function sustainedTurnTest(plane: PlaneConfig, altitudeM = 500): SustainedTurnResult {
  const weightN = plane.massKg * GRAVITY_MS2;
  const kInduced = inducedDragFactor(plane);
  const rho = airDensityKgM3(altitudeM);

  // --- część analityczna ---
  let best = { tasMs: 0, n: 1, omega: 0 };
  for (let tasMs = 40; tasMs <= 160; tasMs += 0.5) {
    const qPa = dynamicPressurePa(rho, tasMs);
    const qS = qPa * plane.wingAreaM2;
    const state = createPlaneState();
    state.position.set(0, altitudeM, 0);
    state.velocity.set(0, 0, tasMs);
    state.throttle = 1;
    const thrustN = thrustForce(state, plane).force.length();
    const excessN = thrustN - qS * plane.cd0;
    if (excessN <= 0) continue;
    const nSq = (excessN * qS) / (kInduced * weightN * weightN);
    const n = Math.min(Math.sqrt(nSq), nAvailG(qPa, plane), plane.nMaxG);
    if (n <= 1.02) continue;
    const omega = (GRAVITY_MS2 * Math.sqrt(n * n - 1)) / tasMs;
    if (omega > best.omega) best = { tasMs, n, omega };
  }
  if (best.omega === 0) {
    throw new PhysicsError('sustainedTurnTest: brak punktu zakrętu ustalonego z n > 1');
  }
  const analyticTurnTimeS = (2 * Math.PI) / best.omega;
  const targetBankRad = Math.acos(1 / best.n);

  // --- symulacja w czasie ---
  const sim = createSimPlane(11);
  const { state } = sim;
  state.position.set(0, altitudeM, 0);
  state.velocity.set(0, 0, best.tasMs);
  state.iasMs = best.tasMs;
  state.throttle = 1;

  const demands = createPilotDemands();
  const liftDir = new Vector3();
  const BANK_GAIN_PER_S = 2;

  const settleS = 8;
  let headingPrevRad: number | undefined;
  let accumulatedRad = 0;
  let measureStartTick = -1;
  let measureStartAltM = 0;

  const maxTicks = 120 * PHYSICS_HZ;
  for (let i = 0; i < maxTicks; i++) {
    // przechylenie mierzone w układzie TORU (liftDir.y), nie z osi kadłuba —
    // nos siedzi α nad torem i pomiar z kadłuba zawyża pion siły nośnej
    // (objaw: zoom climb → utrata V → przeciągnięcie w "ustalonym" zakręcie)
    if (!liftDirection(state, liftDir)) {
      throw new PhysicsError('sustainedTurnTest: zdegenerowany kierunek nośnej');
    }
    const bankRad = Math.acos(Math.min(1, Math.max(-1, liftDir.y)));
    demands.rollRateRadS = BANK_GAIN_PER_S * (targetBankRad - bankRad);
    // n = 1/liftDir.y trzyma poziom przy bieżącym przechyleniu; cap na n*
    // analitycznym — sprzężenie od vy kusi, ale na tylnej stronie krzywej mocy
    // odpowiada odwrotnie (mniej n → mniej oporu → nadmiar ciągu wznosi bardziej)
    demands.nDemandG = Math.min(best.n, 1 / Math.max(liftDir.y, 0.2));
    pilotStep(sim, plane, demands, FIXED_DT_S);
    validatePlaneState(state, 'sustainedTurnTest');

    const headingRad = Math.atan2(state.velocity.x, state.velocity.z);
    if (headingPrevRad !== undefined && i >= settleS * PHYSICS_HZ) {
      if (measureStartTick < 0) {
        measureStartTick = i;
        measureStartAltM = state.position.y;
        accumulatedRad = 0;
      }
      let delta = headingRad - headingPrevRad;
      if (delta > Math.PI) delta -= 2 * Math.PI;
      if (delta < -Math.PI) delta += 2 * Math.PI;
      accumulatedRad += delta;
      if (Math.abs(accumulatedRad) >= 2 * Math.PI) {
        return {
          turnTimeS: (i - measureStartTick) * FIXED_DT_S,
          analyticTurnTimeS,
          bankDeg: (targetBankRad * 180) / Math.PI,
          tasMs: best.tasMs,
          altitudeDriftM: state.position.y - measureStartAltM,
        };
      }
    }
    headingPrevRad = headingRad;
  }
  throw new PhysicsError('sustainedTurnTest: brak pełnego okrążenia w 120 s symulacji');
}

/**
 * Pościg nurkujący (faza 19, scenariusz asymetrii): tor prosty −`diveDeg`, pełny
 * gaz, start z `startSpeedMs`. Zwraca |v| [m/s] po `seconds`. To prędkość rozpędzenia
 * w nurkowaniu — energy-fighter o lepszym współczynniku balistycznym (W/(S·cd0))
 * rozpędza się szybciej. Bf 109 (małe skrzydło) wygrywa nurkowanie mimo mniejszej masy.
 */
export function diveSpeedTest(
  plane: PlaneConfig,
  altitudeM = 4500,
  startSpeedMs = 120,
  diveDeg = 35,
  seconds = 25,
): number {
  const state = createPlaneState();
  const gamma = (-diveDeg * Math.PI) / 180;
  state.position.set(0, altitudeM, 0);
  state.velocity.set(0, Math.sin(gamma), Math.cos(gamma)).multiplyScalar(startSpeedMs);
  state.throttle = 1;
  alignNoseToVelocity(state);

  const maxTicks = seconds * PHYSICS_HZ;
  for (let i = 0; i < maxTicks && state.position.y > 300; i++) {
    alignNoseToVelocity(state);
    stepPlane(state, plane, nDemandForPitchRate(state, 0), FIXED_DT_S);
    validatePlaneState(state, 'diveSpeedTest');
  }
  return state.velocity.length();
}

/**
 * Świeca / zoom climb (faza 19, scenariusz asymetrii „pościg wznoszący"): lot prosty
 * pod kątem +`climbDeg`, BEZ ciągu (czysta wymiana energii kinetycznej w potencjalną),
 * start z wysokiej `startSpeedMs`. Zwraca przyrost wysokości [m] do chwili, gdy prędkość
 * spadnie do `endSpeedMs`. Mniejsza strata energii na opór (lepszy współczynnik balistyczny)
 * = wyższy zoom → Bf 109 utrzymuje energię w pionie lepiej niż Spitfire (turn-fighter).
 */
export function zoomClimbTest(
  plane: PlaneConfig,
  startSpeedMs = 180,
  endSpeedMs = 90,
  climbDeg = 45,
  altitudeM = 2000,
): number {
  const state = createPlaneState();
  const gamma = (climbDeg * Math.PI) / 180;
  state.position.set(0, altitudeM, 0);
  state.velocity.set(0, Math.sin(gamma), Math.cos(gamma)).multiplyScalar(startSpeedMs);
  state.throttle = 0;
  alignNoseToVelocity(state);

  const y0 = state.position.y;
  const maxTicks = 60 * PHYSICS_HZ;
  for (let i = 0; i < maxTicks && state.velocity.length() > endSpeedMs; i++) {
    alignNoseToVelocity(state);
    stepPlane(state, plane, nDemandForPitchRate(state, 0), FIXED_DT_S);
    validatePlaneState(state, 'zoomClimbTest');
  }
  return state.position.y - y0;
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
