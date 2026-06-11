import { THRUST_V_EPS_MS } from '../constants';
import { getForward } from '../math/frame';
import { airDensityKgM3 } from '../physics/atmosphere';
import type { ForceContribution } from '../physics/forces';
import type { PlaneState } from '../physics/state';
import type { PlaneConfig } from '../planes/loader';

/**
 * Moc silnika z prostym modelem sprężarki: pełna do fullThrottleHeightM,
 * wyżej spada proporcjonalnie do gęstości (fizyka-lotu.md rozdz. 5.3).
 */
export function enginePowerW(plane: PlaneConfig, altitudeM: number): number {
  if (altitudeM <= plane.fullThrottleHeightM) return plane.enginePowerW;
  return (
    (plane.enginePowerW * airDensityKgM3(altitudeM)) / airDensityKgM3(plane.fullThrottleHeightM)
  );
}

/**
 * Ciąg: T = min(T_static, η·P(h)·throttle / max(V, V_eps)) wzdłuż osi nosa.
 * Clamp statyczny usuwa osobliwość T→∞ przy V→0 (pułapka z faza-02.md).
 */
export function thrustForce(state: PlaneState, plane: PlaneConfig): ForceContribution {
  const speed = Math.max(state.velocity.length(), THRUST_V_EPS_MS);
  const powerW = enginePowerW(plane, state.position.y) * state.throttle;
  const thrustN = Math.min(plane.staticThrustN, (plane.propEfficiency * powerW) / speed);
  const force = getForward(state.orientation).multiplyScalar(thrustN);
  return { name: 'ciąg', force };
}
