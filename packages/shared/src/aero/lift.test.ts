import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { GRAVITY_MS2 } from '../constants';
import { createPlaneState } from '../physics/state';
import { createTestPlane } from '../testing/fixtures';
import { liftDirection, liftForce } from './lift';

// Fikstura: m=2000 kg, S=20 m², clMax=1.5, Clα=5 → W=19620 N.
// Lot poziomy V=100 m/s na poziomie morza: q=6125 Pa, qS=122 500 N.
const PLANE = createTestPlane();
const Q_PA = 6125;
const WEIGHT_N = PLANE.massKg * GRAVITY_MS2;

function levelFlightState(speedMs = 100): ReturnType<typeof createPlaneState> {
  const state = createPlaneState();
  state.velocity.set(0, 0, speedMs);
  return state;
}

describe('siła nośna', () => {
  it('lot poziomy, n=1 → dokładnie m·g w górę', () => {
    const result = liftForce(levelFlightState(), PLANE, 1, Q_PA);
    expect(result.contribution.force.x).toBeCloseTo(0, 9);
    expect(result.contribution.force.y).toBeCloseTo(WEIGHT_N, 6);
    expect(result.contribution.force.z).toBeCloseTo(0, 9);
    expect(result.nActual).toBeCloseTo(1, 12);
    expect(result.stalled).toBe(false);
  });

  it('L = q·S·Cl co do wartości; Cl = n·m·g/(q·S)', () => {
    const result = liftForce(levelFlightState(), PLANE, 2, Q_PA);
    const expectedCl = (2 * WEIGHT_N) / (Q_PA * PLANE.wingAreaM2);
    expect(result.cl).toBeCloseTo(expectedCl, 12);
    expect(result.contribution.force.length()).toBeCloseTo(Q_PA * PLANE.wingAreaM2 * expectedCl, 6);
  });

  it('żądanie ponad clMax → obcięcie do q·S·clMax i flaga stall', () => {
    const result = liftForce(levelFlightState(), PLANE, 10, Q_PA);
    expect(result.stalled).toBe(true);
    expect(result.cl).toBe(PLANE.clMax);
    expect(result.clRequired).toBeGreaterThan(PLANE.clMax);
    expect(result.contribution.force.y).toBeCloseTo(Q_PA * PLANE.wingAreaM2 * PLANE.clMax, 6);
  });

  it('α_implied = Cl/Clα', () => {
    const result = liftForce(levelFlightState(), PLANE, 1, Q_PA);
    expect(result.alphaImpliedRad).toBeCloseTo(result.cl / PLANE.clAlphaPerRad, 12);
  });

  it('lot odwrócony (roll 180°): n=1 ciągnie w stronę grzbietu, czyli w dół', () => {
    const state = levelFlightState();
    state.orientation.setFromAxisAngle(new Vector3(0, 0, 1), Math.PI);
    const result = liftForce(state, PLANE, 1, Q_PA);
    expect(result.contribution.force.y).toBeCloseTo(-WEIGHT_N, 6);
    expect(result.nActual).toBeCloseTo(1, 12); // n liczone wzdłuż liftDir, nie osi świata
  });

  it('przechylenie 90°: nośna pozioma, prostopadła do prędkości', () => {
    const state = levelFlightState();
    state.orientation.setFromAxisAngle(new Vector3(0, 0, 1), -Math.PI / 2);
    const result = liftForce(state, PLANE, 1, Q_PA);
    expect(Math.abs(result.contribution.force.y)).toBeLessThan(1e-6);
    expect(result.contribution.force.length()).toBeCloseTo(WEIGHT_N, 6);
    expect(Math.abs(result.contribution.force.dot(state.velocity))).toBeLessThan(1e-6);
  });

  it('ujemne n (push) → siła w stronę brzucha', () => {
    const result = liftForce(levelFlightState(), PLANE, -1, Q_PA);
    expect(result.contribution.force.y).toBeCloseTo(-WEIGHT_N, 6);
    expect(result.cl).toBeLessThan(0);
  });

  it('kierunek zdegenerowany (lot pionowo w górę, up ∥ v̂) → zero siły, bez NaN', () => {
    const state = createPlaneState();
    state.velocity.set(0, 100, 0); // identyczność: up body = +Y świata = v̂
    const result = liftForce(state, PLANE, 1, Q_PA);
    expect(result.contribution.force.length()).toBe(0);
    expect(Number.isFinite(result.nActual)).toBe(true);
  });

  it('q=0, n=0 → zero bez NaN; q=0, n≠0 → stalled (żądanie niewykonalne)', () => {
    const state = createPlaneState();
    const zero = liftForce(state, PLANE, 0, 0);
    expect(zero.cl).toBe(0);
    expect(zero.stalled).toBe(false);
    expect(Number.isFinite(zero.alphaImpliedRad)).toBe(true);

    const impossible = liftForce(state, PLANE, 1, 0);
    expect(impossible.stalled).toBe(true);
    expect(impossible.cl).toBe(PLANE.clMax); // obcięty, używalny dalej (opór indukowany)
  });

  it('liftDirection: false przy V≈0', () => {
    const state = createPlaneState();
    expect(liftDirection(state, new Vector3())).toBe(false);
  });
});
