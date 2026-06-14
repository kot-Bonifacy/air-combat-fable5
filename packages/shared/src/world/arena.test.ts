import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { ARENA_SIZE_M, ARENA_WARNING_DISTANCE_M } from '../constants';
import {
  arenaZone,
  distanceToArenaEdgeM,
  nearestToroidalImage,
  toroidalDistanceSqM,
  wrapToArena,
} from './arena';

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

describe('torus areny — wrapToArena (faza 7)', () => {
  it('wewnątrz areny nie zawija (delta zerowa)', () => {
    const pos = new Vector3(1234, 800, -5678);
    const delta = new Vector3();
    expect(wrapToArena(pos, delta)).toBe(false);
    expect(pos.toArray()).toEqual([1234, 800, -5678]);
    expect(delta.toArray()).toEqual([0, 0, 0]);
  });

  it('przekroczenie krawędzi przenosi na przeciwległą stronę (offset i Y zachowane)', () => {
    // 200 m za północną krawędzią (+Z) → 200 m w głąb od południowej (−Z)
    const pos = new Vector3(0, 1000, HALF + 200);
    const delta = new Vector3();
    expect(wrapToArena(pos, delta)).toBe(true);
    expect(pos.z).toBeCloseTo(-HALF + 200, 6);
    expect(pos.x).toBe(0);
    expect(pos.y).toBe(1000); // pion nietknięty
    expect(delta.z).toBeCloseTo(-ARENA_SIZE_M, 6);
    expect(delta.x).toBe(0);
    expect(delta.y).toBe(0);
  });

  it('zawija jednocześnie X i Z (róg)', () => {
    const pos = new Vector3(-HALF - 50, 500, HALF + 50);
    const delta = new Vector3();
    expect(wrapToArena(pos, delta)).toBe(true);
    expect(pos.x).toBeCloseTo(HALF - 50, 6);
    expect(pos.z).toBeCloseTo(-HALF + 50, 6);
  });

  it('po zawinięciu pozycja trzyma się w granicach areny', () => {
    const pos = new Vector3(HALF + 3000, 0, -HALF - 7000);
    const delta = new Vector3();
    wrapToArena(pos, delta);
    expect(Math.abs(pos.x)).toBeLessThanOrEqual(HALF);
    expect(Math.abs(pos.z)).toBeLessThanOrEqual(HALF);
  });
});

describe('percepcja toroidalna celu (faza 7)', () => {
  it('cel tuż za szwem widziany jako bliski (nie oddalony o ~arenę)', () => {
    // ja przy +Z krawędzi, cel tuż za nią (zawinął na −Z) — toroidalnie 60 m, nie ~20 km
    const self = new Vector3(0, 1000, HALF - 30);
    const target = new Vector3(0, 1000, -HALF + 30);
    const out = new Vector3();
    nearestToroidalImage(target, self, out);
    expect(out.z).toBeCloseTo(HALF + 30, 6); // obraz po „mojej" stronie szwu
    expect(out.distanceTo(self)).toBeCloseTo(60, 6);
  });

  it('w środku areny obraz toroidalny = pozycja oryginalna', () => {
    const self = new Vector3(1000, 500, 2000);
    const target = new Vector3(-1500, 800, 500);
    const out = new Vector3();
    nearestToroidalImage(target, self, out);
    expect(out.toArray()).toEqual([-1500, 800, 500]);
  });

  it('odległość toroidalna liczy najkrótszą drogę przez szew', () => {
    const a = new Vector3(0, 0, HALF - 40);
    const b = new Vector3(0, 0, -HALF + 40);
    // euklidesowo ~2·HALF, toroidalnie 80 m
    expect(Math.sqrt(toroidalDistanceSqM(a, b))).toBeCloseTo(80, 6);
  });
});
