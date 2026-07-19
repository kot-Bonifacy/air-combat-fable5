import { Quaternion, Vector3 } from 'three';
import { GRAVITY_MS2 } from '../constants';
import { primaryGroup } from '../combat/fire';
import { createRng } from '../math/rng';
import { getForward, getRight, getUp } from '../math/frame';
import { Instructor, type PilotDemands } from '../instructor/instructor';
import { maxRollRateRadS, peakRollRateRadS } from '../physics/envelope';
import type { PlaneState } from '../physics/state';
import type { PlaneConfig } from '../planes/loader';
import { nearestToroidalImage, toroidalDistanceSqM } from '../world/arena';
import {
  angleBetweenRad,
  computeGeometry,
  createGeometry,
  type AirCombatGeometry,
} from './geometry';
import { createLeadSolution, solveLead, type LeadSolution } from './lead';
import { effectiveTuning, type BotDifficulty, type BotTuning } from './difficulty';
import { isThreatened, nextBotState, type BotPerception, type BotStateName } from './fsm';

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

/** Otoczenie taktyczne (poziom „as", 2026-07-12): pełne listy żywych stanów do skanu
 *  zagrożeń i separacji. Opcjonalne — bez niego (stare testy, niższe poziomy z knobami 0)
 *  bot zachowuje się jak dotąd. */
export interface BotSituation {
  /** Żywe stany WSZYSTKICH wrogów — check-six skanuje pełną listę, nie tylko najbliższego. */
  enemies: readonly PlaneState[];
  /** Żywe stany wszystkich INNYCH samolotów, TAKŻE sojuszników (separacja antykolizyjna). */
  traffic: readonly PlaneState[];
}

/** Rozkaz koordynacji lider/skrzydłowy (poziom „as", 2026-07-19). Arbitraż ról robi SERWER
 *  (zna id/frakcje/amunicję/cele — `PlaneState` ich nie niesie); botowi przekazuje gotową rolę.
 *  Brak rozkazu = as walczy niezależnie (jak dotąd). */
export interface BotWingOrders {
  /** 'leader' = atakuje wspólnego wroga normalnie (bez zmiany zachowania — obecny tu tylko po to,
   *  by bot wiedział, że NIE jest skrzydłowym); 'wingman' = ubezpiecza lidera i trzyma dystans. */
  role: 'leader' | 'wingman';
  /** Żywy stan lidera (referencja serwera) — dla skrzydłowego: skan jego ogona (check-six na jego
   *  rzecz) i punkt trzymania za nim. null dla lidera. */
  leader: PlaneState | null;
}

