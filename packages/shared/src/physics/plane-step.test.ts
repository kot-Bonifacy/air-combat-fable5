import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { FIXED_DT_S, PHYSICS_HZ } from '../constants';
import { createTestPlane } from '../testing/fixtures';
import { nDemandForPitchRate, stepPlane } from './plane-step';
import { createPlaneState } from './state';
import { validatePlaneState } from './nan-guard';

const PLANE = createTestPlane();

describe('stepPlane — tick fizyki samolotu', () => {
  it('lot poziomy z n=1: wysokość stała co do ułamka metra przez 30 s', () => {
    const state = createPlaneState();
    state.position.set(0, 1000, 0);
    state.velocity.set(0, 0, 100);
    state.throttle = 0.6;

    for (let i = 0; i < 30 * PHYSICS_HZ; i++) {
      stepPlane(state, PLANE, 1, FIXED_DT_S);
      validatePlaneState(state, 'stepPlane lot poziomy');
    }
    // n=1 zeruje pionową wypadkową w każdym ticku — tor pozostaje poziomy
    expect(Math.abs(state.position.y - 1000)).toBeLessThan(0.5);
    expect(state.stalled).toBe(false);
    expect(state.loadFactor).toBeCloseTo(1, 6);
    expect(state.iasMs).toBeGreaterThan(0);
  });

  it('pola pochodne: IAS < TAS na wysokości', () => {
    const state = createPlaneState();
    state.position.set(0, 6000, 0);
    state.velocity.set(0, 0, 150);
    const result = stepPlane(state, PLANE, 1, FIXED_DT_S);
    expect(result.tasMs).toBeCloseTo(150, 9);
    expect(state.iasMs).toBeLessThan(150 * 0.8);
  });

  it('nDemandForPitchRate: bez inputu w locie poziomym → n=1; ciągnięcie → n>1', () => {
    const state = createPlaneState();
    state.velocity.set(0, 0, 100);
    expect(nDemandForPitchRate(state, 0)).toBeCloseTo(1, 9);
    // ω=0.0981 rad/s przy V=100: n = 1 + ω·V/g = 2
    expect(nDemandForPitchRate(state, 0.0981)).toBeCloseTo(2, 6);
  });

  it('nDemandForPitchRate w przechyleniu 90°: składowa grawitacyjna znika', () => {
    const state = createPlaneState();
    state.velocity.set(0, 0, 100);
    state.orientation.setFromAxisAngle(new Vector3(0, 0, 1), -Math.PI / 2);
    expect(nDemandForPitchRate(state, 0)).toBeCloseTo(0, 9);
  });
});
