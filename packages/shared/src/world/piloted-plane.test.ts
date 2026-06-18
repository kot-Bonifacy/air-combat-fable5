import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import {
  Instructor,
  SPITFIRE_MK2,
  createPilotDemands,
  createSimPlane,
  createTerrain,
  surfaceHeightM,
  validatePlaneState,
} from '../index';
import { stepPilotedPlane, stepWreckPiloted, type PilotCommand } from './piloted-plane';

// Replay reconciliation (faza-09.md) opiera się na tym, że stepPilotedPlane to czysta
// funkcja (stan + ukryty stan maszyn + input) → stan: ta sama sekwencja inputów z tego
// samego punktu startowego daje BIT-W-BIT ten sam wynik. Każdy ukryty stan globalny
// (RNG poza sim, Date.now, mutowane scratch współdzielone między obiektami) = bug.

const FORWARD_Z = new Vector3(0, 0, 1);
const terrain = createTerrain();

/** Świeży samolot na typowym spawnie (poziomo, 800 m, 120 m/s ku środkowi). */
function freshSim(seed = 1) {
  const sim = createSimPlane(seed);
  const s = sim.state;
  const dir = new Vector3(0, 0, -1);
  s.position.set(8000, 800, 0);
  s.velocity.copy(dir).multiplyScalar(120);
  s.orientation.copy(new Quaternion().setFromUnitVectors(FORWARD_Z, dir));
  s.throttle = 0.8;
  s.iasMs = 120;
  s.life = 'alive';
  return { sim, instructor: new Instructor(), demands: createPilotDemands() };
}

function cmd(over: Partial<PilotCommand> = {}): PilotCommand {
  return { throttle: 0.9, pitchUp: 0, rollRight: 0, yawRight: 0, aimX: 0, aimY: 0, aimZ: 1, ...over };
}

function run(commands: readonly PilotCommand[], seed = 1) {
  const { sim, instructor, demands } = freshSim(seed);
  for (const c of commands) {
    stepPilotedPlane(sim, instructor, SPITFIRE_MK2, demands, c, terrain, 1 / 60, 'test');
  }
  return sim.state;
}

describe('stepPilotedPlane — determinizm i replay', () => {
  it('ta sama sekwencja inputów z tego samego startu → identyczny stan (bit-w-bit)', () => {
    const commands = Array.from({ length: 120 }, (_, i) =>
      cmd({ pitchUp: 0, rollRight: Math.sin(i / 10) * 0.6, aimZ: 1, aimY: Math.sin(i / 20) * 0.3 }),
    );
    const a = run(commands);
    const b = run(commands);
    expect(a.position.toArray()).toEqual(b.position.toArray());
    expect(a.velocity.toArray()).toEqual(b.velocity.toArray());
    expect(a.orientation.toArray()).toEqual(b.orientation.toArray());
  });

  it('różne ziarno maszyny przeciągnięcia NIE rozjeżdża łagodnego lotu (RNG tkwi w sim)', () => {
    // łagodny lot daleko od przeciągnięcia: RNG przeciągnięcia nie odpala, więc nawet
    // różne ziarna dają ten sam tor — potwierdza, że jedyny RNG żyje w stanie sim
    const commands = Array.from({ length: 90 }, () => cmd({ rollRight: 0.2 }));
    const a = run(commands, 1);
    const b = run(commands, 999);
    expect(a.position.distanceTo(b.position)).toBeLessThan(1e-6);
  });

  it('komenda null trzyma lot prosto bez NaN przez długą symulację', () => {
    const { sim, instructor, demands } = freshSim();
    for (let i = 0; i < 600; i++) {
      stepPilotedPlane(sim, instructor, SPITFIRE_MK2, demands, null, terrain, 1 / 60, 'null');
    }
    validatePlaneState(sim.state, 'null long');
    // lot prosto: nos zostaje mniej więcej poziomy (neutralne żądania, brak skrętu)
    const nose = new Vector3(0, 0, 1).applyQuaternion(sim.state.orientation);
    expect(Math.abs(nose.y)).toBeLessThan(0.15);
  });

  it('replay od stanu pośredniego = kontynuacja ciągłej symulacji', () => {
    // własność reconciliation: stan(M) → replay(N kolejnych inputów) = stan(M+N) ciągłe.
    // Tu replay startuje z PEŁNEGO sim (widoczny + ukryty stan), więc równość jest dokładna.
    const all = Array.from({ length: 100 }, (_, i) => cmd({ rollRight: Math.cos(i / 7) * 0.5 }));
    const continuous = run(all);

    const head = all.slice(0, 60);
    const tail = all.slice(60);
    const { sim, instructor, demands } = freshSim();
    for (const c of head) stepPilotedPlane(sim, instructor, SPITFIRE_MK2, demands, c, terrain, 1 / 60, 't');
    for (const c of tail) stepPilotedPlane(sim, instructor, SPITFIRE_MK2, demands, c, terrain, 1 / 60, 't');

    expect(sim.state.position.toArray()).toEqual(continuous.position.toArray());
    expect(sim.state.orientation.toArray()).toEqual(continuous.orientation.toArray());
  });
});

