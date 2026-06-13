import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { segmentSphereHit, segmentSphereHitT } from './hit';

const C = new Vector3(0, 0, 0);
const R = 5;

describe('hit detection — odcinek vs sfera', () => {
  it('przelot na wylot w jednym ticku (oba końce POZA sferą)', () => {
    // kryterium fazy: trafienie łapane, gdy cały segment jest wewnątrz/przebija
    const t = segmentSphereHitT(new Vector3(-20, 0, 0), new Vector3(20, 0, 0), C, R);
    expect(t).toBeGreaterThan(0);
    expect(t).toBeLessThan(1);
    // wejście do sfery o promieniu 5 z punktu x=-20 na odcinku długości 40 → t=15/40
    expect(t).toBeCloseTo(15 / 40, 6);
  });

  it('styczna (odległość prostej = promień) liczy się jako trafienie', () => {
    const t = segmentSphereHitT(new Vector3(-20, R, 0), new Vector3(20, R, 0), C, R);
    expect(t).toBeGreaterThanOrEqual(0);
  });

  it('pudło tuż obok (odległość > promień) → brak trafienia', () => {
    expect(segmentSphereHit(new Vector3(-20, R + 0.01, 0), new Vector3(20, R + 0.01, 0), C, R)).toBe(
      false,
    );
  });

  it('start wewnątrz sfery → trafienie z t=0', () => {
    expect(segmentSphereHitT(new Vector3(1, 0, 0), new Vector3(50, 0, 0), C, R)).toBe(0);
  });

  it('koniec wewnątrz, start poza → trafienie', () => {
    const t = segmentSphereHitT(new Vector3(-20, 0, 0), new Vector3(2, 0, 0), C, R);
    expect(t).toBeGreaterThan(0);
    expect(t).toBeLessThanOrEqual(1);
  });

  it('sfera za końcem odcinka (segment za krótki) → brak trafienia', () => {
    expect(segmentSphereHit(new Vector3(-20, 0, 0), new Vector3(-10, 0, 0), C, R)).toBe(false);
  });

  it('sfera za startem (odcinek odlatuje od celu) → brak trafienia', () => {
    expect(segmentSphereHit(new Vector3(20, 0, 0), new Vector3(50, 0, 0), C, R)).toBe(false);
  });

  it('wejście za końcem odcinka (prosta trafia, ale dopiero za p1) → brak', () => {
    // na osi y=0 sfera wchodzi przy x=−R; p1=−6 nie sięga jeszcze x=−5
    expect(segmentSphereHit(new Vector3(-20, 0, 0), new Vector3(-6, 0, 0), C, R)).toBe(false);
  });

  it('zerowy odcinek: wewnątrz = trafienie, poza = pudło', () => {
    const inside = new Vector3(1, 1, 1);
    expect(segmentSphereHitT(inside, inside, C, R)).toBe(0);
    const outside = new Vector3(100, 0, 0);
    expect(segmentSphereHit(outside, outside, C, R)).toBe(false);
  });

  it('sfera przesunięta od początku układu', () => {
    const center = new Vector3(100, 50, -30);
    const t = segmentSphereHitT(
      new Vector3(80, 50, -30),
      new Vector3(120, 50, -30),
      center,
      R,
    );
    expect(t).toBeCloseTo(15 / 40, 6);
  });
});
