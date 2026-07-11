import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { airDensityKgM3 } from '../physics/atmosphere';
import { createPlaneState } from '../physics/state';
import { createTestPlane } from '../testing/fixtures';
import { enginePowerW, thrustForce } from './thrust';

// Fikstura: P0=600 kW, η=0.8, T_static=10 kN, h_fth=4000 m.
const PLANE = createTestPlane();

describe('ciąg', () => {
  it('V=0, pełny gaz → clamp do ciągu statycznego (bez osobliwości T=P/V)', () => {
    const state = createPlaneState();
    state.throttle = 1;
    const { force } = thrustForce(state, PLANE);
    expect(force.z).toBeCloseTo(PLANE.staticThrustN, 9);
    expect(Number.isFinite(force.length())).toBe(true);
  });

  it('w locie: T = η·P·throttle/V, proporcjonalny do throttle', () => {
    const state = createPlaneState();
    state.velocity.set(0, 0, 100);
    state.throttle = 1;
    expect(thrustForce(state, PLANE).force.z).toBeCloseTo(
      (PLANE.propEfficiency * PLANE.enginePowerW) / 100,
      9,
    );
    state.throttle = 0.5;
    expect(thrustForce(state, PLANE).force.z).toBeCloseTo(
      (PLANE.propEfficiency * PLANE.enginePowerW * 0.5) / 100,
      9,
    );
  });

  it('throttle=0 → zero ciągu', () => {
    const state = createPlaneState();
    state.velocity.set(0, 0, 100);
    expect(thrustForce(state, PLANE).force.length()).toBe(0);
  });

  it('WEP (fizyka v2 R2): moc = P·(1+wepBoostFrac) tylko przy aktywnym dopalaczu', () => {
    const wepPlane = createTestPlane({ wepBoostFrac: 0.2 });
    expect(enginePowerW(wepPlane, 0)).toBeCloseTo(wepPlane.enginePowerW, 9); // domyślnie bez WEP
    expect(enginePowerW(wepPlane, 0, false)).toBeCloseTo(wepPlane.enginePowerW, 9); // moc bojowa
    expect(enginePowerW(wepPlane, 0, true)).toBeCloseTo(wepPlane.enginePowerW * 1.2, 9); // +20% na WEP
    // samolot bez WEP (wepBoostFrac=0, np. Zero) — bit WEP bez efektu na moc
    expect(enginePowerW(PLANE, 0, true)).toBeCloseTo(PLANE.enginePowerW, 9);
  });

  it('WEP: ciąg w locie rośnie o wepBoostFrac, gdy state.wepActive', () => {
    const wepPlane = createTestPlane({ wepBoostFrac: 0.2 });
    const state = createPlaneState();
    state.velocity.set(0, 0, 100);
    state.throttle = 1;
    const mil = thrustForce(state, wepPlane).force.z;
    state.wepActive = true;
    const wep = thrustForce(state, wepPlane).force.z;
    expect(wep).toBeCloseTo(mil * 1.2, 6); // +20% ciągu przy tej samej prędkości i gazie
  });

  it('moc: pełna do h_fth, wyżej spada z gęstością (sprężarka)', () => {
    expect(enginePowerW(PLANE, 0)).toBe(PLANE.enginePowerW);
    expect(enginePowerW(PLANE, PLANE.fullThrottleHeightM)).toBe(PLANE.enginePowerW);
    const expectedRatio =
      airDensityKgM3(6000) / airDensityKgM3(PLANE.fullThrottleHeightM);
    expect(enginePowerW(PLANE, 6000)).toBeCloseTo(PLANE.enginePowerW * expectedRatio, 6);
    expect(enginePowerW(PLANE, 6000)).toBeLessThan(PLANE.enginePowerW);
  });

  it('powerCurve (R1 §6.6): moc = P0·frac(h), interpolacja + wartości brzegowe', () => {
    const curved = createTestPlane({
      powerCurve: [
        [0, 1],
        [4000, 1.2],
        [8000, 0.5],
      ],
    });
    expect(enginePowerW(curved, 0)).toBeCloseTo(curved.enginePowerW, 9);
    expect(enginePowerW(curved, 2000)).toBeCloseTo(curved.enginePowerW * 1.1, 6);
    expect(enginePowerW(curved, 4000)).toBeCloseTo(curved.enginePowerW * 1.2, 9);
    // poza prawym końcem — wartość brzegowa (bez ekstrapolacji w dół)
    expect(enginePowerW(curved, 12_000)).toBeCloseTo(curved.enginePowerW * 0.5, 9);
    // krzywa ma pierwszeństwo przed prostym modelem (h_fth ignorowane)
    expect(enginePowerW(curved, 6000)).toBeCloseTo(curved.enginePowerW * (1.2 - (0.7 * 2000) / 4000), 6);
  });

  it('powerCurve nieobecne (fallback): zachowanie identyczne ze starym modelem', () => {
    // PLANE (fikstura) nie ma powerCurve — asercje „moc: pełna do h_fth" wyżej
    // pilnują fallbacku; tu tylko jawny dowód, że pole jest opcjonalne
    expect(PLANE.powerCurve).toBeUndefined();
  });

  it('kierunek wzdłuż osi nosa (nos w górę → ciąg w górę)', () => {
    const state = createPlaneState();
    state.throttle = 1;
    state.velocity.set(0, 100, 0);
    // nos w górę = obrót o 90° wokół −X (konwencja pitch z loop.ts)
    state.orientation.setFromAxisAngle(new Vector3(-1, 0, 0), Math.PI / 2);
    const { force } = thrustForce(state, PLANE);
    expect(force.x).toBeCloseTo(0, 9);
    expect(force.y).toBeCloseTo((PLANE.propEfficiency * PLANE.enginePowerW) / 100, 6);
    expect(force.z).toBeCloseTo(0, 9);
  });
});
