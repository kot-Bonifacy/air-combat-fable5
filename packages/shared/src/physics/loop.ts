import { Quaternion, Vector3 } from 'three';
import type { PlaneState } from './state';

const scratchOmega = new Vector3();
const scratchDq = new Quaternion();

/**
 * Jeden krok semi-implicit Euler: najpierw v += a·dt, potem p += v·dt.
 * Rotacja kinematyczna: q ← q ⊗ Δq(ω_body·dt), normalizacja co tick.
 *
 * Mapowanie rate'ów pilota na ω_body wynika z konwencji osi (+Z nos, +Y góra,
 * +X lewe skrzydło, układ prawoskrętny): nos w górę = obrót wokół −X,
 * nos w prawo = obrót wokół −Y, przechylenie w prawo = obrót wokół +Z.
 */
export function integrateStep(
  state: PlaneState,
  totalForce: Vector3,
  massKg: number,
  dtS: number,
): void {
  state.velocity.addScaledVector(totalForce, dtS / massKg);
  state.position.addScaledVector(state.velocity, dtS);

  scratchOmega.set(-state.angularRates.pitch, -state.angularRates.yaw, state.angularRates.roll);
  const angleRad = scratchOmega.length() * dtS;
  if (angleRad > 0) {
    scratchOmega.normalize();
    scratchDq.setFromAxisAngle(scratchOmega, angleRad);
    state.orientation.multiply(scratchDq).normalize();
  }
}

/**
 * Akumulator czasu dla stałego kroku fizyki. Render woła advance(dt klatki)
 * i dostaje alpha ∈ [0,1) do interpolacji między przedostatnim a ostatnim stanem.
 */
export class FixedStepLoop {
  private accumulatorS = 0;

  constructor(
    private readonly stepDtS: number,
    private readonly step: (dtS: number) => void,
  ) {}

  advance(frameDtS: number, maxStepsPerFrame = 10): number {
    // clamp chroni przed spiralą śmierci po wznowieniu uśpionej karty
    this.accumulatorS = Math.min(
      this.accumulatorS + frameDtS,
      maxStepsPerFrame * this.stepDtS,
    );
    while (this.accumulatorS >= this.stepDtS) {
      this.step(this.stepDtS);
      this.accumulatorS -= this.stepDtS;
    }
    return this.accumulatorS / this.stepDtS;
  }
}
