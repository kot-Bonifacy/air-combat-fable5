import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { createLeadSolution, solveLead } from './lead';

const MUZZLE = 744;

describe('solveLead — punkt przechwycenia', () => {
  it('cel po prostej, strzelec nieruchomy: rozwiązanie analityczne', () => {
    // cel 300 m przed strzelcem, leci bokiem 100 m/s; t z |aimPoint| = s·t
    const out = solveLead(
      new Vector3(0, 0, 0),
      new Vector3(0, 0, 0),
      new Vector3(0, 0, 300),
      new Vector3(100, 0, 0),
      MUZZLE,
      createLeadSolution(),
    );
    // 10000 t² + 90000 = 744² t² → t = sqrt(90000/(744²−10000))
    const tExpected = Math.sqrt(90000 / (MUZZLE * MUZZLE - 10000));
    expect(out.timeToInterceptS).toBeCloseTo(tExpected, 6);
    expect(out.aimPoint.x).toBeCloseTo(100 * tExpected, 4);
    expect(out.aimPoint.z).toBeCloseTo(300, 6);
    // pocisk wzdłuż aimDir przez czas t dociera do aimPoint
    const hit = new Vector3().copy(out.aimDir).multiplyScalar(MUZZLE * out.timeToInterceptS);
    expect(hit.x).toBeCloseTo(out.aimPoint.x, 3);
    expect(hit.z).toBeCloseTo(out.aimPoint.z, 3);
    expect(out.aimDir.length()).toBeCloseTo(1, 9);
  });

  it('cel ucieka szybciej niż pocisk → brak rozwiązania, aimDir = LOS', () => {
    const out = solveLead(
      new Vector3(0, 0, 0),
      new Vector3(0, 0, 0),
      new Vector3(0, 0, 300),
      new Vector3(0, 0, 800), // szybciej niż 744 i w tę samą stronę
      MUZZLE,
      createLeadSolution(),
    );
    expect(out.timeToInterceptS).toBe(-1);
    expect(out.aimDir.x).toBeCloseTo(0, 9);
    expect(out.aimDir.z).toBeCloseTo(1, 9); // LOS do bieżącej pozycji celu
  });

  it('cel wprost z naprzeciwka: aimDir wzdłuż LOS (brak poprzecznej składowej)', () => {
    const out = solveLead(
      new Vector3(0, 0, 0),
      new Vector3(0, 0, 0),
      new Vector3(0, 0, 400),
      new Vector3(0, 0, -120),
      MUZZLE,
      createLeadSolution(),
    );
    expect(out.timeToInterceptS).toBeGreaterThan(0);
    expect(out.aimDir.x).toBeCloseTo(0, 9);
    expect(out.aimDir.y).toBeCloseTo(0, 9);
    expect(out.aimDir.z).toBeCloseTo(1, 9);
  });

  it('prędkość strzelca jest uwzględniona (lead liczony w jego układzie)', () => {
    // strzelec leci równolegle do celu z tą samą prędkością boczną — brak wyprzedzenia
    const out = solveLead(
      new Vector3(0, 0, 0),
      new Vector3(100, 0, 0),
      new Vector3(0, 0, 300),
      new Vector3(100, 0, 0),
      MUZZLE,
      createLeadSolution(),
    );
    expect(out.aimDir.x).toBeCloseTo(0, 6); // względny ruch boczny = 0 → celuj wprost
    expect(out.aimDir.z).toBeCloseTo(1, 6);
  });
});
