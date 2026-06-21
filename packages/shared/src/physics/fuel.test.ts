import { describe, expect, it } from 'vitest';
import { FIXED_DT_S } from '../constants';
import { thrustForce } from '../aero/thrust';
import type { PilotDemands } from '../instructor/instructor';
import { createTestPlane } from '../testing/fixtures';
import { createPlaneState } from './state';
import { createSimPlane, pilotStep, stepWreck } from './pilot-step';

// Paliwo: spala się proporcjonalnie do gazu (pełny bak przy 100% starcza na
// plane.fuelEnduranceFullThrottleS sekund); po wyczerpaniu silnik gaśnie (T=0).
// Zużycie zależy WYŁĄCZNIE od całki gazu po czasie — niezależne od trajektorii.

/** Sim w locie poziomym na dużej wysokości; krótki bak (10 s) dla szybkich asercji. */
function levelSim(throttle: number) {
  const sim = createSimPlane(1);
  sim.state.position.set(0, 3000, 0);
  sim.state.velocity.set(0, 0, 140); // nos +Z (orientacja = identyczność)
  sim.state.iasMs = 140;
  sim.state.throttle = throttle;
  return sim;
}

const ENDURANCE_S = 10;
const plane = createTestPlane({ fuelEnduranceFullThrottleS: ENDURANCE_S });
const neutral = (): PilotDemands => ({ nDemandG: 1, rollRateRadS: 0, yawRateRadS: 0 });

describe('paliwo: zużycie w pilotStep', () => {
  it('pełny bak na 100% gazu opróżnia się dokładnie po fuelEnduranceFullThrottleS s', () => {
    const sim = levelSim(1);
    const steps = Math.round((ENDURANCE_S * 0.99) / FIXED_DT_S); // tuż przed wyczerpaniem
    for (let i = 0; i < steps; i++) pilotStep(sim, plane, neutral(), FIXED_DT_S);
    expect(sim.state.fuelFrac).toBeGreaterThan(0); // jeszcze leci
    // dopal resztę z zapasem — bak musi sięgnąć 0 i tam zostać (clamp, bez wartości ujemnych)
    for (let i = 0; i < steps; i++) pilotStep(sim, plane, neutral(), FIXED_DT_S);
    expect(sim.state.fuelFrac).toBe(0);
  });

  it('zużycie proporcjonalne do gazu: 50% gazu pali o połowę wolniej', () => {
    const sim = levelSim(0.5);
    const halfTimeSteps = Math.round((ENDURANCE_S / 2) / FIXED_DT_S); // 5 s
    for (let i = 0; i < halfTimeSteps; i++) pilotStep(sim, plane, neutral(), FIXED_DT_S);
    // 0,5 gazu przez 5 s = 0,25 baku zużyte → ~0,75 zostaje
    expect(sim.state.fuelFrac).toBeCloseTo(0.75, 3);
  });

  it('wrak nie pali paliwa (stepWreck wymusza throttle 0)', () => {
    const sim = levelSim(1);
    for (let i = 0; i < 120; i++) stepWreck(sim, plane, neutral(), FIXED_DT_S); // 2 s
    expect(sim.state.fuelFrac).toBe(1);
  });
});

describe('paliwo: pusty bak gasi silnik (thrustForce)', () => {
  it('fuelFrac > 0 → ciąg dodatni na pełnym gazie', () => {
    const state = createPlaneState();
    state.throttle = 1;
    state.velocity.set(0, 0, 100);
    expect(thrustForce(state, plane).force.length()).toBeGreaterThan(0);
  });

  it('fuelFrac = 0 → ciąg zerowy mimo pełnego gazu (silnik stanął)', () => {
    const state = createPlaneState();
    state.throttle = 1;
    state.fuelFrac = 0;
    state.velocity.set(0, 0, 100);
    expect(thrustForce(state, plane).force.length()).toBe(0);
  });
});
