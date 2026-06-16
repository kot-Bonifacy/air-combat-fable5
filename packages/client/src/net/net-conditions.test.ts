import { describe, expect, it } from 'vitest';
import { defaultNetConditions, rollDelayMs, type NetConditionsConfig } from './net-conditions';

function cfg(over: Partial<NetConditionsConfig> = {}): NetConditionsConfig {
  return { enabled: true, latencyMs: 50, jitterMs: 20, loss: 0, ...over };
}

describe('rollDelayMs — symulator warunków sieci', () => {
  it('wyłączony → zawsze 0 ms, zero strat', () => {
    const c = cfg({ enabled: false, loss: 1 });
    for (let i = 0; i < 50; i++) expect(rollDelayMs(c, () => 0)).toBe(0);
  });

  it('opóźnienie mieści się w [latency − jitter, latency + jitter]', () => {
    const c = cfg({ latencyMs: 100, jitterMs: 20 });
    expect(rollDelayMs(c, () => 0)).toBeCloseTo(80); // rand=0 → jitter = −jitterMs
    expect(rollDelayMs(c, () => 1)).toBeCloseTo(120); // rand=1 → jitter = +jitterMs
    expect(rollDelayMs(c, () => 0.5)).toBeCloseTo(100); // środek
  });

  it('nigdy nie zwraca ujemnego opóźnienia (jitter > latency)', () => {
    const c = cfg({ latencyMs: 10, jitterMs: 50 });
    expect(rollDelayMs(c, () => 0)).toBe(0);
  });

  it('strata: rand poniżej progu loss → null (zgubiony), powyżej → liczba', () => {
    const c = cfg({ loss: 0.3, jitterMs: 0 });
    // pierwszy rand() użyty do testu straty
    expect(rollDelayMs(c, makeRand([0.1]))).toBeNull(); // 0.1 < 0.3 → strata
    expect(rollDelayMs(c, makeRand([0.9, 0.5]))).not.toBeNull(); // 0.9 ≥ 0.3 → przechodzi
  });

  it('loss=0 nie zużywa losowania na próbę straty', () => {
    const c = cfg({ loss: 0, latencyMs: 100, jitterMs: 10 });
    // tylko jedno losowanie (jitter); rand=1 → +10
    expect(rollDelayMs(c, makeRand([1]))).toBeCloseTo(110);
  });

  it('domyślne warunki są wyłączone (produkcja nie symuluje lagu)', () => {
    expect(defaultNetConditions().enabled).toBe(false);
  });
});

function makeRand(values: number[]): () => number {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)] ?? 0;
}
