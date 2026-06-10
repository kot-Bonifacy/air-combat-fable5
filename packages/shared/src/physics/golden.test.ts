import { Quaternion } from 'three';
import { describe, expect, it } from 'vitest';
import { FIXED_DT_S, GRAVITY_MS2, PHYSICS_HZ } from '../constants';
import { gravityForce, sumForces } from './forces';
import { integrateStep } from './loop';
import { createPlaneState } from './state';

// Złote testy analityczne (docs/phases/faza-01.md). Tolerancje są częścią
// kontraktu — refaktoryzacja, która je psuje, psuje grę.

const MASS_KG = 100;

describe('złote testy — integrator', () => {
  it('spadek swobodny: h(t) = h0 − ½gt² z tolerancją < 0.1% po 5 s', () => {
    const state = createPlaneState();
    const h0 = 1000;
    state.position.set(0, h0, 0);
    const total = sumForces([gravityForce(MASS_KG)]);

    const seconds = 5;
    for (let i = 0; i < seconds * PHYSICS_HZ; i++) {
      integrateStep(state, total, MASS_KG, FIXED_DT_S);
    }

    const analytic = h0 - 0.5 * GRAVITY_MS2 * seconds * seconds;
    const relativeError = Math.abs(state.position.y - analytic) / Math.abs(analytic);
    expect(relativeError).toBeLessThan(0.001);
  });

  it('rzut ukośny: zasięg zgodny z wzorem analitycznym < 0.1%', () => {
    const state = createPlaneState();
    const vx = 100;
    const vy = 100;
    state.velocity.set(vx, vy, 0);
    const total = sumForces([gravityForce(MASS_KG)]);

    let prevX = 0;
    let prevY = 0;
    for (let i = 0; i < 100 * PHYSICS_HZ; i++) {
      prevX = state.position.x;
      prevY = state.position.y;
      integrateStep(state, total, MASS_KG, FIXED_DT_S);
      if (i > 0 && state.position.y < 0) break;
    }
    expect(state.position.y).toBeLessThan(0);

    // liniowa interpolacja przecięcia y=0 między ostatnimi dwoma tickami
    const alpha = prevY / (prevY - state.position.y);
    const range = prevX + alpha * (state.position.x - prevX);

    const analyticRange = (2 * vx * vy) / GRAVITY_MS2;
    const relativeError = Math.abs(range - analyticRange) / analyticRange;
    expect(relativeError).toBeLessThan(0.001);
  });

  it('kwaternion: 4 × obrót o 90° wraca do identyczności, norma nie dryfuje', () => {
    const state = createPlaneState();
    state.angularRates.pitch = Math.PI / 2; // 90°/s → pełny obrót w 4 s
    const total = sumForces([]);

    for (let i = 0; i < 4 * PHYSICS_HZ; i++) {
      integrateStep(state, total, MASS_KG, FIXED_DT_S);
    }

    // q i −q to ta sama rotacja — porównujemy |dot| z identycznością
    const dot = Math.abs(state.orientation.dot(new Quaternion()));
    expect(dot).toBeCloseTo(1, 9);
    expect(state.orientation.length()).toBeCloseTo(1, 12);
  });

  it('norma kwaternionu stabilna po 60 000 ticków mieszanych rotacji', () => {
    const state = createPlaneState();
    state.angularRates.pitch = 0.7;
    state.angularRates.roll = 1.3;
    state.angularRates.yaw = -0.4;
    const total = sumForces([]);

    for (let i = 0; i < 60_000; i++) {
      integrateStep(state, total, MASS_KG, FIXED_DT_S);
    }
    expect(state.orientation.length()).toBeCloseTo(1, 12);
  });
});
