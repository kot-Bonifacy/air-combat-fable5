import { describe, expect, it } from 'vitest';
import { A6M2_ZERO, BF109_E, SPITFIRE_MK2, type PlaneConfig } from '../planes/loader';
import {
  loopTest,
  psBleedTest,
  rollBleedTest,
  rollTime360Test,
  timeToAltitudeTest,
  turn180Test,
} from './combat-maneuvers';

// Testy ZAMRAŻAJĄCE baseline fizyki v2 (etap R0, docs/fizyka-v2-rekalibracja.md §8.2):
// liczby wzięte z raportu bazowego docs/fizyka-v2-baseline.md (stara fizyka, 2026-07-10).
// To NIE są cele historyczne (te pilnuje golden.test.ts/maneuvers.test.ts) — to kotwice
// stanu wyjściowego: każda zmiana fizyki w R1–R4 ma je poruszyć ŚWIADOMIE (aktualizacja
// liczby w tym pliku z komentarzem etapu), nigdy przypadkiem. Tolerancja ±3% — ciasna,
// bo symulacja jest deterministyczna (stały krok, stałe ziarna stallu); pasmo istnieje
// tylko po to, by nie zamrażać szumu ostatniej cyfry raportu.

const TOL = 0.03;

/** Asercja pasma ±frac wokół wartości zamrożonej — poprawna także dla wartości ujemnych (Ps). */
function expectFrozen(actual: number, frozen: number, label: string, frac = TOL): void {
  const lo = Math.min(frozen * (1 - frac), frozen * (1 + frac));
  const hi = Math.max(frozen * (1 - frac), frozen * (1 + frac));
  expect(actual, label).toBeGreaterThan(lo);
  expect(actual, label).toBeLessThan(hi);
}

interface FrozenBaseline {
  label: string;
  config: PlaneConfig;
  /** Zawrócenie 180° max-rate @ 100 m: [IAS wejścia km/h, czas s] (pełny pipeline). */
  turn180: readonly (readonly [iasKmh: number, timeS: number])[];
  /** Pełna beczka 360° @ 1000 m: [IAS km/h, czas s] (nasycenie robi koperta). */
  roll360: readonly (readonly [iasKmh: number, timeS: number])[];
  /** Pętla z 300 km/h (start 500 m): czas domknięcia [s] — wszystkie 3 samoloty domykają. */
  loop300S: number;
  /** Bleed beczek 10 s @ 400 km/h: koszt energetyczny [km/h IAS-ekwiwalentu]. */
  rollBleedKmh: number;
  /** Ps @ 5 G, 350 km/h IAS, 1000 m [m/s] (analitycznie; ujemny = zakręt nie do utrzymania). */
  ps5g350Ms: number;
  /** Czas wznoszenia 100 m → 6000 m [s] (quasi-statyczny po najlepszym ROC). */
  timeTo6000S: number;
}

const FROZEN: readonly FrozenBaseline[] = [
  {
    label: 'Spitfire Mk IIa (+12 lb)',
    config: SPITFIRE_MK2,
    turn180: [
      [250, 7.3],
      [350, 5.7],
      [450, 6.9],
    ],
    roll360: [
      [250, 4.6],
      [400, 6.5],
    ],
    loop300S: 13.5,
    // 9.4 (R1: 9.5) — R4 op. indukowany (oswaldE 0.87→0.78); koszt beczek ~bez ruchu (ctrlDragK stały)
    rollBleedKmh: 9.4,
    ps5g350Ms: -27.1, // R4: −17.8→−27.1 (oswaldE ↓ = wyższy opór indukowany przy 5 G)
    timeTo6000S: 345, // R4: 328→345 (krzywa mocy §6.6, moc bojowa niższa; hist. 420 s poza modelem — patrz Wynik R4)
  },
  {
    label: 'Bf 109 E-3 (DB 601A)',
    config: BF109_E,
    turn180: [
      [250, 9.1],
      [350, 6.8],
      [450, 6.3],
    ],
    roll360: [
      [250, 3.9],
      [400, 5.3],
    ],
    // 16.1 s (R1: 33) — R4: modelowanie SLOTÓW krawędziowych E-3 (§5.2: buffetOnsetRatio 0.9→0.92,
    // wingDropDelayS 1.0→1.3) + clMax 2.0→2.1 (stall 123) sprawia, że Bf domyka teraz pętlę z 300
    // pewnie (a i z 250 — patrz relacje §5.4.7): sloty opóźniają zerwanie na małej prędkości.
    loop300S: 16.1,
    // 8.5 (R1: 8.4) — clMax ↑ nieznacznie; ctrlDragK stały
    rollBleedKmh: 8.5,
    ps5g350Ms: -53.7, // R4: −51.1→−53.7 (moc bojowa niższa + clMax ↑)
    timeTo6000S: 433, // R4: 376→433 (krzywa mocy §6.6 — bliżej hist. 465 s; wys. krytyczna 4500 daje zapaść mocy)
  },
  {
    label: 'A6M2 Zero model 21 (Sakae 12)',
    config: A6M2_ZERO,
    turn180: [
      [250, 5.7],
      [350, 5.7],
      [450, 8.3],
    ],
    roll360: [
      [250, 4.3],
      // 34.6 s pełnej beczki @ 400 km/h — zabetonowane lotki (testy Kogi); roll nietykany w R4,
      // drobny ruch (35.4→34.6) od niższej mocy bojowej (mniej rozpędza się w spirali beczki).
      [400, 34.6],
    ],
    loop300S: 10.2,
    // 10.3 (R1: 10.2) — bez ruchu (roll/ctrlDragK stałe; krzywa mocy prawie nie rusza beczki @400)
    rollBleedKmh: 10.3,
    ps5g350Ms: -12.8, // R4: −11.3→−12.8 (moc bojowa niższa przy 5 G)
    timeTo6000S: 375, // R4: 357→375 (krzywa mocy §6.6; hist. 447 s poza modelem — wys. krytyczna 4550, patrz Wynik R4)
  },
];

