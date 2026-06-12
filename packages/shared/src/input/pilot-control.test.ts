import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { FIXED_DT_S } from '../constants';
import { createPilotDemands } from '../instructor/instructor';
import { getForward } from '../math/frame';
import { maxRollRateRadS } from '../physics/envelope';
import { createPlaneState } from '../physics/state';
import { createTestPlane } from '../testing/fixtures';
import {
  PilotControl,
  createControlDeflections,
  keyboardDemands,
} from './pilot-control';

const DEG_TO_RAD = Math.PI / 180;

function levelState(speedMs = 100): ReturnType<typeof createPlaneState> {
  const state = createPlaneState();
  state.position.set(0, 1000, 0);
  state.velocity.set(0, 0, speedMs);
  state.iasMs = speedMs;
  return state;
}

describe('keyboardDemands', () => {
  it('pełne wychylenia sięgają limitów koperty i konfiguracji', () => {
    const plane = createTestPlane();
    const state = levelState();
    const out = createPilotDemands();
    const deflections = createControlDeflections();

    deflections.pitchUp = 1;
    deflections.rollRight = 1;
    deflections.yawRight = 1;
    keyboardDemands(state, plane, deflections, out);
    expect(out.nDemandG).toBeCloseTo(plane.nMaxG, 6);
    expect(out.rollRateRadS).toBeCloseTo(maxRollRateRadS(state.iasMs, plane), 10);
    expect(out.yawRateRadS).toBeCloseTo(plane.instructor.maxYawRateDegS * DEG_TO_RAD, 10);

    deflections.pitchUp = -1;
    keyboardDemands(state, plane, deflections, out);
    expect(out.nDemandG).toBeCloseTo(plane.nMinG, 6);
  });

  it('zero wychylenia pitch = lot po prostej (n bazowe, w poziomie 1 G)', () => {
    const plane = createTestPlane();
    const state = levelState();
    const out = createPilotDemands();
    keyboardDemands(state, plane, createControlDeflections(), out);
    expect(out.nDemandG).toBeCloseTo(1, 6);
    expect(out.rollRateRadS).toBe(0);
    expect(out.yawRateRadS).toBe(0);
  });
});

describe('PilotControl — arbitraż mysz↔klawiatura', () => {
  it('niezerowe wychylenie przejmuje od myszy; puszczenie oddaje z celem na nosie', () => {
    const plane = createTestPlane();
    const state = levelState();
    const control = new PilotControl();
    const deflections = createControlDeflections();
    const out = createPilotDemands();
    control.reset(state);

    // mysz steruje: cel odsunięty od nosa
    control.mouseAim.applyMovementPx(-300, -300);
    expect(control.update(state, plane, deflections, FIXED_DT_S, out)).toBe('mysz');

    deflections.rollRight = 1;
    expect(control.update(state, plane, deflections, FIXED_DT_S, out)).toBe('klawiatura');
    expect(out.rollRateRadS).toBeGreaterThan(0);

    // puszczenie klawiszy: cel wraca na nos → brak szarpnięcia od starego celu
    deflections.rollRight = 0;
    expect(control.update(state, plane, deflections, FIXED_DT_S, out)).toBe('mysz');
    const target = control.mouseAim.targetDir(new Vector3());
    const nose = getForward(state.orientation, new Vector3());
    expect(target.angleTo(nose)).toBeLessThan(1e-6);
    expect(out.nDemandG).toBeCloseTo(1, 1); // cel na nosie → ~lot po prostej
  });

  it('updateWithTarget (autopilot) prowadzi na cel i trzyma celownik na nosie', () => {
    const plane = createTestPlane();
    const state = levelState();
    const control = new PilotControl();
    const out = createPilotDemands();
    control.reset(state);

    // cel w prawo od nosa: prawe skrzydło to −X świata (body +X = LEWE, glTF)
    const targetDir = new Vector3(-1, 0, 1).normalize();
    control.updateWithTarget(state, plane, targetDir, FIXED_DT_S, out);
    expect(control.mode).toBe('mysz');
    // cel w prawo → żądanie przechylenia w prawo (bank-and-pull)
    expect(out.rollRateRadS).toBeGreaterThan(0);
    const aimDir = control.mouseAim.targetDir(new Vector3());
    expect(aimDir.angleTo(getForward(state.orientation, new Vector3()))).toBeLessThan(1e-6);
  });
});
