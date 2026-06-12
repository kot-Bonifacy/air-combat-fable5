import { Vector3 } from 'three';
import type { PilotDemands } from '../instructor/instructor';
import { GRAVITY_MS2 } from '../constants';
import { getRight } from '../math/frame';
import type { PlaneConfig } from '../planes/loader';
import { airDensityKgM3, dynamicPressurePa } from './atmosphere';
import { clampLoadFactorG, dampSideslip, maxRollRateRadS, nAvailG, weathervaneRates } from './envelope';
import { pitchRateForLoadFactor, stepPlane, type PlaneTickResult } from './plane-step';
import { StallMachine, createStallEffects, type StallEffects } from './stall';
import { createPlaneState, type AngularRates, type PlaneState } from './state';

// Pełny tick "pilot → samolot" (fizyka-lotu.md rozdz. 6–8): żądania pilota
// (z instruktora LUB klawiatury) przechodzą przez kopertę i maszynę
// przeciągnięcia, stają się kinematycznymi prędkościami kątowymi
// (+ weathervaning), po czym działa fizyka translacji i koordynacja yaw.
// Klient, serwer i harness używają TEGO wejścia — nie składają pipeline'u sami.

/** Samolot jako jednostka symulacji: stan + maszyna przeciągnięcia + bufory. */
export interface SimPlane {
  state: PlaneState;
  stallMachine: StallMachine;
  stallEffects: StallEffects;
  /** Bufor poprawek weathervane (bez alokacji per tick). */
  weathervane: AngularRates;
}

export function createSimPlane(stallSeed: number): SimPlane {
  return {
    state: createPlaneState(),
    stallMachine: new StallMachine(stallSeed),
    stallEffects: createStallEffects(),
    weathervane: { pitch: 0, roll: 0, yaw: 0 },
  };
}

const scratchRightCoord = new Vector3();

export interface PilotTickResult extends PlaneTickResult {
  stall: StallEffects;
  /** n po przejściu przez kopertę [G] — to poleciało do siły nośnej. */
  nClampedG: number;
  /** Fizycznie dostępne n przy bieżącym q [G]. */
  nAvailG: number;
}

/**
 * Jeden tick z pełnym pipeline'em sterowania. Kolejność jest częścią kontraktu:
 * 1. koperta: clamp n (struktura + n_avail), clamp roll z krzywej IAS
 * 2. maszyna przeciągnięcia na surowym żądaniu (clRatio = n_demand/n_avail)
 * 3. rates: pitch z n (nos podąża za torem) + weathervane + nose drop;
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
  const nClampedG = clampLoadFactorG(demands.nDemandG, qPa, plane);
  const maxRoll = maxRollRateRadS(state.iasMs, plane);
  const rollClamped = Math.min(maxRoll, Math.max(-maxRoll, demands.rollRateRadS));

  // (2) przeciągnięcie — próg na ŻĄDANIU obciętym tylko strukturalnie:
  // koperta n_avail z definicji nie pozwala przekroczyć clMax, a maszyna
  // ma wykrywać właśnie "chcę więcej, niż fizyka daje"; ratio ZE ZNAKIEM —
  // znak żądanego Cl steruje kierunkiem nose dropu w maszynie
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
  state.angularRates.pitch = pathPitchRate + sim.weathervane.pitch + stall.pitchRateOffsetRadS;
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

  return { ...tick, stall, nClampedG, nAvailG: nAvail };
}
