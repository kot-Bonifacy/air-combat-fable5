import { Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { FIXED_DT_S } from '../constants';
import { createRng } from '../math/rng';
import { SPITFIRE_MK2 } from '../planes/loader';
import { BulletPool } from './ballistics';
import { createFireControl, updateFire, type FiringPlatform } from './fire';
import { segmentSphereHit } from './hit';
import { applyDamage, createHealth } from './health';

// Test integracyjny: cała ścieżka walki bez renderera (ogień → tor pocisku →
// hit-detekcja → HP → zniszczenie). Lustro pętli klienta (main.ts) na czystej
// fizyce z shared — gwarancja, że rozgrywka działa nawet jeśli warstwa
// renderowania (tracery/meshe) jest nietestowalna headless.

function platformAtOrigin(): FiringPlatform {
  return { position: new Vector3(), velocity: new Vector3(), orientation: new Quaternion() };
}

describe('walka end-to-end: strzał → tor → trafienie → HP → zniszczenie', () => {
  it('seria w nieruchomy cel na dystansie konwergencji niszczy go', () => {
    const arm = SPITFIRE_MK2.armament;
    const platform = platformAtOrigin(); // nos w +Z (orientacja identyczności)
    const pool = new BulletPool(2000);
    const fc = createFireControl(arm);
    const rng = createRng(7);
    const targetCenter = new Vector3(0, 0, arm.convergenceM);
    const targetRadius = 8;
    const health = createHealth(50);

    let ticks = 0;
    let hits = 0;
    while (health.alive && ticks < 600) {
      updateFire(fc, arm, platform, 0, rng, pool, true, FIXED_DT_S);
      pool.update(arm.bulletDragK, arm.bulletLifetimeS, FIXED_DT_S);
      for (const b of pool.bullets) {
        if (!b.active) continue;
        if (segmentSphereHit(b.prevPosition, b.position, targetCenter, targetRadius)) {
          b.active = false;
          if (applyDamage(health, b.damage) !== 'ignored') hits++;
        }
      }
      ticks++;
    }

    expect(health.alive).toBe(false);
    expect(hits).toBeGreaterThan(0);
    expect(ticks).toBeLessThan(600); // padł grubo przed 10 s (kryterium: seria niszczy cel)
  });

  it('bez trzymania spustu nic nie leci i amunicja stoi', () => {
    const arm = SPITFIRE_MK2.armament;
    const platform = platformAtOrigin();
    const pool = new BulletPool(64);
    const fc = createFireControl(arm);
    for (let i = 0; i < 120; i++) {
      updateFire(fc, arm, platform, 0, createRng(1), pool, false, FIXED_DT_S);
      pool.update(arm.bulletDragK, arm.bulletLifetimeS, FIXED_DT_S);
    }
    expect(pool.activeCount).toBe(0);
    expect(fc.ammoRemaining).toBe(arm.ammoPerGun * arm.muzzles.length);
  });
});
