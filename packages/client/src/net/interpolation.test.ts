import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { ARENA_SIZE_M, PHYSICS_HZ, type EntitySnapshot } from '@air-combat/shared';
import { SnapshotInterpolator, createInterpolatedState } from './interpolation';

const MS_PER_TICK = 1000 / PHYSICS_HZ;
const ID = 7;

// Ruch liniowy +X z V=60 m/s dobrany tak, że x(tick) = tick (x = V·tick/PHYSICS_HZ),
// więc dokładny lerp daje x == renderClockMs / MS_PER_TICK. Pozwala sprawdzić, że
// interpolacja leży DOKŁADNIE na torze, niezależnie od pozycji zegara odtwarzania.
const V = 60;

function ent(x: number, vx = V): EntitySnapshot {
  return {
    id: ID,
    life: 'alive',
    stalled: false,
    isLocal: false,
    position: new Vector3(x, 1000, 0),
    orientation: new Quaternion(),
    velocity: new Vector3(vx, 0, 0),
    throttle: 0.8,
    healthFrac: 1,
    ammoFrac: 1,
    ammoSecondaryFrac: 1,
    fuelFrac: 1,
    planeType: 'spitfire',
  };
}

describe('SnapshotInterpolator', () => {
  it('wykrywa zgubione snapshoty po luce ticków', () => {
    const interp = new SnapshotInterpolator();
    interp.ingest(100, [ent(0)]);
    interp.ingest(102, [ent(2)]); // odstęp = 2 ticki = norma (30 Hz)
    expect(interp.lostSnapshots).toBe(0);
    interp.ingest(108, [ent(8)]); // skok o 6 ticków → 2 snapshoty zgubione
    expect(interp.lostSnapshots).toBe(2);
  });

  it('odrzuca sample starszy/duplikat po reorderingu', () => {
    const interp = new SnapshotInterpolator();
    interp.ingest(100, [ent(0)]);
    interp.ingest(102, [ent(2)]);
    interp.ingest(100, [ent(999)]); // spóźniony, starszy tick — ignorowany
    const out = createInterpolatedState();
    // zegar startuje przy 100·MS_PER_TICK − 100 ms (przed pierwszym) → clamp do najstarszego
    interp.update(0);
    expect(interp.sample(ID, out)).toBe(true);
    expect(out.position.x).toBeLessThan(3); // gdyby wszedł x=999, byłoby duże
  });

  it('interpoluje DOKŁADNIE na torze ruchu liniowego i renderuje płynnie (bez teleportów)', () => {
    const interp = new SnapshotInterpolator();
    const out = createInterpolatedState();
    let tick = 600;
    interp.ingest(tick, [ent(tick)]);

    let prevX = -Infinity;
    let warmedSamples = 0;
    // 2 s: snapshoty co 2 ticki (30 Hz), render 60 fps
    for (let frame = 0; frame < 120; frame++) {
      // dwa snapshoty na każde ~3.3 klatki — tu prosto: snapshot co drugą klatkę
      if (frame % 2 === 0) {
        tick += 2;
        interp.ingest(tick, [ent(tick)]);
      }
      interp.update(1 / 60);
      expect(interp.sample(ID, out)).toBe(true);
      // monotoniczność: ruch tylko do przodu, bez cofania/teleportu
      expect(out.position.x).toBeGreaterThanOrEqual(prevX - 1e-6);
      prevX = out.position.x;

      // w środku bufora (między najstarszym a najnowszym sample'em) lerp jest dokładny
      const clock = interp.renderClockMs;
      if (clock > 601 * MS_PER_TICK && clock < (tick - 1) * MS_PER_TICK && !out.extrapolated) {
        expect(out.position.x).toBeCloseTo(clock / MS_PER_TICK, 4);
        warmedSamples++;
      }
    }
    expect(warmedSamples).toBeGreaterThan(40); // realnie interpolowaliśmy
    // bufor utrzymuje ~100 ms zaległości (INTERP_DELAY_MS)
    expect(interp.bufferMs).toBeGreaterThan(60);
    expect(interp.bufferMs).toBeLessThan(160);
  });

  it('ekstrapoluje przy zacięciu renderu (duży frame dt) — ograniczona, oznaczona flagą', () => {
    const interp = new SnapshotInterpolator();
    const out = createInterpolatedState();
    let tick = 300;
    interp.ingest(tick, [ent(tick)]);
    for (let i = 0; i < 30; i++) {
      tick += 2;
      interp.ingest(tick, [ent(tick)]);
      interp.update(1 / 60);
    }
    const lastX = tick; // x ostatniego sample'a
    interp.update(0.3); // zacięcie 300 ms → zegar wyprzedza ostatni sample
    expect(interp.sample(ID, out)).toBe(true);
    expect(out.extrapolated).toBe(true);
    expect(out.position.x).toBeGreaterThan(lastX); // ruszył dalej niż ostatni znany punkt
    // ekstrapolacja ograniczona do 100 ms prędkości: V·0.1 s = 6 m ponad ostatni sample
    expect(out.position.x).toBeLessThanOrEqual(lastX + V * 0.1 + 1e-6);
  });

  it('lerp pozycji jest bezpieczny na szwie torusa (nie przez środek areny)', () => {
    const interp = new SnapshotInterpolator();
    const out = createInterpolatedState();
    const half = ARENA_SIZE_M / 2;
    // dwa sample'y tuż przy przeciwległych krawędziach — toroidalnie SĄSIADUJĄ
    const a = ent(half - 50, 0);
    a.position.set(half - 50, 1000, 0);
    const b = ent(-half + 50, 0);
    b.position.set(-half + 50, 1000, 0);
    let tick = 500;
    interp.ingest(tick, [withPos(a, half - 50)]);
    // dosyć snapshotów, by zegar wszedł między sample'y
    for (let i = 0; i < 10; i++) {
      tick += 2;
      interp.ingest(tick, [withPos(i % 2 ? b : a, i % 2 ? -half + 50 : half - 50)]);
      interp.update(1 / 60);
    }
    interp.update(1 / 60);
    interp.sample(ID, out);
    // interpolacja przy szwie: |x| blisko krawędzi, NIGDY w okolicy środka (0)
    expect(Math.abs(out.position.x)).toBeGreaterThan(half - 200);
  });
});

function withPos(e: EntitySnapshot, x: number): EntitySnapshot {
  return { ...e, position: new Vector3(x, 1000, 0), velocity: new Vector3(0, 0, 0) };
}
