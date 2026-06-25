import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { EMPLACEMENT_BELT_SIZE, EMPLACEMENT_COUNT, EMPLACEMENT_RANGE_M, SEA_LEVEL_M } from '../constants';
import { createTerrain } from './terrain';
import { Emplacement, emplacementBasePositions, hasTerrainLineOfSight, type AaTarget } from './emplacement';
import type { Terrain } from './terrain';

const DT = 1 / 60;

/** Teren zastępczy: tafla bardzo nisko (linia ognia zawsze nad terenem → LOS czysty). */
const flatTerrain: Terrain = {
  gridN: 2,
  gridSpacingM: 48,
  nodeCoordM: (i) => i,
  nodeHeightM: () => -100,
  heightAt: () => -100,
};
/** Teren zastępczy „mur": teren wysoko → linia ognia zawsze przesłonięta. */
const blockedTerrain: Terrain = { ...flatTerrain, heightAt: () => 5000 };

const target = (pos: Vector3, vel = new Vector3()): AaTarget => ({ id: 1, position: pos, velocity: vel });

/** Stepuje stanowisko przez `seconds` z jednym celem; zwraca łączną liczbę wystrzelonych pocisków. */
function fireOver(e: Emplacement, t: AaTarget, terrain: Terrain, seconds: number): number {
  let shots = 0;
  const ticks = Math.round(seconds / DT);
  for (let i = 0; i < ticks; i++) shots += e.update(DT, [t], terrain)?.shots ?? 0;
  return shots;
}

/** Stepuje aż taśma się wyczerpie (start przeładowania); zwraca łączną liczbę wystrzelonych pocisków. */
function fireUntilReloading(e: Emplacement, t: AaTarget, terrain: Terrain, maxSeconds = 30): number {
  let shots = 0;
  const ticks = Math.round(maxSeconds / DT);
  for (let i = 0; i < ticks; i++) {
    shots += e.update(DT, [t], terrain)?.shots ?? 0;
    if (e.reloading) break;
  }
  return shots;
}

describe('rozmieszczenie stanowisk', () => {
  const terrain = createTerrain();
  const positions = emplacementBasePositions(terrain);

  it('są EMPLACEMENT_COUNT stanowisk na lądzie (powyżej poziomu morza, nie na plaży)', () => {
    expect(positions).toHaveLength(EMPLACEMENT_COUNT);
    for (const p of positions) {
      // wysoko na zboczu góry: nie woda, nie niski piaszczysty szelf plaży (~+10 m)
      expect(p.y).toBeGreaterThan(SEA_LEVEL_M + 60);
      expect(terrain.heightAt(p.x, p.z)).toBeCloseTo(p.y, 3);
    }
  });

  it('są rozrzucone (każda para oddalona o > 1,5 km)', () => {
    for (let i = 0; i < positions.length; i++) {
      for (let j = i + 1; j < positions.length; j++) {
        const a = positions[i]!;
        const b = positions[j]!;
        expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(1500);
      }
    }
  });
});

describe('widoczność (LOS) wzdłuż terenu', () => {
  const terrain = createTerrain();

  it('linia nisko nad ziemią przez szczyt góry jest przesłonięta', () => {
    // z jednego brzegu na drugi, nisko (50 m) — między nimi rdzeń góry ~1000 m
    expect(hasTerrainLineOfSight(new Vector3(-3500, 50, 0), new Vector3(3500, 50, 0), terrain)).toBe(false);
  });

  it('linia wysoko nad terenem jest czysta', () => {
    expect(hasTerrainLineOfSight(new Vector3(0, 2500, 0), new Vector3(600, 2500, 0), terrain)).toBe(true);
  });
});

describe('ogień stanowiska', () => {
  const muzzleAt = () => new Emplacement(0, new Vector3(0, 0, 0));
  // cel w zasięgu, nad stanowiskiem (LOS czysty na flatTerrain)
  const near = () => new Vector3(0, 300, 100);

  it('nie strzela bez celu w zasięgu', () => {
    const e = muzzleAt();
    const far = target(new Vector3(0, 300, EMPLACEMENT_RANGE_M + 500));
    expect(fireOver(e, far, flatTerrain, 5)).toBe(0);
    expect(e.belt).toBe(EMPLACEMENT_BELT_SIZE);
  });

  it('nie strzela, gdy cel przesłonięty terenem (góra na linii ognia)', () => {
    const e = muzzleAt();
    expect(fireOver(e, target(near()), blockedTerrain, 5)).toBe(0);
  });

  it('zniszczone stanowisko milczy', () => {
    const e = muzzleAt();
    e.destroyed = true;
    expect(fireOver(e, target(near()), flatTerrain, 5)).toBe(0);
  });

  it('strzela seriami i po wyczerpaniu taśmy (~100) przechodzi w przeładowanie', () => {
    const e = muzzleAt();
    const fired = fireUntilReloading(e, target(near()), flatTerrain);
    expect(fired).toBe(EMPLACEMENT_BELT_SIZE); // zużyto dokładnie jedną taśmę
    expect(e.reloading).toBe(true);
  });

  it('podczas przeładowania milczy, po ~30 s taśma znów pełna', () => {
    const e = muzzleAt();
    const t = target(near());
    fireUntilReloading(e, t, flatTerrain); // wyczerpie taśmę → start przeładowania (timer 30 s)
    expect(e.reloading).toBe(true);
    const duringReload = fireOver(e, t, flatTerrain, 10); // 10 s < 30 s → wciąż milczy
    expect(duringReload).toBe(0);
    fireOver(e, t, flatTerrain, 25); // łącznie > 30 s → przeładowane i znów strzela
    expect(e.belt).toBeLessThan(EMPLACEMENT_BELT_SIZE); // napełniona taśma znów się zużywa
  });

  it('reset odbudowuje i napełnia taśmę', () => {
    const e = muzzleAt();
    fireOver(e, target(near()), flatTerrain, 10);
    e.reset();
    expect(e.belt).toBe(EMPLACEMENT_BELT_SIZE);
    expect(e.reloading).toBe(false);
    expect(e.destroyed).toBe(false);
  });

  it('wyprzedza cel: namiar odchyla się w stronę jego ruchu (nie celuje w pozycję bieżącą)', () => {
    const e = muzzleAt();
    // cel dokładnie nad działem, lecący w +X — wyprzedzenie musi odchylić namiar w +X
    fireOver(e, target(new Vector3(0, 300, 0), new Vector3(160, 0, 0)), flatTerrain, 2);
    expect(e.aimDirection.x).toBeGreaterThan(0.05);
  });

  it('namiar ma lag: nagła zmiana kierunku celu nie przeskakuje namiaru natychmiast', () => {
    const e = muzzleAt();
    const t = target(new Vector3(0, 300, 0), new Vector3(160, 0, 0));
    // krótka zbieżność (bez wyczerpania taśmy), namiar wiedzie w +X
    for (let i = 0; i < 90; i++) e.update(DT, [t], flatTerrain);
    const before = e.aimDirection.x;
    expect(before).toBeGreaterThan(0.05);
    // odwracamy ruch celu i robimy JEDEN krok — lag nie pozwala przeskoczyć w −X od razu
    t.velocity.set(-160, 0, 0);
    e.update(DT, [t], flatTerrain);
    expect(e.aimDirection.x).toBeLessThan(before); // ruszył w stronę nowego namiaru…
    expect(e.aimDirection.x).toBeGreaterThan(0); // …ale nie przeskoczył (wciąż wiedzie w starą stronę)
  });
});
