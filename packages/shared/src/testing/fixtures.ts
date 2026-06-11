import type { PlaneConfig } from '../planes/loader';

/**
 * Samolot testowy o okrągłych liczbach — do testów jednostkowych sił,
 * gdzie asercje liczone są ręcznie. NIE jest to konfiguracja gameplayowa
 * (te żyją w planes/*.json).
 */
export function createTestPlane(overrides: Partial<PlaneConfig> = {}): PlaneConfig {
  return {
    name: 'Testowy',
    massKg: 2000,
    wingAreaM2: 20,
    aspectRatio: 6,
    oswaldE: 0.8,
    cd0: 0.02,
    clMax: 1.5,
    clAlphaPerRad: 5,
    enginePowerW: 600_000,
    fullThrottleHeightM: 4000,
    propEfficiency: 0.8,
    staticThrustN: 10_000,
    ...overrides,
  };
}
