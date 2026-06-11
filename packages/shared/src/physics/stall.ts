import { createRng } from '../math/rng';
import type { PlaneConfig } from '../planes/loader';

// Maszyna stanów przeciągnięcia (fizyka-lotu.md rozdz. 6.5):
// normal → buffet → stalled, z wing dropem po przetrzymaniu przeciągnięcia.
// Wejściem jest clRatio = |Cl wymagany przez żądanie| / clMax — czyli
// n_demand / n_avail; obcięcie Cl w lift.ts robi swoje niezależnie,
// ta maszyna dokłada skutki "miękkie": buffet, nose drop, utratę lotek, wing drop.

const DEG_TO_RAD = Math.PI / 180;

export type StallPhase = 'normal' | 'buffet' | 'stalled';

export interface StallEffects {
  phase: StallPhase;
  /** 0..1 — narasta liniowo od progu buffetu do progu przeciągnięcia (drganie kamery/HUD). */
  buffetIntensity: number;
  /** Mnożnik żądania roll pilota (utrata sterowności lotek w przeciągnięciu). */
  aileronFactor: number;
  /** Wymuszone opadanie nosa [rad/s] (≤ 0; tylko w przeciągnięciu). */
  pitchRateOffsetRadS: number;
  /** Wing drop [rad/s] — losowo-deterministyczny powolny przewrót po wingDropDelayS. */
  rollRateOffsetRadS: number;
}

export function createStallEffects(): StallEffects {
  return {
    phase: 'normal',
    buffetIntensity: 0,
    aileronFactor: 1,
    pitchRateOffsetRadS: 0,
    rollRateOffsetRadS: 0,
  };
}

export class StallMachine {
  private phase: StallPhase = 'normal';
  private stalledTimeS = 0;
  /** Kierunek i skala wing dropu — losowane raz przy wejściu w przeciągnięcie. */
  private wingDropFactor = 0;
  private readonly rng: () => number;

  constructor(seed: number) {
    this.rng = createRng(seed);
  }

  /**
   * Jeden tick maszyny. `clRatio` = |Cl wymagany|/clMax z bieżącego żądania
   * (równoważnie |n_demand|/n_avail). Wynik zapisywany do `effects`.
   */
  update(clRatio: number, plane: PlaneConfig, dtS: number, effects: StallEffects): StallEffects {
    const stall = plane.stall;
    const stalledNow = clRatio > 1;

    if (stalledNow && this.phase !== 'stalled') {
      this.stalledTimeS = 0;
      // znak losowy, skala 0.75–1.25 — "raz w lewo, raz w prawo, nigdy identycznie"
      const sign = this.rng() < 0.5 ? -1 : 1;
      this.wingDropFactor = sign * (0.75 + 0.5 * this.rng());
    }
    this.phase = stalledNow ? 'stalled' : clRatio >= stall.buffetOnsetRatio ? 'buffet' : 'normal';

    if (this.phase === 'stalled') {
      this.stalledTimeS += dtS;
      effects.buffetIntensity = 1;
      effects.aileronFactor = stall.aileronEffectiveness;
      effects.pitchRateOffsetRadS = -stall.noseDropRateDegS * DEG_TO_RAD;
      effects.rollRateOffsetRadS =
        this.stalledTimeS > stall.wingDropDelayS
          ? this.wingDropFactor * stall.wingDropRateDegS * DEG_TO_RAD
          : 0;
    } else {
      this.stalledTimeS = 0;
      effects.buffetIntensity =
        this.phase === 'buffet'
          ? Math.min(1, (clRatio - stall.buffetOnsetRatio) / (1 - stall.buffetOnsetRatio))
          : 0;
      effects.aileronFactor = 1;
      effects.pitchRateOffsetRadS = 0;
      effects.rollRateOffsetRadS = 0;
    }

    effects.phase = this.phase;
    return effects;
  }
}
