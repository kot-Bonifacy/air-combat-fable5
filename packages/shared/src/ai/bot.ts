import { Quaternion, Vector3 } from 'three';
import { createRng } from '../math/rng';
import { getForward, getRight, getUp } from '../math/frame';
import { Instructor, type PilotDemands } from '../instructor/instructor';
import type { PlaneState } from '../physics/state';
import type { PlaneConfig } from '../planes/loader';
import { distanceToArenaEdgeM } from '../world/arena';
import {
  angleBetweenRad,
  computeGeometry,
  createGeometry,
  type AirCombatGeometry,
} from './geometry';
import { createLeadSolution, solveLead, type LeadSolution } from './lead';
import type { BotDifficulty, BotTuning } from './difficulty';
import { nextBotState, type BotPerception, type BotStateName } from './fsm';

// Bot (faza-06.md): steruje samolotem WYŁĄCZNIE przez interfejs instruktora
// (kierunek nosa + throttle + spust) — fizycznie nie umie więcej niż gracz
// (pułapka fazy: bot lepszy niż koperta = bug interfejsu, nie feature).
//
// Potok jednego ticku:
//   geometria + wyprzedzenie → FSM (nextBotState) → sterowanie per stan
//   → degradacja (limit G, opóźnienie reakcji, szum celowania)
//   → NADRZĘDNE override'y bezpieczeństwa (arena, ziemia)
//   → instruktor → PilotDemands.
// Override'y są ostatnie i precyzyjne (nie podlegają szumowi) — unikanie ziemi
// MUSI być nadrzędne nad FSM, inaczej evade w dolinie = crash.

/** Otoczenie potrzebne botowi do decyzji o bezpieczeństwie. */
export interface BotEnvironment {
  /** Wysokość terenu/morza pod botem [m] (liczona przez wołającego). */
  surfaceHeightM: number;
}

/** Wynik ticku bota dla wołającego (poza wypełnionym PilotDemands). */
export interface BotOutput {
  state: BotStateName;
  throttle: number;
  fire: boolean;
}

/** Co ile sekund losowany jest nowy cel błądzenia celownika (szum). */
const NOISE_RESAMPLE_S = 0.8;
/** Stała czasowa wodzenia celownika do celu szumu [s]. */
const NOISE_SLEW_TAU_S = 0.3;
/** Zejście gazu przy zbyt małym dystansie (unikanie taranowania / przestrzelenia). */
const ENGAGE_CLOSE_THROTTLE = 0.5;
/** Granice clampu kąta komendy z limitu G [rad]. */
const MIN_CMD_ANGLE_RAD = 0.12;
const MAX_CMD_ANGLE_RAD = 2.6;

const scratchSelfFwd = new Vector3();
const scratchSelfUp = new Vector3();
const scratchSelfRight = new Vector3();
const scratchTargetFwd = new Vector3();
const scratchLos = new Vector3();
const scratchHoriz = new Vector3();
const scratchRotAxis = new Vector3();
const scratchQuat = new Quaternion();

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

