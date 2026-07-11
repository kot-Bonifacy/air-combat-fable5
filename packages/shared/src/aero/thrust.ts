import { THRUST_V_EPS_MS } from '../constants';
import { sampleCurve } from '../math/curve';
import { getForward } from '../math/frame';
import { airDensityKgM3 } from '../physics/atmosphere';
import type { ForceContribution } from '../physics/forces';
import type { PlaneState } from '../physics/state';
import type { PlaneConfig } from '../planes/loader';

/**
 * Moc silnika vs wysokość [W] (fizyka v2 R2, §6.3: opcjonalny mnożnik WEP na końcu). Dwa modele
 * charakterystyki wysokościowej (R1, §6.6):
 * 1. `powerCurve` w JSON → moc = enginePowerW · sampleCurve(powerCurve, h) — odcinkowa
 *    charakterystyka sprężarki per silnik (RAM, biegi sprężarki); kalibracja w R4.
 * 2. Brak pola (stan dzisiejszych JSON-ów) → prosty model historyczny: pełna moc
 *    do fullThrottleHeightM, wyżej spada proporcjonalnie do gęstości (rozdz. 5.3).
 * `enginePowerW` bez WEP = MOC BOJOWA (military, +9 lb); `wepActive` mnoży ją przez (1+wepBoostFrac)
 * (WEP/overboost, +12 lb — rekalibracja Vmax na WEP w R4). Domyślnie false → callery harnessu/złotych
 * liczą moc bojową (Vmax złote bez zmian).
 */
export function enginePowerW(plane: PlaneConfig, altitudeM: number, wepActive = false): number {
  const wepMul = wepActive ? 1 + plane.wepBoostFrac : 1;
  if (plane.powerCurve) return plane.enginePowerW * sampleCurve(plane.powerCurve, altitudeM) * wepMul;
  if (altitudeM <= plane.fullThrottleHeightM) return plane.enginePowerW * wepMul;
  return (
    (plane.enginePowerW * wepMul * airDensityKgM3(altitudeM)) / airDensityKgM3(plane.fullThrottleHeightM)
  );
}

/**
 * Ciąg: T = min(T_static, η·P(h)·throttle / max(V, V_eps)) wzdłuż osi nosa.
 * Clamp statyczny usuwa osobliwość T→∞ przy V→0 (pułapka z faza-02.md).
 * Pusty bak (fuelFrac=0) → silnik staje: efektywny gaz 0, więc T=0 (samolot szybuje).
 * WEP (state.wepActive, R2) podnosi moc przez enginePowerW; ciąg statyczny (T_static) NIE jest
 * skalowany WEP-em (clamp niskoprędkościowy — WEP daje przewagę na prędkości, nie w zawisie).
 */
export function thrustForce(state: PlaneState, plane: PlaneConfig): ForceContribution {
  const speed = Math.max(state.velocity.length(), THRUST_V_EPS_MS);
  const effectiveThrottle = state.fuelFrac > 0 ? state.throttle : 0;
  const powerW = enginePowerW(plane, state.position.y, state.wepActive) * effectiveThrottle;
  const thrustN = Math.min(plane.staticThrustN, (plane.propEfficiency * powerW) / speed);
  const force = getForward(state.orientation).multiplyScalar(thrustN);
  return { name: 'ciąg', force };
}
