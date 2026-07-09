import { describe, expect, it } from 'vitest';
import { MS_TO_KMH } from '../constants';
import { A6M2_ZERO, BF109_E, SPITFIRE_MK2, type PlaneConfig } from '../planes/loader';
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
  /**
   * Kotwice KSZTAŁTU krzywej rolla [IAS km/h, °/s] ±10% — pełny pipeline pilota.
   * Punkt @350 pilnuje środka; te punkty pilnują, żeby rekalibracja nie przesunęła
   * szczytu ani zapaści (sesja 2026-07-09: zapaść Zero była o ~50 km/h za wcześnie).
   */
  rollShape: readonly (readonly [iasKmh: number, degS: number])[];
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
    // płócienne lotki 1940: szczyt ~przy 250, łagodne ciężnienie ku 640 (14°/s @ 400 mph — RAE)
    rollShape: [
      [250, 79],
      [450, 47],
    ],
    // 17.5 s (było 16): rekalibracja po dodaniu zagięcia biegunowej Cd przy wysokim Cl
    // (dragHighClK, 2026-06-26) — zakręt ustalony lekko wolniejszy, bliżej literatury
    // (~17-18 s SL, AFDU); GŁÓWNY efekt zmiany to większy bleed energii w ciasnym/over-pull.
    turnS: 17.5,
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
    // RAE: 109E lepszy w rollu od Spitfire'a poniżej ~500 km/h, zrównanie u góry zakresu
    rollShape: [
      [250, 92],
      [450, 54],
    ],
    // 23.5 s (było 22): jak Spitfire — zagięcie biegunowej przy wysokim Cl (dragHighClK)
    // koszt zakrętu na wysokim Cl; energy-fighter dalej wyraźnie gorszy w krążeniu.
    turnS: 23.5,
  },
  // A6M2 Zero model 21 (Sakae 12): król wirażu — najlżejszy, najniższe obciążenie powierzchni,
  // wyraźnie NAJLEPSZY zakręt; ceną wolniejszy Vmax, sztywne lotki przy dużej prędkości
  // (rollRateCurve zapada powyżej ~350 km/h — kanoniczna słabość) i kruchość (hpPool/strefy/pożary).
  {
    label: 'A6M2 Zero model 21 (Sakae 12)',
    config: A6M2_ZERO,
    // 445 = góra pasma źródeł (435-445); rekalibracja 2026-07-09 (FTH 4200→4550 jako proxy
    // odzysku RAM, cd0 0,021→0,020) trafia książkowe 533 @ 4550 m kosztem lekko hojnego SL —
    // spójnie z konwencją Spit/Bf (oba SL też u górnej granicy).
    vMaxSLKmh: 445,
    vMaxAltKmh: 533,
    altM: 4550,
    vStallKmh: 105,
    climbMs: 15.5,
    // 47 (było 30): zapaść lotek przesunięta w prawo wg testów Zero Kogi (2026-07-09) —
    // stery lekkie <~350 km/h, sztywnienie >350, „beton" >445 km/h. Stara krzywa zapadała
    // się już od ~260 km/h (o ~50 km/h za wcześnie), przez co Zero było ślamazarne
    // w CAŁYM zakresie bojowym, nie tylko przy dużej IAS.
    rollDegS: 47,
    rollShape: [
      [250, 84], // lekkie, skuteczne lotki poniżej ~320 km/h (testy Kogi)
      [300, 74], // wciąż żwawy — zapaść jeszcze się nie zaczęła
      [400, 24], // sztywnienie w pełni („rolki powolne, duża siła na drążku")
      [450, 12], // historyczny „beton" >445 km/h — WOLNIEJ niż stara krzywa (14)
    ],
    // 15 s zmierzone (V≈207 km/h — okrąg wolniejszy i CIAŚNIEJSZY promieniem ~140 m vs ~193 m
    // Spitfire'a). Literatura sugeruje 12-14 s, ale 940 KM Sakae więcej w bilansie mocy nie daje;
    // dominacja wirażu i tak wyraźna (15,0 < 17,5 < 23,5 + najmniejszy promień + najniższy stall).
    turnS: 15,
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

  it('kształt krzywej rolla: kotwice [IAS, °/s] ±10% (szczyt i zapaść na miejscu)', () => {
    for (const [iasKmh, degS] of t.rollShape) {
      const rateDegS = rollRateTest(t.config, iasKmh);
      expect(rateDegS, `roll @ ${String(iasKmh)} km/h`).toBeGreaterThan(degS * 0.9);
      expect(rateDegS, `roll @ ${String(iasKmh)} km/h`).toBeLessThan(degS * 1.1);
    }
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

// Asymetria A6M2 Zero (sesja kalibracji 2026-07-09): król wirażu o lekkich lotkach
// na małej prędkości, ale kanonicznie sztywny w rollu przy dużej IAS, najwolniejszy
// i najgorszy w nurkowaniu — wygrywa walką kołową, przegrywa energetyczną.
describe('asymetria matchupu A6M2 Zero ↔ reszta', () => {
  it('Zero wygrywa krążenie poziome z oboma (najkrótszy czas 360°)', () => {
    const zero = sustainedTurnTest(A6M2_ZERO).turnTimeS;
    expect(zero).toBeLessThan(sustainedTurnTest(SPITFIRE_MK2).turnTimeS);
    expect(zero).toBeLessThan(sustainedTurnTest(BF109_E).turnTimeS);
  });

  it('Zero ma najlepszy roll przy małej prędkości (200 km/h — lekkie lotki)', () => {
    const zero = rollRateTest(A6M2_ZERO, 200);
    expect(zero).toBeGreaterThan(rollRateTest(SPITFIRE_MK2, 200));
    expect(zero).toBeGreaterThan(rollRateTest(BF109_E, 200));
  });

  it('Zero ma zdecydowanie najgorszy roll przy 400 km/h (sztywnienie lotek)', () => {
    const zero = rollRateTest(A6M2_ZERO, 400);
    // "zdecydowanie": co najmniej 2× wolniej — słabość ma być odczuwalna, nie kosmetyczna
    expect(zero * 2).toBeLessThan(rollRateTest(SPITFIRE_MK2, 400));
    expect(zero * 2).toBeLessThan(rollRateTest(BF109_E, 400));
  });

  it('Zero przegrywa nurkowanie z oboma (najlżejszy, najgorszy wsp. balistyczny)', () => {
    const zero = diveSpeedTest(A6M2_ZERO);
    expect(zero).toBeLessThan(diveSpeedTest(SPITFIRE_MK2));
    expect(zero).toBeLessThan(diveSpeedTest(BF109_E));
  });
});