/** Wynik ticku bota dla wołającego (poza wypełnionym PilotDemands). */
export interface BotOutput {
  state: BotStateName;
  throttle: number;
  fire: boolean;
  /** Zamiar użycia WEP (as: zawsze przy pełnym gazie, bez limitu cieplnego — boty są
   *  immune na przegrzanie). Serwer bramkuje jak input gracza (pełny gaz + wepBoostFrac>0)
   *  — Zero zostaje no-opem. */
  wep: boolean;
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

// --- stałe zachowań „asa" (2026-07-12; progi bramkowane knobami difficulty > 0) ---

/** Horyzont predykcji punktu największego zbliżenia (CPA) separacji [s]. */
const SEPARATION_HORIZON_S = 3;
/** Wzmocnienie odchylenia kursu przez wektor uniku (atan(gain·u) ≈ kąt przy pełnej pilności). */
const SEPARATION_GAIN = 2.5;
/** Pilność separacji, powyżej której bot wstrzymuje ogień (unik ważniejszy niż strzał). */
const SEPARATION_HOLD_FIRE_U = 0.45;
/** Czołówka: oba nosy w tym stożku [rad] (~26°) i zbliżanie szybsze niż próg [m/s]. */
const HEAD_ON_CONE_RAD = 0.45;
const HEAD_ON_MIN_CLOSURE_MS = 120;
/** Zamierzony dystans minięcia się w czołówce [m] (kąt offsetu = atan2(MISS, range) —
 *  hojny, bo samolot dolatuje do offsetu z opóźnieniem regulatora i budowy G). */
const HEAD_ON_MISS_M = 280;
/** Kąt do celu, powyżej którego engage to walka MANEWROWA (redukcja gazu przy słabych lotkach). */
const MANEUVER_ANGLE_RAD = 0.45;
/** Gaz asa w ciasnej walce przy zdrewniałych lotkach (powrót do reżimu sterowności). */
const MANEUVER_THROTTLE = 0.62;
/** Nożyce (evade z variety): rewers breaku, gdy zagrożenie tuż za nami wciąż szybko się zbliża. */
const SCISSORS_RANGE_M = 220;
const SCISSORS_CLOSURE_MS = 40;
/** Kontrola przestrzelenia (overshootGuardClosureMs>0): działa tylko w tej strefie dystansu
 *  [m] — bliski/średni ogień, gdzie wyprzedzenie wolnego celu boli. Daleki pościg (poza nią)
 *  = pełny gaz, bo tam nadmiar prędkości to dobór dystansu i przewaga energetyczna. */
const OVERSHOOT_GUARD_RANGE_M = 350;
/** „Sam z celem": guard przestrzelenia działa tylko, gdy w tym promieniu [m] nie ma innego
 *  żywego wroga (życzenie usera: nie wyprzedzaj celu, gdy w pobliżu < 1 km nie ma innych). */
const OVERSHOOT_GUARD_LONE_RANGE_M = 1000;
/** Separacja w WALCE (bot ma cel) jest łagodniejsza niż w czystej antykolizji bez celu:
 *  słabsze odpychanie kursu (żeby nie odciągało od celu → as strzelał w kłębowisku) i wyższy
 *  próg wstrzymania ognia. Bez celu (patrol/dwa boty lecące obok) zostają pełne SEPARATION_*. */
const SEPARATION_GAIN_ENGAGED = 1.5;
const SEPARATION_HOLD_FIRE_ENGAGED_U = 0.75;
/** W walce twarda bańka od NIE-celu jest ciaśniejsza (× separationRangeM): reaguj tylko na
 *  realnie kolizyjny dystans, nie na „sąsiada w luźnym tłoku" — inaczej omijanie każdego
 *  samolotu w 70 m zjadałoby celność. Rozdzielenie sklejonych (dryf < tej bańki) zachowane. */
const SEPARATION_ENGAGED_BUBBLE_FRAC = 0.6;
/** Krótkie serie (burstFireRangeM>0): powyżej progu dystansu ogień pulsuje — BURST_ON_S sekund
 *  ognia, potem BURST_OFF_S przerwy. Cel: nie wypruć całej amunicji na dalekim, mniej celnym
 *  dystansie. Cykl liczony w tempie decyzji (10 Hz), więc granularność ~0,1 s wystarcza. */
const BURST_ON_S = 0.6;
const BURST_OFF_S = 0.9;
// bufory koordynacji skrzydłowego (2026-07-19): pozycja/nos lidera i punkt trzymania standoff
const scratchLeaderPos = new Vector3();
const scratchLeaderFwd = new Vector3();
const scratchHold = new Vector3();

const scratchSelfFwd = new Vector3();
const scratchSelfUp = new Vector3();
const scratchSelfRight = new Vector3();
const scratchTargetFwd = new Vector3();
const scratchTargetPos = new Vector3();
const scratchLos = new Vector3();
const scratchHoriz = new Vector3();
const scratchRotAxis = new Vector3();
const scratchQuat = new Quaternion();
// bufory asa: skan zagrożeń (pozycja utrzymywana przez CAŁY tick — patrz steerEvade) i separacja
const scratchThreatPos = new Vector3();
const scratchEnemyPos = new Vector3();
const scratchEnemyFwd = new Vector3();
const scratchSepPos = new Vector3();
const scratchSepRel = new Vector3();
const scratchSepVel = new Vector3();
const scratchSepAvoid = new Vector3();
const scratchOvershoot = new Vector3();

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

/**
 * Wybiera najbliższy żywy cel z listy kandydatów (wołający wyklucza siebie/sojuszników).
 * `maxRangeM` ogranicza wykrycie do zasięgu „spotting" (SPOT_RANGE_M): cel dalej jest
 * dla bota niewidoczny — twardy próg bez histerezy, więc za granicą bot wraca do patrolu
 * (symetrycznie do markera/beacona gracza). Domyślnie bez limitu (testy, zgodność wstecz).
 */
export function selectNearestTarget(
  selfPos: Vector3,
  candidates: readonly PlaneState[],
  maxRangeM = Infinity,
): PlaneState | null {
  let best: PlaneState | null = null;
  let bestD = maxRangeM * maxRangeM; // start = kwadrat zasięgu → cele poza nim od razu odpadają
  for (const c of candidates) {
    if (c.life !== 'alive') continue;
    const d = toroidalDistanceSqM(selfPos, c.position); // torus: cel za szwem nie „znika"
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
    criticalDamage: false,
    rearThreat: false,
  };
  private readonly rng: () => number;
  /** Tuning z per-poziomowymi override'ami (as: progi wykrycia/energii) — patrz effectiveTuning. */
  private readonly tuning: BotTuning;

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
  // reakcja na trafienie (tylko poziomy z difficulty.hitReactionDelayS > 0, np. „trudny"):
  // po otrzymaniu ostrzału bot odczekuje delay, po czym wykonuje krótki zryw obronny w którąś
  // stronę. delayS > 0 = odliczanie do zrywu; breakRemainingS > 0 = trwa zryw (override sterowania).
  private hitDelayRemainingS = 0;
  private hitBreakRemainingS = 0;
  private hitBreakSign: 1 | -1 = 1;
  // --- stan asa ---
  /** Skan check-six znalazł zagrożenie (pozycja w scratchThreatPos, metryki niżej). */
  private hasScanThreat = false;
  private scanThreatRangeM = 0;
  private scanThreatClosureMs = 0;
  /** Trwający unik czołówki: strona minięcia wylosowana raz na zbliżenie (bez dygotania). */
  private headOnActive = false;
  private headOnSide: 1 | -1 = 1;
  /** Nieregularny jink asa (evadeVariety01>0): losowany okres/amplituda per cykl. */
  private jinkPeriodS = 1;
  private jinkAmpScale = 1;
  private jinkResampleAtS = 0;
  /** Zegar cyklu krótkich serii (burstFireRangeM>0) — rośnie w tempie decyzji, faza on/off. */
  private burstTimerS = 0;

  constructor(
    tuning: BotTuning,
    private readonly difficulty: BotDifficulty,
    rngSeed: number,
    private readonly waypoints: readonly Vector3[] = [],
  ) {
    this.rng = createRng(rngSeed);
    this.tuning = effectiveTuning(tuning, difficulty);
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
    this.hitDelayRemainingS = 0;
    this.hitBreakRemainingS = 0;
    this.hasScanThreat = false;
    this.headOnActive = false;
    this.jinkResampleAtS = 0;
    this.burstTimerS = 0;
  }

  /**
   * Sygnał z serwera, że bota trafiono (resolveHits). Poziomy z `hitReactionDelayS > 0` (tylko
   * „trudny") po krótkim opóźnieniu wykonają zryw obronny — żeby ostrzeliwany bot nie leciał
   * dalej prosto. Niższe poziomy mają delay = 0 → metoda jest no-op (lecą prosto, jak dotąd).
   * Kolejne trafienia w trakcie odliczania/zrywu nie restartują reakcji (jeden zryw na serię).
   */
  notifyHit(): void {
    if (this.difficulty.hitReactionDelayS <= 0) return;
    if (this.hitDelayRemainingS > 0 || this.hitBreakRemainingS > 0) return;
    this.hitDelayRemainingS = this.difficulty.hitReactionDelayS;
  }

  /**
   * Jeden tick decyzji. Wypełnia `outDemands` (do pilotStep) i zwraca
   * {state, throttle, fire, wep}. `target` = null albo martwy → patrol.
   * `criticalDamage` (faza 22 cz.3): serwer sygnalizuje krytyczne uszkodzenia — bot przerywa walkę
   * i ucieka (FSM → extend). Domyślnie false (sprawny / wywołania testów bez uszkodzeń).
   * `situation` (poziom „as", 2026-07-12): pełne listy wrogów (check-six) i ruchu (separacja);
   * bez niej lub przy knobach 0 zachowanie jak dotąd.
   * `wing` (koordynacja asów, 2026-07-19): rola lider/skrzydłowy z serwera. Skrzydłowy trzyma
   * dystans od wspólnego wroga i broni ogona lidera (podmiana celu na napastnika lidera).
   */
  update(
    self: PlaneState,
    plane: PlaneConfig,
    target: PlaneState | null,
    env: BotEnvironment,
    dtS: number,
    outDemands: PilotDemands,
    criticalDamage = false,
    situation?: BotSituation,
    wing?: BotWingOrders,
  ): BotOutput {
    this.jinkTimeS += dtS;
    this.burstTimerS += dtS;
    this.updateHitReaction(dtS);
    getForward(self.orientation, scratchSelfFwd);
    getUp(self.orientation, scratchSelfUp);
    getRight(self.orientation, scratchSelfRight);

    // Koordynacja skrzydłowego (as, wingmanRangeM>0): domyślnie trzyma dystans od WSPÓLNEGO wroga
    // (standoff — nie odbiera liderowi strzału), ale gdy wróg wchodzi LIDEROWI na ogon, przełącza
    // cel na tego napastnika i atakuje go normalnie (aktywne ubezpieczanie). Podmiana `target` musi
    // nastąpić PRZED geometrią/FSM (liczą się dla efektywnego celu). Lider (role='leader') leci bez
    // zmian — atakuje wspólnego wroga jak zwykły engage.
    let wingStandoff = false;
    if (
      wing?.role === 'wingman' &&
      wing.leader?.life === 'alive' &&
      this.difficulty.wingmanRangeM > 0 &&
      target !== null
    ) {
      const defend = this.findLeaderThreat(self, wing.leader, situation);
      if (defend) target = defend;
      else wingStandoff = true;
    }

    const hasTarget = target !== null && target.life === 'alive';
    if (hasTarget && target) {
      // torus: percepcja celu z najbliższego obrazu toroidalnego (a nie surowej
      // pozycji świata), inaczej cel tuż za szwem mapy „skacze" o ~całą arenę
      const tgtPos = nearestToroidalImage(target.position, self.position, scratchTargetPos);
      getForward(target.orientation, scratchTargetFwd);
      computeGeometry(
        self.position,
        scratchSelfFwd,
        self.velocity,
        tgtPos,
        scratchTargetFwd,
        target.velocity,
        this.geom,
      );
      solveLead(
        self.position,
        self.velocity,
        tgtPos,
        target.velocity,
        // wyprzedzenie liczone dla broni głównej (jedna prędkość wylotowa); rachunek pomija
        // opór, więc reprezentatywna grupa wystarcza (faza 19)
        primaryGroup(plane.armament).muzzleVelocityMs,
        this.lead,
        // kompensacja opadu grawitacyjnego (as: leadGravityFrac=1 → celuje z uwzględnieniem
        // grawitacji; niższe poziomy 0 → pocisk pada pod cel na dalekim dystansie, jak dotąd)
        GRAVITY_MS2 * this.difficulty.leadGravityFrac,
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
    // niezależne od celu — krytycznie uszkodzony bot ucieka także w patrolu (często trafiany bez
    // wypatrzenia napastnika); FSM bez celu i tak zwróci patrol, więc zaszkodzić nie może
    this.perception.criticalDamage = criticalDamage;
    // check-six (as): najbliższy zagrażający wróg z PEŁNEJ listy (nie tylko bieżący cel) —
    // domyka ślepą plamę „ktoś wchodzi mi na ogon, gdy gonię kogoś innego"
    this.perception.rearThreat = this.scanRearThreat(self, situation);

    this.state = nextBotState(this.state, this.perception, this.tuning);
    // unik czołówki żyje wyłącznie w engage — po zmianie stanu zaczynamy od czysta
    // (stale true po powrocie do engage aplikowałoby offset w zwykłym pościgu)
    if (this.state !== 'engage') this.headOnActive = false;

    // (1) sterowanie per stan → surowy kierunek nosa + throttle + zamiar ognia
    const aimDir = this.aimScratch;
    let throttle = this.tuning.cruiseThrottle;
    let fire = false;

    if (hasTarget && target) {
      switch (this.state) {
        case 'engage': {
          if (wingStandoff && wing?.leader) {
            // skrzydłowy bez zagrożenia lidera: trzymaj dystans od wspólnego wroga (za liderem),
            // NIE strzelaj do niego (nie odbieraj strzału liderowi, brak ryzyka trafienia go z tyłu)
            this.steerWingmanStandoff(self, wing.leader, aimDir);
            throttle =
              this.geom.rangeM < this.difficulty.wingmanRangeM
                ? Math.min(this.difficulty.throttle, MANEUVER_THROTTLE)
                : this.difficulty.throttle;
            fire = false;
            break;
          }
          this.steerEngage(self, aimDir);
          throttle =
            this.geom.rangeM < this.tuning.minRangeM
              ? this.difficulty.throttle * ENGAGE_CLOSE_THROTTLE
              : this.difficulty.throttle;
          throttle = this.applyManeuverThrottle(self, plane, throttle);
          throttle = this.applyOvershootThrottle(self, target, situation, throttle);
          // w czołówce as nie naciska spustu (nos i tak schodzi z celu; strzał czołowy
          // to zaproszenie do wymiany, której unik ma właśnie zapobiec)
          fire = this.shouldFire() && !this.headOnActive;
          // krótkie serie na dalekim dystansie (burstFireRangeM>0): pulsuj ogień, by nie
          // wystrzelać zapasu, gdy strzał i tak mniej pewny; blisko progu ogień ciągły
          fire = this.applyBurstDiscipline(fire);
          break;
        }
        case 'evade': {
          // zryw od NAJGROŹNIEJSZEGO: skan check-six mógł znaleźć bliższego/faktycznego
          // napastnika, podczas gdy scratchTargetPos to tylko najbliższy wróg (cel)
          if (this.hasScanThreat && (!isThreatened(this.perception, this.tuning) || this.scanThreatRangeM < this.geom.rangeM)) {
            this.steerEvade(self, scratchThreatPos, this.scanThreatRangeM, this.scanThreatClosureMs, aimDir);
          } else {
            this.steerEvade(self, scratchTargetPos, this.geom.rangeM, this.geom.closureMs, aimDir);
          }
          throttle = this.applyManeuverThrottle(self, plane, this.difficulty.throttle);
          break;
        }
        case 'extend':
          this.steerExtend(self, scratchTargetPos, aimDir);
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

    // (1b) zryw obronny po trafieniu (poziomy z hitReactionDelayS>0): nadrzędny nad FSM, bo bot ma
    // zerwać NIEZALEŻNIE od tego, czy wypatrzył napastnika (często jest trafiany w patrolu,
    // gdzie hasTarget=false). Override ziemi niżej i tak go skoryguje, gdy zryw groziłby
    // wbiciem się w teren (kryterium użytkownika: zryw, chyba że oznaczałby uderzenie w ziemię).
    if (this.hitBreakRemainingS > 0) {
      this.steerHitBreak(aimDir);
      throttle = this.difficulty.throttle;
      fire = false;
    }

    // (2) degradacja: limit G (clamp kąta komendy) → opóźnienie reakcji → szum
    this.applyMaxG(aimDir, plane);
    this.applyReactionLag(aimDir, dtS);
    this.applyAimNoise(aimDir, dtS);

    // (2b) separacja antykolizyjna asa: PO degradacji (precyzyjna, jak override ziemi — szum
    // nie może jej rozmyć), PRZED ziemią (ziemia pozostaje nadrzędna nad wszystkim)
    if (this.applySeparation(self, hasTarget ? target : null, situation, aimDir)) fire = false;

    // (3) override bezpieczeństwa (nadrzędny, precyzyjny). Granicy areny NIE ma
    // co pilnować — świat jest torusem, wyjście poza krawędź zawija na drugą stronę.
    const climbed = this.applyGroundAvoidance(self, env, aimDir);
    if (climbed) {
      throttle = this.difficulty.throttle;
      fire = false;
    }

    this.instructor.update(self, plane, aimDir, dtS, outDemands);
    return { state: this.state, throttle, fire, wep: this.updateWep(throttle) };
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
    // brak waypointów: lot poziomy na bieżącym kursie (świat-torus zawija przy krawędzi)
    aim.set(scratchSelfFwd.x, 0, scratchSelfFwd.z);
    if (aim.lengthSq() < 1e-6) aim.set(0, 0, 1);
    aim.normalize();
  }

  private steerEngage(self: PlaneState, aim: Vector3): void {
    // wyprzedzenie (lead.aimDir fallbackuje do LOS gdy cel ucieka szybciej niż pocisk)
    aim.copy(this.lead.aimDir);

    // unik czołówki (as, headOnAvoidRangeM>0): oba nosy na siebie + szybkie zbliżanie =
    // zamiast grać w cykora, celuj OBOK celu (minięcie się bokiem ~HEAD_ON_MISS_M) i po
    // minięciu wracaj do pościgu. Strona wybierana raz na zbliżenie (bez dygotania);
    // offset psuje rozwiązanie ognia → shouldFire sam wygasza strzał czołowy.
    const hoRange = this.difficulty.headOnAvoidRangeM;
    if (hoRange <= 0) return;
    const g = this.geom;
    const headOnNow =
      g.rangeM < hoRange &&
      g.closureMs > HEAD_ON_MIN_CLOSURE_MS &&
      g.attackerOffBoresightRad < HEAD_ON_CONE_RAD &&
      g.targetOffBoresightRad < HEAD_ON_CONE_RAD;
    if (!this.headOnActive && headOnNow) {
      this.headOnActive = true;
      // minięcie po stronie, po której cel JUŻ jest względem nosa (pogłębiaj istniejący
      // offset); idealnie na wprost → w prawo (lotnicze „prawo drogi", symetryczne dla obu)
      scratchLos.subVectors(scratchTargetPos, self.position).normalize();
      const lateral = scratchLos.dot(scratchSelfRight);
      this.headOnSide = lateral > 0.05 ? -1 : 1;
    } else if (this.headOnActive) {
      // koniec uniku: minęliśmy się (dystans rośnie), zbliżenie zerwane albo cel odwrócił nos
      // (przestał być czołowy → zwykły pościg); warunek celowo NIE używa attackerOffBoresight,
      // bo własny offset go psuje i unik gasłby natychmiast
      if (g.closureMs < 0 || g.rangeM > hoRange * 1.2 || g.targetOffBoresightRad > HEAD_ON_CONE_RAD * 1.5) {
        this.headOnActive = false;
      }
    }
    if (!this.headOnActive) return;
    const offRad = clamp(Math.atan2(HEAD_ON_MISS_M, Math.max(g.rangeM, 50)), 0.2, 0.9);
    scratchLos.subVectors(scratchTargetPos, self.position).normalize();
    // offset PIONOWY (w górę) dominuje: pull działa od razu (cel nad nosem = zero błędu
    // przechylenia → instruktor ciągnie pełne G), podczas gdy czysto boczny offset wymaga
    // ~90° beczki, która przy IAS czołówki (450+ km/h) trwa sekundy. Bias boczny w SWOJE
    // prawo dekoreluje dwa asy naprzeciw siebie (przeciwne strony świata — „prawo drogi").
    const off = Math.tan(offRad);
    aim
      .copy(scratchLos)
      .addScaledVector(scratchSelfUp, off)
      .addScaledVector(scratchSelfRight, this.headOnSide * 0.5 * off)
      .normalize();
  }

  private steerEvade(
    self: PlaneState,
    threatPos: Vector3,
    threatRangeM: number,
    threatClosureMs: number,
    aim: Vector3,
  ): void {
    scratchLos.subVectors(threatPos, self.position);
    if (scratchLos.lengthSq() < 1e-6) scratchLos.copy(scratchSelfFwd);
    scratchLos.normalize();
    // zrywaj W STRONĘ przeciwną do zagrożenia (wymuszony overshoot przeciwnika)
    const lateral = scratchLos.dot(scratchSelfRight);
    let breakSign = lateral >= 0 ? -1 : 1;
    const variety = this.difficulty.evadeVariety01;
    let jinkPhase = (2 * Math.PI * this.jinkTimeS) / this.tuning.evadeJinkPeriodS;
    let jinkAmp = this.tuning.evadeJinkRad;
    if (variety > 0) {
      // nożyce: napastnik tuż za nami wciąż szybko się zbliża = zaraz przestrzeli —
      // rewers W JEGO stronę wymusza overshoot zamiast uciekania po przewidywalnym łuku
      if (threatRangeM < SCISSORS_RANGE_M && threatClosureMs > SCISSORS_CLOSURE_MS) {
        breakSign = -breakSign;
      }
      // nieprzewidywalny jink: okres i amplituda losowane co cykl (przeciwnik nie może
      // „nastroić się" na stały sinus); zegar jinkTimeS wspólny, resample po okresie
      if (this.jinkTimeS >= this.jinkResampleAtS) {
        this.jinkPeriodS = 0.7 + this.rng() * 1.3;
        this.jinkAmpScale = 1 + (this.rng() * 2 - 1) * 0.5 * variety;
        this.jinkResampleAtS = this.jinkTimeS + this.jinkPeriodS;
      }
      jinkPhase = (2 * Math.PI * this.jinkTimeS) / this.jinkPeriodS;
      jinkAmp *= this.jinkAmpScale;
    }
    const a = this.tuning.evadeBreakRad;
    const jink = jinkAmp * Math.sin(jinkPhase);
    aim.copy(scratchSelfFwd).multiplyScalar(Math.cos(a));
    aim.addScaledVector(scratchSelfRight, breakSign * Math.sin(a));
    aim.addScaledVector(scratchSelfUp, Math.sin(jink));
    aim.normalize();
  }

  private steerExtend(self: PlaneState, targetPos: Vector3, aim: Vector3): void {
    scratchHoriz.set(self.position.x - targetPos.x, 0, self.position.z - targetPos.z);
    if (scratchHoriz.lengthSq() < 1e-6) scratchHoriz.set(scratchSelfFwd.x, 0, scratchSelfFwd.z);
    if (scratchHoriz.lengthSq() < 1e-6) scratchHoriz.set(0, 0, 1);
    scratchHoriz.normalize();
    const dive = this.tuning.extendDiveRad;
    // zniżanie z dala od przeciwnika = zamiana wysokości na prędkość
    aim
      .set(scratchHoriz.x * Math.cos(dive), -Math.sin(dive), scratchHoriz.z * Math.cos(dive))
      .normalize();
  }

  /**
   * Odlicza reakcję na trafienie: najpierw opóźnienie (hitReactionDelayS), potem zryw przez
   * tuning.hitReactionDurationS. Stronę zrywu losujemy raz, na starcie zrywu (zwrot „w którąś
   * stronę"). Wołane co tick decyzji — czas płynie tempem decyzji (dtS = krok × interwał).
   */
  private updateHitReaction(dtS: number): void {
    if (this.hitBreakRemainingS > 0) {
      this.hitBreakRemainingS -= dtS;
    } else if (this.hitDelayRemainingS > 0) {
      this.hitDelayRemainingS -= dtS;
      if (this.hitDelayRemainingS <= 0) {
        this.hitBreakRemainingS = this.tuning.hitReactionDurationS;
        this.hitBreakSign = this.rng() < 0.5 ? -1 : 1;
      }
    }
  }

  /** Zryw obronny po trafieniu: ostre ciągnięcie w GÓRĘ z lekkim biasem bocznym (wylosowana strona).
   *  Nie wymaga celu — w odróżnieniu od `steerEvade` zrywa „w którąś stronę". Składowa pionowa
   *  MUSI dominować nad boczną: instruktor bramkuje ciągnięcie błędem przechylenia (zeruje pull
   *  powyżej 2× bankThreshold), więc cel mocno z boku = bot tylko by rolował, ledwie ciągnąc. Przy
   *  dominującej pionie błąd przechylenia jest mały → pełne ciągnięcie OD RAZU, a bias boczny nadaje
   *  stronę. Zryw wznoszący sam oddala od ziemi (override unikania ziemi niżej i tak go pilnuje). */
  private steerHitBreak(aim: Vector3): void {
    const a = this.tuning.evadeBreakRad;
    aim.copy(scratchSelfFwd).multiplyScalar(Math.cos(a));
    aim.addScaledVector(scratchSelfUp, Math.sin(a));
    aim.addScaledVector(scratchSelfRight, this.hitBreakSign * Math.sin(a) * 0.25);
    aim.normalize();
  }

  // --- zachowania asa (knoby difficulty > 0; 2026-07-12) ---

  /**
   * Check-six: skan WSZYSTKICH wrogów pod kątem zagrożenia z tylnej półsfery — te same
   * warunki kątowe co isThreatened (celuje we mnie + za moją linią 3-9), ale po pełnej
   * liście i z własnym zasięgiem (checkSixRangeM). Wynik: pozycja NAJBLIŻSZEGO
   * zagrażającego w scratchThreatPos + metryki do steerEvade/nożyc. Zwraca flagę do FSM.
   */
  private scanRearThreat(self: PlaneState, situation?: BotSituation): boolean {
    this.hasScanThreat = false;
    const rangeLimit = this.difficulty.checkSixRangeM;
    if (rangeLimit <= 0 || !situation) return false;
    const threat = this.findTailThreat(self.position, scratchSelfFwd, situation.enemies, rangeLimit);
    if (!threat) return false;
    const pos = nearestToroidalImage(threat.position, self.position, scratchThreatPos);
    scratchSepRel.subVectors(pos, self.position);
    const d = scratchSepRel.length();
    scratchSepRel.divideScalar(Math.max(d, 1e-6)); // LOS ja→wróg, jednostkowy
    scratchSepVel.subVectors(threat.velocity, self.velocity);
    this.hasScanThreat = true;
    this.scanThreatRangeM = d;
    // zbliżanie (+ = dystans maleje): −d|rel|/dt = −LOS·(v_wróg − v_ja)
    this.scanThreatClosureMs = -scratchSepRel.dot(scratchSepVel);
    return true;
  }

  /**
   * Najbliższy żywy wróg zagrażający pozycji `refPos` z TYLNEJ półsfery: leci za linią 3-9 obrońcy
   * (kąt(refFwd, LOS) > threatBehind) i celuje w niego (jego nos ~ −LOS, w stożku threatCone).
   * Zwraca referencję wroga (bez zapisu do pól) albo null. Wspólny rdzeń check-six (skan własnego
   * ogona) i obrony lidera przez skrzydłowego (skan ogona LIDERA).
   */
  private findTailThreat(
    refPos: Vector3,
    refFwd: Vector3,
    enemies: readonly PlaneState[],
    rangeLimit: number,
  ): PlaneState | null {
    let best: PlaneState | null = null;
    let bestD = rangeLimit;
    for (const e of enemies) {
      if (e.life !== 'alive') continue;
      const pos = nearestToroidalImage(e.position, refPos, scratchEnemyPos);
      scratchSepRel.subVectors(pos, refPos);
      const d = scratchSepRel.length();
      if (d < 1e-3 || d >= bestD) continue;
      scratchSepRel.divideScalar(d); // LOS ref→wróg, jednostkowy
      if (angleBetweenRad(refFwd, scratchSepRel) < this.tuning.threatBehindRad) continue;
      getForward(e.orientation, scratchEnemyFwd);
      // celuje w ref: kąt(jego nos, −LOS) = π − kąt(jego nos, LOS)
      if (Math.PI - angleBetweenRad(scratchEnemyFwd, scratchSepRel) > this.tuning.threatConeRad) continue;
      best = e;
      bestD = d;
    }
    return best;
  }

  /**
   * Skrzydłowy (koordynacja asów, 2026-07-19): najbliższy wróg wchodzący LIDEROWI na ogon (skan
   * tylnej półsfery lidera w zasięgu check-six). Zwraca napastnika do przełączenia celu (obrona
   * lidera) albo null (lider czysty → skrzydłowy trzyma dystans). Bez listy wrogów — null.
   */
  private findLeaderThreat(
    self: PlaneState,
    leader: PlaneState,
    situation?: BotSituation,
  ): PlaneState | null {
    const rangeLimit = this.difficulty.checkSixRangeM;
    if (rangeLimit <= 0 || !situation) return null;
    const leaderPos = nearestToroidalImage(leader.position, self.position, scratchLeaderPos);
    getForward(leader.orientation, scratchLeaderFwd);
    return this.findTailThreat(leaderPos, scratchLeaderFwd, situation.enemies, rangeLimit);
  }

  /**
   * Sterowanie skrzydłowego bez zagrożenia lidera (standoff): trzyma się na `wingmanRangeM` od
   * WSPÓLNEGO wroga (scratchTargetPos), po stronie lidera — w praktyce tuż za nim, gotów przejąć
   * atak. Punkt trzymania = na linii wróg→lider, `wingmanRangeM` od wroga. Ogień wygaszony przez
   * wołającego (nie odbiera strzału liderowi). Wołane w engage PO wyliczeniu geometrii celu.
   */
  private steerWingmanStandoff(self: PlaneState, leader: PlaneState, aim: Vector3): void {
    const leaderPos = nearestToroidalImage(leader.position, self.position, scratchLeaderPos);
    // kierunek wróg→lider (jednostkowy); fallback: wprost do lidera / bieżący nos
    scratchHold.subVectors(leaderPos, scratchTargetPos);
    if (scratchHold.lengthSq() < 1e-6) scratchHold.subVectors(leaderPos, self.position);
    if (scratchHold.lengthSq() < 1e-6) scratchHold.copy(scratchSelfFwd);
    scratchHold.normalize();
    // punkt trzymania = wingmanRangeM od wroga w stronę lidera
    scratchHold.multiplyScalar(this.difficulty.wingmanRangeM).add(scratchTargetPos);
    aim.subVectors(scratchHold, self.position);
    if (aim.lengthSq() < 1e-6) aim.copy(scratchSelfFwd);
    aim.normalize();
  }

  /**
   * Krótkie serie (burstFireRangeM>0): powyżej progu dystansu pulsuj ogień (BURST_ON_S ognia /
   * BURST_OFF_S przerwy), by nie wystrzelać zapasu na dalekim, mniej celnym dystansie. Poniżej
   * progu (pewny, bliski strzał) ogień ciągły. 0 = brak dyscypliny (niższe poziomy: bez zmian).
   */
  private applyBurstDiscipline(fire: boolean): boolean {
    if (!fire) return false;
    const burstRange = this.difficulty.burstFireRangeM;
    if (burstRange <= 0 || this.geom.rangeM <= burstRange) return fire;
    const period = BURST_ON_S + BURST_OFF_S;
    return this.burstTimerS % period < BURST_ON_S;
  }

  /**
   * Separacja antykolizyjna (separationRangeM>0): dla każdego samolotu w ruchu (też
   * sojusznika) przewiduje punkt największego zbliżenia (CPA) w horyzoncie i odchyla kurs
   * składową ⊥ do aim (unik nie hamuje lotu). Leczy „sklejanie się skrzydłami" dwóch botów
   * goniących ten sam cel (zbieżne kursy na wspólny punkt wyprzedzenia). WYJĄTEK: atakowany
   * cel reaguje tylko na twardą bańkę — pełne CPA psułoby strzał z wyprzedzeniem (lot na cel
   * to zamierzone „zbliżenie"), a czołówkę z celem rozbraja wcześniej steerEngage.
   * Zwraca true przy pilnym uniku (wołający wstrzymuje ogień).
   */
  private applySeparation(
    self: PlaneState,
    target: PlaneState | null,
    situation: BotSituation | undefined,
    aim: Vector3,
  ): boolean {
    const sep = this.difficulty.separationRangeM;
    if (sep <= 0 || !situation) return false;
    // w walce (mamy cel) reagujemy TYLKO na twardą bańkę (samolot realnie blisko TERAZ),
    // pomijając predykcyjne CPA dalekich minięć — to właśnie omijanie przewidywanych minięć
    // odciągało bota od celu w kłębowisku (zmierzone: śr. dystans ~84→300 m, prawie brak ognia).
    // Antykolizja realna (sklejanie skrzydłami < sep) zostaje; bez celu (patrol) pełne CPA.
    const engaged = target !== null;
    scratchSepAvoid.set(0, 0, 0);
    let urgency = 0;
    for (const other of situation.traffic) {
      if (other === self || other.life !== 'alive') continue;
      const pos = nearestToroidalImage(other.position, self.position, scratchSepPos);
      scratchSepRel.subVectors(pos, self.position);
      const d = scratchSepRel.length();
      if (d < 1e-3) continue;
      scratchSepVel.subVectors(other.velocity, self.velocity);
      const vv = scratchSepVel.lengthSq();
      let tCpa = vv > 1e-6 ? -scratchSepRel.dot(scratchSepVel) / vv : 0;
      tCpa = clamp(tCpa, 0, SEPARATION_HORIZON_S);
      const isTarget = other === target;
      // bańka twarda (bieżący dystans) — dla celu jedyne kryterium (patrz nagłówek); w walce
      // od nie-celu ciaśniejsza (patrz SEPARATION_ENGAGED_BUBBLE_FRAC), poza walką pełny sep
      const bubbleM = isTarget
        ? sep * 1.2
        : engaged
          ? sep * SEPARATION_ENGAGED_BUBBLE_FRAC
          : sep;
      let u: number;
      if (d < bubbleM) {
        u = 1 - d / bubbleM;
        scratchSepRel.divideScalar(d); // od intruza TERAZ
      } else if (!isTarget && !engaged) {
        scratchSepRel.addScaledVector(scratchSepVel, tCpa); // pozycja względna przy CPA
        const dCpa = scratchSepRel.length();
        if (dCpa >= sep || dCpa < 1e-3) continue;
        // pilność rośnie, im ciaśniejsze minięcie i im bliżej w czasie
        u = (1 - dCpa / sep) * (0.35 + 0.65 * (1 - tCpa / SEPARATION_HORIZON_S));
        scratchSepRel.divideScalar(dCpa);
      } else {
        continue;
      }
      scratchSepAvoid.addScaledVector(scratchSepRel, -u); // odpychanie
      if (u > urgency) urgency = u;
    }
    if (urgency <= 0) return false;
    // w walce łagodniejszy gain (twarda bańka i tak odpala rzadko — patrz wyżej) i wyższy próg
    // wstrzymania ognia: as strzela, chyba że realnie grozi zderzenie. Bez celu — pełne wartości.
    const gain = engaged ? SEPARATION_GAIN_ENGAGED : SEPARATION_GAIN;
    const holdFireU = engaged ? SEPARATION_HOLD_FIRE_ENGAGED_U : SEPARATION_HOLD_FIRE_U;
    // tylko składowa ⊥ do aim: unik odchyla kurs, nie „hamuje" celu nosa; unik dokładnie
    // na wprost (składowa ⊥ znika) → w górę (od ziemi, override ziemi i tak pilnuje)
    const along = scratchSepAvoid.dot(aim);
    scratchSepAvoid.addScaledVector(aim, -along);
    if (scratchSepAvoid.lengthSq() < 1e-8) scratchSepAvoid.copy(scratchSelfUp);
    scratchSepAvoid.normalize();
    aim.addScaledVector(scratchSepAvoid, gain * urgency).normalize();
    return urgency > holdFireU;
  }

  /**
   * Prędkość bojowa per samolot (rollAuthorityMinFrac>0): w walce MANEWROWEJ (duży kąt do
   * celu) przy zdrewniałych lotkach (autorytet = maxRoll(IAS)/szczyt krzywej poniżej progu)
   * zejdź z gazu — wróć do reżimu sterowności. Wyprowadzone z rollRateCurve, bez nowych
   * parametrów samolotu: Zero zwalnia z „betonu" >400 km/h, Spit/Bf prawie nieodczuwalne
   * (ich zapaść zaczyna się dużo wyżej). Pościg prosty (mały kąt) = pełny gaz.
   */
  private applyManeuverThrottle(self: PlaneState, plane: PlaneConfig, throttle: number): number {
    const minAuth = this.difficulty.rollAuthorityMinFrac;
    if (minAuth <= 0) return throttle;
    if (this.geom.attackerOffBoresightRad < MANEUVER_ANGLE_RAD) return throttle;
    const peak = peakRollRateRadS(plane);
    if (peak <= 1e-6) return throttle;
    const authority = maxRollRateRadS(self.iasMs, plane) / peak;
    return authority < minAuth ? Math.min(throttle, MANEUVER_THROTTLE) : throttle;
  }

  /**
   * Kontrola przestrzelenia (asa, overshootGuardClosureMs>0): gdy bot siedzi za wolniejszym
   * celem w strefie strzału i dochodzi ZBYT szybko (closure > próg), zdejmuje gaz do reżimu
   * manewrowego — dzięki czemu nie wyprzedza celu na WEP, tylko dopasowuje prędkość i zostaje
   * na ogonie. Zejście gazu < 1 gasi też WEP (updateWep wymaga pełnego gazu). Działa TYLKO
   * gdy bot jest z celem „sam" (żaden inny żywy wróg < OVERSHOOT_GUARD_LONE_RANGE_M) — decyzja
   * usera: w kłębowisku nadmiar prędkości to przewaga, więc guard się wyłącza. Poza strefą
   * strzału (daleki pościg) pełny gaz = przewaga energetyczna.
   */
  private applyOvershootThrottle(
    self: PlaneState,
    target: PlaneState | null,
    situation: BotSituation | undefined,
    throttle: number,
  ): number {
    const guard = this.difficulty.overshootGuardClosureMs;
    if (guard <= 0 || !target) return throttle;
    if (this.geom.rangeM > OVERSHOOT_GUARD_RANGE_M) return throttle;
    if (this.geom.closureMs <= guard) return throttle;
    if (this.hasOtherEnemyNear(self, target, situation)) return throttle;
    return Math.min(throttle, MANEUVER_THROTTLE);
  }

  /** Czy w promieniu OVERSHOOT_GUARD_LONE_RANGE_M jest INNY żywy wróg niż `target`. Bez listy
   *  wrogów (situation) zakładamy „sam z celem" (testy 1v1, zgodność wstecz) → guard aktywny. */
  private hasOtherEnemyNear(
    self: PlaneState,
    target: PlaneState,
    situation: BotSituation | undefined,
  ): boolean {
    if (!situation) return false;
    const limitSq = OVERSHOOT_GUARD_LONE_RANGE_M * OVERSHOOT_GUARD_LONE_RANGE_M;
    for (const e of situation.enemies) {
      if (e === target || e.life !== 'alive') continue;
      const pos = nearestToroidalImage(e.position, self.position, scratchOvershoot);
      if (pos.distanceToSquared(self.position) < limitSq) return true;
    }
    return false;
  }

  /**
   * WEP asa (useWep>0): dopalacz ZAWSZE, gdy silnik na pełnym gazie — bez dyscypliny
   * cieplnej (decyzja usera 2026-07-12: as lata na WEP bez limitu, a boty są immune na
   * obrażenia z przegrzania — decyzja 2026-06-30, stepOverheatDamage pomija isBot).
   * W patrolu gaz przelotowy (0.85) < 1 → WEP naturalnie zgaszony (jak bramka serwera).
   */
  private updateWep(throttle: number): boolean {
    return this.difficulty.useWep > 0 && throttle >= 1;
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

  // --- override bezpieczeństwa ---

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
