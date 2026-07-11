import { THRUST_V_EPS_MS } from '../constants';
import { sampleCurve } from '../math/curve';
import { getForward } from '../math/frame';
import { airDensityKgM3 } from '../physics/atmosphere';
import type { ForceContribution } from '../physics/forces';
import type { PlaneState } from '../physics/state';
import type { PlaneConfig } from '../planes/loader';

/**
 * Moc silnika vs wysokość. Dwa modele (fizyka v2 R1, §6.6):
 * 1. `powerCurve` w JSON → moc = enginePowerW · sampleCurve(powerCurve, h) — odcinkowa
 *    charakterystyka sprężarki per silnik (RAM, biegi sprężarki); kalibracja w R4.
 * 2. Brak pola (stan dzisiejszych JSON-ów) → prosty model historyczny: pełna moc
 *    do fullThrottleHeightM, wyżej spada proporcjonalnie do gęstości (rozdz. 5.3).
 */
export function enginePowerW(plane: PlaneConfig, altitudeM: number): number {
  if (plane.powerCurve) return plane.enginePowerW * sampleCurve(plane.powerCurve, altitudeM);
  if (altitudeM <= plane.fullThrottleHeightM) return plane.enginePowerW;
  return (
    (plane.enginePowerW * airDensityKgM3(altitudeM)) / airDensityKgM3(plane.fullThrottleHeightM)
  );
}

/**
 * Ciąg: T = min(T_static, η·P(h)·throttle / max(V, V_eps)) wzdłuż osi nosa.
 * Clamp statyczny usuwa osobliwość T→∞ przy V→0 (pułapka z faza-02.md).
 * Pusty bak (fuelFrac=0) → silnik staje: efektywny gaz 0, więc T=0 (samolot szybuje).
 */
export function thrustForce(state: PlaneState, plane: PlaneConfig): ForceContribution {
  const speed = Math.max(state.velocity.length(), THRUST_V_EPS_MS);
  const effectiveThrottle = state.fuelFrac > 0 ? state.throttle : 0;
  const powerW = enginePowerW(plane, state.position.y) * effectiveThrottle;
  const thrustN = Math.min(plane.staticThrustN, (plane.propEfficiency * powerW) / speed);
  const force = getForward(state.orientation).multiplyScalar(thrustN);
  return { name: 'ciąg', force };
}
