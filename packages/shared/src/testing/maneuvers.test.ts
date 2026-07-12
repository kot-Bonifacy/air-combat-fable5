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
  /** V_max na poziomie morza [km/h TAS], tolerancja ±5% (R4). MOC BOJOWA (bez WEP). */
  vMaxSLKmh: number;
  /** V_max na wysokości [km/h TAS] mierzone na `altM`, tolerancja ±5% (R4). MOC BOJOWA. */
  vMaxAltKmh: number;
  altM: number;
  /** V przeciągnięcia [km/h IAS], tolerancja ±5% (R4). */
  vStallKmh: number;
  /** Wznoszenie początkowe [m/s], tolerancja ±10% (R4; climb wrażliwy na integrator/rating). */
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
  // Spitfire Mk IIa — cele MOCY BOJOWEJ (+9 lb, P7280), tabela §5.1 fizyka-v2-rekalibracja.
  // R4 (2026-07-11): koniec „hojnego SL" — Vmax SL 505→467 (moc bojowa; WEP +12 lb daje ~483 osobno,
  // limit termiczny). Krzywa mocy §6.6 rozprzęgła Vmax SL od Vmax na wysokości: 570@5350 m osiągalne.
  {
    label: 'Spitfire Mk IIa (+12 lb)',
    config: SPITFIRE_MK2,
    vMaxSLKmh: 467, // P7280: 290 mph SL (+9 lb, moc bojowa)
    vMaxAltKmh: 570, // P7280: 354 mph @ 17 550 ft
    altM: 5350,
    vStallKmh: 117, // P7280: 73 mph
    climbMs: 14.8, // P7280: 2 915 ft/min SL (moc bojowa) — model biegnie ~+7% (militarny SL lekko hojny)
    rollDegS: 70,
    // płócienne lotki 1940: szczyt ~przy 250, łagodne ciężnienie ku 640 (14°/s @ 400 mph — RAE)
    rollShape: [
      [250, 79],
      [450, 47],
    ],
    // 18.5 s (było 17.5): cel §5.1 (AFDU 18–19 s @ 1 000 ft). R4 dostroił oporem indukowanym
    // (oswaldE 0.87→0.78) — zakręt ustalony wolniejszy, energy-fighter Bf dalej wyraźnie gorszy.
    turnS: 18.5,
  },
  // Bf 109 E-3 (DB 601A): energy-fighter — szybszy na wysokości, lepszy roll, GORSZY zakręt
  // (małe skrzydło → duże obciążenie powierzchni, niska sprawność indukowana). Kolumna rozdz. 10.
  {
    label: 'Bf 109 E-3 (DB 601A)',
    config: BF109_E,
    // R4: Vmax SL 465→467 (Swiss J-347 5-min 465–472), krzywa mocy — koniec „+7% zmierzone".
    // Vmax na wysokości 555@4500 (było 555@5500 — poprawiona WYSOKOŚĆ krytyczna do Kennblatt/CEMA).
    vMaxSLKmh: 467,
    vMaxAltKmh: 555,
    altM: 4500,
    vStallKmh: 123, // próby brytyjskie 120–127 (sloty łagodzą zerwanie → clMax 2.0→2.1 + miękkie knoby buffet)
    climbMs: 14.5, // CEMA @ 1 100 KM (5-min ≈ moc bojowa): 13.9–15.1 → środek. 15.5 to Notleistung (WEP, osobno)
    rollDegS: 85,
    // RAE: 109E lepszy w rollu od Spitfire'a poniżej ~500 km/h, zrównanie u góry zakresu
    rollShape: [
      [250, 92],
      [450, 54],
    ],
    // 23.5 s: cel §5.2 (RAE ~25 s; obliczenia Messerschmitt niższe → środek). Energy-fighter
    // wyraźnie gorszy w krążeniu niż Spitfire (18.5) — mimo lepszego rolla i nurkowania.
    turnS: 23.5,
  },
  // A6M2 Zero model 21 (Sakae 12): król wirażu — najlżejszy, najniższe obciążenie powierzchni,
  // wyraźnie NAJLEPSZY zakręt; ceną wolniejszy Vmax, sztywne lotki przy dużej prędkości
  // (rollRateCurve zapada powyżej ~350 km/h — kanoniczna słabość) i kruchość (hpPool/strefy/pożary).
  {
    label: 'A6M2 Zero model 21 (Sakae 12)',
    config: A6M2_ZERO,
    // R4: Vmax SL 445→440 (środek pasma źródeł 435–445), krzywa mocy §6.6 — koniec „hojnego SL".
    // 533 @ 4550 m (oficjalne, Francillon) utrzymane krzywą mocy.
    vMaxSLKmh: 440,
    vMaxAltKmh: 533,
    altM: 4550,
    vStallKmh: 105,
    climbMs: 15.7, // oficjalne (3 100 ft/min). Model biegnie ~15.1 (−4%) — Sakae 12 nie daje więcej w bilansie mocy
    //   przy Vmax SL 440; kruchość i dominacja wirażu Zera i tak wyraźne.
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
    // 15 s (V≈207 km/h — okrąg wolniejszy i CIAŚNIEJSZY promieniem ~140 m vs ~200 m Spitfire'a).
    // R4 (decyzja usera): ponowna próba 12–14 s na krzywej mocy §6.6 potwierdziła — 940 KM Sakae
    // więcej w bilansie NIE daje, więc trzymamy udokumentowany fallback 15 s (§3, ryzyko nr 7).
    // Dominacja wirażu i tak wyraźna: 15,0 < 18,5 (Spit) < 23,5 (Bf) + najmniejszy promień + najniższy stall.
    turnS: 15,
  },
];

