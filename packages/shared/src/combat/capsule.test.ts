import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { closestSegmentSegment, segmentCapsuleHit, segmentCapsuleHitT } from './capsule';

// Oś kapsuły wzdłuż X w (0,0,0)→(10,0,0), promień 1 — model „skrzydła".
const a = new Vector3(0, 0, 0);
const b = new Vector3(10, 0, 0);
const R = 1;

describe('closestSegmentSegment', () => {
  it('przecinające się odcinki → dystans 0, parametry w środku', () => {
    const out = { s: 0, t: 0 };
    const d2 = closestSegmentSegment(
      new Vector3(5, -1, 0),
      new Vector3(5, 1, 0),
      a,
      b,
      out,
    );
    expect(d2).toBeCloseTo(0, 6);
    expect(out.s).toBeCloseTo(0.5, 6); // środek pionowego odcinka
    expect(out.t).toBeCloseTo(0.5, 6); // środek osi kapsuły
  });

  it('równoległe odcinki → stały dystans między prostymi', () => {
    const out = { s: 0, t: 0 };
    const d2 = closestSegmentSegment(
      new Vector3(0, 3, 0),
      new Vector3(10, 3, 0),
      a,
      b,
      out,
    );
    expect(Math.sqrt(d2)).toBeCloseTo(3, 6);
  });

  it('odcinek zdegenerowany do punktu → dystans punkt↔odcinek', () => {
    const out = { s: 0, t: 0 };
    const p = new Vector3(5, 4, 0);
    const d2 = closestSegmentSegment(p, p, a, b, out);
    expect(Math.sqrt(d2)).toBeCloseTo(4, 6);
    expect(out.t).toBeCloseTo(0.5, 6);
  });
});

describe('segmentCapsuleHitT / segmentCapsuleHit', () => {
  it('pocisk przebija oś poprzecznie → trafienie ~w połowie toru', () => {
    const t = segmentCapsuleHitT(new Vector3(5, -2, 0), new Vector3(5, 2, 0), a, b, R);
    expect(t).toBeGreaterThanOrEqual(0);
    expect(t).toBeCloseTo(0.5, 6);
  });

  it('pocisk mija kapsułę w bezpiecznej odległości → pudło', () => {
    expect(segmentCapsuleHit(new Vector3(5, 3, 0), new Vector3(15, 3, 0), a, b, R)).toBe(false);
  });

  it('pocisk muska w granicy promienia → trafienie', () => {
    // tor równoległy w odległości 0.9 < R od osi
    expect(segmentCapsuleHit(new Vector3(0, 0.9, 0), new Vector3(10, 0.9, 0), a, b, R)).toBe(true);
  });

  it('start wewnątrz kapsuły → trafienie', () => {
    expect(segmentCapsuleHit(new Vector3(5, 0, 0), new Vector3(5, 0.2, 0), a, b, R)).toBe(true);
  });

  it('tunelowanie: oba końce toru poza kapsułą, ale przelot przez nią → trafienie', () => {
    // długi szybki tor z jednej strony na drugą, mija oś o 0 w środku
    expect(segmentCapsuleHit(new Vector3(5, -50, 0), new Vector3(5, 50, 0), a, b, R)).toBe(true);
  });

  it('trafienie półkolistej czaszy poza odcinkiem osi (x<0) w zasięgu promienia', () => {
    // punkt tuż za końcem „a": odległość od końca osi < R
    expect(segmentCapsuleHit(new Vector3(-0.5, 0, 0), new Vector3(-0.5, 0.4, 0), a, b, R)).toBe(true);
  });

  it('poza czaszą końca osi (x znacznie < 0) → pudło', () => {
    expect(segmentCapsuleHit(new Vector3(-3, 0, 0), new Vector3(-3, 0.4, 0), a, b, R)).toBe(false);
  });

  it('kapsuła zdegenerowana (a==b) zachowuje się jak sfera', () => {
    const c = new Vector3(0, 0, 0);
    expect(segmentCapsuleHit(new Vector3(-2, 0, 0), new Vector3(2, 0, 0), c, c, R)).toBe(true);
    expect(segmentCapsuleHit(new Vector3(-2, 5, 0), new Vector3(2, 5, 0), c, c, R)).toBe(false);
  });
});
