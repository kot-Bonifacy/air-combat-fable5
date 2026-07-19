import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { GRAVITY_MS2 } from '../constants';
import { createLeadSolution, solveLead } from './lead';

const MUZZLE = 744;

describe('solveLead — punkt przechwycenia', () => {
  it('cel po prostej, strzelec nieruchomy: rozwiązanie analityczne', () => {
    // cel 300 m przed strzelcem, leci bokiem 100 m/s; t z |aimPoint| = s·t
    const out = solveLead(
      new Vector3(0, 0, 0),
      new Vector3(0, 0, 0),
      new Vector3(0, 0, 300),
      new Vector3(100, 0, 0),
      MUZZLE,
      createLeadSolution(),
    );
    // 10000 t² + 90000 = 744² t² → t = sqrt(90000/(744²−10000))
    const tExpected = Math.sqrt(90000 / (MUZZLE * MUZZLE - 10000));
    expect(out.timeToInterceptS).toBeCloseTo(tExpected, 6);
    expect(out.aimPoint.x).toBeCloseTo(100 * tExpected, 4);
    expect(out.aimPoint.z).toBeCloseTo(300, 6);
    // pocisk wzdłuż aimDir przez czas t dociera do aimPoint
    const hit = new Vector3().copy(out.aimDir).multiplyScalar(MUZZLE * out.timeToInterceptS);
    expect(hit.x).toBeCloseTo(out.aimPoint.x, 3);
    expect(hit.z).toBeCloseTo(out.aimPoint.z, 3);
    expect(out.aimDir.length()).toBeCloseTo(1, 9);
  });

  it('cel ucieka szybciej niż pocisk → brak rozwiązania, aimDir = LOS', () => {
    const out = solveLead(
      new Vector3(0, 0, 0),
      new Vector3(0, 0, 0),
      new Vector3(0, 0, 300),
      new Vector3(0, 0, 800), // szybciej niż 744 i w tę samą stronę
      MUZZLE,
      createLeadSolution(),
    );
    expect(out.timeToInterceptS).toBe(-1);
    expect(out.aimDir.x).toBeCloseTo(0, 9);
    expect(out.aimDir.z).toBeCloseTo(1, 9); // LOS do bieżącej pozycji celu
  });

  it('cel wprost z naprzeciwka: aimDir wzdłuż LOS (brak poprzecznej składowej)', () => {
    const out = solveLead(
      new Vector3(0, 0, 0),
      new Vector3(0, 0, 0),
      new Vector3(0, 0, 400),
      new Vector3(0, 0, -120),
      MUZZLE,
      createLeadSolution(),
    );
    expect(out.timeToInterceptS).toBeGreaterThan(0);
    expect(out.aimDir.x).toBeCloseTo(0, 9);
    expect(out.aimDir.y).toBeCloseTo(0, 9);
    expect(out.aimDir.z).toBeCloseTo(1, 9);
  });

  it('prędkość strzelca jest uwzględniona (lead liczony w jego układzie)', () => {
    // strzelec leci równolegle do celu z tą samą prędkością boczną — brak wyprzedzenia
    const out = solveLead(
      new Vector3(0, 0, 0),
      new Vector3(100, 0, 0),
      new Vector3(0, 0, 300),
      new Vector3(100, 0, 0),
      MUZZLE,
      createLeadSolution(),
    );
    expect(out.aimDir.x).toBeCloseTo(0, 6); // względny ruch boczny = 0 → celuj wprost
    expect(out.aimDir.z).toBeCloseTo(1, 6);
  });
});

describe('solveLead — kompensacja opadu grawitacyjnego', () => {
  // strzelec i cel na tej samej wysokości, cel leci prosto poziomo (pościg ogonowy)
  const SHOOTER_POS = new Vector3(0, 0, 0);
  const SHOOTER_VEL = new Vector3(0, 0, 130);
  const TARGET_POS = new Vector3(0, 0, 400);
  const TARGET_VEL = new Vector3(0, 0, 122);

  it('gravityMs2=0 (domyślnie, niższe poziomy): namiar poziomy — brak podniesienia', () => {
    const out = solveLead(SHOOTER_POS, SHOOTER_VEL, TARGET_POS, TARGET_VEL, MUZZLE, createLeadSolution());
    expect(out.aimDir.y).toBeCloseTo(0, 9); // cel co-altitude, brak kompensacji → celuj w płaszczyźnie
    expect(out.aimPoint.y).toBeCloseTo(0, 9);
  });

  it('gravityMs2>0 (as): namiar podniesiony DOKŁADNIE o ½·g·t² i nos celuje w górę', () => {
    const out = solveLead(SHOOTER_POS, SHOOTER_VEL, TARGET_POS, TARGET_VEL, MUZZLE, createLeadSolution(), GRAVITY_MS2);
    const t = out.timeToInterceptS;
    expect(t).toBeGreaterThan(0);
    // aimPoint podniesiony o pełny opad na czasie lotu (targetVel poziomy → wkład y celu = 0)
    expect(out.aimPoint.y).toBeCloseTo(0.5 * GRAVITY_MS2 * t * t, 6);
    expect(out.aimDir.y).toBeGreaterThan(0); // nos ponad LOS → pocisk opadnie w cel
    expect(out.aimDir.length()).toBeCloseTo(1, 9); // nadal jednostkowy
  });

  it('pocisk wystrzelony wzdłuż skompensowanego namiaru opada BLIŻEJ celu niż bez kompensacji', () => {
    // symulacja balistyczna: pocisk (grawitacja + brak oporu) wzdłuż aimDir, dziedziczy prędkość
    // strzelca; sprawdzamy pionowe pudło przy dolocie do z celu.
    function verticalMissAtTarget(gravityMs2: number): number {
      const lead = solveLead(SHOOTER_POS, SHOOTER_VEL, TARGET_POS, TARGET_VEL, MUZZLE, createLeadSolution(), gravityMs2);
      const pos = SHOOTER_POS.clone();
      const vel = SHOOTER_VEL.clone().addScaledVector(lead.aimDir, MUZZLE);
      const tgt = TARGET_POS.clone();
      const dt = 1 / 600; // drobny krok dla dokładności
      for (let i = 0; i < 2000; i++) {
        vel.y -= GRAVITY_MS2 * dt;
        const prevZ = pos.z;
        pos.addScaledVector(vel, dt);
        tgt.addScaledVector(TARGET_VEL, dt);
        if (prevZ <= tgt.z && pos.z >= tgt.z) return Math.abs(pos.y - tgt.y);
      }
      return Infinity;
    }
    const missNoComp = verticalMissAtTarget(0);
    const missComp = verticalMissAtTarget(GRAVITY_MS2);
    expect(missComp).toBeLessThan(missNoComp);
    expect(missComp).toBeLessThan(0.5); // skompensowany trafia niemal w środek (cel co-altitude)
  });
});
