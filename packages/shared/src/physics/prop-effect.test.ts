import { describe, expect, it } from 'vitest';
import { propEffectRates, type PropRates } from './prop-effect';
import { MS_TO_KMH } from '..';
import { createTestPlane } from '../testing/fixtures';
import { createPlaneState } from './state';

// Szczątkowe efekty śmigła (fizyka v2 R3, §6.5): bias yaw/roll ∝ throttle·(1 − IAS/fade)², znak =
// kierunek historyczny obrotu śmigła. Zanik KWADRATOWY do zera powyżej fadeKmh (brak ciągłego trymu).

/** Plane z jawnym propEffect (fikstura ma biasy 0 — neutralna; tu potrzebujemy niezerowych). */
function planeWithProp() {
  return createTestPlane({
    propEffect: { yawBiasMaxRadS: -0.5, rollBiasMaxRadS: -0.3, fadeKmh: 200 },
  });
}

function ratesAt(iasMs: number, throttle: number): PropRates {
  const plane = planeWithProp();
  const state = createPlaneState();
  state.iasMs = iasMs;
  state.throttle = throttle;
  const out: PropRates = { yaw: 0, roll: 0 };
  return propEffectRates(state, plane, out);
}

describe('efekt śmigła R3 — propEffectRates', () => {
  it('IAS = 0, pełny gaz → maksymalny bias (znak z konfiguracji)', () => {
    const r = ratesAt(0, 1);
    expect(r.yaw).toBeCloseTo(-0.5, 6);
    expect(r.roll).toBeCloseTo(-0.3, 6);
  });

  it('powyżej fadeKmh → zero (brak ciągłego trymowania w locie poziomym)', () => {
    const r = ratesAt(250 / MS_TO_KMH, 1); // 250 km/h > fade 200
    expect(r.yaw).toBeCloseTo(0, 10);
    expect(r.roll).toBeCloseTo(0, 10);
  });

  it('dokładnie na fadeKmh → zero', () => {
    const r = ratesAt(200 / MS_TO_KMH, 1);
    expect(r.yaw).toBeCloseTo(0, 6);
    expect(r.roll).toBeCloseTo(0, 6);
  });

  it('zanik KWADRATOWY z prędkością', () => {
    // na połowie fade speedFrac = 0.5 → factor = 0.25 (kwadrat) przy pełnym gazie
    const r = ratesAt(100 / MS_TO_KMH, 1);
    expect(r.yaw).toBeCloseTo(-0.5 * 0.25, 5);
    expect(r.roll).toBeCloseTo(-0.3 * 0.25, 5);
  });

  it('skaluje się liniowo z gazem', () => {
    const full = ratesAt(0, 1);
    const half = ratesAt(0, 0.5);
    expect(half.yaw).toBeCloseTo(full.yaw * 0.5, 6);
    expect(half.roll).toBeCloseTo(full.roll * 0.5, 6);
  });

  it('zero gazu → zero biasu', () => {
    const r = ratesAt(0, 0);
    expect(r.yaw).toBeCloseTo(0, 10);
    expect(r.roll).toBeCloseTo(0, 10);
  });
});
