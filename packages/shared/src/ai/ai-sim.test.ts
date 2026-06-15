import { Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { ARENA_SIZE_M, FIXED_DT_S } from '../constants';
import { createSimPlane, pilotStep, type SimPlane } from '../physics/pilot-step';
import { createPilotDemands } from '../instructor/instructor';
import { validatePlaneState } from '../physics/nan-guard';
import { SPITFIRE_MK2 } from '../planes/loader';
import { wrapToArena } from '../world/arena';
import { createTerrain, type Terrain } from '../world/terrain';
import { lookaheadSurfaceM, surfaceHeightM, updateLifecycle } from '../world/lifecycle';
import { Bot, selectNearestTarget } from './bot';
import { BOT_CONFIG, type DifficultyLevel } from './difficulty';

// Kryterium faza-06.md: 10 min symulacji, 4 boty, zero rozbić o teren. To test
// NADRZĘDNEGO override'u unikania ziemi pod pełną fizyką — broń wyłączona, liczy
// się samo latanie. Świat jest torusem: zawijanie utrzymuje boty w granicach areny.

interface Agent {
  sim: SimPlane;
  bot: Bot;
}

const SPAWN_SPEED_MS = 145;

function spawnAgent(level: DifficultyLevel, seed: number, pos: Vector3, headingDeg: number): Agent {
  const sim = createSimPlane(seed);
  const dir = new Vector3(Math.sin((headingDeg * Math.PI) / 180), 0, Math.cos((headingDeg * Math.PI) / 180));
  sim.state.position.copy(pos);
  sim.state.velocity.copy(dir).multiplyScalar(SPAWN_SPEED_MS);
  sim.state.orientation.copy(new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), dir));
  sim.state.throttle = 0.9;
  sim.state.iasMs = SPAWN_SPEED_MS;
  sim.state.life = 'alive';
  const bot = new Bot(BOT_CONFIG.tuning, BOT_CONFIG.levels[level], seed);
  bot.reset(sim.state);
  return { sim, bot };
}

/** Najwyższa powierzchnia pod i przed samolotem (omijanie grani). */
const LOOKAHEAD_DISTANCES_M = [300, 600, 1000, 1500];
function surfaceAhead(terrain: Terrain, state: { position: Vector3; velocity: Vector3 }): number {
  return lookaheadSurfaceM(
    terrain,
    state.position.x,
    state.position.z,
    state.velocity.x,
    state.velocity.z,
    LOOKAHEAD_DISTANCES_M,
  );
}

describe('symulacja 4 botów (flight safety)', () => {
  it('10 min lotu: zero rozbić o teren i brak ucieczki poza arenę', () => {
    const terrain = createTerrain();
    const demands = createPilotDemands();
    // mieszanka trudności; pozycje rozrzucone (w tym jeden nad wysokim rdzeniem wyspy)
    const agents: Agent[] = [
      spawnAgent('latwy', 0xa11, new Vector3(-2500, 1100, -2500), 45),
      spawnAgent('normalny', 0xb22, new Vector3(2500, 1000, -2500), -45),
      spawnAgent('trudny', 0xc33, new Vector3(2500, 1200, 2500), -135),
      spawnAgent('normalny', 0xd44, new Vector3(400, 1350, 400), 200),
    ];

    const others: typeof agents = [];
    const wrapDelta = new Vector3();
    let crashes = 0;
    let maxAbsXZ = 0;
    const TICKS = Math.round(600 / FIXED_DT_S); // 10 minut

    for (let tick = 0; tick < TICKS; tick++) {
      for (const a of agents) {
        // kandydaci = pozostali żywi
        others.length = 0;
        for (const b of agents) if (b !== a) others.push(b);
        const target = selectNearestTarget(a.sim.state.position, others.map((o) => o.sim.state));

        const env = { surfaceHeightM: surfaceAhead(terrain, a.sim.state) };
        const out = a.bot.update(a.sim.state, SPITFIRE_MK2, target, env, FIXED_DT_S, demands);
        a.sim.state.throttle = out.throttle;
        pilotStep(a.sim, SPITFIRE_MK2, demands, FIXED_DT_S);
        wrapToArena(a.sim.state.position, wrapDelta); // świat-torus jak po stronie klienta
        validatePlaneState(a.sim.state, `bot tick ${String(tick)}`);

        if (updateLifecycle(a.sim.state, terrain, FIXED_DT_S) === 'crashed') {
          crashes++;
          const s = a.sim.state;
          console.error(
            `CRASH t=${(tick * FIXED_DT_S).toFixed(1)}s stan=${a.bot.state} ` +
              `pos=(${s.position.x.toFixed(0)},${s.position.y.toFixed(0)},${s.position.z.toFixed(0)}) ` +
              `agl=${(s.position.y - surfaceHeightM(terrain, s.position.x, s.position.z)).toFixed(0)} ` +
              `vy=${s.velocity.y.toFixed(0)} tas=${s.velocity.length().toFixed(0)} stalled=${String(s.stalled)}`,
          );
          a.bot.reset(s); // nie kontynuuj lotu wrakiem (correctness pętli testu)
          s.life = 'alive';
          s.position.y = surfaceHeightM(terrain, s.position.x, s.position.z) + 1200;
          s.velocity.set(0, 0, SPAWN_SPEED_MS);
        }
        maxAbsXZ = Math.max(maxAbsXZ, Math.abs(a.sim.state.position.x), Math.abs(a.sim.state.position.z));
      }
    }

    expect(crashes).toBe(0);
    // świat-torus: zawijanie utrzymuje samoloty w granicach areny (|x|,|z| ≤ HALF)
    expect(maxAbsXZ).toBeLessThanOrEqual(ARENA_SIZE_M / 2);
  }, 30000);
});
