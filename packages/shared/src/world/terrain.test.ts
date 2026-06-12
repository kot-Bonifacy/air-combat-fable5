import { describe, expect, it } from 'vitest';
import { createRng } from '../math/rng';
import {
  createTerrain,
  SEABED_M,
  TERRAIN_GRID_N,
  TERRAIN_GRID_SPACING_M,
  TERRAIN_REGION_HALF_M,
} from './terrain';

const terrain = createTerrain();

describe('teren — heightmapa proceduralna (faza 4)', () => {
  it('deterministyczny: ten sam seed → identyczne wysokości', () => {
    const other = createTerrain();
    const rng = createRng(0xdeadbeef);
    for (let i = 0; i < 50; i++) {
      const x = (rng() - 0.5) * 2 * TERRAIN_REGION_HALF_M;
      const z = (rng() - 0.5) * 2 * TERRAIN_REGION_HALF_M;
      expect(other.heightAt(x, z)).toBe(terrain.heightAt(x, z));
    }
  });

  it('inny seed → inna mapa', () => {
    const other = createTerrain(7);
    expect(other.heightAt(1000, 500)).not.toBe(terrain.heightAt(1000, 500));
  });

  // Kryterium fazy 4: zgodność kolizji z meshem — mesh klienta powstaje
  // z nodeHeightM/nodeCoordM, a heightAt() w węźle musi zwrócić TĘ SAMĄ wartość.
  it('heightAt w 100 losowych węzłach === wartość siatki użyta do mesha', () => {
    const rng = createRng(0x5eed);
    for (let i = 0; i < 100; i++) {
      const ix = Math.floor(rng() * TERRAIN_GRID_N);
      const iz = Math.floor(rng() * TERRAIN_GRID_N);
      expect(terrain.heightAt(terrain.nodeCoordM(ix), terrain.nodeCoordM(iz))).toBe(
        terrain.nodeHeightM(ix, iz),
      );
    }
  });

  it('bilinear: środek komórki = średnia czterech rogów', () => {
    const ix = 100;
    const iz = 120;
    const xM = terrain.nodeCoordM(ix) + TERRAIN_GRID_SPACING_M / 2;
    const zM = terrain.nodeCoordM(iz) + TERRAIN_GRID_SPACING_M / 2;
    const avg =
      (terrain.nodeHeightM(ix, iz) +
        terrain.nodeHeightM(ix + 1, iz) +
        terrain.nodeHeightM(ix, iz + 1) +
        terrain.nodeHeightM(ix + 1, iz + 1)) /
      4;
    expect(terrain.heightAt(xM, zM)).toBeCloseTo(avg, 9);
  });

  it('poza regionem heightmapy → płaskie dno (SEABED_M), bez skoku na krawędzi', () => {
    expect(terrain.heightAt(TERRAIN_REGION_HALF_M + 1, 0)).toBe(SEABED_M);
    expect(terrain.heightAt(0, -TERRAIN_REGION_HALF_M - 1000)).toBe(SEABED_M);
    expect(terrain.heightAt(15000, 15000)).toBe(SEABED_M);
    // wszystkie węzły brzegowe siatki to już dno — region domyka się gładko
    const last = TERRAIN_GRID_N - 1;
    for (let i = 0; i < TERRAIN_GRID_N; i++) {
      expect(terrain.nodeHeightM(i, 0)).toBeCloseTo(SEABED_M, 3);
      expect(terrain.nodeHeightM(i, last)).toBeCloseTo(SEABED_M, 3);
      expect(terrain.nodeHeightM(0, i)).toBeCloseTo(SEABED_M, 3);
      expect(terrain.nodeHeightM(last, i)).toBeCloseTo(SEABED_M, 3);
    }
  });

  it('sylwetka wyspy: szczyt 1000–1400 m (śnieg), centrum to góra, brzeg to morze', () => {
    let peak = -Infinity;
    let landNodes = 0;
    for (let iz = 0; iz < TERRAIN_GRID_N; iz++) {
      for (let ix = 0; ix < TERRAIN_GRID_N; ix++) {
        const h = terrain.nodeHeightM(ix, iz);
        if (h > peak) peak = h;
        if (h > 0) landNodes++;
      }
    }
    expect(peak).toBeGreaterThan(1000);
    expect(peak).toBeLessThan(1400);
    expect(terrain.heightAt(0, 0)).toBeGreaterThan(600);
    // ekwiwalentna średnica lądu ~5–6 km (decyzja użytkownika z briefu fazy 4)
    const landAreaM2 = landNodes * TERRAIN_GRID_SPACING_M ** 2;
    const equivalentDiameterM = 2 * Math.sqrt(landAreaM2 / Math.PI);
    expect(equivalentDiameterM).toBeGreaterThan(4800);
    expect(equivalentDiameterM).toBeLessThan(6500);
    expect(terrain.heightAt(3500, 0)).toBeLessThan(0);
    expect(terrain.heightAt(0, -3500)).toBeLessThan(0);
  });

  it('heightAt nigdy nie zwraca NaN (próbkowanie krawędzi i dalekich punktów)', () => {
    const probes: [number, number][] = [
      [0, 0],
      [TERRAIN_REGION_HALF_M, TERRAIN_REGION_HALF_M],
      [-TERRAIN_REGION_HALF_M, TERRAIN_REGION_HALF_M],
      [1e7, -1e7],
      [-0.0001, 0.0001],
    ];
    for (const [x, z] of probes) expect(Number.isFinite(terrain.heightAt(x, z))).toBe(true);
  });
});
