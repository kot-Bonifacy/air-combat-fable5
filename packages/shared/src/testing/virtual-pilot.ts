import { Vector3 } from 'three';
import { GRAVITY_MS2 } from '../constants';
import { enginePowerW } from '../aero/thrust';
import { MOUSE_SENSITIVITY_RAD_PER_PX } from '../input/mouse-aim-core';
import { PilotControl, createControlDeflections } from '../input/pilot-control';
import { createPilotDemands } from '../instructor/instructor';
import { getForward, getUp } from '../math/frame';
import { airDensityKgM3, dynamicPressurePa, tasToIasMs } from '../physics/atmosphere';
import { nAvailG } from '../physics/envelope';
import { validatePlaneState } from '../physics/nan-guard';
import {
  createSimPlane,
  pilotStep,
  type PilotTickResult,
  type SimPlane,
} from '../physics/pilot-step';
import { nDemandForPitchRate } from '../physics/plane-step';
import type { PlaneState } from '../physics/state';
import { inducedDragFactor, type PlaneConfig } from '../planes/loader';

// Wirtualny pilot (harness manewrów gracza): symuluje rękę na myszy
// i klawiaturze NAD pełnym pipeline'em wejścia gry (MouseAimCore →
// PilotControl → Instructor → pilotStep). Steruje sprzężeniem zwrotnym —
// jak gracz patrzący na znacznik nosa i wskaźnik G w HUD — więc testy
// nie pękają po strojeniu czułości/agresywności, tylko po zmianach modelu.

/** Limit tempa ruchu ręki [px/s] — energiczny, ale ludzki zamach myszą. */
const MAX_MOUSE_SPEED_PX_S = 4000;

const TWO_PI = 2 * Math.PI;

/** Zawinięcie kąta do (−π, π]. */
export function wrapPiRad(rad: number): number {
  let r = rad % TWO_PI;
  if (r > Math.PI) r -= TWO_PI;
  else if (r <= -Math.PI) r += TWO_PI;
  return r;
}

const scratchDesired = new Vector3();
const scratchFwd = new Vector3();
const scratchUp = new Vector3();

export class VirtualPilot {
  readonly control = new PilotControl();
  readonly sim: SimPlane;
  readonly demands = createPilotDemands();
  readonly deflections = createControlDeflections();
  lastTick: PilotTickResult | undefined;
  /** Najdalsze wychylenie pitch celownika od horyzontu [rad] — dowód przejścia przez pion. */
  maxAimPitchAbsRad = 0;

  constructor(
    readonly plane: PlaneConfig,
    stallSeed: number,
  ) {
    this.sim = createSimPlane(stallSeed);
  }

  get state(): PlaneState {
    return this.sim.state;
  }

  /** Lot poziomy na wprost (+Z) na zadanej wysokości i TAS; celownik na nosie. */
  setLevelFlight(altitudeM: number, tasMs: number, throttle: number): void {
    const state = this.state;
    state.position.set(0, altitudeM, 0);
    state.velocity.set(0, 0, tasMs);
    state.orientation.identity();
    state.angularRates.pitch = 0;
    state.angularRates.roll = 0;
    state.angularRates.yaw = 0;
    state.throttle = throttle;
    state.iasMs = tasToIasMs(tasMs, airDensityKgM3(altitudeM));
    this.deflections.pitchUp = 0;
    this.deflections.rollRight = 0;
    this.deflections.yawRight = 0;
    this.control.reset(state);
    this.maxAimPitchAbsRad = 0;
  }

  /** Throttle z bilansu T = D w locie poziomym (n=1) przy zadanej TAS. */
  trimThrottleForLevel(altitudeM: number, tasMs: number): number {
    const plane = this.plane;
    const rho = airDensityKgM3(altitudeM);
    const qS = dynamicPressurePa(rho, tasMs) * plane.wingAreaM2;
    const cl = (plane.massKg * GRAVITY_MS2) / qS;
    const dragN = qS * (plane.cd0 + inducedDragFactor(plane) * cl * cl);
    const availablePowerW = plane.propEfficiency * enginePowerW(plane, altitudeM);
    return Math.min(1, (dragN * tasMs) / availablePowerW);
  }

