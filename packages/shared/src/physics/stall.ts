import { createRng } from '../math/rng';
import type { PlaneConfig } from '../planes/loader';

// Maszyna stanów przeciągnięcia (fizyka-lotu.md rozdz. 6.5):
// normal → buffet → stalled, z wing dropem po przetrzymaniu przeciągnięcia.
// Wejściem jest clRatio = Cl wymagany przez żądanie / clMax (ZE ZNAKIEM) —
// czyli n_demand / n_avail; progi działają na |clRatio|, znak steruje
// kierunkiem nose dropu (zawsze ku mniejszemu |α| — przeciągnięcie na
// ujemnym Cl wypycha nos ku torowi, nie dalej od niego). Obcięcie Cl
// w lift.ts robi swoje niezależnie, ta maszyna dokłada skutki "miękkie":
// buffet, nose drop, utratę lotek, wing drop.

const DEG_TO_RAD = Math.PI / 180;

export type StallPhase = 'normal' | 'buffet' | 'stalled';

export interface StallEffects {
  phase: StallPhase;
  /** 0..1 — narasta liniowo od progu buffetu do progu przeciągnięcia (drganie kamery/HUD). */
  buffetIntensity: number;
  /** Mnożnik żądania roll pilota (utrata sterowności lotek w przeciągnięciu). */
  aileronFactor: number;
  /**
   * Wymuszony obrót nosa ku mniejszemu |α| [rad/s] (tylko w przeciągnięciu).
   * Przeciągnięcie na dodatnim Cl → nose drop (< 0); na ujemnym Cl → nos
   * ku torowi (> 0).
   */
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
   * Jeden tick maszyny. `clRatio` = Cl wymagany/clMax z bieżącego żądania
   * ZE ZNAKIEM (równoważnie n_demand/n_avail). Wynik zapisywany do `effects`.
   */
  update(clRatio: number, plane: PlaneConfig, dtS: number, effects: StallEffects): StallEffects {
    const stall = plane.stall;
    const ratioAbs = Math.abs(clRatio);
    const stalledNow = ratioAbs > 1;

    if (stalledNow && this.phase !== 'stalled') {
      this.stalledTimeS = 0;
      // znak losowy, skala 0.75–1.25 — "raz w lewo, raz w prawo, nigdy identycznie"
      const sign = this.rng() < 0.5 ? -1 : 1;
      this.wingDropFactor = sign * (0.75 + 0.5 * this.rng());
    }
    this.phase = stalledNow ? 'stalled' : ratioAbs >= stall.buffetOnsetRatio ? 'buffet' : 'normal';

    if (this.phase === 'stalled') {
      this.stalledTimeS += dtS;
      effects.buffetIntensity = 1;
      effects.aileronFactor = stall.aileronEffectiveness;
      // nos zawsze ku mniejszemu |α|: stall na dodatnim Cl → w dół,
      // na ujemnym (pchanie) → w górę, ku torowi
      effects.pitchRateOffsetRadS = -Math.sign(clRatio) * stall.noseDropRateDegS * DEG_TO_RAD;
      effects.rollRateOffsetRadS =
        this.stalledTimeS > stall.wingDropDelayS
          ? this.wingDropFactor * stall.wingDropRateDegS * DEG_TO_RAD
          : 0;
    } else {
      this.stalledTimeS = 0;
      effects.buffetIntensity =
        this.phase === 'buffet'
          ? Math.min(1, (ratioAbs - stall.buffetOnsetRatio) / (1 - stall.buffetOnsetRatio))
          : 0;
      effects.aileronFactor = 1;
      effects.pitchRateOffsetRadS = 0;
      effects.rollRateOffsetRadS = 0;
    }

    effects.phase = this.phase;
    return effects;
  }
}
