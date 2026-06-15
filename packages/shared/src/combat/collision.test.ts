import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { planesCollide } from './collision';

// Promień kolizji jednego płatowca; suma dwóch = 6 m (jak collisionRadiusM w
// spitfire-mk1.json: 3 + 3). Próg zderzenia = odległość środków < rA + rB.
const R = 3;

describe('planesCollide — zderzenie samolot↔samolot', () => {
  it('nieruchome, środki bliżej niż suma promieni → kolizja', () => {
    const a = new Vector3(0, 0, 0);
    const b = new Vector3(0, 0, 5); // 5 m < 6 m
    expect(planesCollide(a, a, R, b, b, R)).toBe(true);
  });

  it('nieruchome, środki dalej niż suma promieni → brak kolizji', () => {
    const a = new Vector3(0, 0, 0);
    const b = new Vector3(0, 0, 7); // 7 m > 6 m
    expect(planesCollide(a, a, R, b, b, R)).toBe(false);
  });

  it('lot czołowy: mijają się w jednym ticku — test zamiatany łapie mimo że OBA końce poza sferą', () => {
    // A leci +Z, B leci −Z; start 10 m przed sobą, koniec 10 m za sobą.
    // |relPrev| = |relCurr| = 20 m — test punktowy by to zgubił (tunelowanie).
    const prevA = new Vector3(0, 0, -10);
    const posA = new Vector3(0, 0, 10);
    const prevB = new Vector3(0, 0, 10);
    const posB = new Vector3(0, 0, -10);
    expect(planesCollide(prevA, posA, R, prevB, posB, R)).toBe(true);
  });

  it('mijanka boczna, minimalne zbliżenie < suma promieni → kolizja', () => {
    // A nieruchomy w origin; B przelatuje wzdłuż X na stałym z=4 (<6) — closest 4 m.
    const a = new Vector3(0, 0, 0);
    const prevB = new Vector3(-50, 0, 4);
    const posB = new Vector3(50, 0, 4);
    expect(planesCollide(a, a, R, prevB, posB, R)).toBe(true);
  });

  it('mijanka boczna, minimalne zbliżenie > suma promieni → brak kolizji', () => {
    const a = new Vector3(0, 0, 0);
    const prevB = new Vector3(-50, 0, 8); // closest 8 m > 6 m
    const posB = new Vector3(50, 0, 8);
    expect(planesCollide(a, a, R, prevB, posB, R)).toBe(false);
  });

  it('lot równoległy tuż poza zasięgiem (stały odstęp 6.1 m) → brak kolizji', () => {
    const prevA = new Vector3(0, 0, 0);
    const posA = new Vector3(0, 0, 20);
    const prevB = new Vector3(6.1, 0, 0);
    const posB = new Vector3(6.1, 0, 20);
    expect(planesCollide(prevA, posA, R, prevB, posB, R)).toBe(false);
  });

  it('o progu decyduje SUMA promieni (asymetryczne hitboxy)', () => {
    const a = new Vector3(0, 0, 0);
    const b = new Vector3(0, 0, 9);
    expect(planesCollide(a, a, 4, b, b, 4)).toBe(false); // suma 8 < 9
    expect(planesCollide(a, a, 5, b, b, 5)).toBe(true); // suma 10 > 9
  });

  it('kolejne wywołania nie wyciekają stanem (scratch reużyty poprawnie)', () => {
    const a = new Vector3(0, 0, 0);
    const near = new Vector3(0, 0, 4);
    const far = new Vector3(0, 0, 100);
    expect(planesCollide(a, a, R, near, near, R)).toBe(true);
    expect(planesCollide(a, a, R, far, far, R)).toBe(false);
    expect(planesCollide(a, a, R, near, near, R)).toBe(true);
  });
});