describe.each(TARGETS)('złote testy osiągów — $label', (t) => {
  it(`V_max na poziomie morza ≈ ${String(t.vMaxSLKmh)} km/h TAS ±5% (moc bojowa)`, () => {
    const vKmh = topSpeedTest(t.config, 0) * MS_TO_KMH;
    expect(vKmh).toBeGreaterThan(t.vMaxSLKmh * 0.95);
    expect(vKmh).toBeLessThan(t.vMaxSLKmh * 1.05);
  });

  it(`V_max na ${String(t.altM)} m ≈ ${String(t.vMaxAltKmh)} km/h TAS ±5% (moc bojowa)`, () => {
    const vKmh = topSpeedTest(t.config, t.altM) * MS_TO_KMH;
    expect(vKmh).toBeGreaterThan(t.vMaxAltKmh * 0.95);
    expect(vKmh).toBeLessThan(t.vMaxAltKmh * 1.05);
  });

  it(`V przeciągnięcia ≈ ${String(t.vStallKmh)} km/h IAS ±5%`, () => {
    const vKmh = stallTest(t.config) * MS_TO_KMH;
    expect(vKmh).toBeGreaterThan(t.vStallKmh * 0.95);
    expect(vKmh).toBeLessThan(t.vStallKmh * 1.05);
  });

  it(`wznoszenie początkowe ≈ ${String(t.climbMs)} m/s ±10%`, () => {
    const result = climbTest(t.config);
    expect(result.rocMs).toBeGreaterThan(t.climbMs * 0.9);
    expect(result.rocMs).toBeLessThan(t.climbMs * 1.1);
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

  it(`zakręt ustalony 360° ≈ ${String(t.turnS)} s ±5%`, () => {
    const result = sustainedTurnTest(t.config);
    expect(result.turnTimeS).toBeGreaterThan(t.turnS * 0.95);
    expect(result.turnTimeS).toBeLessThan(t.turnS * 1.05);
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

// Przeciągnięcie z KLAPAMI (R4, §8.2 „stallTest z klapami"). Prędkość przeciągnięcia zależy tylko
// od clMax (V_stall ∝ 1/√clMax), więc mierzymy stallTest na konfiguracji z clMax podniesionym o
// clMaxAdd pełnej pozycji klap — reużycie harnessu bez wątku flapIndex (cd0Add nie wpływa na V_stall).
describe('przeciągnięcie z klapami (§6.4 / §5.1)', () => {
  const fullFlap = (p: PlaneConfig): PlaneConfig => {
    const last = p.flaps.positions[p.flaps.positions.length - 1];
    if (!last) throw new Error(`${p.name}: brak pozycji klap`); // noUncheckedIndexedAccess: pusty zestaw niemożliwy (loader wymaga ≥1)
    return { ...p, clMax: p.clMax + last.clMaxAdd };
  };

  it.each([SPITFIRE_MK2, BF109_E, A6M2_ZERO])('klapy obniżają przeciągnięcie ($name)', (p) => {
    expect(stallTest(fullFlap(p)) * MS_TO_KMH).toBeLessThan(stallTest(p) * MS_TO_KMH);
  });

  it('Spitfire z pełnymi klapami ≈ 101 km/h IAS ±5% (P7280: 63 mph)', () => {
    const v = stallTest(fullFlap(SPITFIRE_MK2)) * MS_TO_KMH;
    expect(v).toBeGreaterThan(101 * 0.95);
    expect(v).toBeLessThan(101 * 1.05);
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

// Komplet PORZĄDKÓW §5.4 (fizyka-v2-rekalibracja.md) — zamrażamy relacje między samolotami,
// nie liczby (D4: asymetrie bez tolerancji procentowej). Uzupełnia asymetrie faz 19/2026-07-09
// o pełne trójstronne orderingi. Relacje 6 (Ps-bleed) i 7 (pętle) → combat-maneuvers.test.ts
// (tam importowane psBleedTest/loopTest). Dwie KOREKTY spec §5.4 (patrz komentarze relacji 3 i 5).
describe('relacje §5.4 (R4 — komplet porządków)', () => {
  it('§5.4.1 zakręt ustalony: Zero < Spitfire < Bf 109', () => {
    const zero = sustainedTurnTest(A6M2_ZERO).turnTimeS;
    const spit = sustainedTurnTest(SPITFIRE_MK2).turnTimeS;
    const bf = sustainedTurnTest(BF109_E).turnTimeS;
    expect(zero).toBeLessThan(spit);
    expect(spit).toBeLessThan(bf);
  });

  it('§5.4.2 nurkowanie (V po 25 s): Bf 109 > Spitfire > Zero', () => {
    const bf = diveSpeedTest(BF109_E);
    const spit = diveSpeedTest(SPITFIRE_MK2);
    const zero = diveSpeedTest(A6M2_ZERO);
    expect(bf).toBeGreaterThan(spit);
    expect(spit).toBeGreaterThan(zero);
  });

  // KOREKTA §5.4.3: spec pisze „Spitfire ≥ Bf ≫ Zero", ale przeczy to KALIBROWANEJ krzywej rolla
  // (rollRateCurve, R1) i cytowanym w §5.1/§5.2 danym RAE („109E lepszy w rollu poniżej ~500 km/h;
  // płócienne lotki Spitfire'a ciężkie"). Prawdziwa relacja @400 km/h to Bf ≥ Spitfire ≫ Zero —
  // spójna z istniejącym testem „Bf wygrywa beczkę @350". Zamrażamy PRAWDZIWĄ (roll nietykany w R4).
  it('§5.4.3 roll @ 400 km/h: Bf 109 ≥ Spitfire ≫ Zero (beton lotek Zero)', () => {
    const bf = rollRateTest(BF109_E, 400);
    const spit = rollRateTest(SPITFIRE_MK2, 400);
    const zero = rollRateTest(A6M2_ZERO, 400);
    expect(bf).toBeGreaterThanOrEqual(spit);
    expect(zero * 2).toBeLessThan(spit); // „≫": co najmniej 2× wolniej niż wolniejszy z pary
  });

  it('§5.4.4 zoom climb: Bf 109 > Spitfire > Zero', () => {
    const bf = zoomClimbTest(BF109_E);
    const spit = zoomClimbTest(SPITFIRE_MK2);
    const zero = zoomClimbTest(A6M2_ZERO);
    expect(bf).toBeGreaterThan(spit);
    expect(spit).toBeGreaterThan(zero);
  });

  // KOREKTA §5.4.5: spec pisze „Bf ≈ Zero > Spitfire", ale to figura NOTLEISTUNG (WEP) Bf.
  // Przy MOCY BOJOWEJ (military — jak liczą złote) wszystkie trzy ściskają się w ~1,7 m/s
  // (Spit ~15.8, Zero ~15.1, Bf ~14.2): podobne obciążenie mocą (W/kg). Zamrażamy DEFENSYWNĄ
  // wersję: wznoszenie SL porównywalne (klaster < 2,5 m/s), żaden nie dominuje ani nie odpada.
  it('§5.4.5 wznoszenie SL: trzy samoloty porównywalne (klaster < 2,5 m/s, moc bojowa)', () => {
    const rocs = [SPITFIRE_MK2, BF109_E, A6M2_ZERO].map((p) => climbTest(p, 100).rocMs);
    for (const roc of rocs) {
      expect(roc).toBeGreaterThan(12);
      expect(roc).toBeLessThan(18);
    }
    expect(Math.max(...rocs) - Math.min(...rocs)).toBeLessThan(2.5);
  });
});
