import { Vector3 } from 'three';
import { GRAVITY_MS2 } from '../constants';

/**
 * Pojedynczy wkład siły [N] w układzie świata.
 * Moduły sił zwracają zwykłe obiekty i importują wyłącznie state.ts —
 * nigdy siebie nawzajem (lekcja z opus4-7: circular import physics↔aero).
 */
export interface ForceContribution {
  name: string;
  force: Vector3;
}

export function gravityForce(massKg: number): ForceContribution {
  return { name: 'grawitacja', force: new Vector3(0, -massKg * GRAVITY_MS2, 0) };
}

/** Suma wkładów sił → wypadkowa [N]. */
export function sumForces(
  contributions: readonly ForceContribution[],
  target = new Vector3(),
): Vector3 {
  target.set(0, 0, 0);
  for (const c of contributions) target.add(c.force);
  return target;
}
