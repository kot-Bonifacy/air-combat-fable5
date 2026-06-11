import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { FIXED_DT_S, GRAVITY_MS2, SEA_LEVEL_AIR_DENSITY_KGM3 } from '../constants';
import { SPITFIRE_MK1 } from '../planes/loader';
import { airDensityKgM3, dynamicPressurePa } from './atmosphere';
import {
  clampLoadFactorG,
  dampSideslip,
  maxRollRateRadS,
  nAvailG,
  weathervaneRates,
} from './envelope';
import { createPlaneState, type AngularRates } from './state';

const plane = SPITFIRE_MK1;
const DEG = Math.PI / 180;
const X_AXIS = new Vector3(1, 0, 0);
const Y_AXIS = new Vector3(0, 1, 0);
const Z_AXIS = new Vector3(0, 0, 1);

function qAt(tasMs: number, altitudeM = 0): number {
  return dynamicPressurePa(airDensityKgM3(altitudeM), tasMs);
}

describe('koperta — dostępne przeciążenie (6.1)', () => {
  it('n_avail skaluje się z V² (2× prędkość = 4× n)', () => {
    const n1 = nAvailG(qAt(60), plane);
    const n2 = nAvailG(qAt(120), plane);
    expect(n2 / n1).toBeCloseTo(4, 6);
  });

  it('n_avail = 1 dokładnie przy prędkości, gdzie nośna maksymalna równa się ciężarowi', () => {
    // q·S·clMax = m·g → V = sqrt(2·m·g/(ρ·S·clMax))
    const v = Math.sqrt(
      (2 * plane.massKg * GRAVITY_MS2) /
        (SEA_LEVEL_AIR_DENSITY_KGM3 * plane.wingAreaM2 * plane.clMax),
    );
    expect(nAvailG(qAt(v), plane)).toBeCloseTo(1, 3);
  });

  it('przy dużej prędkości clamp do limitu strukturalnego nMaxG/nMinG', () => {
    const q = qAt(200); // ~720 km/h — n_avail >> 8
    expect(clampLoadFactorG(50, q, plane)).toBe(plane.nMaxG);
    expect(clampLoadFactorG(-50, q, plane)).toBe(plane.nMinG);
  });

  it('przy małej prędkości clamp do n_avail (fizyka przed strukturą)', () => {
    const q = qAt(50);
    const avail = nAvailG(q, plane);
    expect(avail).toBeLessThan(plane.nMaxG);
    expect(clampLoadFactorG(8, q, plane)).toBeCloseTo(avail, 9);
    expect(clampLoadFactorG(-8, q, plane)).toBeCloseTo(-avail, 9);
  });

  it('żądanie wewnątrz limitów przechodzi bez zmian', () => {
    expect(clampLoadFactorG(2.5, qAt(150), plane)).toBe(2.5);
  });
});

describe('koperta — krzywa roll rate (6.2)', () => {
  it('w punktach krzywej zwraca dokładnie wartości z konfiguracji', () => {
    for (const [iasKmh, degS] of plane.rollRateCurve) {
      expect(maxRollRateRadS(iasKmh / 3.6, plane)).toBeCloseTo(degS * DEG, 9);
    }
  });

  it('między punktami interpoluje liniowo', () => {
    // środek między [240,80] a [320,75] → 77.5 °/s
    expect(maxRollRateRadS(280 / 3.6, plane)).toBeCloseTo(77.5 * DEG, 9);
  });

  it('poza zakresem zwraca wartości brzegowe (bez ekstrapolacji)', () => {
    const first = plane.rollRateCurve[0];
    const last = plane.rollRateCurve[plane.rollRateCurve.length - 1];
    if (first === undefined || last === undefined) throw new Error('pusta krzywa');
    expect(maxRollRateRadS(10 / 3.6, plane)).toBeCloseTo(first[1] * DEG, 9);
    expect(maxRollRateRadS(900 / 3.6, plane)).toBeCloseTo(last[1] * DEG, 9);
  });
});

