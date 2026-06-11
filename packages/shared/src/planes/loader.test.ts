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
    expect(SPITFIRE_MK1.name).toBe('Spitfire Mk I');
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

  it('K = 1/(π·e·AR)', () => {
    const config = loadPlaneConfig(validRaw());
    expect(inducedDragFactor(config)).toBeCloseTo(1 / (Math.PI * 0.8 * 5.6), 12);
  });
});