describe.each(FROZEN)('baseline v2 zamrożony (R0) — $label', (t) => {
  it('zawrócenie 180° max-rate @ 100 m: czasy jak w raporcie bazowym ±3%', () => {
    for (const [iasKmh, timeS] of t.turn180) {
      expectFrozen(
        turn180Test(t.config, iasKmh, 100).timeS,
        timeS,
        `turn180 @ ${String(iasKmh)} km/h`,
      );
    }
  });

  it('pełna beczka 360° @ 1000 m: czasy jak w raporcie bazowym ±3%', () => {
    for (const [iasKmh, timeS] of t.roll360) {
      expectFrozen(
        rollTime360Test(t.config, iasKmh),
        timeS,
        `beczka @ ${String(iasKmh)} km/h`,
      );
    }
  });

  it(`pętla z 300 km/h domyka się w ~${String(t.loop300S)} s ±3%`, () => {
    const r = loopTest(t.config, 300);
    expect(r.completed).toBe(true);
    expectFrozen(r.timeS, t.loop300S, 'czas pętli');
  });

  it(`bleed beczek 10 s @ 400 km/h ≈ ${String(t.rollBleedKmh)} km/h IAS-ekwiwalentu`, () => {
    // Tolerancja ABSOLUTNA ±0,5 km/h zamiast ±3%: wartości są małe, a raport zaokrągla
    // do 0,1 — pasmo procentowe byłoby ciaśniejsze niż ziarno zapisu. Wartości
    // zaktualizowane ŚWIADOMIE w R1 (§6.1 opór lotek: R0 5,3/2,9/7,6 → 9,5/8,4/10,2);
    // cel gameplayowy §6.1 (3 pełne beczki) pilnowany osobnym describe niżej.
    const r = rollBleedTest(t.config);
    expect(r.iasEquivDropKmh).toBeGreaterThan(t.rollBleedKmh - 0.5);
    expect(r.iasEquivDropKmh).toBeLessThan(t.rollBleedKmh + 0.5);
  });

  it(`Ps @ 5 G, 350 km/h ≈ ${String(t.ps5g350Ms)} m/s ±3% (mapa energetyczna)`, () => {
    expectFrozen(psBleedTest(t.config, 5, 350).psMs, t.ps5g350Ms, 'Ps @ 5 G / 350 km/h');
  });

  it(`czas wznoszenia 100→6000 m ≈ ${String(t.timeTo6000S)} s ±3%`, () => {
    // R4: krzywa mocy §6.6 przybliżyła historię (Bf 376→433 s vs cel 465; Spit 328→345 vs 420;
    // Zero 357→375 vs 447). Bf trafia najlepiej (wysokość krytyczna 4500 m < 6000 → zapaść mocy
    // wydłuża wznoszenie). Spit/Zero zostają optymistyczne: ich wysoka wys. krytyczna (5350/4550)
    // trzyma silnik mocny prawie do 6000 m, a punkt-masa bez spadku sprawności śmigła z wys. daje
    // wciąż mocne wznoszenie u góry — pełne 420/447 s poza modelem bez psucia Vmax@wys. (patrz Wynik R4).
    expectFrozen(timeToAltitudeTest(t.config, 6000), t.timeTo6000S, 'czas do 6000 m');
  });
});

