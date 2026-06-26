import { describe, expect, it } from 'vitest';
import { PlaneConfigError } from '../errors';
import { BF109_E, SPITFIRE_MK2, inducedDragFactor, loadPlaneConfig } from './loader';

function validRaw(): Record<string, unknown> {
  return {
    name: 'Testowy',
    massKg: 2700,
    wingAreaM2: 22.5,
    aspectRatio: 5.6,
    oswaldE: 0.8,
    cd0: 0.021,
    dragHighClK: 0.003,
    dragStallK: 0.8,
    clMax: 1.45,
    clAlphaPerRad: 5.0,
    enginePowerW: 768000,
    fullThrottleHeightM: 5000,
    propEfficiency: 0.8,
    staticThrustN: 13000,
    fuelEnduranceFullThrottleS: 900,
    nMaxG: 8,
    nMinG: -4,
    rollRateCurve: [
      [150, 30],
      [300, 70],
      [450, 85],
    ],
    alignTauS: 0.4,
    weathervaneMaxRateDegS: 120,
    sideslipDampingS: 0.5,
    sideslipMaxAccelG: 0.3,
    hpPool: 120,
    hitRadiusM: 6,
    collisionRadiusM: 3,
    armament: {
      groups: [
        {
          name: '.303',
          muzzleVelocityMs: 744,
          convergenceM: 200,
          convergenceRiseM: 0.41,
          fireRateRpmPerGun: 1150,
          ammoPerGun: 300,
          dispersionMrad: 3.0,
          damagePerHit: 1.5,
          bulletDragK: 0.001,
          bulletLifetimeS: 3.0,
          muzzles: [
            [1.5, -0.25, 1.2],
            [-1.5, -0.25, 1.2],
          ],
        },
      ],
    },
    stall: {
      buffetOnsetRatio: 0.9,
      aileronEffectiveness: 0.3,
      wingDropDelayS: 1.0,
      wingDropRateDegS: 40,
    },
    gTolerance: {
      onsetG: 4,
      toleranceGS: 6,
      recoveryRatePerS: 0.35,
      greyoutReserve: 0.6,
    },
    instructor: {
      aggressivenessRoll: 5.0,
      aggressivenessPitch: 2.5,
      bankThresholdDeg: 20,
      pushoverConeDeg: 20,
      smoothingTauS: 0.12,
      yawGain: 0.5,
      maxYawRateDegS: 8,
      aimExpo: 1.0,
      aimExpoRefDeg: 60,
    },
    wreck: {
      baseLoadG: 0.35,
      pitchAuthority: 0.25,
    },
  };
}

