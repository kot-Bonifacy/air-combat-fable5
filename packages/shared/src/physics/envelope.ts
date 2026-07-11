import { Quaternion, Vector3 } from 'three';
import { GRAVITY_MS2, MS_TO_KMH } from '../constants';
import { sampleCurve } from '../math/curve';
import { getForward, getRight, getUp } from '../math/frame';
import type { PlaneConfig } from '../planes/loader';
import type { AngularRates, PlaneState } from './state';

// Koperta osiągów (fizyka-lotu.md rozdz. 6): rotacja jest kinematyczna,
// ale żądania pilota/instruktora są obcinane przez limity wynikające
// z prędkości, wysokości i konfiguracji — to tu powstaje "czucie" samolotu.

const DEG_TO_RAD = Math.PI / 180;

/** Poniżej tej prędkości kierunki toru są zdegenerowane — koperta nie koryguje. */
const MIN_SPEED_MS = 0.1;

/** Fizycznie dostępne przeciążenie przy danym ciśnieniu dynamicznym (rozdz. 6.1). */
export function nAvailG(qPa: number, plane: PlaneConfig): number {
  return (qPa * plane.wingAreaM2 * plane.clMax) / (plane.massKg * GRAVITY_MS2);
}

/** Efektywne n: clamp żądania do [nMin, min(n_avail, n_max_struct)] (rozdz. 6.1). */
export function clampLoadFactorG(nDemandG: number, qPa: number, plane: PlaneConfig): number {
  const upper = Math.min(nAvailG(qPa, plane), plane.nMaxG);
  // przy bardzo małym q upper może spaść poniżej nMinG — wtedy decyduje fizyka (n_avail)
  return Math.min(Math.max(nDemandG, Math.max(plane.nMinG, -upper)), upper);
}

/**
 * Maksymalny roll rate z krzywej rollRate(IAS) [rad/s] — interpolacja liniowa
 * po punktach [km/h, °/s] z konfiguracji, poza zakresem wartości brzegowe (rozdz. 6.2).
 */
export function maxRollRateRadS(iasMs: number, plane: PlaneConfig): number {
  return sampleCurve(plane.rollRateCurve, iasMs * MS_TO_KMH) * DEG_TO_RAD;
}

/**
 * Szczytowy roll rate krzywej [rad/s] — mianownik „realnego wychylenia lotek"
 * (fizyka v2 R1, §6.1): przy IAS powyżej szczytu pełny drążek wychyla lotki tylko
 * częściowo (siła na drążku), więc δa = |roll żądany| / szczyt, nie / maxRoll(IAS) —
 * Zero z zabetonowanymi lotkami przy 400+ km/h NIE płaci oporem za wychylenie,
 * którego fizycznie nie osiąga.
 */
export function peakRollRateRadS(plane: PlaneConfig): number {
  let peakDegS = 0;
  for (const [, rateDegS] of plane.rollRateCurve) {
    if (rateDegS > peakDegS) peakDegS = rateDegS;
  }
  return peakDegS * DEG_TO_RAD;
}

/**
 * Autorytet steru wysokości vs IAS [0..1] z krzywej pitchAuthorityCurve (fizyka v2 R1,
 * §6.2): mnożnik maksymalnego ŻĄDANEGO n (poniżej ograniczeń koperty/G-LOC — nigdy
 * powyżej). Przy dużej prędkości ster „ciężknie" — wyrwanie z nurkowania @650+ km/h
 * nie osiąga nMaxG, promień wyrwania rośnie (duch WT RB). Nasycenie w pilotStep
 * gwarantuje utrzymanie lotu poziomego (cap ≥ 1 G) i odwróconego (cap ≤ −1 G).
 */
export function pitchAuthorityFrac(iasMs: number, plane: PlaneConfig): number {
  return sampleCurve(plane.pitchAuthorityCurve, iasMs * MS_TO_KMH);
}

const scratchVHat = new Vector3();
const scratchLiftDir = new Vector3();
const scratchDesiredFwd = new Vector3();
const scratchFwd = new Vector3();
const scratchAxis = new Vector3();
const scratchInvQ = new Quaternion();

