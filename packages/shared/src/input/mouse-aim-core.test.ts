import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { MOUSE_SENSITIVITY_RAD_PER_PX, MouseAimCore } from './mouse-aim-core';

describe('MouseAimCore', () => {
  it('ruch myszy w lewo/górę zwiększa yaw/pitch zgodnie z czułością', () => {
    const aim = new MouseAimCore();
    aim.applyMovementPx(-100, -50);
    expect(aim.yawRad).toBeCloseTo(100 * MOUSE_SENSITIVITY_RAD_PER_PX, 10);
    expect(aim.pitchRad).toBeCloseTo(50 * MOUSE_SENSITIVITY_RAD_PER_PX, 10);
  });

  it('targetDir odtwarza kierunek ustawiony przez alignTo', () => {
    const aim = new MouseAimCore();
    const dir = new Vector3(0.3, 0.5, 0.6).normalize();
    aim.alignTo(dir);
    const out = aim.targetDir(new Vector3());
    expect(out.distanceTo(dir)).toBeLessThan(1e-9);
  });

  it('pitch przechodzi przez pion bez ograniczenia i wrapuje do (−π, π]', () => {
    const aim = new MouseAimCore();
    const pxFor180Deg = Math.PI / MOUSE_SENSITIVITY_RAD_PER_PX;
    aim.applyMovementPx(0, -pxFor180Deg * 1.2); // 216° w górę
    expect(Math.abs(aim.pitchRad)).toBeLessThanOrEqual(Math.PI);
    // 216° = za plecami pod horyzontem: cos(pitch) < 0
    expect(Math.cos(aim.pitchRad)).toBeLessThan(0);
  });

  it('renormalize przepisuje odwróconą parametryzację bez zmiany kierunku celu', () => {
    const aim = new MouseAimCore();
    // cel "za plecami przez górę", elewacja ~10°: pitch = 170°
    const pitchRad = (170 * Math.PI) / 180;
    aim.applyMovementPx(0, -pitchRad / MOUSE_SENSITIVITY_RAD_PER_PX);
    const before = aim.targetDir(new Vector3());
    aim.renormalize(before.clone()); // nos dokładnie na celu
    expect(Math.cos(aim.pitchRad)).toBeGreaterThanOrEqual(0);
    const after = aim.targetDir(new Vector3());
    expect(after.distanceTo(before)).toBeLessThan(1e-9);
  });

  it('renormalize nie odpala, gdy nos daleko od celu albo cel wysoko', () => {
    const aim = new MouseAimCore();
    const pitchRad = (170 * Math.PI) / 180;
    aim.applyMovementPx(0, -pitchRad / MOUSE_SENSITIVITY_RAD_PER_PX);
    const target = aim.targetDir(new Vector3());
    // nos 90° od celu → manewr niedomknięty → parametryzacja zostaje
    aim.renormalize(new Vector3(1, 0, 0));
    expect(Math.cos(aim.pitchRad)).toBeLessThan(0);
    // cel wysoko (elewacja 60° w odwróconej połówce) → też zostaje
    aim.alignTo(target); // reset do normalnej
    aim.applyMovementPx(0, -((120 * Math.PI) / 180 / MOUSE_SENSITIVITY_RAD_PER_PX));
    const high = aim.targetDir(new Vector3());
    aim.renormalize(high.clone());
    expect(Math.cos(aim.pitchRad)).toBeLessThan(0);
  });
});