describe('loader konfiguracji samolotu', () => {
  it('poprawny JSON przechodzi i zachowuje wartości', () => {
    const config = loadPlaneConfig(validRaw());
    expect(config.name).toBe('Testowy');
    expect(config.massKg).toBe(2700);
    expect(config.enginePowerW).toBe(768000);
  });

  it('SPITFIRE_MK2 ładuje się z JSON (walidacja przy imporcie)', () => {
    expect(SPITFIRE_MK2.name).toBe('Spitfire Mk IIa (Merlin XII, +12 lb boost)');
    expect(SPITFIRE_MK2.wingAreaM2).toBeGreaterThan(0);
  });

  it('BF109_E ładuje się z JSON (drugi samolot, dwie grupy broni)', () => {
    expect(BF109_E.name).toBe('Bf 109 E-3 (DB 601A)');
    expect(BF109_E.armament.groups).toHaveLength(2);
    expect(BF109_E.armament.groups[1]?.name).toBe('MG FF');
  });

  it('brak wymaganego pola → PlaneConfigError z nazwą pola', () => {
    const raw = validRaw();
    delete raw['clMax'];
    expect(() => loadPlaneConfig(raw)).toThrowError(PlaneConfigError);
    expect(() => loadPlaneConfig(raw)).toThrowError(/clMax/);
  });

  it('zły typ pola → PlaneConfigError', () => {
    const raw = validRaw();
    raw['massKg'] = '2700';
    expect(() => loadPlaneConfig(raw)).toThrowError(/massKg/);
  });

  it('wartość poza zakresem sanity → PlaneConfigError (łapie pomyłki jednostek)', () => {
    const raw = validRaw();
    raw['enginePowerW'] = 768; // moc w kW zamiast W
    expect(() => loadPlaneConfig(raw)).toThrowError(/enginePowerW/);
  });

  it('nieznane pole → PlaneConfigError (łapie literówki)', () => {
    const raw = validRaw();
    raw['clMaks'] = 1.45;
    expect(() => loadPlaneConfig(raw)).toThrowError(/clMaks/);
  });

  it('NaN/Infinity → PlaneConfigError', () => {
    const raw = validRaw();
    raw['cd0'] = Number.NaN;
    expect(() => loadPlaneConfig(raw)).toThrowError(/cd0/);
  });

  it('nie-obiekt → PlaneConfigError', () => {
    expect(() => loadPlaneConfig(null)).toThrowError(PlaneConfigError);
    expect(() => loadPlaneConfig([1, 2])).toThrowError(PlaneConfigError);
  });

  it('rollRateCurve z malejącą IAS → PlaneConfigError (monotoniczność)', () => {
    const raw = validRaw();
    raw['rollRateCurve'] = [
      [300, 70],
      [150, 30],
    ];
    expect(() => loadPlaneConfig(raw)).toThrowError(/monotonicznie/);
  });

  it('literówka w sekcji stall → PlaneConfigError z pełną ścieżką', () => {
    const raw = validRaw();
    (raw['stall'] as Record<string, unknown>)['wingDropRateDegSec'] = 40;
    expect(() => loadPlaneConfig(raw)).toThrowError(/stall\.wingDropRateDegSec/);
  });

  it('nMinG ≥ 0 → PlaneConfigError (limit ujemny musi być ujemny)', () => {
    const raw = validRaw();
    raw['nMinG'] = 0;
    expect(() => loadPlaneConfig(raw)).toThrowError(/nMinG/);
  });

  /** Grupy broni z surowego configu (do mutacji w testach walidacji). */
  function rawGroups(raw: Record<string, unknown>): Record<string, unknown>[] {
    return (raw['armament'] as Record<string, unknown>)['groups'] as Record<string, unknown>[];
  }

  it('armament: poprawne uzbrojenie zachowuje wartości i lufy', () => {
    const config = loadPlaneConfig(validRaw());
    const gun = config.armament.groups[0];
    expect(gun?.muzzleVelocityMs).toBe(744);
    expect(gun?.muzzles).toHaveLength(2);
    expect(gun?.muzzles[0]?.[0]).toBe(1.5);
    expect(config.hpPool).toBe(120);
  });

  it('armament: brak grup → PlaneConfigError', () => {
    const raw = validRaw();
    (raw['armament'] as Record<string, unknown>)['groups'] = [];
    expect(() => loadPlaneConfig(raw)).toThrowError(/armament\.groups/);
  });

  it('armament: pole poza zakresem → PlaneConfigError ze ścieżką grupy', () => {
    const raw = validRaw();
    rawGroups(raw)[0]!['muzzleVelocityMs'] = 5; // m/s zamiast realnej
    expect(() => loadPlaneConfig(raw)).toThrowError(/armament\.groups\[0\]\.muzzleVelocityMs/);
  });

  it('armament: literówka w lufach → PlaneConfigError', () => {
    const raw = validRaw();
    rawGroups(raw)[0]!['muzzles'] = [[1.5, -0.25]]; // brak Z
    expect(() => loadPlaneConfig(raw)).toThrowError(/armament\.groups\[0\]\.muzzles/);
  });

  it('armament: brak nazwy grupy → PlaneConfigError', () => {
    const raw = validRaw();
    delete rawGroups(raw)[0]!['name'];
    expect(() => loadPlaneConfig(raw)).toThrowError(/armament\.groups\[0\]\.name/);
  });

  it('armament: nieznane pole grupy → PlaneConfigError', () => {
    const raw = validRaw();
    rawGroups(raw)[0]!['kadencja'] = 1150;
    expect(() => loadPlaneConfig(raw)).toThrowError(/armament\.groups\[0\]\.kadencja/);
  });

  it('K = 1/(π·e·AR)', () => {
    const config = loadPlaneConfig(validRaw());
    expect(inducedDragFactor(config)).toBeCloseTo(1 / (Math.PI * 0.8 * 5.6), 12);
  });
});
