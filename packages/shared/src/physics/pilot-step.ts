import { Vector3 } from 'three';
import type { PilotDemands } from '../instructor/instructor';
import { GRAVITY_MS2 } from '../constants';
import { getRight } from '../math/frame';
import type { PlaneConfig } from '../planes/loader';
import { airDensityKgM3, dynamicPressurePa } from './atmosphere';
import { clampLoadFactorG, dampSideslip, maxRollRateRadS, nAvailG, weathervaneRates } from './envelope';
import { GLoadMachine, createGLoadEffects, type GLoadEffects } from './g-load';
import { pitchRateForLoadFactor, stepPlane, type PlaneTickResult } from './plane-step';
import { StallMachine, createStallEffects, type StallEffects } from './stall';
import { createPlaneState, type AngularRates, type PlaneState } from './state';

// Pełny tick "pilot → samolot" (fizyka-lotu.md rozdz. 6–8): żądania pilota
// (z instruktora LUB klawiatury) przechodzą przez kopertę i maszynę
// przeciągnięcia, stają się kinematycznymi prędkościami kątowymi
// (+ weathervaning), po czym działa fizyka translacji i koordynacja yaw.
// Klient, serwer i harness używają TEGO wejścia — nie składają pipeline'u sami.

/** Samolot jako jednostka symulacji: stan + maszyny + bufory. */
export interface SimPlane {
  state: PlaneState;
  stallMachine: StallMachine;
  stallEffects: StallEffects;
  /** Tolerancja przeciążenia pilota (G-LOC) — sufit dodatniego n + zaciemnienie. */
  gLoadMachine: GLoadMachine;
  gLoadEffects: GLoadEffects;
  /** Bufor poprawek weathervane (bez alokacji per tick). */
  weathervane: AngularRates;
}

export function createSimPlane(stallSeed: number): SimPlane {
  return {
    state: createPlaneState(),
    stallMachine: new StallMachine(stallSeed),
    stallEffects: createStallEffects(),
    gLoadMachine: new GLoadMachine(),
    gLoadEffects: createGLoadEffects(),
    weathervane: { pitch: 0, roll: 0, yaw: 0 },
  };
}

const scratchRightCoord = new Vector3();

export interface PilotTickResult extends PlaneTickResult {
  stall: StallEffects;
  /** Tolerancja przeciążenia pilota (G-LOC): sufit n, rezerwa, zaciemnienie. */
  gLoad: GLoadEffects;
  /** n po kopercie ORAZ po limicie pilota [G] — to poleciało do siły nośnej. */
  nClampedG: number;
  /** Fizycznie dostępne n przy bieżącym q [G]. */
  nAvailG: number;
}

/**
 * Jeden tick z pełnym pipeline'em sterowania. Kolejność jest częścią kontraktu:
 * 1. koperta: clamp n (struktura + n_avail), clamp roll z krzywej IAS
 * 2. maszyna przeciągnięcia na surowym żądaniu (clRatio = n_demand/n_avail)
 * 3. rates: pitch z n (nos podąża za torem) + weathervane — przeciągnięcie NIE
 *    wymusza nosa, tor sam opada przy obciętym Cl (gracz wyprowadza nurkując);
 *    roll po kopercie × sterowność lotek + wing drop; yaw + weathervane
 * 4. stepPlane (siły + integracja) — state.stalled pochodzi z maszyny stanów
 * 5. dampSideslip (koordynacja yaw na nowym wektorze prędkości)
 */
