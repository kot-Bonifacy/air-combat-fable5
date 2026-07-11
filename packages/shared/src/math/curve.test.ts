import { describe, expect, it } from 'vitest';
import { sampleCurve, type CurvePoints } from './curve';

const CURVE: CurvePoints = [
  [100, 40],
  [300, 80],
  [500, 20],
];

describe('sampleCurve — odcinkowa krzywa strojeniowa', () => {
  it('w punktach krzywej zwraca dokładnie wartości', () => {
    expect(sampleCurve(CURVE, 100)).toBe(40);
    expect(sampleCurve(CURVE, 300)).toBe(80);
    expect(sampleCurve(CURVE, 500)).toBe(20);
  });

  it('między punktami interpoluje liniowo', () => {
    expect(sampleCurve(CURVE, 200)).toBeCloseTo(60, 12);
    expect(sampleCurve(CURVE, 450)).toBeCloseTo(35, 12);
  });

  it('poza zakresem zwraca wartości brzegowe (bez ekstrapolacji)', () => {
    expect(sampleCurve(CURVE, -50)).toBe(40);
    expect(sampleCurve(CURVE, 9000)).toBe(20);
  });

  it('pusta krzywa → 0 (defensywne; loader wymaga ≥2 punktów)', () => {
    expect(sampleCurve([], 123)).toBe(0);
  });
});
