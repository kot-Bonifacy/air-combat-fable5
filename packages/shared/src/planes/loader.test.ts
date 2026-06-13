import { describe, expect, it } from 'vitest';
import { PlaneConfigError } from '../errors';
import { SPITFIRE_MK1, inducedDragFactor, loadPlaneConfig } from './loader';

function validRaw(): Record<string, unknown> {
  return {
    name: 'Testowy',
    massKg: 2700,
    wingAreaM2: 22.5,
    aspectRatio: 5.6,
    oswaldE: 0.8,
    cd0: 0.021,
    clMax: 1.45,
    clAlphaPerRad: 5.0,
    enginePowerW: 768000,
    fullThrottleHeightM: 5000,
    propEfficiency: 0.8,
    staticThrustN: 13000,
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
    armament: {
      muzzleVelocityMs: 744,
      convergenceM: 200,
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
    stall: {
      buffetOnsetRatio: 0.9,
      noseDropRateDegS: 12,
      aileronEffectiveness: 0.3,
      wingDropDelayS: 1.0,
      wingDropRateDegS: 40,
    },
    instructor: {
      aggressivenessRoll: 5.0,
      aggressivenessPitch: 2.5,
      bankThresholdDeg: 20,
      pushoverConeDeg: 20,
      smoothingTauS: 0.12,
      yawGain: 0.5,
      maxYawRateDegS: 8,
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

  it('SPITFIRE_MK1 ładuje się z JSON (walidacja przy imporcie)', () => {
    expect(SPITFIRE_MK1.name).toBe('Spitfire Mk IA (BoB, +12 lb boost)');
    expect(SPITFIRE_MK1.wingAreaM2).toBeGreaterThan(0);
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
    (raw['stall'] as Record<string, unknown>)['noseDropRateDegSec'] = 12;
    expect(() => loadPlaneConfig(raw)).toThrowError(/stall\.noseDropRateDegSec/);
  });

  it('nMinG ≥ 0 → PlaneConfigError (limit ujemny musi być ujemny)', () => {
    const raw = validRaw();
    raw['nMinG'] = 0;
    expect(() => loadPlaneConfig(raw)).toThrowError(/nMinG/);
  });

  it('armament: poprawne uzbrojenie zachowuje wartości i lufy', () => {
    const config = loadPlaneConfig(validRaw());
    expect(config.armament.muzzleVelocityMs).toBe(744);
    expect(config.armament.muzzles).toHaveLength(2);
    expect(config.armament.muzzles[0]?.[0]).toBe(1.5);
    expect(config.hpPool).toBe(120);
  });

  it('armament: pole poza zakresem → PlaneConfigError ze ścieżką', () => {
    const raw = validRaw();
    (raw['armament'] as Record<string, unknown>)['muzzleVelocityMs'] = 5; // m/s zamiast realnej
    expect(() => loadPlaneConfig(raw)).toThrowError(/armament\.muzzleVelocityMs/);
  });

  it('armament: literówka w lufach → PlaneConfigError', () => {
    const raw = validRaw();
    (raw['armament'] as Record<string, unknown>)['muzzles'] = [[1.5, -0.25]]; // brak Z
    expect(() => loadPlaneConfig(raw)).toThrowError(/armament\.muzzles/);
  });

  it('armament: nieznane pole → PlaneConfigError', () => {
    const raw = validRaw();
    (raw['armament'] as Record<string, unknown>)['kadencja'] = 1150;
    expect(() => loadPlaneConfig(raw)).toThrowError(/armament\.kadencja/);
  });

  it('K = 1/(π·e·AR)', () => {
    const config = loadPlaneConfig(validRaw());
    expect(inducedDragFactor(config)).toBeCloseTo(1 / (Math.PI * 0.8 * 5.6), 12);
  });
});