// stepWreckPiloted (faza 16): wspólna ścieżka spadającego wraku dla serwera i predykcji
// klienta. Wrak: silnik martwy (throttle=0), brak instruktora/myszy — gracz steruje wprost
// wychyleniami (command niezerowe), bot leci neutralnie (command=null). Niezmiennik
// reconciliation: determinizm jak w stepPilotedPlane.
describe('stepWreckPiloted — spadający wrak', () => {
  function runWreck(commands: readonly (PilotCommand | null)[], seed = 1) {
    const { sim, demands } = freshSim(seed);
    sim.state.life = 'dying';
    sim.state.lifeTimerS = 0;
    for (const c of commands) {
      stepWreckPiloted(sim, SPITFIRE_MK2, demands, c, terrain, 1 / 60, 'test-wrak');
    }
    return sim.state;
  }

  it('ta sama sekwencja wychyleń → identyczny stan (determinizm replay)', () => {
    const commands = Array.from({ length: 90 }, (_, i) => cmd({ rollRight: Math.sin(i / 9) * 0.7, pitchUp: 0.4 }));
    const a = runWreck(commands);
    const b = runWreck(commands);
    expect(a.position.toArray()).toEqual(b.position.toArray());
    expect(a.orientation.toArray()).toEqual(b.orientation.toArray());
  });

  it('wymusza throttle 0 (silnik martwy) i opada przy neutralnym wraku bota (command=null)', () => {
    const start = freshSim().sim.state.position.y;
    const s = runWreck(Array.from({ length: 120 }, () => null));
    expect(s.throttle).toBe(0);
    expect(s.position.y).toBeLessThan(start); // wrak opadł
    validatePlaneState(s, 'wrak null');
  });

  it('gracz steruje wrakiem (lotki działają): przechył różny od neutralnego opadu', () => {
    const rolled = runWreck(Array.from({ length: 50 }, () => cmd({ rollRight: 1 })));
    const neutral = runWreck(Array.from({ length: 50 }, () => null));
    // pełne lotki w wraku dają inny przechył niż czysty opad bez sterowania
    expect(rolled.orientation.angleTo(neutral.orientation)).toBeGreaterThan(0.2);
  });

  it('po dotknięciu ziemi zwraca wreckImpact i przechodzi w „dead"', () => {
    const { sim, demands } = freshSim();
    const surf = surfaceHeightM(terrain, sim.state.position.x, sim.state.position.z);
    sim.state.position.y = surf + 40; // nisko nad ziemią → wrak szybko uderzy
    sim.state.life = 'dying';
    sim.state.lifeTimerS = 0;
    let impact = -1;
    for (let i = 0; i < 600 && impact < 0; i++) {
      if (stepWreckPiloted(sim, SPITFIRE_MK2, demands, null, terrain, 1 / 60, 't') === 'wreckImpact') impact = i;
    }
    expect(impact).toBeGreaterThanOrEqual(0);
    expect(sim.state.life).toBe('dead');
  });
});
