import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { MIN_SPAWN_CLEARANCE_M } from '../constants';
import { chooseSpawnIndex, minDistance } from './spawn';

function ring(): Vector3[] {
  // 4 kandydaci na obrzeżach kwadratu 8 km
  return [
    new Vector3(8000, 800, 0),
    new Vector3(-8000, 800, 0),
    new Vector3(0, 800, 8000),
    new Vector3(0, 800, -8000),
  ];
}

describe('chooseSpawnIndex', () => {
  it('bez zajętych punktów wybiera pierwszego kandydata', () => {
    expect(chooseSpawnIndex(ring(), [])).toBe(0);
  });

  it('pusta lista kandydatów → −1', () => {
    expect(chooseSpawnIndex([], [new Vector3()])).toBe(-1);
  });

  it('wybiera kandydata najdalej od wrogów', () => {
    const candidates = ring();
    const enemies = [new Vector3(7900, 800, 0), new Vector3(0, 800, 7900)]; // blisko #0 i #2
    const idx = chooseSpawnIndex(candidates, enemies);
    // #1 (-8000,0,0) i #3 (0,0,-8000) są najdalej; oba ~równe → niższy indeks (1)
    expect(idx).toBe(1);
  });

  it('dotrzymuje progu prześwitu, gdy arena na to pozwala', () => {
    const candidates = ring();
    const enemies = [new Vector3(8000, 800, 0)]; // jeden wróg na slocie #0
    const idx = chooseSpawnIndex(candidates, enemies);
    const clearance = minDistance(candidates[idx]!, enemies);
    expect(clearance).toBeGreaterThanOrEqual(MIN_SPAWN_CLEARANCE_M);
  });
});

describe('minDistance', () => {
  it('zwraca najmniejszy dystans do zbioru punktów', () => {
    const p = new Vector3(0, 0, 0);
    expect(minDistance(p, [new Vector3(10, 0, 0), new Vector3(3, 0, 0)])).toBeCloseTo(3);
  });

  it('pusta lista → Infinity', () => {
    expect(minDistance(new Vector3(), [])).toBe(Infinity);
  });
});