// Relacje §5.4 zależne od pętli/mapy energetycznej (importują loopTest/psBleedTest stąd; reszta
// porządków §5.4.1–5 → maneuvers.test.ts). Zamrażamy PORZĄDKI, nie liczby (D4).
describe('relacje §5.4 (R4) — pętle i bleed energii', () => {
  // KOREKTA §5.4.7: spec pisze „Bf NIE domyka pętli z 250". To była własność STAREJ fizyki
  // (twarde zerwanie bez modelu slotów). R4 modeluje sloty krawędziowe E-3 (miękkie knoby buffet,
  // §5.2) → Bf domyka teraz pętlę z 250 (sloty opóźniają departure na małej prędkości — historycznie
  // poprawne). Zamrażamy ROBUSTNĄ część relacji: kolejność czasu domknięcia z 300 (obciążenie skrzydła).
  it('§5.4.7 pętla z 300 km/h: Zero domyka najszybciej, Bf najwolniej (Zero < Spit < Bf)', () => {
    const zero = loopTest(A6M2_ZERO, 300).timeS;
    const spit = loopTest(SPITFIRE_MK2, 300).timeS;
    const bf = loopTest(BF109_E, 300).timeS;
    expect(loopTest(A6M2_ZERO, 300).completed).toBe(true);
    expect(loopTest(SPITFIRE_MK2, 300).completed).toBe(true);
    expect(loopTest(BF109_E, 300).completed).toBe(true);
    expect(zero).toBeLessThan(spit);
    expect(spit).toBeLessThan(bf);
  });

  it('§5.4.6 bleed Ps @ 5 G / 350 km/h: Bf traci najszybciej, Zero najwolniej (Bf < Spit < Zero)', () => {
    // Ps ujemne = zakręt zjada energię; „kto szybciej traci" = najbardziej ujemny Ps (Bf, małe skrzydło).
    const bf = psBleedTest(BF109_E, 5, 350).psMs;
    const spit = psBleedTest(SPITFIRE_MK2, 5, 350).psMs;
    const zero = psBleedTest(A6M2_ZERO, 5, 350).psMs;
    expect(bf).toBeLessThan(spit);
    expect(spit).toBeLessThan(zero);
  });
});

// Cel gameplayowy R1 §6.1 (opór manewrowy lotek): „3 pełne beczki z 400 km/h zjadają
// ~40–60 km/h IAS". Pomiar = pełny pipeline, stop po 3 obrotach ALBO sufit 20 s (bez
// sufitu pomiar degeneruje się w spiralę nurkową: nurkowanie → wyższa IAS → sztywniejsze
// lotki → dłuższe okno → głębsze nurkowanie), start 2000 m (zapas na osiadanie toru).
// UWAGA interpretacyjna (rozstrzygnięta pomiarem w R1): 40–60 km/h to CAŁKOWITY koszt
// energetyczny manewru, jaki widzi gracz — większość zjada osiadanie toru w beczce
// (kontrola k=0 daje ~39–52 km/h @ 400), a opór lotek dokłada resztę przy k_ail w zgodzie
// z rzędem „+15–25% Cd0" z §6.1. Ręczny rachunek z planu R1 (k≈0.007–0.010) zakładał
// idealny lot poziomy, którego pełny pipeline (i gra) nie utrzymuje — konflikt kotwic
// §6.1 rozwiązał się sam. Pasmo asercji do 65: Spitfire siedzi przy górnej granicy
// (jego 3 beczki @ 400 trwają najdłużej → najgłębsze osiadanie), a R4 (krzywa mocy)
// jeszcze te wartości poruszy.
describe('cele R1 §6.1 — bleed 3 pełnych beczek', () => {
  it('Spitfire i Bf 109: 3 beczki z 400 km/h kosztują ~40–60 km/h IAS-ekwiwalentu', () => {
    for (const config of [SPITFIRE_MK2, BF109_E]) {
      const r = rollBleedTest(config, 400, 2000, 20, 3);
      expect(r.iasEquivDropKmh, `${config.name}: bleed`).toBeGreaterThan(40);
      expect(r.iasEquivDropKmh, `${config.name}: bleed`).toBeLessThan(65);
      // sanity: to była próba beczek, nie nurkowanie — wykręcone ≥2,4 obrotu
      expect(r.rolledTurns, `${config.name}: obroty`).toBeGreaterThan(2.4);
    }
  });

  it('Zero: kotwica @ 300 km/h (78 km/h ±10%); @ 400 beton lotek nie domyka nawet 1 beczki', () => {
    // @ 400 km/h Zero fizycznie nie zrobi 3 beczek (rollRateCurve ~12°/s) — jego kotwicą
    // §6.1 jest 300 km/h (środek zakresu bojowego, lotki jeszcze skuteczne).
    const r300 = rollBleedTest(A6M2_ZERO, 300, 2000, 20, 3);
    expect(r300.iasEquivDropKmh).toBeGreaterThan(78 * 0.9);
    expect(r300.iasEquivDropKmh).toBeLessThan(78 * 1.1);
    const r400 = rollBleedTest(A6M2_ZERO, 400, 2000, 20, 3);
    expect(r400.rolledTurns).toBeLessThan(1);
  });

  it('opór lotek jest realnym składnikiem kosztu: bleed z k_ail > bleed kontroli k=0', () => {
    for (const config of [SPITFIRE_MK2, BF109_E, A6M2_ZERO]) {
      const control: PlaneConfig = { ...config, ctrlDragK: { aileron: 0, rudder: 0 } };
      const withDrag = rollBleedTest(config, 350, 2000, 20, 3).iasEquivDropKmh;
      const without = rollBleedTest(control, 350, 2000, 20, 3).iasEquivDropKmh;
      expect(withDrag, `${config.name}: marginalny koszt lotek`).toBeGreaterThan(without + 2);
    }
  });
});
