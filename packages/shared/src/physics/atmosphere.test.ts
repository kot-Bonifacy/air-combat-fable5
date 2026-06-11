import { describe, expect, it } from 'vitest';
import { SEA_LEVEL_AIR_DENSITY_KGM3 } from '../constants';
import { airDensityKgM3, dynamicPressurePa, tasToIasMs } from './atmosphere';

// Wartości tablicowe ISA (US Standard Atmosphere 1976), tolerancja 0.5% —
// nasz model potęgowy to przybliżenie pełnego modelu barometrycznego.
const ISA_TABLE: ReadonlyArray<[altitudeM: number, rhoKgM3: number]> = [
  [0, 1.225],
  [3000, 0.90925],
  [6000, 0.66011],
];

describe('atmosfera ISA', () => {
  it.each(ISA_TABLE)('ρ(%d m) zgodna z tablicą ISA w 0.5%%', (altitudeM, expected) => {
    const rho = airDensityKgM3(altitudeM);
    expect(Math.abs(rho - expected) / expected).toBeLessThan(0.005);
  });

  it('ρ maleje monotonicznie z wysokością i nie daje NaN przy ekstremach', () => {
    let prev = airDensityKgM3(0);
    for (let h = 500; h <= 11_000; h += 500) {
      const rho = airDensityKgM3(h);
      expect(rho).toBeLessThan(prev);
      expect(Number.isFinite(rho)).toBe(true);
      prev = rho;
    }
    expect(airDensityKgM3(100_000)).toBe(0); // podstawa potęgi obcięta do 0, nie NaN
  });

  it('ciśnienie dynamiczne: q = ½ρV²', () => {
    expect(dynamicPressurePa(1.225, 100)).toBeCloseTo(6125, 6);
    expect(dynamicPressurePa(1.225, 0)).toBe(0);
  });

  it('IAS = TAS na poziomie morza, mniejsza na wysokości', () => {
    expect(tasToIasMs(150, SEA_LEVEL_AIR_DENSITY_KGM3)).toBeCloseTo(150, 9);
    const rho6km = airDensityKgM3(6000);
    const ias = tasToIasMs(150, rho6km);
    expect(ias).toBeCloseTo(150 * Math.sqrt(rho6km / 1.225), 9);
    expect(ias).toBeLessThan(150 * 0.8); // na 6 km IAS wyraźnie niższa od TAS
  });
});
