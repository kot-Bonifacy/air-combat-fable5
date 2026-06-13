import { Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { FIXED_DT_S } from '../constants';
import { createRng } from '../math/rng';
import { SPITFIRE_MK1, type Armament } from '../planes/loader';
import { BulletPool } from './ballistics';
import {
  aimDirectionBody,
  createFireControl,
  totalAmmo,
  updateFire,
  volleyIntervalS,
  type FiringPlatform,
} from './fire';

function testArmament(over: Partial<Armament> = {}): Armament {
  return {
    muzzleVelocityMs: 744,
    convergenceM: 200,
    convergenceRiseM: 0,
    fireRateRpmPerGun: 1150,
    ammoPerGun: 300,
    dispersionMrad: 0,
    damagePerHit: 1.5,
    bulletDragK: 0.001,
    bulletLifetimeS: 3,
    muzzles: [
      [1.5, -0.25, 1.2],
      [-1.5, -0.25, 1.2],
    ],
    ...over,
  };
}

function platformAtOrigin(): FiringPlatform {
  return { position: new Vector3(), velocity: new Vector3(), orientation: new Quaternion() };
}

describe('kontrola ognia — kadencja i amunicja', () => {
  it('salwa = jeden pocisk z każdej lufy', () => {
    const arm = testArmament();
    const pool = new BulletPool(16);
    const fc = createFireControl(arm);
    const fired = updateFire(fc, arm, platformAtOrigin(), 0, createRng(1), pool, true, FIXED_DT_S);
    expect(fired).toBe(arm.muzzles.length);
    expect(pool.activeCount).toBe(arm.muzzles.length);
  });

  it('kadencja blokuje drugą salwę w tym samym oknie', () => {
    const arm = testArmament();
    const pool = new BulletPool(16);
    const fc = createFireControl(arm);
    const platform = platformAtOrigin();
    expect(updateFire(fc, arm, platform, 0, createRng(1), pool, true, FIXED_DT_S)).toBe(2);
    // kolejny tick (1/60 s < odstęp salw) — jeszcze cooldown
    expect(updateFire(fc, arm, platform, 0, createRng(1), pool, true, FIXED_DT_S)).toBe(0);
  });

  it('amunicja się wyczerpuje i ogień ustaje', () => {
    const arm = testArmament({ ammoPerGun: 3 }); // 2 lufy × 3 = 6 pocisków
    const pool = new BulletPool(16);
    const fc = createFireControl(arm);
    const platform = platformAtOrigin();
    const interval = volleyIntervalS(arm);
    let total = 0;
    for (let i = 0; i < 10; i++) {
      total += updateFire(fc, arm, platform, 0, createRng(1), pool, true, interval);
    }
    expect(total).toBe(totalAmmo(arm));
    expect(fc.ammoRemaining).toBe(0);
  });

  it('zwolnienie spustu zeruje cooldown (natychmiastowy strzał po naciśnięciu)', () => {
    const arm = testArmament();
    const pool = new BulletPool(16);
    const fc = createFireControl(arm);
    const platform = platformAtOrigin();
    updateFire(fc, arm, platform, 0, createRng(1), pool, true, FIXED_DT_S); // salwa, cooldown > 0
    updateFire(fc, arm, platform, 0, createRng(1), pool, false, 1.0); // spust puszczony
    expect(fc.cooldownS).toBe(0);
  });
});

describe('konwergencja luf', () => {
  it('strumienie z obu skrzydeł schodzą się dokładnie na convergenceM', () => {
    const arm = testArmament({ convergenceM: 200 });
    const pool = new BulletPool(16);
    const fc = createFireControl(arm);
    updateFire(fc, arm, platformAtOrigin(), 0, createRng(1), pool, true, FIXED_DT_S);

    for (let i = 0; i < arm.muzzles.length; i++) {
      const b = pool.bullets[i];
      if (!b?.active) throw new Error('brak pocisku');
      const dir = b.velocity.clone().normalize();
      const t = (arm.convergenceM - b.position.z) / dir.z; // dolot do z = convergenceM
      const xAtConv = b.position.x + t * dir.x;
      const yAtConv = b.position.y + t * dir.y;
      expect(xAtConv).toBeCloseTo(0, 5);
      expect(yAtConv).toBeCloseTo(0, 5);
    }
  });

  it('aimDirectionBody robi zbieg (toe-in) ku osi', () => {
    const left = aimDirectionBody(new Vector3(1.5, -0.25, 1.2), 200, 0, new Vector3());
    const right = aimDirectionBody(new Vector3(-1.5, -0.25, 1.2), 200, 0, new Vector3());
    expect(left.x).toBeLessThan(0); // lewe skrzydło celuje w prawo
    expect(right.x).toBeGreaterThan(0);
    expect(left.z).toBeGreaterThan(0.99); // niemal do przodu
  });

  it('convergenceRiseM podnosi celowanie (kompensacja opadu) ponad linię osi', () => {
    const muzzle = new Vector3(1.5, -0.25, 1.2);
    const flat = aimDirectionBody(muzzle.clone(), 200, 0, new Vector3());
    const raised = aimDirectionBody(muzzle.clone(), 200, 0.41, new Vector3());
    // ten sam wylot, większe rise ⇒ kierunek mierzy wyżej (większy składnik +Y)
    expect(raised.y).toBeGreaterThan(flat.y);
    // geometryczny punkt celowania na convergenceM podnosi się o ~rise nad oś
    const tRaised = (200 - muzzle.z) / raised.z;
    expect(muzzle.y + tRaised * raised.y).toBeCloseTo(0.41, 2);
    const tFlat = (200 - muzzle.z) / flat.z;
    expect(muzzle.y + tFlat * flat.y).toBeCloseTo(0, 5);
  });
});

describe('rozrzut z seeded RNG', () => {
  it('ten sam seed → identyczne prędkości pocisków (determinizm klient↔serwer)', () => {
    const arm = testArmament({ dispersionMrad: 4 });
    const run = (): Vector3[] => {
      const pool = new BulletPool(16);
      const fc = createFireControl(arm);
      updateFire(fc, arm, platformAtOrigin(), 0, createRng(42), pool, true, FIXED_DT_S);
      return pool.bullets.filter((b) => b.active).map((b) => b.velocity.clone());
    };
    const a = run();
    const b = run();
    expect(a.length).toBe(arm.muzzles.length);
    a.forEach((v, i) => {
      expect(v.x).toBe(b[i]?.x);
      expect(v.y).toBe(b[i]?.y);
      expect(v.z).toBe(b[i]?.z);
    });
  });

  it('różny seed → różne kierunki (rozrzut faktycznie działa)', () => {
    const arm = testArmament({ dispersionMrad: 4 });
    const dirFor = (seed: number): Vector3 => {
      const pool = new BulletPool(16);
      const fc = createFireControl(arm);
      updateFire(fc, arm, platformAtOrigin(), 0, createRng(seed), pool, true, FIXED_DT_S);
      const b = pool.bullets[0];
      if (!b) throw new Error('brak pocisku');
      return b.velocity.clone().normalize();
    };
    expect(dirFor(1).angleTo(dirFor(2))).toBeGreaterThan(0);
  });
});

describe('smugacze i bilans obrażeń', () => {
  it('co 3. pocisk jest smugaczem', () => {
    const arm = testArmament({ ammoPerGun: 6 }); // 12 pocisków → indeksy 0,3,6,9 = 4 smugacze
    const pool = new BulletPool(32);
    const fc = createFireControl(arm);
    const platform = platformAtOrigin();
    const interval = volleyIntervalS(arm);
    for (let i = 0; i < 6; i++) updateFire(fc, arm, platform, 0, createRng(1), pool, true, interval);
    const tracers = pool.bullets.filter((b) => b.tracer).length;
    expect(tracers).toBe(4);
  });

  it('Spitfire .303: słabe działka — zestrzelenie wymaga długiej serii', () => {
    const arm = SPITFIRE_MK1.armament;
    const bulletsToKill = Math.ceil(SPITFIRE_MK1.hpPool / arm.damagePerHit);
    const bulletsPerSecond = (arm.fireRateRpmPerGun / 60) * arm.muzzles.length;
    const ttkPerfectS = bulletsToKill / bulletsPerSecond; // 100% trafień (dolne ograniczenie)
    const ttk30pctS = ttkPerfectS / 0.3; // realistyczna celność ~30%
    expect(bulletsToKill).toBeGreaterThan(40); // dużo trafień = słabe kaemy
    expect(ttkPerfectS).toBeLessThan(1); // nawet idealny ogień to seria, nie błysk
    expect(ttk30pctS).toBeGreaterThan(1.2); // realistycznie 1.5-2 s na muszce
    expect(ttk30pctS).toBeLessThan(3);
  });
});
