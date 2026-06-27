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
    dragHighClK: 0, // fikstura: czysta biegunowa paraboliczna (asercje liczone ręcznie)
    dragStallK: 0,
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
      aimRollDeadzoneDeg: 0, // martwa strefa wyłączona w harnessie (testy używają dużych kątów)
    },
    wreck: {
      baseLoadG: 0.35,
      pitchAuthority: 0.25,
    },
    zones: [
      { role: 'engine', shape: { kind: 'sphere', center: [0, 0, 2.3], radius: 1.3 }, maxHp: 50 },
      { role: 'cockpit', shape: { kind: 'sphere', center: [0, 0.4, -0.4], radius: 0.8 }, maxHp: 60 },
      { role: 'tank', shape: { kind: 'sphere', center: [0, -0.1, 1.0], radius: 0.9 }, maxHp: 40 },
      { role: 'wingL', shape: { kind: 'capsule', a: [0.9, -0.15, 0.2], b: [5.2, -0.15, -0.3], radius: 0.7 }, maxHp: 45 },
      { role: 'wingR', shape: { kind: 'capsule', a: [-0.9, -0.15, 0.2], b: [-5.2, -0.15, -0.3], radius: 0.7 }, maxHp: 45 },
      { role: 'tail', shape: { kind: 'capsule', a: [0, 0.1, -1.6], b: [0, 0.5, -4.6], radius: 0.6 }, maxHp: 40 },
    ],
    damage: {
      lightFrac: 0.66,
      heavyFrac: 0.33,
      enginePowerMid: 0.6,
      enginePowerLow: 0.3,
      wingClMaxLossFull: 0.35,
      wingCd0AddFull: 0.02,
      wingRollBiasFullRadS: 0.6,
      tailAuthorityFloor: 0.35,
      tankLeakDrainFactor: 4,
      fireIgniteChanceMg: 0.008,
      fireIgniteChanceCannon: 0.1,
      fireDotPerS: 4,
      fireSelfExtinguishS: 12,
    },
    ...overrides,
  };
}