  /**
   * Ruch myszy w stronę zadanego kierunku świata: z dwóch równoważnych
   * parametryzacji {yaw, pitch} (normalna / "za plecami przez pion") wybiera
   * bliższą bieżącej pozycji kursora — czyli ciągnie kursor po ekranie tak,
   * jak zrobiłaby to ręka — i przesuwa go z limitem tempa.
   */
  moveMouseTowards(desiredDirWorld: Vector3, dtS: number): void {
    const aim = this.control.mouseAim;
    const y = Math.min(1, Math.max(-1, desiredDirWorld.y));
    const pitchA = Math.asin(y);
    const yawA = Math.atan2(desiredDirWorld.x, desiredDirWorld.z);
    const pitchB = wrapPiRad(Math.PI - pitchA);
    const yawB = wrapPiRad(yawA + Math.PI);

    const dYawA = wrapPiRad(yawA - aim.yawRad);
    const dPitchA = wrapPiRad(pitchA - aim.pitchRad);
    const dYawB = wrapPiRad(yawB - aim.yawRad);
    const dPitchB = wrapPiRad(pitchB - aim.pitchRad);

    const closerA = Math.hypot(dYawA, dPitchA) <= Math.hypot(dYawB, dPitchB);
    const dYaw = closerA ? dYawA : dYawB;
    const dPitch = closerA ? dPitchA : dPitchB;

    // ruch myszy w prawo/dół (dodatni px) ZMNIEJSZA yaw/pitch — stąd minus
    let dxPx = -dYaw / MOUSE_SENSITIVITY_RAD_PER_PX;
    let dyPx = -dPitch / MOUSE_SENSITIVITY_RAD_PER_PX;
    const maxPx = MAX_MOUSE_SPEED_PX_S * dtS;
    const lenPx = Math.hypot(dxPx, dyPx);
    if (lenPx > maxPx) {
      dxPx *= maxPx / lenPx;
      dyPx *= maxPx / lenPx;
    }
    aim.applyMovementPx(dxPx, dyPx);
  }

  /**
   * Wyprzedzenie celownika nad nos [rad] dające żądanie ≈ clRatioTarget·n_avail
   * (cap strukturalny nMaxG) — gracz dawkuje ciągnięcie wg wskaźnika G w HUD,
   * zamiast szarpać do oporu i przeciągać przy małej prędkości.
   */
  pullLeadRad(clRatioTarget: number): number {
    const state = this.state;
    const qPa = dynamicPressurePa(airDensityKgM3(state.position.y), state.velocity.length());
    const nTarget = Math.min(clRatioTarget * nAvailG(qPa, this.plane), this.plane.nMaxG);
    const baseN = nDemandForPitchRate(state, 0);
    const leadRad = (nTarget - baseN) / this.plane.instructor.aggressivenessPitch;
    return Math.min(Math.max(leadRad, 0), 0.45 * Math.PI);
  }

  /** Prowadź celownik leadRad nad nosem w płaszczyźnie symetrii (ciągnięcie). */
  steerPull(leadRad: number, dtS: number): void {
    getForward(this.state.orientation, scratchFwd);
    getUp(this.state.orientation, scratchUp);
    scratchDesired
      .copy(scratchFwd)
      .multiplyScalar(Math.cos(leadRad))
      .addScaledVector(scratchUp, Math.sin(leadRad));
    this.moveMouseTowards(scratchDesired, dtS);
  }

  /** Prowadź celownik leadRad pod nosem (pchnięcie — w stożku pushover instruktora). */
  steerPush(leadRad: number, dtS: number): void {
    this.steerPull(-leadRad, dtS);
  }

  /** Jeden tick: arbitraż wejścia → pilotStep → strażnik NaN. */
  tick(dtS: number, label: string): PilotTickResult {
    this.control.update(this.state, this.plane, this.deflections, dtS, this.demands);
    this.lastTick = pilotStep(this.sim, this.plane, this.demands, dtS);
    validatePlaneState(this.state, label);
    this.maxAimPitchAbsRad = Math.max(
      this.maxAimPitchAbsRad,
      Math.abs(this.control.mouseAim.pitchRad),
    );
    return this.lastTick;
  }
}
