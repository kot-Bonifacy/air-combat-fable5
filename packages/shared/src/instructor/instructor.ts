import { Quaternion, Vector3 } from 'three';
import { airDensityKgM3, dynamicPressurePa } from '../physics/atmosphere';
import { maxRollRateRadS, nAvailG } from '../physics/envelope';
import { nDemandForPitchRate } from '../physics/plane-step';
import type { PlaneState } from '../physics/state';
import type { PlaneConfig } from '../planes/loader';

// Instruktor mouse-aim (fizyka-lotu.md rozdz. 7, wzorzec War Thunder):
// gracz wskazuje punkt na sferze wokół samolotu, instruktor zamienia błąd
// kątowy nos→cel na żądania {n, rollRate, yawRate} strategią bank-and-pull.
// Regulator P z nasyceniem — rates są kinematyczne, więc oscylacje typowe
// dla PID nad fizyką momentową nie występują. Boty (przyszłe fazy) używają
// dokładnie tego interfejsu — nie umieją złamać koperty.

const DEG_TO_RAD = Math.PI / 180;

/**
 * Krzywa wykładnicza reakcji celownika myszy: mnożnik wzmocnienia ciągnięcia
 * rosnący z |błąd kątowy| (= oddalenie kursora od nosa). Przy małym błędzie ≈1
 * (delikatny ruch myszy jak dawniej — nachylenie w zerze = 1, precyzyjne
 * celowanie bez zmian), przy |błąd| ≥ refRad ustala się na (1 + expo): duże
 * oddalenie kursora = mocniejsza zmiana kierunku lotu. expo = 0 wyłącza (czysta
 * liniowość). Stosowane TYLKO do pitch (pull) — roll/yaw i tak saturują do
 * fizycznego limitu, a boost rollError psułby precyzyjne korekty w bok
 * (atan2 daje duży kąt przechylenia nawet przy małym oddaleniu kursora w bok).
 */
function expoPullGainFactor(errRad: number, expo: number, refRad: number): number {
  if (expo <= 0 || refRad <= 0) return 1;
  return 1 + expo * Math.min(1, Math.abs(errRad) / refRad);
}

/**
 * Maksymalny clRatio (n_demand / n_avail), do którego instruktor dawkuje G przy
 * wzmocnieniu wykładniczym. Poniżej progu buffetu (0.9) i przeciągnięcia (1.0),
 * więc daleki kursor ciągnie aż do granicy koperty — mocniej, gdy jest zapas
 * prędkości/G — ale samolot nie departuje przy płynnym śledzeniu (fizyka-lotu.md
 * rozdz. 7; por. „pilot dawkuje G wg HUD clRatio 0.85" w testach manewrów).
 */
const INSTRUCTOR_MAX_CLRATIO = 0.85;

/** Żądania pilota PRZED kopertą — wspólne wyjście instruktora i klawiatury. */
export interface PilotDemands {
  /** Żądane przeciążenie [G]. */
  nDemandG: number;
  /** Żądany roll rate [rad/s], + w prawo. */
  rollRateRadS: number;
  /** Żądany yaw rate [rad/s], + nos w prawo. */
  yawRateRadS: number;
}

export function createPilotDemands(): PilotDemands {
  return { nDemandG: 1, rollRateRadS: 0, yawRateRadS: 0 };
}

const scratchTargetBody = new Vector3();
const scratchInvQ = new Quaternion();

export class Instructor {
  /** Wygładzane (filtr 1. rzędu) żądania surowe — stan między tickami. */
  private smoothedPullG = 0;
  private smoothedRollRateRadS = 0;
  private smoothedYawRateRadS = 0;

  reset(): void {
    this.smoothedPullG = 0;
    this.smoothedRollRateRadS = 0;
    this.smoothedYawRateRadS = 0;
  }

