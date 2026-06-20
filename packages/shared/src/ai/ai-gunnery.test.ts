import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { FIXED_DT_S } from '../constants';
import { BulletPool } from '../combat/ballistics';
import { createFireControl, updateFire } from '../combat/fire';
import { segmentSphereHit } from '../combat/hit';
import { createRng } from '../math/rng';
import { createPilotDemands } from '../instructor/instructor';
import { createSimPlane, pilotStep } from '../physics/pilot-step';
import { SPITFIRE_MK2 } from '../planes/loader';
import { Bot } from './bot';
import { BOT_CONFIG, type DifficultyLevel } from './difficulty';

// Test skuteczności ognia (faza-06.md kryteria walki): pełny potok lead → instruktor
// → balistyka → trafienie. Atakujący bot startuje na ogonie celu lecącego po
// łagodnym okręgu (cel manewrujący) i ma trafiać OKAZJONALNIE. Porównanie
// poziomów dowodzi degradacji: łatwy trafia rzadziej niż trudny (nie aimbotuje).

const ALT_M = 1000;
const TARGET_SPEED_MS = 130;
const TARGET_RADIUS_M = 2000; // łuk łagodny: ω = v/R ≈ 0.065 rad/s
const SIM_S = 25;

const scratchTan = new Vector3();
const FWD = new Vector3(0, 0, 1);

/** Liczba trafień, które atakujący o danej trudności zadaje celowi w SIM_S sekund. */
function runGunnery(level: DifficultyLevel): number {
  const plane = SPITFIRE_MK2;
  const omega = TARGET_SPEED_MS / TARGET_RADIUS_M;

  // cel: skryptowany lot po okręgu (środek w (−R,0,0), start w origin)
  const targetSim = createSimPlane(0x7);
  const target = targetSim.state;
  const center = new Vector3(-TARGET_RADIUS_M, ALT_M, 0);
  const setTarget = (tS: number): void => {
    const a = omega * tS;
    target.position.set(center.x + TARGET_RADIUS_M * Math.cos(a), ALT_M, center.z + TARGET_RADIUS_M * Math.sin(a));
    scratchTan.set(-Math.sin(a), 0, Math.cos(a)); // styczna (kierunek lotu)
    target.velocity.copy(scratchTan).multiplyScalar(TARGET_SPEED_MS);
    target.orientation.setFromUnitVectors(FWD, scratchTan);
    target.life = 'alive';
  };
  setTarget(0);

  // atakujący: 250 m za celem na jego szóstej, lekko szybciej (domyka)
  const atkSim = createSimPlane(0x9);
  const atk = atkSim.state;
  atk.position.copy(target.position).addScaledVector(scratchTan, -250);
  atk.position.y = ALT_M;
  atk.velocity.copy(scratchTan).multiplyScalar(TARGET_SPEED_MS + 8);
  atk.orientation.copy(target.orientation);
  atk.throttle = 1;
  atk.iasMs = TARGET_SPEED_MS + 8;
  atk.life = 'alive';

  const bot = new Bot(BOT_CONFIG.tuning, BOT_CONFIG.levels[level], 0x1234);
  bot.reset(atk);
  const demands = createPilotDemands();
  const pool = new BulletPool(512);
  const fc = createFireControl(plane.armament);
  const rng = createRng(0xfee1);

  let hits = 0;
  const ticks = Math.round(SIM_S / FIXED_DT_S);
  for (let i = 0; i < ticks; i++) {
    setTarget(i * FIXED_DT_S);
    const out = bot.update(atk, plane, target, { surfaceHeightM: 0 }, FIXED_DT_S, demands);
    atk.throttle = out.throttle;
    pilotStep(atkSim, plane, demands, FIXED_DT_S);
    updateFire(fc, plane.armament, atk, 0, rng, pool, out.fire, FIXED_DT_S);
    pool.update(FIXED_DT_S);
    for (const b of pool.bullets) {
      if (!b.active) continue;
      if (segmentSphereHit(b.prevPosition, b.position, target.position, plane.hitRadiusM)) {
        hits++;
        b.active = false;
      }
    }
  }
  return hits;
}

describe('skuteczność ognia bota', () => {
  it('trudny trafia manewrujący cel (lead + ogień działają)', () => {
    expect(runGunnery('trudny')).toBeGreaterThan(0);
  });

  it('degradacja: łatwy trafia rzadziej niż trudny (nie aimbotuje)', () => {
    const easy = runGunnery('latwy');
    const hard = runGunnery('trudny');
    expect(hard).toBeGreaterThan(easy);
  });
});
