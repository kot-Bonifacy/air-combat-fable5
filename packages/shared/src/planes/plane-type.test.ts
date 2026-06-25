import { describe, expect, it } from 'vitest';
import { NetError } from '../errors';
import { BF109_E, SPITFIRE_MK2, wingspanM } from './loader';
import {
  DEFAULT_PLANE_TYPE,
  PLANE_TYPES,
  clampPlaneType,
  planeConfigOf,
  planeLabelOf,
  planeTypeFromCode,
  planeTypeToCode,
  type PlaneType,
} from './plane-type';

describe('rejestr typów samolotów', () => {
  it('kod ↔ typ round-trip dla wszystkich typów (stabilny format v4)', () => {
    for (const type of PLANE_TYPES) {
      expect(planeTypeFromCode(planeTypeToCode(type))).toBe(type);
    }
    // kolejność = kod na drucie: NIE zmieniać bez bumpu protokołu
    expect(planeTypeToCode('spitfire')).toBe(0);
    expect(planeTypeToCode('bf109')).toBe(1);
  });

  it('odrzuca nieznany kod (obrona dekodera snapshotu)', () => {
    expect(() => planeTypeFromCode(99)).toThrow(NetError);
  });

  it('mapuje typ na właściwą konfigurację', () => {
    expect(planeConfigOf('spitfire')).toBe(SPITFIRE_MK2);
    expect(planeConfigOf('bf109')).toBe(BF109_E);
  });

  it('etykiety krótkie do HUD/lobby', () => {
    expect(planeLabelOf('spitfire')).toMatch(/spitfire/i);
    expect(planeLabelOf('bf109')).toMatch(/109/);
  });

  it('clampPlaneType broni przed wartością z sieci (niezmiennik nr 11)', () => {
    expect(clampPlaneType('bf109')).toBe('bf109');
    expect(clampPlaneType('spitfire')).toBe('spitfire');
    expect(clampPlaneType('messerschmitt')).toBe(DEFAULT_PLANE_TYPE);
    expect(clampPlaneType(undefined)).toBe(DEFAULT_PLANE_TYPE);
    expect(clampPlaneType(7)).toBe(DEFAULT_PLANE_TYPE);
  });

  it('rozpiętość z geometrii zgodna z historią (Spit ≈ 11,2 m, 109 ≈ 9,9 m)', () => {
    expect(wingspanM(SPITFIRE_MK2)).toBeCloseTo(11.2, 1);
    expect(wingspanM(BF109_E)).toBeCloseTo(9.9, 1);
    // asymetria geometrii (mniejsze skrzydło 109) widoczna w rozpiętości
    expect(wingspanM(BF109_E)).toBeLessThan(wingspanM(SPITFIRE_MK2));
  });

  it('DEFAULT_PLANE_TYPE jest poprawnym typem z listy', () => {
    const t: PlaneType = DEFAULT_PLANE_TYPE;
    expect(PLANE_TYPES).toContain(t);
  });
});
