import { ARENA_SIZE_M, ARENA_WARNING_DISTANCE_M } from '../constants';

// Granice areny (faza 4): kwadrat ARENA_SIZE_M × ARENA_SIZE_M wokół (0,0).
// Strefy: inside → warning (HUD) → outside (autopilot zawracający przejmuje stery).

export type ArenaZone = 'inside' | 'warning' | 'outside';

/** Odległość do najbliższej granicy areny [m]; ujemna = poza areną. */
export function distanceToArenaEdgeM(xM: number, zM: number): number {
  const halfM = ARENA_SIZE_M / 2;
  return Math.min(halfM - Math.abs(xM), halfM - Math.abs(zM));
}

export function arenaZone(xM: number, zM: number): ArenaZone {
  const edgeM = distanceToArenaEdgeM(xM, zM);
  if (edgeM < 0) return 'outside';
  return edgeM <= ARENA_WARNING_DISTANCE_M ? 'warning' : 'inside';
}
