import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { createPlaneState, type PlaneState } from '../physics/state';
import { FIXED_DT_S, SPOT_RANGE_M } from '../constants';
import { createSimPlane, pilotStep } from '../physics/pilot-step';
import { createPilotDemands } from '../instructor/instructor';
import { validatePlaneState } from '../physics/nan-guard';
import { SPITFIRE_MK2 } from '../planes/loader';
import { getForward } from '../math/frame';
import { Bot, selectNearestTarget } from './bot';
import { BOT_CONFIG, type DifficultyLevel } from './difficulty';

// Bramka zasięgu wykrycia (faza 7: oznaczanie wrogów dopiero ≤ SPOT_RANGE_M).
// selectNearestTarget czyta tylko `position` i `life` — budujemy minimalne stany.
function planeAt(x: number, z: number, life: PlaneState['life'] = 'alive'): PlaneState {
  const s = createPlaneState();
  s.position.set(x, 0, z);
  s.life = life;
  return s;
}

describe('selectNearestTarget — bramka zasięgu wykrycia', () => {
  const self = new Vector3(0, 0, 0);

  it('pomija cel poza zasięgiem, wybiera ten w zasięgu', () => {
    const near = planeAt(0, SPOT_RANGE_M - 100);
    const far = planeAt(0, SPOT_RANGE_M + 100);
    expect(selectNearestTarget(self, [far, near], SPOT_RANGE_M)).toBe(near);
  });

  it('zwraca null, gdy wszystkie cele są poza zasięgiem (twardy próg)', () => {
    const far1 = planeAt(0, SPOT_RANGE_M + 1);
    const far2 = planeAt(SPOT_RANGE_M + 500, 0);
    expect(selectNearestTarget(self, [far1, far2], SPOT_RANGE_M)).toBeNull();
  });

  it('spośród celów w zasięgu wybiera najbliższy', () => {
    const closer = planeAt(300, 0);
    const farther = planeAt(0, 1500);
    expect(selectNearestTarget(self, [farther, closer], SPOT_RANGE_M)).toBe(closer);
  });

  it('pomija cel martwy mimo bliskości', () => {
    const deadClose = planeAt(100, 0, 'dead');
    const aliveFar = planeAt(0, 1500);
    expect(selectNearestTarget(self, [deadClose, aliveFar], SPOT_RANGE_M)).toBe(aliveFar);
  });

  it('bez limitu (domyślnie) wybiera nawet cel daleko poza zasięgiem', () => {
    const far = planeAt(0, SPOT_RANGE_M + 3000);
    expect(selectNearestTarget(self, [far])).toBe(far);
  });
});

// Reakcja na trafienie (decyzja użytkownika 2026-06-21): bot „trudny" po krótkim opóźnieniu
// zrywa w którąś stronę, gdy go ostrzeliwują — niższe poziomy lecą prosto. Test mierzy zmianę
// kursu bota lecącego prosto bez celu (patrol), z dala od ziemi: zryw = duża zmiana, brak = mała.
function headingDeviationAfterHit(level: DifficultyLevel, withHit: boolean): number {
  const sim = createSimPlane(0x51b);
  const dir = new Vector3(0, 0, 1);
  sim.state.position.set(0, 3000, 0); // wysoko → override unikania ziemi nieaktywny
  sim.state.velocity.copy(dir).multiplyScalar(150);
  sim.state.orientation.copy(new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), dir));
  sim.state.throttle = 0.9;
  sim.state.iasMs = 150;
  sim.state.life = 'alive';
  const bot = new Bot(BOT_CONFIG.tuning, BOT_CONFIG.levels[level], 0x51b);
  bot.reset(sim.state);
  const demands = createPilotDemands();
  const env = { surfaceHeightM: 0 };
  const initialFwd = getForward(sim.state.orientation, new Vector3());

  if (withHit) bot.notifyHit();
  const TICKS = Math.round(2.9 / FIXED_DT_S); // opóźnienie (0,5 s) + pełen zryw (2,2 s) + margines
  const fwd = new Vector3();
  let maxDeviation = 0; // szczyt uniku (po zrywie patrol prostuje nos → mierzymy maksimum, nie koniec)
  for (let t = 0; t < TICKS; t++) {
    const out = bot.update(sim.state, SPITFIRE_MK2, null, env, FIXED_DT_S, demands);
    sim.state.throttle = out.throttle;
    pilotStep(sim, SPITFIRE_MK2, demands, FIXED_DT_S);
    validatePlaneState(sim.state, `hit-react ${level} t${String(t)}`);
    maxDeviation = Math.max(maxDeviation, initialFwd.angleTo(getForward(sim.state.orientation, fwd)));
  }
  return maxDeviation;
}

describe('Bot.notifyHit — zryw po trafieniu (tylko trudny)', () => {
  it('trudny zrywa po trafieniu (duża zmiana kursu), a bez trafienia leci prosto', () => {
    const straight = headingDeviationAfterHit('trudny', false);
    const broke = headingDeviationAfterHit('trudny', true);
    expect(straight).toBeLessThan(0.15); // patrol bez trafienia = ~prosto
    expect(broke).toBeGreaterThan(0.4); // po zrywie kurs wyraźnie zmieniony
  });

  it('łatwy i normalny IGNORUJĄ trafienie (lecą prosto — hitReactionDelayS = 0)', () => {
    expect(headingDeviationAfterHit('latwy', true)).toBeLessThan(0.15);
    expect(headingDeviationAfterHit('normalny', true)).toBeLessThan(0.15);
  });
});

describe('Bot.update — ucieczka przy krytycznych uszkodzeniach (faza 22 cz.3)', () => {
  /** Bot lecący na cel w zasięgu: bez uszkodzeń atakuje (engage), krytycznie uszkodzony ucieka. */
  function stateAfterDecision(criticalDamage: boolean): string {
    const self = createPlaneState();
    self.position.set(0, 3000, 0);
    self.velocity.set(0, 0, 150);
    self.orientation.copy(new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), new Vector3(0, 0, 1)));
    self.iasMs = 150; // wysoka energia → bez krytyku FSM nie ucieknie z powodu „extend energii"
    self.life = 'alive';
    // cel ~800 m na wprost, lecący w tę samą stronę (nie celuje we mnie → brak evade)
    const target = createPlaneState();
    target.position.set(0, 3000, 800);
    target.velocity.set(0, 0, 150);
    const bot = new Bot(BOT_CONFIG.tuning, BOT_CONFIG.levels.normalny, 0xc0de);
    bot.reset(self);
    const demands = createPilotDemands();
    return bot.update(self, SPITFIRE_MK2, target, { surfaceHeightM: 0 }, FIXED_DT_S, demands, criticalDamage).state;
  }

  it('sprawny atakuje cel w zasięgu (engage), uszkodzony krytycznie ucieka (extend)', () => {
    expect(stateAfterDecision(false)).toBe('engage');
    expect(stateAfterDecision(true)).toBe('extend');
  });
});