  /**
   * Jeden tick regulatora: kierunek na cel (world, znormalizowany) → żądania.
   * Wynik zapisywany do `out`.
   */
  update(
    state: PlaneState,
    plane: PlaneConfig,
    targetDirWorld: Vector3,
    dtS: number,
    out: PilotDemands,
  ): PilotDemands {
    const cfg = plane.instructor;
    scratchInvQ.copy(state.orientation).invert();
    scratchTargetBody.copy(targetDirWorld).applyQuaternion(scratchInvQ).normalize();

    // rozkład błędu w body frame: +Z nos, +Y góra, +X LEWE skrzydło
    const lateral = -scratchTargetBody.x; // prawo dodatnie
    const vertical = scratchTargetBody.y;
    const thetaTotalRad = Math.acos(Math.min(1, Math.max(-1, scratchTargetBody.z)));

    const pushoverConeRad = cfg.pushoverConeDeg * DEG_TO_RAD;
    let rollErrorRad: number;
    let pullErrorRad: number;
    if (
      thetaTotalRad < pushoverConeRad &&
      vertical < 0 &&
      Math.abs(lateral) < Math.abs(vertical)
    ) {
      // cel tuż pod nosem, błąd głównie pionowy: pchnięcie zamiast beczki o 180°
      rollErrorRad = 0;
      pullErrorRad = Math.atan2(vertical, scratchTargetBody.z);
    } else {
      // bank-and-pull: przechyl tak, by cel znalazł się nad nosem, i ciągnij;
      // ciągnięcie pełne poniżej bankThreshold, wygaszone liniowo do zera
      // przy 2×bankThreshold — "najpierw roll, potem pull"
      // przy θ→0 atan2(lateral, vertical) degeneruje się (szum ±90°) —
      // waga min(1, θ/stożek) wygasza roll proporcjonalnie do całego błędu
      const rollRelevance = Math.min(1, thetaTotalRad / Math.max(pushoverConeRad, 1e-6));
      rollErrorRad = Math.atan2(lateral, vertical) * rollRelevance;
      const thrRad = cfg.bankThresholdDeg * DEG_TO_RAD;
      const pullScale = Math.min(1, Math.max(0, (2 * thrRad - Math.abs(rollErrorRad)) / thrRad));
      pullErrorRad = thetaTotalRad * pullScale;
    }

    const maxRoll = maxRollRateRadS(state.iasMs, plane);
    const rawRoll = Math.min(maxRoll, Math.max(-maxRoll, cfg.aggressivenessRoll * rollErrorRad));
    // n proporcjonalne do błędu w płaszczyźnie (rozdz. 7: aggressiveness w G/rad);
    // krzywa wykładnicza wzmacnia ciągnięcie przy dużym oddaleniu kursora (małe
    // ruchy bez zmian); nasycenie robi koperta (n_avail / nMaxG) w pilotStep
    const expoRefRad = cfg.aimExpoRefDeg * DEG_TO_RAD;
    const rawPullG =
      cfg.aggressivenessPitch *
      pullErrorRad *
      expoPullGainFactor(pullErrorRad, cfg.aimExpo, expoRefRad);
    const maxYaw = cfg.maxYawRateDegS * DEG_TO_RAD;
    const yawErrorRad = Math.atan2(lateral, Math.max(scratchTargetBody.z, 0));
    const rawYaw = Math.min(maxYaw, Math.max(-maxYaw, cfg.yawGain * yawErrorRad));

    // filtr 1. rzędu — tłumi szarpnięcia myszy zanim trafią w kinematykę
    const blend = -Math.expm1(-dtS / cfg.smoothingTauS);
    this.smoothedRollRateRadS += (rawRoll - this.smoothedRollRateRadS) * blend;
    this.smoothedPullG += (rawPullG - this.smoothedPullG) * blend;
    this.smoothedYawRateRadS += (rawYaw - this.smoothedYawRateRadS) * blend;

    out.rollRateRadS = this.smoothedRollRateRadS;
    out.yawRateRadS = this.smoothedYawRateRadS;
    // baza n: lot po prostej (nośna równoważy grawitację ⊥ do toru) + ciągnięcie
    out.nDemandG = nDemandForPitchRate(state, 0) + this.smoothedPullG;
    // Krzywa wykładnicza może zażądać więcej G, niż daje skrzydło przy małej
    // prędkości (wolny szczyt pętli) → samolot by przeciągnął. Klampujemy więc
    // wzmocnione ciągnięcie do bezpiecznego pułapu koperty (nAvail liczone tym
    // samym wzorem co w pilotStep) — daleki kursor ciągnie do granicy, ale nie
    // poza nią. Tylko gdy expo aktywne i ciągniemy (push/baza/expo=0 bez zmian).
    if (cfg.aimExpo > 0 && this.smoothedPullG > 0) {
      const qPa = dynamicPressurePa(airDensityKgM3(state.position.y), state.velocity.length());
      const stallSafeMaxG = INSTRUCTOR_MAX_CLRATIO * nAvailG(qPa, plane);
      if (out.nDemandG > stallSafeMaxG) out.nDemandG = stallSafeMaxG;
    }
    return out;
  }
}
