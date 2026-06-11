import { describe, expect, it } from 'vitest';
import { inducedDragFactor } from '../planes/loader';
import { createPlaneState } from '../physics/state';
import { createTestPlane } from '../testing/fixtures';
import { dragForce } from './drag';

// Fikstura: S=20 m², cd0=0.02, K=1/(π·0.8·6). Lot V=100: q=6125 Pa.
const PLANE = createTestPlane();
const Q_PA = 6125;

describe('opór', () => {
  it('Cl=0 → czysty opór pasożytniczy D = q·S·Cd0, przeciwnie do v̂', () => {
    const state = createPlaneState();
    state.velocity.set(0, 0, 100);
    const { force } = dragForce(state, PLANE, Q_PA, 0);
    expect(force.x).toBeCloseTo(0, 9);
    expect(force.y).toBeCloseTo(0, 9);
    expect(force.z).toBeCloseTo(-Q_PA * PLANE.wingAreaM2 * PLANE.cd0, 6);
  });

  it('biegunowa: Cd = Cd0 + K·Cl² co do wartości', () => {
    const state = createPlaneState();
    state.velocity.set(0, 0, 100);
    const cl = 1;
    const { force } = dragForce(state, PLANE, Q_PA, cl);
    const expectedCd = PLANE.cd0 + inducedDragFactor(PLANE) * cl * cl;
    expect(force.length()).toBeCloseTo(Q_PA * PLANE.wingAreaM2 * expectedCd, 6);
  });

  it('kierunek dokładnie przeciwny do prędkości (dowolny kierunek lotu)', () => {
    const state = createPlaneState();
    state.velocity.set(30, 40, 0); // |v| = 50
    const { force } = dragForce(state, PLANE, Q_PA, 0.5);
    const cosAngle = force.dot(state.velocity) / (force.length() * state.velocity.length());
    expect(cosAngle).toBeCloseTo(-1, 12);
  });

  it('V=0 → zero siły, bez NaN', () => {
    const state = createPlaneState();
    const { force } = dragForce(state, PLANE, 0, 0);
    expect(force.length()).toBe(0);
  });
});