export function pilotStep(
  sim: SimPlane,
  plane: PlaneConfig,
  demands: PilotDemands,
  dtS: number,
): PilotTickResult {
  const { state } = sim;
  const tasMs = state.velocity.length();
  const qPa = dynamicPressurePa(airDensityKgM3(state.position.y), tasMs);

  // (1) koperta
  const nAvail = nAvailG(qPa, plane);
  const nEnvelopeG = clampLoadFactorG(demands.nDemandG, qPa, plane);
  const maxRoll = maxRollRateRadS(state.iasMs, plane);
  const rollClamped = Math.min(maxRoll, Math.max(-maxRoll, demands.rollRateRadS));

  // (1b) tolerancja przeciążenia pilota (G-LOC): sufit dodatniego n opada przy
  // UTRZYMYWANIU wysokiego G — chwilowe szarpnięcie do nMaxG przechodzi, ale
  // wieczny max zakręt nie (decyzja 2026-06-14). Maszyna zużywa rezerwę z n PO
  // limicie i zwraca nLimitedG; od tej pory to ono jest "n po kopercie".
  const gLoad = sim.gLoadMachine.update(nEnvelopeG, plane, dtS, sim.gLoadEffects);
  const nClampedG = gLoad.nLimitedG;

  // (2) przeciągnięcie — próg na ŻĄDANIU obciętym tylko strukturalnie:
  // koperta n_avail z definicji nie pozwala przekroczyć clMax, a maszyna
  // ma wykrywać właśnie "chcę więcej, niż fizyka daje". Maszyna patrzy na
  // |clRatio| (znak bez znaczenia — przeciągnięcie i pchanie symetryczne);
  // liczymy go ze znakiem tylko po to, by przy q→0 (nAvail=0) ±Infinity
  // zachowało sens dla obu kierunków
  const nStructG = Math.min(plane.nMaxG, Math.max(plane.nMinG, demands.nDemandG));
  const clRatio =
    nAvail > 0 ? nStructG / nAvail : nStructG === 0 ? 0 : Infinity * Math.sign(nStructG);
  sim.stallMachine.update(clRatio, plane, dtS, sim.stallEffects);
  const stall = sim.stallEffects;

  // (3) kinematyczne prędkości kątowe; α_implied liczona z n PO kopercie
  // (ten sam wzór co w lift.ts — tu potrzebna PRZED stepPlane dla weathervane)
  const qS = qPa * plane.wingAreaM2;
  const clNow =
    qS > 0
      ? Math.min(plane.clMax, Math.max(-plane.clMax, (nClampedG * plane.massKg * GRAVITY_MS2) / qS))
      : 0;
  const alphaImpliedRad = clNow / plane.clAlphaPerRad;
  const pathPitchRate = pitchRateForLoadFactor(state, nClampedG);
  weathervaneRates(state, alphaImpliedRad, plane, sim.weathervane);
  state.angularRates.pitch = pathPitchRate + sim.weathervane.pitch;
  state.angularRates.roll = rollClamped * stall.aileronFactor + stall.rollRateOffsetRadS;
  state.angularRates.yaw = demands.yawRateRadS + sim.weathervane.yaw;

  // (4) fizyka translacji
  // koordynacja zakrętu (feed-forward, nie regulator): w przechyleniu grawitacja
  // zagina tor BOKIEM względem płaszczyzny symetrii z przyspieszeniem g·sinφ
  // (= −g·right.y); nos musi yaw-ować w tym samym tempie, inaczej powstaje
  // trwały ślizg, którego tłumik kadłuba nie ma prawa nadgonić
  if (tasMs > 1) {
    getRight(state.orientation, scratchRightCoord);
    state.angularRates.yaw += (-GRAVITY_MS2 * scratchRightCoord.y) / tasMs;
  }

  const tick = stepPlane(state, plane, nClampedG, dtS);
  state.stalled = stall.phase === 'stalled';

  // (5) koordynacja yaw
  dampSideslip(state, plane, dtS);

  return { ...tick, stall, gLoad, nClampedG, nAvailG: nAvail };
}

// Bufor żądań wraku — stepWreck nie alokuje per tick (jeden wątek, sekwencyjnie).
const wreckDemands: PilotDemands = { nDemandG: 1, rollRateRadS: 0, yawRateRadS: 0 };

/**
 * Ogranicza żądania pilota do możliwości ZESTRZELONEGO wraku (zniszczenie w
 * powietrzu): lotki działają w pełni, ster wysokości tylko częściowo. Bazą jest
 * wreck.baseLoadG (< 1 G → wrak opada, nie utrzymuje wysokości); input pitch gracza
 * dodaje wokół niej ułamek (wreck.pitchAuthority). Ster kierunku martwy. Mutuje `out`.
 * Dla bota podaj neutralne żądania (nDemandG=1) → czysty opad bez prób wyprowadzania.
 */
export function applyWreckControl(demands: PilotDemands, plane: PlaneConfig, out: PilotDemands): void {
  out.rollRateRadS = demands.rollRateRadS; // lotki pełne — wrakiem da się przechylać
  // pitch: baza opadania + ułamek nadwyżki żądania ponad neutralne 1 G (gracz „macha", nie ratuje)
  out.nDemandG = plane.wreck.baseLoadG + (demands.nDemandG - 1) * plane.wreck.pitchAuthority;
  out.yawRateRadS = 0; // ster kierunku nie działa
}

/**
 * Jeden tick SPADAJĄCEGO WRAKU (life 'dying'). Silnik martwy → throttle wymuszony
 * na 0 (model ciągu skaluje się gazem, więc T = 0), sterowanie ograniczone przez
 * applyWreckControl. Reszta to zwykła fizyka (opór, grawitacja, weathervaning) —
 * wrak traci energię i opada, ale gracz może nim częściowo kierować (lotki + nikły
 * pitch). `demands` to surowe żądania (gracza z klawiatury albo zera dla bota).
 */
export function stepWreck(
  sim: SimPlane,
  plane: PlaneConfig,
  demands: PilotDemands,
  dtS: number,
): PilotTickResult {
  applyWreckControl(demands, plane, wreckDemands);
  sim.state.throttle = 0; // silnik stoi — brak ciągu (śmigło wytraca obroty po stronie wizualnej)
  return pilotStep(sim, plane, wreckDemands, dtS);
}
