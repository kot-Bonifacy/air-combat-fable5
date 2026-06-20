import { describe, expect, it } from 'vitest';
import { MS_TO_KMH } from '../constants';
import { BF109_E, SPITFIRE_MK2, type PlaneConfig } from '../planes/loader';
import {
  climbTest,
  diveEnergyTest,
  diveSpeedTest,
  rollRateTest,
  stallTest,
  sustainedTurnTest,
  topSpeedTest,
  zoomClimbTest,
} from './maneuvers';

// Złote testy osiągów vs tabela z docs/fizyka-lotu.md rozdz. 10. Asercje na surowych
// km/h (nie błędzie względnym), żeby porażka pokazywała zmierzoną wartość — to narzędzie
// kalibracji, nie tylko bramka. Faza 19: SPARAMETRYZOWANE po samolocie (describe.each) —
// pierwszy dowód, że koperta osiągów jest w pełni data-driven (ten sam harness, dwie kolumny).

interface PlaneTargets {
  label: string;
  config: PlaneConfig;
  /** V_max na poziomie morza [km/h TAS], tolerancja ±8%. */
  vMaxSLKmh: number;
  /** V_max na wysokości [km/h TAS] mierzone na `altM`, tolerancja ±8%. */
  vMaxAltKmh: number;
  altM: number;
  /** V przeciągnięcia [km/h IAS], tolerancja ±8%. */
  vStallKmh: number;
  /** Wznoszenie początkowe [m/s], tolerancja ±15%. */
  climbMs: number;
  /** Roll rate @ 350 km/h [°/s], tolerancja ±10%. */
  rollDegS: number;
  /** Czas zakrętu 360° [s], tolerancja ±8%. */
  turnS: number;
}

const TARGETS: readonly PlaneTargets[] = [
  // Spitfire Mk IIa (Merlin XII, +12 lb): V_max 357 mph @ 17k ft (≈574 @ 5182 m), reszta jak Mk IA.
  {
    label: 'Spitfire Mk IIa (+12 lb)',
    config: SPITFIRE_MK2,
    vMaxSLKmh: 505,
    vMaxAltKmh: 574,
    altM: 5182,
    vStallKmh: 118,
    climbMs: 17,
    rollDegS: 70,
    turnS: 16,
  },
  // Bf 109 E-3 (DB 601A): energy-fighter — szybszy na wysokości, lepszy roll, GORSZY zakręt
  // (małe skrzydło → duże obciążenie powierzchni, niska sprawność indukowana). Kolumna rozdz. 10.
  {
    label: 'Bf 109 E-3 (DB 601A)',
    config: BF109_E,
    vMaxSLKmh: 465,
    vMaxAltKmh: 555,
    altM: 5500,
    vStallKmh: 125,
    climbMs: 15,
    rollDegS: 85,
    turnS: 22,
  },
];

describe.each(TARGETS)('złote testy osiągów — $label', (t) => {
  it(`V_max na poziomie morza ≈ ${String(t.vMaxSLKmh)} km/h TAS ±8%`, () => {
    const vKmh = topSpeedTest(t.config, 0) * MS_TO_KMH;
    expect(vKmh).toBeGreaterThan(t.vMaxSLKmh * 0.92);
    expect(vKmh).toBeLessThan(t.vMaxSLKmh * 1.08);
  });

  it(`V_max na ${String(t.altM)} m ≈ ${String(t.vMaxAltKmh)} km/h TAS ±8%`, () => {
    const vKmh = topSpeedTest(t.config, t.altM) * MS_TO_KMH;
    expect(vKmh).toBeGreaterThan(t.vMaxAltKmh * 0.92);
    expect(vKmh).toBeLessThan(t.vMaxAltKmh * 1.08);
  });

  it(`V przeciągnięcia ≈ ${String(t.vStallKmh)} km/h IAS ±8%`, () => {
    const vKmh = stallTest(t.config) * MS_TO_KMH;
    expect(vKmh).toBeGreaterThan(t.vStallKmh * 0.92);
    expect(vKmh).toBeLessThan(t.vStallKmh * 1.08);
  });

  it(`wznoszenie początkowe ≈ ${String(t.climbMs)} m/s ±15%`, () => {
    const result = climbTest(t.config);
    expect(result.rocMs).toBeGreaterThan(t.climbMs * 0.85);
    expect(result.rocMs).toBeLessThan(t.climbMs * 1.15);
    // symulacja w czasie vs bilans mocy — rozjazd >5% = błąd integratora/modelu
    expect(Math.abs(result.rocMs - result.analyticRocMs) / result.analyticRocMs).toBeLessThan(0.05);
  });

  it(`roll rate @ 350 km/h ≈ ${String(t.rollDegS)}°/s ±10% (pełna lotka przez kopertę)`, () => {
    const rateDegS = rollRateTest(t.config, 350);
    expect(rateDegS).toBeGreaterThan(t.rollDegS * 0.9);
    expect(rateDegS).toBeLessThan(t.rollDegS * 1.1);
  });

  it(`zakręt ustalony 360° ≈ ${String(t.turnS)} s ±8%`, () => {
    const result = sustainedTurnTest(t.config);
    expect(result.turnTimeS).toBeGreaterThan(t.turnS * 0.92);
    expect(result.turnTimeS).toBeLessThan(t.turnS * 1.08);
    // symulacja vs bilans mocy — rozjazd >8% = regulator albo model się rozjechał
    expect(
      Math.abs(result.turnTimeS - result.analyticTurnTimeS) / result.analyticTurnTimeS,
    ).toBeLessThan(0.08);
    // "z utrzymaniem wysokości": dryf w mierzonym okrążeniu ograniczony
    expect(Math.abs(result.altitudeDriftM)).toBeLessThan(60);
  });

  it('nurkowanie bez ciągu: energia całkowita nie rośnie w żadnym ticku', () => {
    const result = diveEnergyTest(t.config);
    expect(result.maxTickEnergyGainJ).toBeLessThanOrEqual(0);
    expect(result.totalEnergyChangeJ).toBeLessThan(0);
  });
});

// Scenariusze asymetrii matchupu (faza 19, kryterium ukończenia): turn-fighter (Spitfire)
// vs energy-fighter (Bf 109). 30 s symulacji obu strategii w czystym harnessie.
describe('asymetria matchupu Spitfire ↔ Bf 109', () => {
  it('Spitfire wygrywa krążenie poziome (krótszy czas pełnego zakrętu)', () => {
    const spit = sustainedTurnTest(SPITFIRE_MK2).turnTimeS;
    const bf = sustainedTurnTest(BF109_E).turnTimeS;
    expect(spit).toBeLessThan(bf);
  });

  it('Bf 109 wygrywa beczkę (szybszy roll na średniej prędkości)', () => {
    // lotki Spitfire'a były ciężkie (płótno) — 109 robi rewersy szybciej (energia w pionie)
    expect(rollRateTest(BF109_E, 350)).toBeGreaterThan(rollRateTest(SPITFIRE_MK2, 350));
  });

  it('Bf 109 wygrywa nurkowanie (lepszy współczynnik balistyczny → wyższa prędkość)', () => {
    expect(diveSpeedTest(BF109_E)).toBeGreaterThan(diveSpeedTest(SPITFIRE_MK2));
  });

  it('Bf 109 wygrywa pościg wznoszący / zoom (lepsza retencja energii w pionie)', () => {
    expect(zoomClimbTest(BF109_E)).toBeGreaterThan(zoomClimbTest(SPITFIRE_MK2));
  });
});
