import { Vector3 } from 'three';
import { Instructor, type PilotDemands } from '../instructor/instructor';
import { getForward } from '../math/frame';
import { maxRollRateRadS } from '../physics/envelope';
import { nDemandForPitchRate } from '../physics/plane-step';
import type { PlaneState } from '../physics/state';
import type { PlaneConfig } from '../planes/loader';
import { MouseAimCore } from './mouse-aim-core';

// Arbitraż wejścia gracza (wydzielony z klienta): klawiatura z niezerowym
// wychyleniem omija instruktora (bezpośrednie żądania przez kopertę,
// fizyka-lotu.md rozdz. 7 pkt 4); po jej puszczeniu mysz przejmuje od
// bieżącego kierunku nosa — bez szarpnięcia. Klient i harness testów
// manewrów używają TEJ klasy — nie składają arbitrażu sami.

const DEG_TO_RAD = Math.PI / 180;

/**
 * Wychylenia sterów −1..1 (konwencja symulatorowa, decyzja z fazy 2):
 * +pitchUp = nos w górę (drążek do siebie), +rollRight = przechylenie
 * w prawo, +yawRight = nos w prawo.
 */
export interface ControlDeflections {
  pitchUp: number;
  rollRight: number;
  yawRight: number;
}

export function createControlDeflections(): ControlDeflections {
  return { pitchUp: 0, rollRight: 0, yawRight: 0 };
}

/**
 * Mapowanie wychyleń klawiatury na żądania PRZED kopertą: pitch interpoluje n
 * między bazą lotu po prostej a nMax/nMin, roll/yaw proporcjonalnie do
 * limitów koperty/konfiguracji. Nasycenie i tak robi koperta w pilotStep.
 */
export function keyboardDemands(
  state: PlaneState,
  plane: PlaneConfig,
  deflections: ControlDeflections,
  out: PilotDemands,
): PilotDemands {
  const baseN = nDemandForPitchRate(state, 0);
  const pitchD = deflections.pitchUp;
  out.nDemandG =
    pitchD >= 0
      ? baseN + pitchD * (plane.nMaxG - baseN)
      : baseN + pitchD * (baseN - plane.nMinG);
  out.rollRateRadS = deflections.rollRight * maxRollRateRadS(state.iasMs, plane);
  out.yawRateRadS = deflections.yawRight * plane.instructor.maxYawRateDegS * DEG_TO_RAD;
  return out;
}

export type ControlMode = 'mysz' | 'klawiatura';

const scratchFwd = new Vector3();
const scratchTarget = new Vector3();

export class PilotControl {
  readonly mouseAim = new MouseAimCore();
  private readonly instructor = new Instructor();
  private keyboardActive = false;

  get mode(): ControlMode {
    return this.keyboardActive ? 'klawiatura' : 'mysz';
  }

  /** Po respawnie: wyzeruj filtry instruktora i postaw celownik na nosie. */
  reset(state: PlaneState): void {
    this.instructor.reset();
    this.mouseAim.alignTo(getForward(state.orientation, scratchFwd));
    this.keyboardActive = false;
  }

  /**
   * Jeden tick arbitrażu: niezerowe wychylenia → żądania z klawiatury
   * (instruktor resetowany, by po powrocie myszy nie strzelił starym stanem
   * filtra); zero wychyleń → mysz przez instruktora, z przejęciem od nosa
   * w pierwszym ticku po puszczeniu klawiszy.
   */
  update(
    state: PlaneState,
    plane: PlaneConfig,
    deflections: ControlDeflections,
    dtS: number,
    out: PilotDemands,
  ): ControlMode {
    const hasRotationInput =
      deflections.pitchUp !== 0 || deflections.rollRight !== 0 || deflections.yawRight !== 0;
    if (hasRotationInput) {
      this.keyboardActive = true;
      this.instructor.reset();
      keyboardDemands(state, plane, deflections, out);
    } else {
      if (this.keyboardActive) {
        // przejęcie przez mysz bez szarpnięcia: cel = aktualny kierunek nosa
        this.mouseAim.alignTo(getForward(state.orientation, scratchFwd));
        this.keyboardActive = false;
      }
      this.mouseAim.renormalize(getForward(state.orientation, scratchFwd));
      this.mouseAim.targetDir(scratchTarget);
      this.instructor.update(state, plane, scratchTarget, dtS, out);
    }
    return this.mode;
  }

  /**
   * Sterowanie zadanym celem z pominięciem myszy (autopilot zawracania poza
   * areną): instruktor prowadzi na cel, celownik trzymany na nosie — po
   * oddaniu sterów graczowi brak szarpnięcia.
   */
  updateWithTarget(
    state: PlaneState,
    plane: PlaneConfig,
    targetDirWorld: Vector3,
    dtS: number,
    out: PilotDemands,
  ): void {
    this.instructor.update(state, plane, targetDirWorld, dtS, out);
    this.mouseAim.alignTo(getForward(state.orientation, scratchFwd));
    this.keyboardActive = false;
  }
}
