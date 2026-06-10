import { Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { getForward, getRight, getUp } from './frame';

const EPS = 1e-12;

function expectVec(actual: Vector3, x: number, y: number, z: number): void {
  expect(actual.x).toBeCloseTo(x, 12);
  expect(actual.y).toBeCloseTo(y, 12);
  expect(actual.z).toBeCloseTo(z, 12);
  expect(Math.abs(actual.length() - 1)).toBeLessThan(EPS);
}

// Uwaga: ten plik celowo biegnie w czystym Node (bez DOM) — potwierdza,
// że klasy math z `three` działają poza przeglądarką (lekcja z opus4-7).

describe('frame helpers — 4 orientacje bazowe', () => {
  it('identyczność: nos +Z, góra +Y, prawe skrzydło −X', () => {
    const q = new Quaternion();
    expectVec(getForward(q), 0, 0, 1);
    expectVec(getUp(q), 0, 1, 0);
    expectVec(getRight(q), -1, 0, 0);
  });

  it('yaw 180° (obrót o π wokół +Y): nos −Z, góra bez zmian, right odwrócony', () => {
    const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI);
    expectVec(getForward(q), 0, 0, -1);
    expectVec(getUp(q), 0, 1, 0);
    expectVec(getRight(q), 1, 0, 0);
  });

  it('pitch 90° w górę (obrót o π/2 wokół −X): nos +Y, góra −Z', () => {
    const q = new Quaternion().setFromAxisAngle(new Vector3(-1, 0, 0), Math.PI / 2);
    expectVec(getForward(q), 0, 1, 0);
    expectVec(getUp(q), 0, 0, -1);
    expectVec(getRight(q), -1, 0, 0);
  });

  it('roll 90° w prawo (obrót o π/2 wokół +Z): góra → prawe skrzydło świata', () => {
    const q = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2);
    expectVec(getForward(q), 0, 0, 1);
    expectVec(getUp(q), -1, 0, 0);
    expectVec(getRight(q), 0, -1, 0);
  });
});
