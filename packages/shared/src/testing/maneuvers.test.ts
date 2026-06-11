import { describe, expect, it } from 'vitest';
import { MS_TO_KMH } from '../constants';
import { SPITFIRE_MK1 } from '../planes/loader';
import {
  climbTest,
  diveEnergyTest,
  rollRateTest,
  stallTest,
  sustainedTurnTest,
  topSpeedTest,
} from './maneuvers';

// Złote testy osiągów Spitfire Mk I vs tabela z docs/fizyka-lotu.md rozdz. 10.
// Asercje na surowych km/h (nie błędzie względnym), żeby porażka pokazywała
// zmierzoną wartość — to narzędzie kalibracji, nie tylko bramka.

// Cele: Spitfire Mk IA w konfiguracji Bitwy o Anglię (100 oktanów, +12 lb boost):
// próby N.3171 (A&AEE 1940) + RAE 06.1940 (314 mph SL, 359 mph @ 11.5k ft),
// zakręt wg Morgan & Morris (n=2.7); szczegóły docs/fizyka-lotu.md rozdz. 10.
describe('złote testy osiągów — Spitfire Mk IA (+12 lb)', () => {
  it('V_max na poziomie morza ≈ 505 km/h TAS ±8% (314 mph, RAE +12 lb)', () => {
    const vKmh = topSpeedTest(SPITFIRE_MK1, 0) * MS_TO_KMH;
    expect(vKmh).toBeGreaterThan(505 * 0.92);
    expect(vKmh).toBeLessThan(505 * 1.08);
  });

  it('V_max na 5500 m ≈ 570 km/h TAS ±8% (354 mph @ 18.9k ft, N.3171)', () => {
    const vKmh = topSpeedTest(SPITFIRE_MK1, 5500) * MS_TO_KMH;
    expect(vKmh).toBeGreaterThan(570 * 0.92);
    expect(vKmh).toBeLessThan(570 * 1.08);
  });

  it('V przeciągnięcia ≈ 117 km/h IAS ±8% (~73 mph przy 6050 lb)', () => {
    const vKmh = stallTest(SPITFIRE_MK1) * MS_TO_KMH;
    expect(vKmh).toBeGreaterThan(117 * 0.92);
    expect(vKmh).toBeLessThan(117 * 1.08);
  });

  it('wznoszenie początkowe ≈ 17 m/s ±15% (+12 lb; +6¼ dawało 2820 ft/min)', () => {
    const result = climbTest(SPITFIRE_MK1);
    expect(result.rocMs).toBeGreaterThan(17 * 0.85);
    expect(result.rocMs).toBeLessThan(17 * 1.15);
    // symulacja w czasie vs bilans mocy — rozjazd >5% = błąd integratora/modelu
    expect(Math.abs(result.rocMs - result.analyticRocMs) / result.analyticRocMs).toBeLessThan(
      0.05,
    );
  });

  it('roll rate @ 350 km/h ≈ 70°/s ±10% (pełna lotka przez kopertę)', () => {
    const rateDegS = rollRateTest(SPITFIRE_MK1, 350);
    expect(rateDegS).toBeGreaterThan(70 * 0.9);
    expect(rateDegS).toBeLessThan(70 * 1.1);
  });

  it('zakręt ustalony 360° ≈ 16 s ±8% (M&M: 17.2 s @ 12k ft → SL szybciej)', () => {
    const result = sustainedTurnTest(SPITFIRE_MK1);
    expect(result.turnTimeS).toBeGreaterThan(16 * 0.92);
    expect(result.turnTimeS).toBeLessThan(16 * 1.08);
    // symulacja vs bilans mocy — rozjazd >8% = regulator albo model się rozjechał
    expect(
      Math.abs(result.turnTimeS - result.analyticTurnTimeS) / result.analyticTurnTimeS,
    ).toBeLessThan(0.08);
    // "z utrzymaniem wysokości": dryf w mierzonym okrążeniu ograniczony
    expect(Math.abs(result.altitudeDriftM)).toBeLessThan(60);
  });

  it('nurkowanie bez ciągu: energia całkowita nie rośnie w żadnym ticku', () => {
    const result = diveEnergyTest(SPITFIRE_MK1);
    expect(result.maxTickEnergyGainJ).toBeLessThanOrEqual(0);
    expect(result.totalEnergyChangeJ).toBeLessThan(0);
  });
});
