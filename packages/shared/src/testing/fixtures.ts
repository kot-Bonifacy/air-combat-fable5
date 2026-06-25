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
    fuelEnduranceFullThrottleS: 900,
    nMaxG: 8,
    nMinG: -4,
    rollRateCurve: [
      [100, 40],
      [400, 80],
    ],
    alignTauS: 0.4,
    weathervaneMaxRateDegS: 120,
    sideslipDampingS: 0.5,
    sideslipMaxAccelG: 0.3,
    hpPool: 100,
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
          dispersionMrad: 3,
          damagePerHit: 1.5,
          bulletDragK: 0.001,
          bulletLifetimeS: 3,
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
      aggressivenessRoll: 5,
      aggressivenessPitch: 4,
      bankThresholdDeg: 20,
      pushoverConeDeg: 20,
      smoothingTauS: 0.12,
      yawGain: 0.5,
      maxYawRateDegS: 8,
      aimExpo: 0, // fizyka liczona ręcznie → liniowy instruktor jak dawniej
      aimExpoRefDeg: 60,
    },
    wreck: {
      baseLoadG: 0.35,
      pitchAuthority: 0.25,
    },
    ...overrides,
  };
}
