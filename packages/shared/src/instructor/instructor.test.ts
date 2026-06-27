import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { FIXED_DT_S, MS_TO_KMH, PHYSICS_HZ } from '../constants';
import { getForward } from '../math/frame';
import { maxRollRateRadS } from '../physics/envelope';
import { createSimPlane, pilotStep } from '../physics/pilot-step';
import { validatePlaneState } from '../physics/nan-guard';
import { SPITFIRE_MK2 } from '../planes/loader';
import { Instructor, createPilotDemands } from './instructor';

const plane = SPITFIRE_MK2;
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

  it('martwa strefa rolla: mikro-offset celownika (< deadzone) → roll ≈ 0', () => {
    // 0,3° w bok (≈2 px) przy nosie: bez martwej strefy atan2(bok, pion≈0)≈90°
    // wywołałoby kilka °/s rolla (gwałtowny zamach skrzydłami w locie prostym).
    const dz = plane.instructor.aimRollDeadzoneDeg;
    expect(dz).toBeGreaterThan(0.3); // założenie testu: 0,3° leży w strefie
    const sim = levelSim();
    const instructor = new Instructor();
    const demands = createPilotDemands();
    const target = new Vector3(-Math.sin(0.3 * DEG), 0, Math.cos(0.3 * DEG)).normalize();
    for (let i = 0; i < 120; i++) {
      instructor.update(sim.state, plane, target, FIXED_DT_S, demands);
    }
    expect(demands.rollRateRadS).toBeCloseTo(0, 5);
  });

  it('martwa strefa rolla: offset poza strefą (> 2× deadzone) → pełny autorytet rolla', () => {
    // 3° w bok: powyżej 2× deadzone → brama otwarta, roll nasyca krzywą koperty
    const sim = levelSim();
    const instructor = new Instructor();
    const demands = createPilotDemands();
    const target = new Vector3(-Math.sin(3 * DEG), 0, Math.cos(3 * DEG)).normalize();
    for (let i = 0; i < 120; i++) {
      instructor.update(sim.state, plane, target, FIXED_DT_S, demands);
    }
    expect(demands.rollRateRadS).toBeGreaterThan(0);
    expect(demands.rollRateRadS).toBeCloseTo(maxRollRateRadS(sim.state.iasMs, plane), 3);
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

  it('krzywa wykładnicza: duże oddalenie kursora ciągnie superliniowo, małe ~bez zmian', () => {
    // cel w płaszczyźnie symetrii (lateral=0 → czyste ciągnięcie, roll≈0);
    // tylko instructor.update (bez fizyki) → filtr zbiega do surowego żądania.
    // Duża prędkość → spory zapas koperty, więc klamp clRatio≈0.85 NIE obcina
    // pomiaru i mierzymy czystą krzywą wykładniczą.
    const pullAtElevation = (elevDeg: number): number => {
      const sim = levelSim(200);
      const instructor = new Instructor();
      const demands = createPilotDemands();
      const a = elevDeg * DEG;
      const target = new Vector3(0, Math.sin(a), Math.cos(a));
      for (let i = 0; i < 240; i++) {
        instructor.update(sim.state, plane, target, FIXED_DT_S, demands);
      }
      return demands.nDemandG;
    };

    const base = pullAtElevation(0); // cel przed nosem → tylko baza lotu
    const pullSmall = pullAtElevation(10) - base;
    const pullLarge = pullAtElevation(60) - base;

    // liniowo stosunek = 60/10 = 6; krzywa (aimExpo=1, ref=60°) daje wyraźnie więcej
    expect(pullLarge / pullSmall).toBeGreaterThan(7);
    // ale małe oddalenie prawie nietknięte: mnożnik gainu ~1.17, < +25%
    const linearSmall = plane.instructor.aggressivenessPitch * (10 * DEG);
    expect(pullSmall / linearSmall).toBeGreaterThan(1.0);
    expect(pullSmall / linearSmall).toBeLessThan(1.25);
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

  it('cel prowadzony przez pion (gracz ciągnie mysz) → pełna pętla bez utraty śledzenia', () => {
    const sim = levelSim(140);
    sim.state.position.y = 1000;
    sim.state.throttle = 1;
    const instructor = new Instructor();
    const demands = createPilotDemands();
    const target = new Vector3();
    const fwd = new Vector3();

    // skrypt "gracza": cel w płaszczyźnie Y-Z, prowadzony 40°/s w górę,
    // ale tylko gdy nos nadąża (błąd < 60°) — jak ręka na myszy
    const DRAG_RATE_RAD_S = 40 * DEG;
    const CATCH_UP_CONE_RAD = 60 * DEG;
    let targetPitchRad = 0;
    let prevNosePitchRad: number | undefined;
    let accumulatedRad = 0;

    const maxTicks = 45 * PHYSICS_HZ;
    for (let i = 0; i < maxTicks && accumulatedRad < 2 * Math.PI; i++) {
      target.set(0, Math.sin(targetPitchRad), Math.cos(targetPitchRad));
      getForward(sim.state.orientation, fwd);
      if (fwd.angleTo(target) < CATCH_UP_CONE_RAD && targetPitchRad < 2 * Math.PI) {
        targetPitchRad += DRAG_RATE_RAD_S * FIXED_DT_S;
      }
      instructor.update(sim.state, plane, target, FIXED_DT_S, demands);
      pilotStep(sim, plane, demands, FIXED_DT_S);
      validatePlaneState(sim.state, 'instruktor pętla przez pion');

      // kąt nosa w płaszczyźnie pętli (Y-Z), odwijany do sumy obrotu
      const nosePitchRad = Math.atan2(fwd.y, fwd.z);
      if (prevNosePitchRad !== undefined) {
        let delta = nosePitchRad - prevNosePitchRad;
        if (delta > Math.PI) delta -= 2 * Math.PI;
        if (delta < -Math.PI) delta += 2 * Math.PI;
        accumulatedRad += delta;
      }
      prevNosePitchRad = nosePitchRad;
      // pętla ma zostać w swojej płaszczyźnie — bez beczki / wing dropu
      expect(Math.abs(fwd.x)).toBeLessThan(0.35);
    }

    expect(accumulatedRad).toBeGreaterThanOrEqual(2 * Math.PI * 0.98);
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
