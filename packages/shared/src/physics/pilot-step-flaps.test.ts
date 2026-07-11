import { Quaternion } from 'three';
import { describe, expect, it } from 'vitest';
import type { PilotDemands } from '../instructor/instructor';
import { createTestPlane } from '../testing/fixtures';
import { createSimPlane, pilotStep, type PilotTickResult } from './pilot-step';
import { FIXED_DT_S, FLAP_DISABLE_WING_LEVEL } from '../constants';

// Klapy + efekt śmigła w pilotStep (fizyka v2 R3, §6.4–6.5). Tożsamość (flapIndex=0 + brak uszkodzeń ==
// jak dawniej) pilnują złote testy; tu sprawdzamy, że wysunięte klapy podnoszą clMax/opór, urwanie je
// wyłącza, a efekt śmigła działa TYLKO przy applyPropEffect=true (gracz), nie w harnessie/botach.

const plane = createTestPlane(); // flaps: schowane(0) + pełne(1: clMaxAdd 0.5, cd0Add 0.08)

const lvl = (engine = 0, cockpit = 0, tank = 0, wingL = 0, wingR = 0, tail = 0): number[] => [
  engine,
  cockpit,
  tank,
  wingL,
  wingR,
  tail,
];

/** Sim przelotowy (1000 m, zadany IAS wzdłuż +Z), z indeksem klap i opcjonalnymi poziomami uszkodzeń. */
function makeSim(flapIndex: number, levels: number[] | null = null, iasMs = 120) {
  const sim = createSimPlane(123);
  sim.state.position.set(0, 1000, 0);
  sim.state.velocity.set(0, 0, iasMs);
  sim.state.orientation.copy(new Quaternion()); // forward = +Z
  sim.state.iasMs = iasMs;
  sim.state.throttle = 1;
  sim.state.flapIndex = flapIndex;
  sim.damageLevels = levels;
  return sim;
}

const cruise: PilotDemands = { nDemandG: 1, rollRateRadS: 0, yawRateRadS: 0 };

function dragMag(tick: PilotTickResult): number {
  const c = tick.contributions.find((x) => x.name === 'opór');
  return c ? c.force.length() : 0;
}

describe('pilotStep — klapy (R3 §6.4)', () => {
  it('wysunięte klapy → większe dostępne n (podniesiony clMax → ciaśniejszy zakręt)', () => {
    const pull: PilotDemands = { nDemandG: 6, rollRateRadS: 0, yawRateRadS: 0 };
    const stowed = pilotStep(makeSim(0), plane, pull, FIXED_DT_S);
    const deployed = pilotStep(makeSim(1), plane, pull, FIXED_DT_S);
    expect(deployed.nAvailG).toBeGreaterThan(stowed.nAvailG);
  });

  it('wysunięte klapy → większy opór (cd0Add)', () => {
    const stowed = dragMag(pilotStep(makeSim(0), plane, cruise, FIXED_DT_S));
    const deployed = dragMag(pilotStep(makeSim(1), plane, cruise, FIXED_DT_S));
    expect(deployed).toBeGreaterThan(stowed);
  });

  it('urwane klapy (skrzydło ≥ próg) → brak dodatku clMax (jak schowane przy tym samym uszkodzeniu)', () => {
    const pull: PilotDemands = { nDemandG: 6, rollRateRadS: 0, yawRateRadS: 0 };
    const torn = lvl(0, 0, 0, FLAP_DISABLE_WING_LEVEL); // lewe skrzydło na progu wyłączenia
    // przy TYM SAMYM uszkodzeniu skrzydła: żądanie klap=1 nie daje nic (urwane) == klapy=0
    const cmdDeployedButTorn = pilotStep(makeSim(1, torn), plane, pull, FIXED_DT_S);
    const stowedSameDamage = pilotStep(makeSim(0, torn), plane, pull, FIXED_DT_S);
    expect(cmdDeployedButTorn.nAvailG).toBeCloseTo(stowedSameDamage.nAvailG, 9);
  });

  it('klapy sprawne przy LEKKIM uszkodzeniu skrzydła (poniżej progu) wciąż podnoszą clMax', () => {
    const pull: PilotDemands = { nDemandG: 6, rollRateRadS: 0, yawRateRadS: 0 };
    const light = lvl(0, 0, 0, FLAP_DISABLE_WING_LEVEL - 1);
    const deployed = pilotStep(makeSim(1, light), plane, pull, FIXED_DT_S);
    const stowed = pilotStep(makeSim(0, light), plane, pull, FIXED_DT_S);
    expect(deployed.nAvailG).toBeGreaterThan(stowed.nAvailG);
  });
});

describe('pilotStep — efekt śmigła (R3 §6.5)', () => {
  const propPlane = createTestPlane({
    propEffect: { yawBiasMaxRadS: -0.5, rollBiasMaxRadS: -0.3, fadeKmh: 200 },
  });

  it('applyPropEffect=true (gracz) → nos ściągany w yaw/roll przy małej prędkości', () => {
    const off = makeSim(0, null, 30); // 108 km/h < fade → efekt aktywny
    const on = makeSim(0, null, 30);
    pilotStep(off, propPlane, cruise, FIXED_DT_S, false);
    pilotStep(on, propPlane, cruise, FIXED_DT_S, true);
    // różnica izoluje bias śmigła (reszta yaw/roll: weathervane/koordynacja — identyczna)
    expect(on.state.angularRates.yaw).toBeLessThan(off.state.angularRates.yaw);
    expect(on.state.angularRates.roll).toBeLessThan(off.state.angularRates.roll);
  });

  it('applyPropEffect=false domyślnie (bot/harness) → brak biasu śmigła', () => {
    const a = makeSim(0, null, 30);
    const b = makeSim(0, null, 30);
    pilotStep(a, propPlane, cruise, FIXED_DT_S); // domyślne false
    pilotStep(b, propPlane, cruise, FIXED_DT_S, false);
    expect(a.state.angularRates.yaw).toBeCloseTo(b.state.angularRates.yaw, 9);
    expect(a.state.angularRates.roll).toBeCloseTo(b.state.angularRates.roll, 9);
  });

  it('powyżej fadeKmh efekt śmigła zanika (brak trymu w locie poziomym)', () => {
    const off = makeSim(0, null, 120); // 432 km/h > fade
    const on = makeSim(0, null, 120);
    pilotStep(off, propPlane, cruise, FIXED_DT_S, false);
    pilotStep(on, propPlane, cruise, FIXED_DT_S, true);
    expect(on.state.angularRates.yaw).toBeCloseTo(off.state.angularRates.yaw, 9);
    expect(on.state.angularRates.roll).toBeCloseTo(off.state.angularRates.roll, 9);
  });
});
