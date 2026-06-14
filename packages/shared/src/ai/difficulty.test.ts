import { describe, expect, it } from 'vitest';
import { AiConfigError } from '../errors';
import { BOT_CONFIG, DIFFICULTY_LEVELS, loadBotConfig } from './difficulty';

function validTuning(): Record<string, unknown> {
  return {
    detectRangeM: 2500,
    disengageRangeM: 3500,
    threatConeDeg: 35,
    threatBehindDeg: 90,
    threatRangeM: 900,
    offensiveConeDeg: 22,
    offensiveRangeM: 700,
    minRangeM: 90,
    minFireRangeM: 60,
    lowEnergyIasKmh: 200,
    recoveredEnergyIasKmh: 330,
    cruiseThrottle: 0.85,
    evadeBreakDeg: 70,
    evadeJinkDeg: 22,
    evadeJinkPeriodS: 1.6,
    extendDiveDeg: 12,
    waypointReachedM: 450,
    groundSafetyMarginM: 300,
    groundHardFloorM: 140,
    groundLookAheadS: 4,
    groundClimbDeg: 25,
    maxDiveDeg: 28,
  };
}

function validLevel(): Record<string, unknown> {
  return { reactionTimeS: 0.3, aimErrorDeg: 1.3, maxG: 6, throttle: 0.92, fireRangeM: 450, fireConeDeg: 3.5 };
}

function validRaw(): Record<string, unknown> {
  return {
    tuning: validTuning(),
    levels: { latwy: validLevel(), normalny: validLevel(), trudny: validLevel() },
  };
}

describe('loadBotConfig', () => {
  it('BOT_CONFIG ładuje się i ma wszystkie poziomy', () => {
    for (const lvl of DIFFICULTY_LEVELS) {
      expect(BOT_CONFIG.levels[lvl]).toBeDefined();
    }
  });

  it('konwersja jednostek °→rad i km/h→m/s', () => {
    const cfg = loadBotConfig(validRaw());
    expect(cfg.tuning.threatConeRad).toBeCloseTo((35 * Math.PI) / 180, 9);
    expect(cfg.tuning.lowEnergyIasMs).toBeCloseTo(200 / 3.6, 9);
    expect(cfg.tuning.recoveredEnergyIasMs).toBeCloseTo(330 / 3.6, 9);
    expect(cfg.levels.normalny.aimErrorRad).toBeCloseTo((1.3 * Math.PI) / 180, 9);
    expect(cfg.levels.trudny.fireConeRad).toBeCloseTo((3.5 * Math.PI) / 180, 9);
  });

  it('degradacja jest monotoniczna: trudniejszy = celniejszy i szybszy w reakcji', () => {
    expect(BOT_CONFIG.levels.latwy.aimErrorRad).toBeGreaterThan(BOT_CONFIG.levels.normalny.aimErrorRad);
    expect(BOT_CONFIG.levels.normalny.aimErrorRad).toBeGreaterThan(BOT_CONFIG.levels.trudny.aimErrorRad);
    expect(BOT_CONFIG.levels.latwy.reactionTimeS).toBeGreaterThan(BOT_CONFIG.levels.trudny.reactionTimeS);
    expect(BOT_CONFIG.levels.latwy.maxG).toBeLessThan(BOT_CONFIG.levels.trudny.maxG);
  });

  it('odrzuca wartość poza zakresem sanity', () => {
    const bad = validRaw();
    (bad['tuning'] as Record<string, unknown>)['detectRangeM'] = 50; // za mało
    expect(() => loadBotConfig(bad)).toThrow(AiConfigError);
  });

  it('odrzuca nieznane pole (literówka)', () => {
    const bad = validRaw();
    (bad['levels'] as { normalny: Record<string, unknown> }).normalny['maksG'] = 6;
    expect(() => loadBotConfig(bad)).toThrow(AiConfigError);
  });

  it('odrzuca brakujący poziom trudności', () => {
    const bad = validRaw();
    delete (bad['levels'] as Record<string, unknown>)['trudny'];
    expect(() => loadBotConfig(bad)).toThrow(AiConfigError);
  });
});