/** Wybiera najbliższy żywy cel z listy kandydatów (wołający wyklucza siebie/sojuszników). */
export function selectNearestTarget(
  selfPos: Vector3,
  candidates: readonly PlaneState[],
): PlaneState | null {
  let best: PlaneState | null = null;
  let bestD = Infinity;
  for (const c of candidates) {
    if (c.life !== 'alive') continue;
    const d = selfPos.distanceToSquared(c.position);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

export class Bot {
  private readonly instructor = new Instructor();
  private readonly geom: AirCombatGeometry = createGeometry();
  private readonly lead: LeadSolution = createLeadSolution();
  private readonly perception: BotPerception = {
    hasTarget: false,
    rangeM: 0,
    attackerOffBoresightRad: 0,
    targetOffBoresightRad: Math.PI,
    aspectRad: Math.PI,
    iasMs: 0,
  };
  private readonly rng: () => number;

  state: BotStateName = 'patrol';
  /** Bufor celu nosa — jeden, sekwencyjne użycie w obrębie ticku (zero alokacji). */
  private readonly aimScratch = new Vector3(0, 0, 1);
  private readonly smoothedAim = new Vector3(0, 0, 1);
  private noiseYaw = 0;
  private noisePitch = 0;
  private noiseTargetYaw = 0;
  private noiseTargetPitch = 0;
  private noiseTimerS = 0;
  private jinkTimeS = 0;
  private waypointIndex = 0;

  constructor(
    private readonly tuning: BotTuning,
    private readonly difficulty: BotDifficulty,
    rngSeed: number,
    private readonly waypoints: readonly Vector3[] = [],
  ) {
    this.rng = createRng(rngSeed);
  }

  /** Po (re)spawnie: zeruje filtry, stan i celownik na bieżący nos. */
  reset(state: PlaneState): void {
    this.instructor.reset();
    this.state = 'patrol';
    getForward(state.orientation, this.smoothedAim);
    this.noiseYaw = 0;
    this.noisePitch = 0;
    this.noiseTargetYaw = 0;
    this.noiseTargetPitch = 0;
    this.noiseTimerS = 0;
    this.jinkTimeS = 0;
    this.waypointIndex = 0;
  }

  /**
   * Jeden tick decyzji. Wypełnia `outDemands` (do pilotStep) i zwraca
   * {state, throttle, fire}. `target` = null albo martwy → patrol.
   */
  update(
    self: PlaneState,
    plane: PlaneConfig,
    target: PlaneState | null,
    env: BotEnvironment,
    dtS: number,
    outDemands: PilotDemands,
  ): BotOutput {
    this.jinkTimeS += dtS;
    getForward(self.orientation, scratchSelfFwd);
    getUp(self.orientation, scratchSelfUp);
    getRight(self.orientation, scratchSelfRight);

    const hasTarget = target !== null && target.life === 'alive';
    if (hasTarget) {
      getForward(target.orientation, scratchTargetFwd);
      computeGeometry(
        self.position,
        scratchSelfFwd,
        self.velocity,
        target.position,
        scratchTargetFwd,
        target.velocity,
        this.geom,
      );
      solveLead(
        self.position,
        self.velocity,
        target.position,
        target.velocity,
        plane.armament.muzzleVelocityMs,
        this.lead,
      );
      this.perception.hasTarget = true;
      this.perception.rangeM = this.geom.rangeM;
      this.perception.attackerOffBoresightRad = this.geom.attackerOffBoresightRad;
      this.perception.targetOffBoresightRad = this.geom.targetOffBoresightRad;
      this.perception.aspectRad = this.geom.aspectRad;
      this.perception.iasMs = self.iasMs;
    } else {
      this.perception.hasTarget = false;
    }

    this.state = nextBotState(this.state, this.perception, this.tuning);

    // (1) sterowanie per stan → surowy kierunek nosa + throttle + zamiar ognia
    const aimDir = this.aimScratch;
    let throttle = this.tuning.cruiseThrottle;
    let fire = false;

    if (hasTarget && target) {
      switch (this.state) {
        case 'engage': {
          this.steerEngage(aimDir);
          throttle =
            this.geom.rangeM < this.tuning.minRangeM
              ? this.difficulty.throttle * ENGAGE_CLOSE_THROTTLE
              : this.difficulty.throttle;
          fire = this.shouldFire();
          break;
        }
        case 'evade':
          this.steerEvade(self, target, aimDir);
          throttle = this.difficulty.throttle;
          break;
        case 'extend':
          this.steerExtend(self, target, aimDir);
          throttle = this.difficulty.throttle;
          break;
        case 'patrol':
        default:
          this.steerPatrol(self, aimDir);
          throttle = this.tuning.cruiseThrottle;
          break;
      }
    } else {
      this.steerPatrol(self, aimDir);
    }

    // (2) degradacja: limit G (clamp kąta komendy) → opóźnienie reakcji → szum
    this.applyMaxG(aimDir, plane);
    this.applyReactionLag(aimDir, dtS);
    this.applyAimNoise(aimDir, dtS);

    // (3) override'y bezpieczeństwa (nadrzędne, precyzyjne)
    this.applyArenaReturn(self, aimDir);
    const climbed = this.applyGroundAvoidance(self, env, aimDir);
    if (climbed) {
      throttle = this.difficulty.throttle;
      fire = false;
    }

    this.instructor.update(self, plane, aimDir, dtS, outDemands);
    return { state: this.state, throttle, fire };
  }

  // --- sterowanie per stan (zapis do `aim`, świat, jednostkowy) ---

  private steerPatrol(self: PlaneState, aim: Vector3): void {
    const wp = this.waypoints[this.waypointIndex];
    if (wp) {
      scratchLos.subVectors(wp, self.position);
      if (scratchLos.lengthSq() < this.tuning.waypointReachedM * this.tuning.waypointReachedM) {
        this.waypointIndex = (this.waypointIndex + 1) % this.waypoints.length;
      }
      aim.subVectors(wp, self.position);
      if (aim.lengthSq() < 1e-6) aim.copy(scratchSelfFwd);
      aim.normalize();
      return;
    }
    // brak waypointów: lot poziomy na bieżącym kursie (override areny zawróci przy granicy)
    aim.set(scratchSelfFwd.x, 0, scratchSelfFwd.z);
    if (aim.lengthSq() < 1e-6) aim.set(0, 0, 1);
    aim.normalize();
  }

  private steerEngage(aim: Vector3): void {
    // wyprzedzenie (lead.aimDir fallbackuje do LOS gdy cel ucieka szybciej niż pocisk)
    aim.copy(this.lead.aimDir);
  }

  private steerEvade(self: PlaneState, target: PlaneState, aim: Vector3): void {
    scratchLos.subVectors(target.position, self.position);
    if (scratchLos.lengthSq() < 1e-6) scratchLos.copy(scratchSelfFwd);
    scratchLos.normalize();
    // zrywaj W STRONĘ przeciwną do zagrożenia (wymuszony overshoot przeciwnika)
    const lateral = scratchLos.dot(scratchSelfRight);
    const breakSign = lateral >= 0 ? -1 : 1;
    const a = this.tuning.evadeBreakRad;
    const jink =
      this.tuning.evadeJinkRad *
      Math.sin((2 * Math.PI * this.jinkTimeS) / this.tuning.evadeJinkPeriodS);
    aim.copy(scratchSelfFwd).multiplyScalar(Math.cos(a));
    aim.addScaledVector(scratchSelfRight, breakSign * Math.sin(a));
    aim.addScaledVector(scratchSelfUp, Math.sin(jink));
    aim.normalize();
  }

  private steerExtend(self: PlaneState, target: PlaneState, aim: Vector3): void {
    scratchHoriz.set(self.position.x - target.position.x, 0, self.position.z - target.position.z);
    if (scratchHoriz.lengthSq() < 1e-6) scratchHoriz.set(scratchSelfFwd.x, 0, scratchSelfFwd.z);
    if (scratchHoriz.lengthSq() < 1e-6) scratchHoriz.set(0, 0, 1);
    scratchHoriz.normalize();
    const dive = this.tuning.extendDiveRad;
    // zniżanie z dala od przeciwnika = zamiana wysokości na prędkość
    aim
      .set(scratchHoriz.x * Math.cos(dive), -Math.sin(dive), scratchHoriz.z * Math.cos(dive))
      .normalize();
  }

  /** Ogień: nos w stożku wokół PRAWDZIWEGO wyprzedzenia (bez szumu) i w zasięgu. */
  private shouldFire(): boolean {
    if (this.lead.timeToInterceptS <= 0) return false;
    if (this.geom.rangeM < this.tuning.minFireRangeM) return false;
    if (this.geom.rangeM > this.difficulty.fireRangeM) return false;
    return angleBetweenRad(scratchSelfFwd, this.lead.aimDir) < this.difficulty.fireConeRad;
  }

  // --- degradacja ---

  private applyMaxG(aim: Vector3, plane: PlaneConfig): void {
    // n ≈ 1 + aggressivenessPitch·błąd_w_płaszczyźnie → kąt komendy ogranicza G
    const maxCmd = clamp(
      (this.difficulty.maxG - 1) / plane.instructor.aggressivenessPitch,
      MIN_CMD_ANGLE_RAD,
      MAX_CMD_ANGLE_RAD,
    );
    const ang = angleBetweenRad(scratchSelfFwd, aim);
    if (ang <= maxCmd) return;
    scratchRotAxis.crossVectors(scratchSelfFwd, aim);
    if (scratchRotAxis.lengthSq() < 1e-12) scratchRotAxis.copy(scratchSelfUp); // anty/równoległe
    scratchRotAxis.normalize();
    scratchQuat.setFromAxisAngle(scratchRotAxis, maxCmd);
    aim.copy(scratchSelfFwd).applyQuaternion(scratchQuat);
  }

  private applyReactionLag(aim: Vector3, dtS: number): void {
    const blend = -Math.expm1(-dtS / Math.max(this.difficulty.reactionTimeS, 1e-3));
    if (this.smoothedAim.dot(aim) < -0.999) this.smoothedAim.copy(aim); // antypodalny — snap
    else this.smoothedAim.lerp(aim, blend).normalize();
    aim.copy(this.smoothedAim);
  }

  private applyAimNoise(aim: Vector3, dtS: number): void {
    this.noiseTimerS -= dtS;
    if (this.noiseTimerS <= 0) {
      const amp = this.difficulty.aimErrorRad;
      this.noiseTargetYaw = (this.rng() * 2 - 1) * amp;
      this.noiseTargetPitch = (this.rng() * 2 - 1) * amp;
      this.noiseTimerS = NOISE_RESAMPLE_S;
    }
    const nb = -Math.expm1(-dtS / NOISE_SLEW_TAU_S);
    this.noiseYaw += (this.noiseTargetYaw - this.noiseYaw) * nb;
    this.noisePitch += (this.noiseTargetPitch - this.noisePitch) * nb;
    aim
      .addScaledVector(scratchSelfRight, this.noiseYaw)
      .addScaledVector(scratchSelfUp, this.noisePitch)
      .normalize();
  }

  // --- override'y bezpieczeństwa ---

  /** Przy granicy areny zastępuje poziomy kurs kierunkiem do środka (pion bez zmian). */
  private applyArenaReturn(self: PlaneState, aim: Vector3): void {
    const edgeM = distanceToArenaEdgeM(self.position.x, self.position.z);
    if (edgeM >= this.tuning.arenaTurnMarginM) return;
    scratchHoriz.set(-self.position.x, 0, -self.position.z);
    if (scratchHoriz.lengthSq() < 1) return; // już w środku
    scratchHoriz.normalize();
    const vY = clamp(aim.y, -1, 1);
    const horizLen = Math.sqrt(Math.max(0, 1 - vY * vY));
    aim.set(scratchHoriz.x * horizLen, vY, scratchHoriz.z * horizLen).normalize();
  }

  /**
   * Unikanie ziemi jako CIĄGŁY sufit zniżania zależny od AGL (nie nagły override):
   * im niżej, tym wyżej minimalne aim.y — od pełnego zniżania (maxDive) wysoko,
   * przez poziom, po wznoszenie (groundClimb) przy podłodze. Dzięki temu stromy
   * nur nigdy się nie rozwija, co jest kluczowe, bo przy dużym IAS roll rate
   * Spitfire'a spada do kilkunastu °/s i wyrwanie z przechylonego nuru trwa za
   * długo. AGL "skracane" prędkością zniżania (predykcja) — szybki nur ograniczany
   * wcześniej. Zwraca true gdy wymusił podniesienie nosa w strefie alarmowej.
   */
  private applyGroundAvoidance(self: PlaneState, env: BotEnvironment, aim: Vector3): boolean {
    const aglM = self.position.y - env.surfaceHeightM;
    // tylko zniżanie skraca prognozę (wznoszenie nie zawyża pułapu)
    const effAglM = aglM + Math.min(0, self.velocity.y) * this.tuning.groundLookAheadS;
    const lo = this.tuning.groundHardFloorM;
    const hi = this.tuning.groundSafetyMarginM * 2;
    // frac ujemne (poniżej podłogi / poniżej grani z przodu) → wznoszenie tym
    // stromsze, im głębiej; cap blisko pionu (sin 80°) by aim pozostał sensowny
    const frac = clamp((effAglM - lo) / (hi - lo), -2, 1);
    const minAimY = clamp(
      Math.sin(this.tuning.groundClimbRad) * (1 - frac) - Math.sin(this.tuning.maxDiveRad) * frac,
      -1,
      0.985,
    );
    if (aim.y >= minAimY) return false;

    // podnieś nos do minAimY, zachowując kurs poziomy (i jednostkowość)
    scratchHoriz.set(aim.x, 0, aim.z);
    if (scratchHoriz.lengthSq() < 1e-6) scratchHoriz.set(scratchSelfFwd.x, 0, scratchSelfFwd.z);
    if (scratchHoriz.lengthSq() < 1e-6) scratchHoriz.set(0, 0, 1);
    scratchHoriz.normalize();
    const horizLen = Math.sqrt(Math.max(0, 1 - minAimY * minAimY));
    aim.set(scratchHoriz.x * horizLen, minAimY, scratchHoriz.z * horizLen).normalize();
    return aglM < this.tuning.groundSafetyMarginM;
  }
}
