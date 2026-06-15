import { describe, expect, it } from 'vitest';
import { MS_TO_KMH } from '../constants';
import { SPITFIRE_MK2 } from '../planes/loader';
import {
  climbTest,
  diveEnergyTest,
  rollRateTest,
  stallTest,
  sustainedTurnTest,
  topSpeedTest,
} from './maneuvers';

// Złote testy osiągów Spitfire Mk IIa vs tabela z docs/fizyka-lotu.md rozdz. 10.
// Asercje na surowych km/h (nie błędzie względnym), żeby porażka pokazywała
// zmierzoną wartość — to narzędzie kalibracji, nie tylko bramka.

// Cele: Spitfire Mk IIa (Merlin XII, 100 oktanów, +12 lb boost). Płatowiec, lotki
// i struktura identyczne jak Mk IA — różnica to cięższy zespół napędowy (masa
// 6172 lb) i charakterystyka Merlin XII. V_max 357 mph @ 17 000 ft (≈574 km/h @
// 5182 m, spec. Mk II), V przeciągnięcia skalowane do 6172 lb, wznoszenie przy
// +12 lb (katalog. 2995 ft/min przy niższym ratingu), zakręt wg Morgan & Morris
// (n=2.7, ten sam płatowiec); szczegóły docs/fizyka-lotu.md rozdz. 10.
describe('złote testy osiągów — Spitfire Mk IIa (+12 lb)', () => {
  it('V_max na poziomie morza ≈ 505 km/h TAS ±8% (~314 mph, +12 lb ≈ jak Mk IA)', () => {
    const vKmh = topSpeedTest(SPITFIRE_MK2, 0) * MS_TO_KMH;
    expect(vKmh).toBeGreaterThan(505 * 0.92);
    expect(vKmh).toBeLessThan(505 * 1.08);
  });

  it('V_max na 5182 m ≈ 574 km/h TAS ±8% (357 mph @ 17k ft, spec. Mk II)', () => {
    const vKmh = topSpeedTest(SPITFIRE_MK2, 5182) * MS_TO_KMH;
    expect(vKmh).toBeGreaterThan(574 * 0.92);
    expect(vKmh).toBeLessThan(574 * 1.08);
  });

  it('V przeciągnięcia ≈ 118 km/h IAS ±8% (~73.5 mph przy 6172 lb)', () => {
    const vKmh = stallTest(SPITFIRE_MK2) * MS_TO_KMH;
    expect(vKmh).toBeGreaterThan(118 * 0.92);
    expect(vKmh).toBeLessThan(118 * 1.08);
  });

  it('wznoszenie początkowe ≈ 17 m/s ±15% (Merlin XII +12 lb; katalog. 2995 ft/min)', () => {
    const result = climbTest(SPITFIRE_MK2);
    expect(result.rocMs).toBeGreaterThan(17 * 0.85);
    expect(result.rocMs).toBeLessThan(17 * 1.15);
    // symulacja w czasie vs bilans mocy — rozjazd >5% = błąd integratora/modelu
    expect(Math.abs(result.rocMs - result.analyticRocMs) / result.analyticRocMs).toBeLessThan(
      0.05,
    );
  });

  it('roll rate @ 350 km/h ≈ 70°/s ±10% (pełna lotka przez kopertę)', () => {
    const rateDegS = rollRateTest(SPITFIRE_MK2, 350);
    expect(rateDegS).toBeGreaterThan(70 * 0.9);
    expect(rateDegS).toBeLessThan(70 * 1.1);
  });

  it('zakręt ustalony 360° ≈ 16 s ±8% (M&M: 17.2 s @ 12k ft → SL szybciej)', () => {
    const result = sustainedTurnTest(SPITFIRE_MK2);
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
    const result = diveEnergyTest(SPITFIRE_MK2);
    expect(result.maxTickEnergyGainJ).toBeLessThanOrEqual(0);
    expect(result.totalEnergyChangeJ).toBeLessThan(0);
  });
});
