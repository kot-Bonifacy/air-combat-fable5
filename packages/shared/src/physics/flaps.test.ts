import { describe, expect, it } from 'vitest';
import {
  clampFlapIndex,
  effectiveFlapIndex,
  flapRipWingDamageHp,
  flapsAvailable,
} from './flaps';
import { FLAP_DISABLE_WING_LEVEL, MS_TO_KMH, ZONE_COUNT, zoneRoleIndex } from '..';
import { createTestPlane } from '../testing/fixtures';

// Klapy (fizyka v2 R3, §6.4): indeks pozycji to INPUT (reconcile-safe), efektywna pozycja spada do 0
// po urwaniu (poziom uszkodzenia skrzydła), obrażenia urwania ∝ względnemu przekroczeniu ripIas.

const WING_L = zoneRoleIndex('wingL');
const WING_R = zoneRoleIndex('wingR');

/** Tablica poziomów uszkodzeń z ustawionym poziomem wskazanej strefy (reszta 0). */
function levelsWith(zone: number, level: number): number[] {
  const l = new Array<number>(ZONE_COUNT).fill(0);
  l[zone] = level;
  return l;
}

describe('klapy R3 — clampFlapIndex', () => {
  const plane = createTestPlane(); // 2 pozycje: schowane(0), pełne(1)

  it('ogranicza do zakresu pozycji i zaokrągla', () => {
    expect(clampFlapIndex(0, plane)).toBe(0);
    expect(clampFlapIndex(1, plane)).toBe(1);
    expect(clampFlapIndex(5, plane)).toBe(1); // ponad zakres → ostatnia pozycja
    expect(clampFlapIndex(-2, plane)).toBe(0); // poniżej zera → 0
    expect(clampFlapIndex(0.6, plane)).toBe(1); // zaokrąglenie
  });
});

describe('klapy R3 — flapsAvailable / effectiveFlapIndex', () => {
  const plane = createTestPlane();

  it('sprawny samolot (null / brak uszkodzeń skrzydeł) → klapy dostępne', () => {
    expect(flapsAvailable(null)).toBe(true);
    expect(flapsAvailable(levelsWith(WING_L, FLAP_DISABLE_WING_LEVEL - 1))).toBe(true);
  });

  it('skrzydło na progu wyłączenia (lewe LUB prawe) → klapy urwane', () => {
    expect(flapsAvailable(levelsWith(WING_L, FLAP_DISABLE_WING_LEVEL))).toBe(false);
    expect(flapsAvailable(levelsWith(WING_R, FLAP_DISABLE_WING_LEVEL))).toBe(false);
    expect(flapsAvailable(levelsWith(WING_R, 3))).toBe(false);
  });

  it('effectiveFlapIndex: żądany gdy sprawne, 0 gdy urwane', () => {
    expect(effectiveFlapIndex(1, null, plane)).toBe(1);
    expect(effectiveFlapIndex(1, levelsWith(WING_L, 1), plane)).toBe(1); // lekkie uszkodzenie nie urywa
    expect(effectiveFlapIndex(1, levelsWith(WING_L, FLAP_DISABLE_WING_LEVEL), plane)).toBe(0);
    // klampuje też żądanie ponad zakres, gdy sprawne
    expect(effectiveFlapIndex(9, null, plane)).toBe(1);
  });
});

describe('klapy R3 — flapRipWingDamageHp', () => {
  const plane = createTestPlane(); // pełne: ripIasKmh 250, ripDamagePerS 60
  const dt = 1;

  it('klapy schowane (effIndex 0) → zero obrażeń niezależnie od prędkości', () => {
    expect(flapRipWingDamageHp(0, 300 / MS_TO_KMH, plane, dt)).toBe(0);
  });

  it('poniżej ripIas → zero obrażeń', () => {
    expect(flapRipWingDamageHp(1, 200 / MS_TO_KMH, plane, dt)).toBe(0);
    expect(flapRipWingDamageHp(1, 250 / MS_TO_KMH, plane, dt)).toBe(0); // dokładnie na progu
  });

  it('powyżej ripIas → obrażenia ∝ względnemu przekroczeniu', () => {
    // 300 km/h vs ripIas 250 → overFrac = 300/250 − 1 = 0.2 → 60·0.2·1 = 12 HP
    expect(flapRipWingDamageHp(1, 300 / MS_TO_KMH, plane, dt)).toBeCloseTo(12, 5);
    // dwa razy większe przekroczenie → dwa razy większe obrażenia
    expect(flapRipWingDamageHp(1, 350 / MS_TO_KMH, plane, dt)).toBeCloseTo(24, 5);
  });

  it('skaluje się liniowo z dt', () => {
    const full = flapRipWingDamageHp(1, 300 / MS_TO_KMH, plane, 1);
    const half = flapRipWingDamageHp(1, 300 / MS_TO_KMH, plane, 0.5);
    expect(half).toBeCloseTo(full / 2, 6);
  });
});
