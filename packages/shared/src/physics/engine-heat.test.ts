import { describe, expect, it } from 'vitest';
import { ENGINE_HEAT_REDLINE, ENGINE_HEAT_WARN, FIXED_DT_S, MS_TO_KMH } from '../constants';
import { BF109_E, SPITFIRE_MK2 } from '../planes/loader';
import { engineDisplayTempC, engineHeatEquilibrium, overheatDamageHp, stepEngineHeat } from './engine-heat';
import { createPlaneState } from './state';

// Model termiczny silnika (fizyka v2 R2): temperatura (engineHeatFrac) relaksuje do equilibrium
// ∝ (WEP ? wepHeatMul : 1)·gaz²/chłodzenie(IAS). KLUCZOWA zmiana R2 vs poprzedni model: 100% gazu MOCY
// BOJOWEJ (bez WEP) osiada na militaryEqHeat < czerwona linia → lot na maksie BEZ LIMITU. Dopiero WEP
// wypycha equilibrium ponad czerwoną linię i po wepTimeToRedlineS (od ustalonej temp bojowej) przegrzewa —
// Spitfire ~5 min, Bf 109 ~1 min. Testy izolują model (wołają stepEngineHeat wprost na syntetycznym stanie).

const speedRefMs = (plane: typeof SPITFIRE_MK2) => plane.engineThermal.speedCoolingRefKmh / MS_TO_KMH;

/**
 * Sekundy od USTALONEJ temperatury bojowej (militaryEqHeat) do czerwonej linii NA WEP, przy 100% gazu
 * i prędkości referencyjnej (chłodzenie ×1). To dokładnie semantyka, z której model wyprowadza τ grzania,
 * więc wynik ≈ wepTimeToRedlineS (lock kalibracji).
 */
function wepTimeToRedlineS(plane: typeof SPITFIRE_MK2, maxS = 3600): number {
  const state = createPlaneState();
  state.throttle = 1;
  state.wepActive = true;
  state.iasMs = speedRefMs(plane);
  state.engineHeatFrac = plane.engineThermal.militaryEqHeat; // start od ustalonej temperatury bojowej
  let s = 0;
  while (state.engineHeatFrac < ENGINE_HEAT_REDLINE && s < maxS) {
    stepEngineHeat(state, plane, FIXED_DT_S);
    s += FIXED_DT_S;
  }
  return s;
}

describe('engine-heat: WEP jako reżim przegrzewający (kalibracja do limitów historycznych)', () => {
  it('Spitfire: WEP od temp. bojowej → czerwona linia po ~wepTimeToRedlineS (≈5 min)', () => {
    const t = wepTimeToRedlineS(SPITFIRE_MK2);
    expect(t).toBeGreaterThan(SPITFIRE_MK2.engineThermal.wepTimeToRedlineS - 3);
    expect(t).toBeLessThan(SPITFIRE_MK2.engineThermal.wepTimeToRedlineS + 3);
    expect(SPITFIRE_MK2.engineThermal.wepTimeToRedlineS).toBe(300); // lock: 5 min WEP Merlina (+12 lb)
  });

  it('Bf 109 na WEP przegrzewa się SZYBCIEJ niż Spitfire (Notleistung ~1 min, asymetria)', () => {
    const spit = wepTimeToRedlineS(SPITFIRE_MK2);
    const bf = wepTimeToRedlineS(BF109_E);
    expect(bf).toBeLessThan(spit);
    expect(bf).toBeGreaterThan(BF109_E.engineThermal.wepTimeToRedlineS - 3);
    expect(bf).toBeLessThan(BF109_E.engineThermal.wepTimeToRedlineS + 3);
    expect(BF109_E.engineThermal.wepTimeToRedlineS).toBe(60); // lock: ~1 min Notleistung
  });
});