/**
 * Weathervaning (rozdz. 6.4): poprawki pitch/yaw rate [rad/s] ściągające nos
 * do kierunku "wektor prędkości + α_implied w płaszczyźnie symetrii"
 * ze stałą czasową alignTau. Składowa roll błędu jest ignorowana —
 * chorągiewka nie przechyla. Zapisuje wynik do `target` i go zwraca.
 */
export function weathervaneRates(
  state: PlaneState,
  alphaImpliedRad: number,
  plane: PlaneConfig,
  target: AngularRates,
): AngularRates {
  target.pitch = 0;
  target.roll = 0;
  target.yaw = 0;
  const speed = state.velocity.length();
  if (speed < MIN_SPEED_MS) return target;

  scratchVHat.copy(state.velocity).divideScalar(speed);
  getUp(state.orientation, scratchLiftDir);
  scratchLiftDir.addScaledVector(scratchVHat, -scratchLiftDir.dot(scratchVHat));
  if (scratchLiftDir.lengthSq() < 1e-12) return target; // up ∥ v̂ — kierunek "nad torem" zdegenerowany
  scratchLiftDir.normalize();

  // nos ma siedzieć α nad wektorem prędkości (po stronie liftDir)
  scratchDesiredFwd
    .copy(scratchVHat)
    .multiplyScalar(Math.cos(alphaImpliedRad))
    .addScaledVector(scratchLiftDir, Math.sin(alphaImpliedRad));

  getForward(state.orientation, scratchFwd);
  scratchAxis.crossVectors(scratchFwd, scratchDesiredFwd);
  const angleRad = Math.atan2(scratchAxis.length(), scratchFwd.dot(scratchDesiredFwd));
  if (angleRad < 1e-9) return target;

  // ω_world = oś · kąt/τ, obcięte limitem tempa (tailslide: błąd ~180° bez
  // limitu dawałby snap ~450°/s); mapowanie body→rates odwrotne do integrateStep
  const rateRadS = Math.min(
    angleRad / plane.alignTauS,
    plane.weathervaneMaxRateDegS * DEG_TO_RAD,
  );
  scratchAxis.normalize().multiplyScalar(rateRadS);
  scratchInvQ.copy(state.orientation).invert();
  scratchAxis.applyQuaternion(scratchInvQ);
  target.pitch = -scratchAxis.x;
  target.yaw = -scratchAxis.y;
  return target;
}

const scratchRight = new Vector3();

/**
 * Koordynacja yaw (rozdz. 6.3): składowa boczna prędkości (body X) wygasa
 * ze stałą sideslipDamping, ale korekta na tick jest ograniczona realnym
 * autorytetem siły bocznej kadłuba (sideslipMaxAccelG). Bez limitu tłumik
 * działa jak nieskończony ster: w przechyleniu (right.y ≈ −sin φ) "zawraca"
 * grawitacyjne opadanie toru w górę — artefakt zoom climbu w zakręcie.
 * |v| nie jest renormalizowane — ubytek energii to opór ślizgu (bilans
 * z diveEnergyTest bezpieczny: korekta zawsze przeciwna składowej bocznej).
 */
export function dampSideslip(state: PlaneState, plane: PlaneConfig, dtS: number): void {
  const speed = state.velocity.length();
  if (speed < MIN_SPEED_MS) return;
  getRight(state.orientation, scratchRight);
  const lateralMs = state.velocity.dot(scratchRight);
  if (Math.abs(lateralMs) < 1e-9) return;
  const wantedDeltaMs = lateralMs * -Math.expm1(-dtS / plane.sideslipDampingS);
  const maxDeltaMs = plane.sideslipMaxAccelG * GRAVITY_MS2 * dtS;
  const deltaMs = Math.min(maxDeltaMs, Math.max(-maxDeltaMs, wantedDeltaMs));
  state.velocity.addScaledVector(scratchRight, -deltaMs);
}
