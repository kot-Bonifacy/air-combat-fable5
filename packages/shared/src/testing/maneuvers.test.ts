import { describe, expect, it } from 'vitest';
import { MS_TO_KMH } from '../constants';
import { SPITFIRE_MK1 } from '../planes/loader';
import { climbTest, diveEnergyTest, stallTest, topSpeedTest } from './maneuvers';

// Złote testy osiągów Spitfire Mk I vs tabela z docs/fizyka-lotu.md rozdz. 10.
// Asercje na surowych km/h (nie błędzie względnym), żeby porażka pokazywała
// zmierzoną wartość — to narzędzie kalibracji, nie tylko bramka.

describe('złote testy osiągów — Spitfire Mk I', () => {
  it('V_max na poziomie morza ≈ 460 km/h TAS ±8%', () => {
    const vKmh = topSpeedTest(SPITFIRE_MK1, 0) * MS_TO_KMH;
    expect(vKmh).toBeGreaterThan(460 * 0.92);
    expect(vKmh).toBeLessThan(460 * 1.08);
  });

  it('V_max na 5500 m ≈ 570 km/h TAS ±8%', () => {
    const vKmh = topSpeedTest(SPITFIRE_MK1, 5500) * MS_TO_KMH;
    expect(vKmh).toBeGreaterThan(570 * 0.92);
    expect(vKmh).toBeLessThan(570 * 1.08);
  });

  it('V przeciągnięcia ≈ 120 km/h IAS ±8%', () => {
    const vKmh = stallTest(SPITFIRE_MK1) * MS_TO_KMH;
    expect(vKmh).toBeGreaterThan(120 * 0.92);
    expect(vKmh).toBeLessThan(120 * 1.08);
  });

  it('wznoszenie początkowe ≈ 12.5 m/s ±15%, zgodne z bilansem mocy', () => {
    const result = climbTest(SPITFIRE_MK1);
    expect(result.rocMs).toBeGreaterThan(12.5 * 0.85);
    expect(result.rocMs).toBeLessThan(12.5 * 1.15);
    // symulacja w czasie vs bilans mocy — rozjazd >5% = błąd integratora/modelu
    expect(Math.abs(result.rocMs - result.analyticRocMs) / result.analyticRocMs).toBeLessThan(
      0.05,
    );
  });

  it('nurkowanie bez ciągu: energia całkowita nie rośnie w żadnym ticku', () => {
    const result = diveEnergyTest(SPITFIRE_MK1);
    expect(result.maxTickEnergyGainJ).toBeLessThanOrEqual(0);
    expect(result.totalEnergyChangeJ).toBeLessThan(0);
  });
});