describe('engine-heat: equilibrium (ciepły silnik na starcie)', () => {
  // spawn ustawia engineHeatFrac = engineHeatEquilibrium(gaz przelotowy, prędkość spawnu): silnik startuje
  // w stanie ustalonym „po długim locie", nie zimny (0). Musi być punktem stałym modelu (żeby nie było
  // transientu po spawnie) i bezpiecznie poniżej progu „gorąco".
  const cruiseThrottle = 0.8; // = SPAWN_THROTTLE (serwer); tu literał, bo to stała serwerowa

  it('engineHeatEquilibrium jest punktem STAŁYM modelu (bez WEP) — seed w równowadze się nie rusza', () => {
    for (const plane of [SPITFIRE_MK2, BF109_E]) {
      const eq = engineHeatEquilibrium(cruiseThrottle, plane.spawnSpeedMs, plane);
      const s = createPlaneState();
      s.throttle = cruiseThrottle;
      s.wepActive = false;
      s.iasMs = plane.spawnSpeedMs;
      s.engineHeatFrac = eq;
      for (let i = 0; i < 60 * 600; i++) stepEngineHeat(s, plane, FIXED_DT_S); // 10 min
      expect(s.engineHeatFrac).toBeCloseTo(eq, 6); // trzyma się dokładnie na równowadze
      expect(eq).toBeGreaterThan(0); // ciepły, nie zimny (istota zmiany)
      expect(eq).toBeLessThan(ENGINE_HEAT_WARN); // bezpiecznie poniżej progu „gorąco"
    }
  });

  it('zimny silnik na gazie przelotowym DOCHODZI do engineHeatEquilibrium (spawn wyprzedza rozgrzewanie)', () => {
    const plane = SPITFIRE_MK2;
    const eq = engineHeatEquilibrium(cruiseThrottle, plane.spawnSpeedMs, plane);
    const s = createPlaneState();
    s.throttle = cruiseThrottle;
    s.wepActive = false;
    s.iasMs = plane.spawnSpeedMs;
    s.engineHeatFrac = 0; // start zimny
    for (let i = 0; i < 60 * 1500; i++) stepEngineHeat(s, plane, FIXED_DT_S); // 25 min → asymptota
    expect(s.engineHeatFrac).toBeCloseTo(eq, 3); // ta sama równowaga, którą spawn ustawia od razu
  });
});

describe('engine-heat: zachowanie modelu', () => {
  it('100% gazu MOCY BOJOWEJ (bez WEP) NIGDY nie przegrzewa — militaryEqHeat to punkt równowagi poniżej progu „gorąco"', () => {
    // militaryEqHeat jest równowagą (fixed point): seed tam trzyma się dokładnie na 100% gazu bojowego,
    // nie pełznie ku czerwonej linii → lot na maksie mocy bojowej bez limitu (WEP jest osobnym reżimem)
    const eq = SPITFIRE_MK2.engineThermal.militaryEqHeat;
    const settled = createPlaneState();
    settled.throttle = 1;
    settled.wepActive = false;
    settled.iasMs = speedRefMs(SPITFIRE_MK2);
    settled.engineHeatFrac = eq;
    for (let i = 0; i < 60 * 1200; i++) stepEngineHeat(settled, SPITFIRE_MK2, FIXED_DT_S); // 20 min
    expect(settled.engineHeatFrac).toBeCloseTo(eq, 6); // stabilny punkt równowagi
    expect(eq).toBeLessThan(ENGINE_HEAT_WARN); // poniżej progu „gorąco" → wskaźnik zielony na 100% bojowym

    // z zimnego silnika grzanie zbliża się do równowagi OD DOŁU (asymptota), więc nigdy nie przekracza jej
    // ani czerwonej linii — po 20 min wciąż wyraźnie poniżej progu „gorąco"
    const fromCold = createPlaneState();
    fromCold.throttle = 1;
    fromCold.wepActive = false;
    fromCold.iasMs = speedRefMs(SPITFIRE_MK2);
    fromCold.engineHeatFrac = 0;
    for (let i = 0; i < 60 * 1200; i++) stepEngineHeat(fromCold, SPITFIRE_MK2, FIXED_DT_S);
    expect(fromCold.engineHeatFrac).toBeLessThan(eq); // dochodzi od dołu
    expect(fromCold.engineHeatFrac).toBeLessThan(ENGINE_HEAT_WARN);
  });

  it('WEP wypycha temperaturę równowagi PONAD czerwoną linię (przegrzewa, gdy trzymany dość długo)', () => {
    const t = SPITFIRE_MK2.engineThermal;
    const eqMil = t.militaryEqHeat; // 100% bojowe @ ref = militaryEqHeat
    const eqWep = t.militaryEqHeat * t.wepHeatMul; // 100% + WEP @ ref
    expect(eqMil).toBeLessThan(ENGINE_HEAT_REDLINE);
    expect(eqWep).toBeGreaterThan(ENGINE_HEAT_REDLINE);
  });

  it('zdjęcie gazu chłodzi silnik (czerwona linia → ~zimno po coolTimeS)', () => {
    const state = createPlaneState();
    state.throttle = 0;
    state.wepActive = false;
    state.iasMs = speedRefMs(SPITFIRE_MK2);
    state.engineHeatFrac = ENGINE_HEAT_REDLINE;
    const steps = Math.round(SPITFIRE_MK2.engineThermal.coolTimeS / FIXED_DT_S);
    for (let i = 0; i < steps; i++) stepEngineHeat(state, SPITFIRE_MK2, FIXED_DT_S);
    expect(state.engineHeatFrac).toBeLessThan(0.1); // ~5% po coolTimeS (3 stałe czasowe)
  });

  it('chłodzenie opływem: wolny lot grzeje mocniej niż szybki (przy tym samym gazie)', () => {
    const ref = SPITFIRE_MK2.engineThermal.speedCoolingRefKmh;
    function heatAfter(iasKmh: number): number {
      const state = createPlaneState();
      state.throttle = 1;
      state.wepActive = true; // na WEP różnica opływu jest wyraźna (equilibrium ponad progiem)
      state.iasMs = iasKmh / MS_TO_KMH;
      for (let i = 0; i < 60 * 100; i++) stepEngineHeat(state, SPITFIRE_MK2, FIXED_DT_S); // 100 s
      return state.engineHeatFrac;
    }
    expect(heatAfter(ref * 0.4)).toBeGreaterThan(heatAfter(ref * 1.8));
  });
});

