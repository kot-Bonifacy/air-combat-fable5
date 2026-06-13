import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import {
  amIOnTargetTail,
  angleBetweenRad,
  computeGeometry,
  createGeometry,
  isTargetOnMyTail,
} from './geometry';

const FWD = new Vector3(0, 0, 1);

describe('angleBetweenRad', () => {
  it('0 dla równoległych, π dla przeciwnych, π/2 dla prostopadłych', () => {
    expect(angleBetweenRad(new Vector3(0, 0, 2), new Vector3(0, 0, 5))).toBeCloseTo(0, 9);
    expect(angleBetweenRad(new Vector3(0, 0, 1), new Vector3(0, 0, -1))).toBeCloseTo(Math.PI, 9);
    expect(angleBetweenRad(new Vector3(1, 0, 0), new Vector3(0, 0, 1))).toBeCloseTo(Math.PI / 2, 9);
  });
});

describe('computeGeometry', () => {
  it('na szóstej: napastnik za celem, oba na +Z', () => {
    const g = createGeometry();
    computeGeometry(
      new Vector3(0, 0, 0),
      FWD,
      new Vector3(0, 0, 200),
      new Vector3(0, 0, 300),
      FWD,
      new Vector3(0, 0, 150),
      g,
    );
    expect(g.rangeM).toBeCloseTo(300, 6);
    expect(g.attackerOffBoresightRad).toBeCloseTo(0, 6); // cel na wprost
    expect(g.aspectRad).toBeCloseTo(0, 6); // jestem za ogonem
    expect(g.targetOffBoresightRad).toBeCloseTo(Math.PI, 6); // cel nie celuje we mnie
    expect(g.closureMs).toBeCloseTo(50, 6); // 200 − 150, zbliżanie
    expect(amIOnTargetTail(g, 0.3, 400)).toBe(true);
    expect(isTargetOnMyTail(g, 0.3, Math.PI / 2, 400)).toBe(false);
  });

  it('czołowo: oba lecą na siebie', () => {
    const g = createGeometry();
    computeGeometry(
      new Vector3(0, 0, 0),
      FWD,
      new Vector3(0, 0, 200),
      new Vector3(0, 0, 500),
      new Vector3(0, 0, -1),
      new Vector3(0, 0, -200),
      g,
    );
    expect(g.attackerOffBoresightRad).toBeCloseTo(0, 6); // cel na wprost
    expect(g.aspectRad).toBeCloseTo(Math.PI, 6);
    expect(g.targetOffBoresightRad).toBeCloseTo(0, 6); // cel też celuje we mnie
    expect(g.closureMs).toBeCloseTo(400, 6);
  });

  it('cel na moim ogonie: za mną, celuje we mnie', () => {
    const g = createGeometry();
    computeGeometry(
      new Vector3(0, 0, 0),
      FWD,
      new Vector3(0, 0, 200),
      new Vector3(0, 0, -250),
      FWD, // cel leci na +Z, czyli w moją stronę
      new Vector3(0, 0, 230),
      g,
    );
    expect(g.attackerOffBoresightRad).toBeCloseTo(Math.PI, 6); // cel za mną
    expect(g.targetOffBoresightRad).toBeCloseTo(0, 6); // cel celuje we mnie
    expect(isTargetOnMyTail(g, 0.5, Math.PI / 2, 400)).toBe(true);
    expect(amIOnTargetTail(g, 0.5, 400)).toBe(false);
  });

  it('tożsamość aspect = π − targetOffBoresight w dowolnej geometrii', () => {
    const g = createGeometry();
    computeGeometry(
      new Vector3(10, 20, 30),
      new Vector3(1, 0.2, 0.3).normalize(),
      new Vector3(50, 5, 10),
      new Vector3(400, 120, -80),
      new Vector3(-0.4, 0.1, 0.9).normalize(),
      new Vector3(-30, 0, 60),
      g,
    );
    expect(g.aspectRad + g.targetOffBoresightRad).toBeCloseTo(Math.PI, 9);
  });
});
