import { describe, expect, it } from 'vitest';
import { ENGINE_HEAT_REDLINE, FIXED_DT_S, MS_TO_KMH } from '../constants';
import { BF109_E, SPITFIRE_MK2 } from '../planes/loader';
import { engineDisplayTempC, overheatDamageHp, stepEngineHeat } from './engine-heat';
import { createPlaneState } from './state';

// Model termiczny silnika: temperatura (engineHeatFrac) relaksuje do equilibrium ∝ gaz²/chłodzenie(IAS).
// Kalibracja zakotwiczona w realnych limitach WEP: czas 0→czerwona linia przy 100% gazu i prędkości
// referencyjnej = overheatTimeFullS (Spitfire ~5 min). Testy izolują model (wołają stepEngineHeat wprost
// na syntetycznym stanie), niezależnie od pełnej dynamiki lotu.

/** Liczy sekundy od zimnego silnika do czerwonej linii przy danym gazie i IAS [km/h]. */
function timeToRedlineS(plane: typeof SPITFIRE_MK2, throttle: number, iasKmh: number, maxS = 3600): number {
  const state = createPlaneState();
  state.throttle = throttle;
  state.iasMs = iasKmh / MS_TO_KMH;
  state.engineHeatFrac = 0;
  let s = 0;
  while (state.engineHeatFrac < ENGINE_HEAT_REDLINE && s < maxS) {
    stepEngineHeat(state, plane, FIXED_DT_S);
    s += FIXED_DT_S;
  }
  return s;
}

describe('engine-heat: kalibracja do limitów historycznych', () => {
  it('Spitfire: 100% gazu @ prędkość referencyjna przegrzewa po ~overheatTimeFullS (≈5 min)', () => {
    const t = timeToRedlineS(SPITFIRE_MK2, 1, SPITFIRE_MK2.engineThermal.speedCoolingRefKmh);
    expect(t).toBeGreaterThan(SPITFIRE_MK2.engineThermal.overheatTimeFullS - 5);
    expect(t).toBeLessThan(SPITFIRE_MK2.engineThermal.overheatTimeFullS + 5);
    expect(SPITFIRE_MK2.engineThermal.overheatTimeFullS).toBe(300); // lock: 5 min WEP Merlina
  });

  it('Bf 109 przegrzewa się SZYBCIEJ niż Spitfire (gorsze chłodnice, asymetria)', () => {
    const spit = timeToRedlineS(SPITFIRE_MK2, 1, SPITFIRE_MK2.engineThermal.speedCoolingRefKmh);
    const bf = timeToRedlineS(BF109_E, 1, BF109_E.engineThermal.speedCoolingRefKmh);
    expect(bf).toBeLessThan(spit);
    expect(bf).toBeGreaterThan(BF109_E.engineThermal.overheatTimeFullS - 5);
    expect(bf).toBeLessThan(BF109_E.engineThermal.overheatTimeFullS + 5);
  });
});

describe('engine-heat: zachowanie modelu', () => {
  it('gaz mocy ciągłej (≤ próg) NIGDY nie przegrzewa — equilibrium poniżej czerwonej linii', () => {
    // gaz, przy którym equilibrium = dokładnie czerwona linia, to 1/√fullEq; bezpieczny zapas pod nim
    const safeThrottle = (1 / Math.sqrt(SPITFIRE_MK2.engineThermal.fullThrottleEqHeat)) * 0.97;
    const state = createPlaneState();
    state.throttle = safeThrottle;
    state.iasMs = SPITFIRE_MK2.engineThermal.speedCoolingRefKmh / MS_TO_KMH;
    state.engineHeatFrac = 0;
    for (let i = 0; i < 60 * 1200; i++) stepEngineHeat(state, SPITFIRE_MK2, FIXED_DT_S); // 20 min
    expect(state.engineHeatFrac).toBeLessThan(ENGINE_HEAT_REDLINE);
  });

  it('zdjęcie gazu chłodzi silnik (czerwona linia → ~zimno po coolTimeS)', () => {
    const state = createPlaneState();
    state.throttle = 0;
    state.iasMs = SPITFIRE_MK2.engineThermal.speedCoolingRefKmh / MS_TO_KMH;
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
