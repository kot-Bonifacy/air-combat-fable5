import { Vector3 } from 'three';
import type { ForceContribution } from '../physics/forces';
import type { PlaneState } from '../physics/state';
import { inducedDragFactor, type PlaneConfig } from '../planes/loader';

/**
 * Opór z biegunowej: Cd = Cd0 + K·Cl², D = q·S·Cd przeciwnie do v̂
 * (fizyka-lotu.md rozdz. 5.2). Cl przychodzi z modułu nośnej przez parametr —
 * moduły sił nie importują siebie nawzajem.
 */
export function dragForce(
  state: PlaneState,
  plane: PlaneConfig,
  qPa: number,
  cl: number,
): ForceContribution {
  const force = new Vector3();
  const speed = state.velocity.length();
  if (speed > 0) {
    const cd = plane.cd0 + inducedDragFactor(plane) * cl * cl;
    const dragN = qPa * plane.wingAreaM2 * cd;
    force.copy(state.velocity).multiplyScalar(-dragN / speed);
  }
  return { name: 'opór', force };
}