describe('koperta — weathervaning (6.4)', () => {
  const rates: AngularRates = { pitch: 0, roll: 0, yaw: 0 };

  it('nos 0.1 rad nad torem, α=0 → pitch rate ≈ −0.1/alignTau (nos w dół)', () => {
    const state = createPlaneState();
    state.velocity.set(0, 0, 100);
    state.orientation.setFromAxisAngle(X_AXIS, -0.1); // nos w górę (pitch>0 = obrót −X)
    weathervaneRates(state, 0, plane, rates);
    expect(rates.pitch).toBeCloseTo(-0.1 / plane.alignTauS, 3);
    expect(rates.yaw).toBeCloseTo(0, 6);
    expect(rates.roll).toBe(0);
  });

  it('nos na torze, α=0.05 → pitch rate dodatni (nos ma siedzieć α nad torem)', () => {
    const state = createPlaneState();
    state.velocity.set(0, 0, 100);
    weathervaneRates(state, 0.05, plane, rates);
    expect(rates.pitch).toBeCloseTo(0.05 / plane.alignTauS, 3);
  });

  it('nos 0.1 rad w prawo od toru → yaw rate ujemny (nos wraca w lewo)', () => {
    const state = createPlaneState();
    state.velocity.set(0, 0, 100);
    state.orientation.setFromAxisAngle(Y_AXIS, -0.1); // nos w prawo (yaw>0 = obrót −Y)
    weathervaneRates(state, 0, plane, rates);
    expect(rates.yaw).toBeCloseTo(-0.1 / plane.alignTauS, 3);
    expect(rates.pitch).toBeCloseTo(0, 6);
  });

  it('czyste przechylenie nie generuje żadnych poprawek', () => {
    const state = createPlaneState();
    state.velocity.set(0, 0, 100);
    state.orientation.setFromAxisAngle(Z_AXIS, 1.2);
    weathervaneRates(state, 0, plane, rates);
    expect(rates.pitch).toBeCloseTo(0, 9);
    expect(rates.yaw).toBeCloseTo(0, 9);
  });

  it('lot pionowy (up ∥ v̂) — zdegenerowany, zwraca zera bez NaN', () => {
    const state = createPlaneState();
    state.velocity.set(0, 100, 0);
    weathervaneRates(state, 0.05, plane, rates);
    expect(rates.pitch).toBe(0);
    expect(rates.yaw).toBe(0);
  });
});

describe('koperta — koordynacja yaw / sideslip (6.3)', () => {
  it('wygasza składową boczną nie dodając energii (|v| nie rośnie)', () => {
    const state = createPlaneState();
    state.velocity.set(3, 0, 100); // lekki ślizg w lewo (+X = lewe skrzydło)
    const speedBefore = state.velocity.length();
    dampSideslip(state, plane, FIXED_DT_S);
    expect(state.velocity.length()).toBeLessThanOrEqual(speedBefore + 1e-12);
    expect(Math.abs(state.velocity.x)).toBeLessThan(3);
    expect(state.velocity.x).toBeGreaterThan(0); // znak zachowany, gaśnie stopniowo
  });

  it('korekta na tick ograniczona autorytetem siły bocznej (sideslipMaxAccelG)', () => {
    const state = createPlaneState();
    state.velocity.set(30, 0, 100); // absurdalny ślizg — żądana korekta >> limit
    const xBefore = state.velocity.x;
    dampSideslip(state, plane, FIXED_DT_S);
    const maxDelta = plane.sideslipMaxAccelG * GRAVITY_MS2 * FIXED_DT_S;
    expect(xBefore - state.velocity.x).toBeCloseTo(maxDelta, 9);
  });

  it('umiarkowany ślizg znika w ~3 s (tor idzie za nosem)', () => {
    const state = createPlaneState();
    state.velocity.set(8, 0, 100);
    for (let i = 0; i < 180; i++) dampSideslip(state, plane, FIXED_DT_S);
    const sideslipDeg = (Math.atan2(state.velocity.x, state.velocity.z) * 180) / Math.PI;
    expect(Math.abs(sideslipDeg)).toBeLessThan(0.5);
  });

  it('prędkość niemal czysto boczna nie produkuje NaN', () => {
    const state = createPlaneState();
    state.velocity.set(5, 0, 1e-7);
    for (let i = 0; i < 600; i++) dampSideslip(state, plane, FIXED_DT_S);
    expect(Number.isFinite(state.velocity.x)).toBe(true);
    expect(Number.isFinite(state.velocity.z)).toBe(true);
  });
});
