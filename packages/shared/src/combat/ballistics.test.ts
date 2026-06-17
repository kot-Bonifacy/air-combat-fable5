import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { FIXED_DT_S, GRAVITY_MS2 } from '../constants';
import { BulletPool, stepBullet, type Bullet } from './ballistics';

// Testy analityczne balistyki (faza-05.md krok 1). Tolerancje to kontrakt —
// 2% na opad/zasięg waliduje przede wszystkim integrator przy kroku 1/60 s.

const V0_MS = 744; // prędkość wylotowa .303 (≈ wartość z konfiguracji)
const DRAG_K = 0.001; // [1/m] — kalibracja: v(300 m) ≈ 0.74·v0

function makeBullet(velocity: Vector3): Bullet {
  return {
    position: new Vector3(0, 0, 0),
    prevPosition: new Vector3(),
    origin: new Vector3(),
    velocity: velocity.clone(),
    ageS: 0,
    active: true,
    damage: 0,
    ownerId: 0,
    tracer: false,
    rewindTicks: 0,
  };
}

/** Strzał poziomy wzdłuż +Z; opad [m] i prędkość [m/s] dokładnie na z = targetZ. */
function measureAtZ(dragK: number, dtS: number, targetZ: number): { dropM: number; speedMs: number } {
  const b = makeBullet(new Vector3(0, 0, V0_MS));
  for (let i = 0; i < 100_000; i++) {
    const prevZ = b.position.z;
    const prevY = b.position.y;
    const prevSpeed = b.velocity.length();
    stepBullet(b, dragK, dtS);
    if (b.position.z >= targetZ) {
      const alpha = (targetZ - prevZ) / (b.position.z - prevZ);
      const y = prevY + alpha * (b.position.y - prevY);
      const speed = prevSpeed + alpha * (b.velocity.length() - prevSpeed);
      return { dropM: -y, speedMs: speed };
    }
  }
  throw new Error('pocisk nie osiągnął targetZ');
}

describe('balistyka pocisku', () => {
  it('opad bez oporu = ½·g·(d/v0)² (analitycznie, <2%)', () => {
    const targetZ = 300;
    const { dropM } = measureAtZ(0, FIXED_DT_S, targetZ);
    const t = targetZ / V0_MS; // bez oporu prędkość pozioma stała
    const analytic = 0.5 * GRAVITY_MS2 * t * t;
    expect(Math.abs(dropM - analytic) / analytic).toBeLessThan(0.02);
  });

  it('spadek prędkości z oporem = v0·e^(−k·x) (<2%)', () => {
    // wzdłuż toru dv/dx = −k·v ⇒ v(x)=v0·e^(−k·x); grawitacja perturbuje <0.1%
    const targetZ = 300;
    const { speedMs } = measureAtZ(DRAG_K, FIXED_DT_S, targetZ);
    const analytic = V0_MS * Math.exp(-DRAG_K * targetZ);
    expect(Math.abs(speedMs - analytic) / analytic).toBeLessThan(0.02);
  });

  it('opad z oporem (300 m) zgodny z gęstym całkowaniem referencyjnym (<2%)', () => {
    // opór kwadratowy nie ma zamkniętej formy z grawitacją — "analitykiem" jest
    // ten sam model scałkowany 16× gęściej (zbieżność semi-implicit Eulera)
    const coarse = measureAtZ(DRAG_K, FIXED_DT_S, 300).dropM;
    const fine = measureAtZ(DRAG_K, FIXED_DT_S / 16, 300).dropM;
    expect(Math.abs(coarse - fine) / fine).toBeLessThan(0.02);
  });

  it('zasięg w czasie życia: zgodny z referencją (<1%) i w paśmie ~1.1 km', () => {
    function rangeAfter(dtS: number, durationS: number): number {
      const b = makeBullet(new Vector3(0, 0, V0_MS));
      const steps = Math.round(durationS / dtS);
      for (let i = 0; i < steps; i++) stepBullet(b, DRAG_K, dtS);
      return b.position.z;
    }
    const coarse = rangeAfter(FIXED_DT_S, 3);
    const fine = rangeAfter(FIXED_DT_S / 16, 3);
    expect(Math.abs(coarse - fine) / fine).toBeLessThan(0.01);
    expect(coarse).toBeGreaterThan(1000);
    expect(coarse).toBeLessThan(1400);
  });

  it('prevPosition zapisany przed ruchem (odcinek do hit-detekcji)', () => {
    const b = makeBullet(new Vector3(0, 0, V0_MS));
    stepBullet(b, 0, FIXED_DT_S);
    expect(b.prevPosition.z).toBe(0);
    expect(b.position.z).toBeCloseTo(V0_MS * FIXED_DT_S, 6);
  });
});

describe('pula pocisków', () => {
  const ORIGIN = new Vector3();
  const VEL = new Vector3(0, 0, V0_MS);

  it('spawn zwraca slot z puli (reużycie, zero nowych obiektów)', () => {
    const pool = new BulletPool(8);
    for (let i = 0; i < 50; i++) {
      const b = pool.spawn(ORIGIN, VEL, 3, 0, false);
      expect(b).not.toBeNull();
      expect(pool.bullets).toContain(b); // zawsze jeden z prealokowanych
      if (b) b.active = false; // zwolnij, by kolejny spawn wziął wolny slot
    }
  });

  it('activeCount rośnie ze spawnem, maleje po wygaśnięciu', () => {
    const pool = new BulletPool(8);
    pool.spawn(ORIGIN, VEL, 3, 0, true);
    pool.spawn(ORIGIN, VEL, 3, 0, false);
    expect(pool.activeCount).toBe(2);
    // czas życia 0.05 s → po kilku krokach 1/60 s oba gasną
    for (let i = 0; i < 5; i++) pool.update(DRAG_K, 0.05, FIXED_DT_S);
    expect(pool.activeCount).toBe(0);
  });

  it('pełna pula nadpisuje najstarszy pocisk (graceful degradation)', () => {
    const pool = new BulletPool(2);
    const a = pool.spawn(ORIGIN, VEL, 3, 0, false);
    pool.update(DRAG_K, 10, FIXED_DT_S); // a postarzeje
    const b = pool.spawn(ORIGIN, VEL, 3, 0, false);
    expect(pool.activeCount).toBe(2);
    const c = pool.spawn(ORIGIN, VEL, 3, 0, false); // brak wolnych → najstarszy = a
    expect(c).toBe(a);
    expect(b?.active).toBe(true);
  });
});