describe('engine-heat: skala °C wskaźnika (per samolot)', () => {
  it('heat 0 → coldTempC, heat 1 → redlineTempC (kotwice per samolot)', () => {
    const tS = SPITFIRE_MK2.engineThermal;
    expect(engineDisplayTempC(0, tS)).toBe(tS.coldTempC);
    expect(engineDisplayTempC(1, tS)).toBe(tS.redlineTempC);
    const tB = BF109_E.engineThermal;
    expect(engineDisplayTempC(0, tB)).toBe(tB.coldTempC);
    expect(engineDisplayTempC(1, tB)).toBe(tB.redlineTempC);
  });

  it('rośnie monotonicznie i ekstrapoluje powyżej czerwonej linii', () => {
    const t = SPITFIRE_MK2.engineThermal;
    expect(engineDisplayTempC(0.5, t)).toBeGreaterThan(engineDisplayTempC(0.2, t));
    expect(engineDisplayTempC(1.5, t)).toBeGreaterThan(t.redlineTempC); // głębokie przegrzanie > próg
  });

  it('samoloty mają RÓŻNE progi (decyzja usera: per samolot)', () => {
    expect(SPITFIRE_MK2.engineThermal.redlineTempC).not.toBe(BF109_E.engineThermal.redlineTempC);
  });
});

describe('engine-heat: obrażenia z przegrzania', () => {
  it('poniżej/na czerwonej linii — zero obrażeń', () => {
    expect(overheatDamageHp(0.5, SPITFIRE_MK2, FIXED_DT_S)).toBe(0);
    expect(overheatDamageHp(ENGINE_HEAT_REDLINE, SPITFIRE_MK2, FIXED_DT_S)).toBe(0);
  });

  it('powyżej czerwonej linii — obrażenia rosną liniowo z przekroczeniem', () => {
    const d12 = overheatDamageHp(1.2, SPITFIRE_MK2, 1);
    const d14 = overheatDamageHp(1.4, SPITFIRE_MK2, 1);
    expect(d12).toBeGreaterThan(0);
    expect(d14).toBeCloseTo(2 * d12, 6); // przekroczenie 0.4 = 2× przekroczenia 0.2
    expect(d12).toBeCloseTo(SPITFIRE_MK2.engineThermal.overheatDamagePerS * 0.2, 6);
  });
});
