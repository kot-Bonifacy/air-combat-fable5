import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { FIXED_DT_S, MS_TO_KMH, PHYSICS_HZ } from '../constants';
import { getForward } from '../math/frame';
import { maxRollRateRadS } from '../physics/envelope';
import { createSimPlane, pilotStep } from '../physics/pilot-step';
import { validatePlaneState } from '../physics/nan-guard';
import { SPITFIRE_MK1 } from '../planes/loader';
import { Instructor, createPilotDemands } from './instructor';

const plane = SPITFIRE_MK1;
const DEG = Math.PI / 180;

/** Samolot w locie poziomym +Z na zadanej IAS≈TAS (niska wysokość). */
function levelSim(speedMs = 120): ReturnType<typeof createSimPlane> {
  const sim = createSimPlane(42);
  sim.state.position.set(0, 600, 0);
  sim.state.velocity.set(0, 0, speedMs);
  sim.state.iasMs = speedMs;
  sim.state.throttle = 0.9;
  return sim;
}

describe('instruktor — pojedynczy tick (regulator P)', () => {
  it('cel dokładnie przed nosem → lot po prostej (n ≈ baza, roll ≈ 0)', () => {
    const sim = levelSim();
    const instructor = new Instructor();
    const demands = createPilotDemands();
    // kilka ticków, żeby filtr wygładzania się ustalił
    for (let i = 0; i < 60; i++) {
      instructor.update(sim.state, plane, new Vector3(0, 0, 1), FIXED_DT_S, demands);
    }
    expect(demands.rollRateRadS).toBeCloseTo(0, 6);
    expect(demands.yawRateRadS).toBeCloseTo(0, 6);
    expect(demands.nDemandG).toBeCloseTo(1, 2); // poziomo: baza = 1 G
  });

  it('cel w prawo → roll w prawo nasycony krzywą koperty', () => {
    const sim = levelSim();
    const instructor = new Instructor();
    const demands = createPilotDemands();
    const target = new Vector3(-1, 0, 0.2).normalize(); // -X = prawo
    for (let i = 0; i < 120; i++) {
      instructor.update(sim.state, plane, target, FIXED_DT_S, demands);
    }
    const maxRoll = maxRollRateRadS(sim.state.iasMs, plane);
    expect(demands.rollRateRadS).toBeGreaterThan(0);
    expect(demands.rollRateRadS).toBeLessThanOrEqual(maxRoll + 1e-9);
    expect(demands.rollRateRadS).toBeCloseTo(maxRoll, 3); // duży błąd → nasycenie
  });

  it('cel lekko poniżej nosa (w stożku pushover) → pchnięcie, NIE beczka', () => {
    const sim = levelSim();
    const instructor = new Instructor();
    const demands = createPilotDemands();
    const target = new Vector3(0, -Math.sin(5 * DEG), Math.cos(5 * DEG));
    for (let i = 0; i < 120; i++) {
      instructor.update(sim.state, plane, target, FIXED_DT_S, demands);
    }
    expect(demands.rollRateRadS).toBeCloseTo(0, 6);
    expect(demands.nDemandG).toBeLessThan(1); // pcha
  });

  it('cel za ogonem z boku → najpierw roll (pull wygaszone)', () => {
    const sim = levelSim();
    const instructor = new Instructor();
    const demands = createPilotDemands();
    // za ogonem, zdecydowanie w prawo: błąd przechylenia ~90°+
    const target = new Vector3(-0.6, 0, -0.8).normalize();
    for (let i = 0; i < 120; i++) {
      instructor.update(sim.state, plane, target, FIXED_DT_S, demands);
    }
    const maxRoll = maxRollRateRadS(sim.state.iasMs, plane);
    expect(demands.rollRateRadS).toBeCloseTo(maxRoll, 2); // pełna beczka w prawo
    // ciągnięcie wygaszone: n blisko bazy lotu po prostej (≈1 w poziomie)
    expect(demands.nDemandG).toBeLessThan(1.6);
  });
});

describe('instruktor — zamknięta pętla z fizyką (bank-and-pull)', () => {
  it('cel za ogonem: sekwencja roll → pull doprowadza nos na cel < 15 s', () => {
    const sim = levelSim(140);
    const instructor = new Instructor();
    const demands = createPilotDemands();
    const target = new Vector3(-0.5, 0.1, -0.85).normalize();
    const fwd = new Vector3();

    let maxAbsRollRate = 0;
    let rollSaturatedTick = -1;
    let pullStartedTick = -1;
    let convergedAtS = -1;

    const maxTicks = 20 * PHYSICS_HZ;
    for (let i = 0; i < maxTicks; i++) {
      instructor.update(sim.state, plane, target, FIXED_DT_S, demands);
      pilotStep(sim, plane, demands, FIXED_DT_S);
      validatePlaneState(sim.state, 'instruktor pętla zamknięta');

      maxAbsRollRate = Math.max(maxAbsRollRate, Math.abs(demands.rollRateRadS));
      if (rollSaturatedTick < 0 && Math.abs(demands.rollRateRadS) > 30 * DEG) {
        rollSaturatedTick = i;
      }
      if (pullStartedTick < 0 && demands.nDemandG > 2.5) pullStartedTick = i;

      getForward(sim.state.orientation, fwd);
      if (convergedAtS < 0 && fwd.angleTo(target) < 5 * DEG) {
        convergedAtS = i / PHYSICS_HZ;
        break;
      }
    }

    expect(rollSaturatedTick).toBeGreaterThanOrEqual(0);
    expect(pullStartedTick).toBeGreaterThan(rollSaturatedTick); // najpierw roll, potem pull
    expect(convergedAtS).toBeGreaterThan(0);
    expect(convergedAtS).toBeLessThan(15);
  });

  it('cel utrzymany przed nosem przez 10 s — lot stabilny, bez NaN i przeciągnięcia', () => {
    const sim = levelSim(120);
    const instructor = new Instructor();
    const demands = createPilotDemands();
    const target = new Vector3(0, 0, 1);
    for (let i = 0; i < 10 * PHYSICS_HZ; i++) {
      instructor.update(sim.state, plane, target, FIXED_DT_S, demands);
      pilotStep(sim, plane, demands, FIXED_DT_S);
      validatePlaneState(sim.state, 'instruktor lot prosty');
    }
    expect(sim.state.stalled).toBe(false);
    // tor pozostał z grubsza poziomy i szybki
    expect(Math.abs(sim.state.velocity.y)).toBeLessThan(8);
    expect(sim.state.iasMs * MS_TO_KMH).toBeGreaterThan(250);
  });
});
