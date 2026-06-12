import { describe, expect, it } from 'vitest';
import { ARENA_SIZE_M, ARENA_WARNING_DISTANCE_M } from '../constants';
import { arenaZone, distanceToArenaEdgeM } from './arena';

const HALF = ARENA_SIZE_M / 2;

describe('granice areny (faza 4)', () => {
  it('odległość do krawędzi: środek, przy ścianie, w rogu, poza areną', () => {
    expect(distanceToArenaEdgeM(0, 0)).toBe(HALF);
    expect(distanceToArenaEdgeM(HALF - 100, 0)).toBe(100);
    expect(distanceToArenaEdgeM(-HALF + 100, 0)).toBe(100);
    expect(distanceToArenaEdgeM(0, HALF - 250)).toBe(250);
    // w rogu decyduje bliższa ściana
    expect(distanceToArenaEdgeM(HALF - 100, HALF - 50)).toBe(50);
    expect(distanceToArenaEdgeM(HALF + 300, 0)).toBe(-300);
    expect(distanceToArenaEdgeM(0, -HALF - 1)).toBe(-1);
  });

  it('strefy: inside → warning (≤1 km od granicy) → outside', () => {
    expect(arenaZone(0, 0)).toBe('inside');
    expect(arenaZone(HALF - ARENA_WARNING_DISTANCE_M - 1, 0)).toBe('inside');
    expect(arenaZone(HALF - ARENA_WARNING_DISTANCE_M, 0)).toBe('warning');
    expect(arenaZone(0, -(HALF - 10))).toBe('warning');
    expect(arenaZone(HALF + 1, 0)).toBe('outside');
    expect(arenaZone(-HALF - 500, -HALF - 500)).toBe('outside');
  });
});
