import { Quaternion } from 'three';
import { describe, expect, it } from 'vitest';
import type { PilotDemands } from '../instructor/instructor';
import { createTestPlane } from '../testing/fixtures';
import { createSimPlane, pilotStep, type PilotTickResult } from './pilot-step';
import { FIXED_DT_S } from '../constants';

// Skutki uszkodzeń w pilotStep (faza 22): degradacja osiągów względem sprawnego samolotu.
// Niezmiennik tożsamości (sprawny == jak dawniej) pilnują złote testy i istniejące suity —
// tu sprawdzamy, że poziomy stref RZECZYWIŚCIE pogarszają lot.

const plane = createTestPlane();

/** Sim w warunkach przelotowych (1000 m, 120 m/s wzdłuż +Z), z opcjonalnymi poziomami uszkodzeń. */
function makeSim(levels: number[] | null) {
  const sim = createSimPlane(123);
  sim.state.position.set(0, 1000, 0);
  sim.state.velocity.set(0, 0, 120);
  sim.state.orientation.copy(new Quaternion()); // forward = +Z
  sim.state.iasMs = 120;
  sim.state.throttle = 1;
  sim.damageLevels = levels;
  return sim;
}

const cruise: PilotDemands = { nDemandG: 1, rollRateRadS: 0, yawRateRadS: 0 };

function thrustMag(tick: PilotTickResult): number {
  const c = tick.contributions.find((x) => x.name === 'ciąg');
  return c ? c.force.length() : 0;
}

const lvl = (engine = 0, cockpit = 0, tank = 0, wingL = 0, wingR = 0, tail = 0): number[] => [
  engine,
  cockpit,
  tank,
  wingL,
  wingR,
  tail,
];

describe('pilotStep — skutki uszkodzeń', () => {
  it('zniszczony silnik → ciąg spada do ~0 (da się tylko szybować)', () => {
    const healthy = thrustMag(pilotStep(makeSim(null), plane, cruise, FIXED_DT_S));
    const dead = thrustMag(pilotStep(makeSim(lvl(3)), plane, cruise, FIXED_DT_S));
    expect(healthy).toBeGreaterThan(1000);
    expect(dead).toBeLessThan(1e-6);
  });

  it('uszkodzony silnik poziom 1/2 → ciąg malejący progowo', () => {
    const full = thrustMag(pilotStep(makeSim(lvl(0)), plane, cruise, FIXED_DT_S));
    const mid = thrustMag(pilotStep(makeSim(lvl(1)), plane, cruise, FIXED_DT_S));
    const low = thrustMag(pilotStep(makeSim(lvl(2)), plane, cruise, FIXED_DT_S));
    expect(mid).toBeCloseTo(full * 0.6, 3);
    expect(low).toBeCloseTo(full * 0.3, 3);
  });

  it('zniszczone prawe skrzydło → stały bias roll w prawo (gracz musi kontrować)', () => {
    const sim = makeSim(lvl(0, 0, 0, 0, 3, 0));
    pilotStep(sim, plane, cruise, FIXED_DT_S);
    expect(sim.state.angularRates.roll).toBeGreaterThan(0.3); // ≈ wingRollBiasFullRadS 0.6
  });

  it('zniszczone lewe skrzydło → bias roll w lewo', () => {
    const sim = makeSim(lvl(0, 0, 0, 3, 0, 0));
    pilotStep(sim, plane, cruise, FIXED_DT_S);
    expect(sim.state.angularRates.roll).toBeLessThan(-0.3);
  });

  it('sprawny samolot przy neutralnym sterze → brak biasu roll', () => {
    const sim = makeSim(null);
    pilotStep(sim, plane, cruise, FIXED_DT_S);
    expect(sim.state.angularRates.roll).toBeCloseTo(0, 6);
  });

  it('uszkodzony ogon → mniejsze osiągalne przeciążenie (autorytet pitch)', () => {
    const pull: PilotDemands = { nDemandG: 5, rollRateRadS: 0, yawRateRadS: 0 };
    const healthy = pilotStep(makeSim(null), plane, pull, FIXED_DT_S);
    const tail = pilotStep(makeSim(lvl(0, 0, 0, 0, 0, 3)), plane, pull, FIXED_DT_S);
    expect(tail.nClampedG).toBeLessThan(healthy.nClampedG);
  });

  it('przebity zbiornik → szybsze zużycie paliwa (wyciek)', () => {
    const healthy = makeSim(null);
    const leak = makeSim(lvl(0, 0, 1));
    pilotStep(healthy, plane, cruise, FIXED_DT_S);
    pilotStep(leak, plane, cruise, FIXED_DT_S);
    const dropHealthy = 1 - healthy.state.fuelFrac;
    const dropLeak = 1 - leak.state.fuelFrac;
    expect(dropLeak).toBeCloseTo(dropHealthy * 4, 8); // tankLeakDrainFactor = 4
  });

  it('uszkodzone skrzydło → mniejsze dostępne n (spadek clMax)', () => {
    const pull: PilotDemands = { nDemandG: 6, rollRateRadS: 0, yawRateRadS: 0 };
    const healthy = pilotStep(makeSim(null), plane, pull, FIXED_DT_S);
    const wing = pilotStep(makeSim(lvl(0, 0, 0, 3, 0, 0)), plane, pull, FIXED_DT_S);
    expect(wing.nAvailG).toBeLessThan(healthy.nAvailG);
  });
});
