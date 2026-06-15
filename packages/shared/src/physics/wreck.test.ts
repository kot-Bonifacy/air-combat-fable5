import { describe, expect, it } from 'vitest';
import { FIXED_DT_S, GRAVITY_MS2 } from '../constants';
import type { PilotDemands } from '../instructor/instructor';
import { createTestPlane } from '../testing/fixtures';
import { applyWreckControl, createSimPlane, stepWreck } from './pilot-step';

// Fizyka spadającego wraku (zniszczenie w powietrzu): silnik martwy (throttle 0),
// lotki pełne, ster wysokości osłabiony, ster kierunku martwy.

describe('wrak: applyWreckControl', () => {
  const plane = createTestPlane({ wreck: { baseLoadG: 0.35, pitchAuthority: 0.25 } });

  it('lotki pełne, pitch wokół baseLoadG, yaw wyzerowany', () => {
    const out: PilotDemands = { nDemandG: 0, rollRateRadS: 0, yawRateRadS: 0 };
    applyWreckControl({ nDemandG: 5, rollRateRadS: 1.2, yawRateRadS: 0.5 }, plane, out);
    expect(out.rollRateRadS).toBe(1.2); // lotki bez zmian
    expect(out.nDemandG).toBeCloseTo(0.35 + (5 - 1) * 0.25, 12); // baza + ćwiartka nadwyżki = 1.35
    expect(out.yawRateRadS).toBe(0); // ster kierunku nie działa
  });

  it('pitchAuthority 0 → ster wysokości martwy: zawsze baseLoadG (< 1 → opada)', () => {
    const dead = createTestPlane({ wreck: { baseLoadG: 0.35, pitchAuthority: 0 } });
    const out: PilotDemands = { nDemandG: 0, rollRateRadS: 0, yawRateRadS: 0 };
    applyWreckControl({ nDemandG: 8, rollRateRadS: 0, yawRateRadS: 0 }, dead, out);
    expect(out.nDemandG).toBe(0.35);
  });
});

describe('wrak: stepWreck', () => {
  function levelWreck() {
    const sim = createSimPlane(1);
    sim.state.position.set(0, 2000, 0);
    sim.state.velocity.set(0, 0, 140); // nos +Z (orientacja identyczność), lot poziomy
    sim.state.iasMs = 140;
    sim.state.throttle = 1; // niby silnik chodzi — stepWreck musi to wyzerować
    return sim;
  }

  it('wymusza throttle 0 (martwy silnik → brak ciągu)', () => {
    const sim = levelWreck();
    stepWreck(sim, createTestPlane(), { nDemandG: 1, rollRateRadS: 0, yawRateRadS: 0 }, FIXED_DT_S);
    expect(sim.state.throttle).toBe(0);
  });

  it('bez ciągu wrak opada i traci energię mechaniczną, stan pozostaje skończony', () => {
    const sim = levelWreck();
    const plane = createTestPlane();
    // energia mechaniczna (kinetyczna + potencjalna): bez ciągu opór może ją tylko zjadać
    const energyJ = (): number =>
      0.5 * plane.massKg * sim.state.velocity.lengthSq() +
      plane.massKg * GRAVITY_MS2 * sim.state.position.y;
    const y0 = sim.state.position.y;
    const e0 = energyJ();
    const demands: PilotDemands = { nDemandG: 1, rollRateRadS: 0, yawRateRadS: 0 };
    for (let i = 0; i < 600; i++) stepWreck(sim, plane, demands, FIXED_DT_S); // 10 s
    expect(Number.isFinite(sim.state.position.y)).toBe(true);
    expect(sim.state.position.y).toBeLessThan(y0); // opada (baseLoadG < 1 → nie utrzymuje wysokości)
    expect(energyJ()).toBeLessThan(e0); // brak ciągu → energia maleje (opór ją zjada)
  });

  it('lotki działają — zadany roll przechyla wrak', () => {
    const sim = levelWreck();
    const plane = createTestPlane();
    const demands: PilotDemands = { nDemandG: 1, rollRateRadS: 1.0, yawRateRadS: 0 };
    for (let i = 0; i < 30; i++) stepWreck(sim, plane, demands, FIXED_DT_S);
    expect(sim.state.angularRates.roll).toBeGreaterThan(0); // przechył reaguje na lotki
  });
});
