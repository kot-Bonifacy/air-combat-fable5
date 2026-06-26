import { Vector3 } from 'three';
import type { ForceContribution } from '../physics/forces';
import type { PlaneState } from '../physics/state';
import { inducedDragFactor, type PlaneConfig } from '../planes/loader';

/**
 * Opór z biegunowej (fizyka-lotu.md rozdz. 5.2): D = q·S·Cd przeciwnie do v̂, gdzie
 *   Cd = Cd0 + K·Cl²  +  dragHighClK·Cl⁴  +  dragStallK·(|Cl_wym|−Cl_max)²₊
 * 1. K·Cl² — opór indukowany (biegunowa paraboliczna).
 * 2. dragHighClK·Cl⁴ — ZAGIĘCIE biegunowej blisko Cl_max: znikome przy małym Cl
 *    (lot poziomy/nurkowanie/łagodny zakręt — V_max i wznoszenie nietknięte), rośnie
 *    szybko w ciasnym zakręcie. Bez tego stałe K zaniża opór wysokiego Cl → zakręty
 *    „za tanie" (diagnoza 2026-06-26: samoloty trzymały energię w ciasnym zakręcie zbyt dobrze).
 * 3. dragStallK·(excess)² — OPÓR ODERWANIA, gdy żądany Cl przekracza Cl_max (over-pull
 *    w buffet/przeciągnięcie): nośna siedzi na Cl_max, ale strugi się odrywają i opór
 *    skacze. `cl` jest już obcięty do ±Cl_max, więc nadwyżkę liczymy z `clRequired`
 *    (nieobciętego). Nadwyżka nasycana do Cl_max (skrzydło w pełni oderwane → Cd plateau,
 *    zarazem strażnik NaN przy clRequired→±∞ dla q→0).
 *
 * Cl przychodzi z modułu nośnej przez parametry — moduły sił nie importują siebie nawzajem.
 * `clRequired` domyślnie = `cl` (gdy caller nie rozróżnia — wtedy excess=0 poniżej Cl_max).
 */
export function dragForce(
  state: PlaneState,
  plane: PlaneConfig,
  qPa: number,
  cl: number,
  clRequired: number = cl,
): ForceContribution {
  const force = new Vector3();
  const speed = state.velocity.length();
  if (speed > 0) {
    const clSq = cl * cl;
    const excessCl = Math.min(plane.clMax, Math.max(0, Math.abs(clRequired) - plane.clMax));
    const cd =
      plane.cd0 +
      inducedDragFactor(plane) * clSq +
      plane.dragHighClK * clSq * clSq +
      plane.dragStallK * excessCl * excessCl;
    const dragN = qPa * plane.wingAreaM2 * cd;
    force.copy(state.velocity).multiplyScalar(-dragN / speed);
  }
  return { name: 'opór', force };
}
