import { createRng } from '../math/rng';
import type { PlaneConfig } from '../planes/loader';

// Maszyna stanów przeciągnięcia (fizyka-lotu.md rozdz. 6.5):
// normal → buffet → stalled, z wing dropem po przetrzymaniu przeciągnięcia.
// Wejściem jest clRatio = n_demand/n_avail (równoważnie |Cl wymagany|/clMax);
// progi działają na |clRatio| (znak nieistotny — przeciągnięcie ujemne, czyli
// pchanie, wykrywane symetrycznie). Maszyna celowo NIE wymusza obrotu nosa:
// wyjście z przeciągnięcia jest naturalne — obcięcie Cl do clMax (n→n_avail
// w kopercie) sprawia, że nośna nie utrzymuje toru, tor (a za nim nos) opada,
// a pilot odzyskuje prędkość nurkując. Maszyna dokłada tylko skutki "miękkie"
// reprezentujące UTRATĘ sterowności: buffet, osłabienie lotek, wing drop.

const DEG_TO_RAD = Math.PI / 180;

export type StallPhase = 'normal' | 'buffet' | 'stalled';

export interface StallEffects {
  phase: StallPhase;
  /** 0..1 — narasta liniowo od progu buffetu do progu przeciągnięcia (drganie kamery/HUD). */
  buffetIntensity: number;
  /** Mnożnik żądania roll pilota (utrata sterowności lotek w przeciągnięciu). */
  aileronFactor: number;
  /** Wing drop [rad/s] — losowo-deterministyczny powolny przewrót po wingDropDelayS. */
  rollRateOffsetRadS: number;
}

export function createStallEffects(): StallEffects {
  return {
    phase: 'normal',
    buffetIntensity: 0,
    aileronFactor: 1,
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
   * Jeden tick maszyny. `clRatio` = n_demand/n_avail (równoważnie |Cl wymagany|
   * /clMax); liczy się tylko |clRatio| — znak (kierunek przeciągnięcia) nie
   * wpływa już na wynik. Wynik zapisywany do `effects`.
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
      // bez wymuszonego nose dropu — nos opada naturalnie za torem (obcięty Cl);
      // jedyny "twardy" skutek to wing drop po przetrzymaniu przeciągnięcia
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
      effects.rollRateOffsetRadS = 0;
    }

    effects.phase = this.phase;
    return effects;
  }
}
