import { Vector3 } from 'three';
import {
  FIXED_DT_S,
  GRAVITY_MS2,
  MS_TO_KMH,
  PHYSICS_HZ,
  SEA_LEVEL_AIR_DENSITY_KGM3,
} from '../constants';
import { PhysicsError } from '../errors';
import { getForward, getUp } from '../math/frame';
import { airDensityKgM3 } from '../physics/atmosphere';
import { maxRollRateRadS } from '../physics/envelope';
import type { PlaneConfig } from '../planes/loader';
import { VirtualPilot, wrapPiRad } from './virtual-pilot';

// Manewry "jak gracz" (uzupełnienie złotych testów z maneuvers.ts): wirtualny
// pilot wykonuje beczkę, pętlę, nurkowanie, split-S, immelmanna i wyprowadzenie
// z przeciągnięcia przez PEŁNY pipeline wejścia gry (mysz px → MouseAimCore →
// PilotControl/Instructor → koperta → fizyka). Prędkości wejściowe z Pilot's
// Notes Spitfire Mk I (loop ~300 mph, rolling 180–300 mph, half roll off loop
// 320–350 mph, limit nurkowania 450 mph IAS) — szczegóły w teście.

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

const scratchFwd = new Vector3();
const scratchUp = new Vector3();
const scratchDesired = new Vector3();

/** TAS [m/s] dająca zadaną IAS [m/s] na zadanej wysokości (odwrotność tasToIasMs). */
export function iasToTasMs(iasMs: number, altitudeM: number): number {
  return iasMs / Math.sqrt(airDensityKgM3(altitudeM) / SEA_LEVEL_AIR_DENSITY_KGM3);
}

function headingRad(velocity: Vector3): number {
  return Math.atan2(velocity.x, velocity.z);
}

/** Kąt toru lotu nad horyzontem [rad]. */
function flightPathAngleRad(velocity: Vector3): number {
  const speed = velocity.length();
  return speed > 1e-6 ? Math.asin(velocity.y / speed) : 0;
}

/** Kąt nosa w pionowej płaszczyźnie manewru {h0, góra} [rad], do odwijania. */
function noseAngleInPlaneRad(fwd: Vector3, h0: Vector3): number {
  return Math.atan2(fwd.y, fwd.x * h0.x + fwd.z * h0.z);
}

export interface PlayerRollResult {
  /** Czas pełnych 360° przechylenia [s]. */
  rollTimeS: number;
  /** 360°/maxRollRate(IAS wejściowej) — oczekiwanie z krzywej koperty [s]. */
  envelopeTimeS: number;
  altitudeLossM: number;
  headingDriftDeg: number;
  everStalled: boolean;
}

/**
 * Beczka lotkowa z klawiatury (Pilot's Notes: rolling 180–300 mph): pełne
 * wychylenie lotek w prawo do 360° obrotu, bez ciągnięcia. Czas musi wynikać
 * z krzywej rollRate(IAS), tor nie ma prawa się rozsypać.
 */
export function playerRollTest(
  plane: PlaneConfig,
  iasKmh: number,
  altitudeM = 1000,
): PlayerRollResult {
  const tasMs = iasToTasMs(iasKmh / MS_TO_KMH, altitudeM);
  const pilot = new VirtualPilot(plane, 5);
  pilot.setLevelFlight(altitudeM, tasMs, pilot.trimThrottleForLevel(altitudeM, tasMs));
  for (let i = 0; i < PHYSICS_HZ; i++) pilot.tick(FIXED_DT_S, 'playerRollTest/ustalenie');

  const y0 = pilot.state.position.y;
  const heading0 = headingRad(pilot.state.velocity);
  pilot.deflections.rollRight = 1;

  let rolledRad = 0;
  let ticks = 0;
  let everStalled = false;
  const maxTicks = 30 * PHYSICS_HZ;
  while (rolledRad < 2 * Math.PI) {
    const tick = pilot.tick(FIXED_DT_S, 'playerRollTest/beczka');
    rolledRad += pilot.state.angularRates.roll * FIXED_DT_S;
    everStalled ||= tick.stall.phase === 'stalled';
    if (++ticks > maxTicks) {
      throw new PhysicsError(
        `playerRollTest: beczka niedomknięta po 30 s (obrót ${(rolledRad * RAD_TO_DEG).toFixed(0)}°)`,
      );
    }
  }
  pilot.deflections.rollRight = 0;

  return {
    rollTimeS: ticks * FIXED_DT_S,
    envelopeTimeS: (2 * Math.PI) / maxRollRateRadS(iasKmh / MS_TO_KMH, plane),
    altitudeLossM: y0 - pilot.state.position.y,
    headingDriftDeg: wrapPiRad(headingRad(pilot.state.velocity) - heading0) * RAD_TO_DEG,
    everStalled,
  };
}

export interface PlayerLoopResult {
  loopTimeS: number;
  /** Najwyższy punkt pętli ponad wysokość wejścia [m] (≈ 2R z fizyki manewru). */
  altitudeGainM: number;
  apexIasKmh: number;
  minIasKmh: number;
  exitHeadingDriftDeg: number;
  /** Odchylenie od poziomych skrzydeł na wyjściu [°]. */
  exitBankDeg: number;
  /** Maksymalny boczny dryf od pionowej płaszczyzny pętli [m]. */
  maxPlaneDeviationM: number;
  maxNG: number;
  everStalled: boolean;
  buffetTimeS: number;
}

/**
 * Pętla samą myszą (Pilot's Notes: looping ~300 mph): pilot ciągnie celownik
 * w górę przez pion z wyprzedzeniem dawkowanym wg dostępnego G (clRatio 0.85
 * — pod progiem buffetu), jak gracz patrzący na wskaźnik G. Wymaga pełnej
 * swobody pitch myszy (decyzja 2026-06-12) i renormalizacji po manewrze.
 */
export function playerLoopTest(
  plane: PlaneConfig,
  entryIasKmh = 483,
  altitudeM = 1500,
): PlayerLoopResult {
  const tasMs = iasToTasMs(entryIasKmh / MS_TO_KMH, altitudeM);
  const pilot = new VirtualPilot(plane, 7);
  pilot.setLevelFlight(altitudeM, tasMs, 1);
  for (let i = 0; i < PHYSICS_HZ; i++) pilot.tick(FIXED_DT_S, 'playerLoopTest/ustalenie');

  const state = pilot.state;
  const y0 = state.position.y;
  const heading0 = headingRad(state.velocity);
  const h0 = getForward(state.orientation, new Vector3());
  h0.y = 0;
  h0.normalize();

  let angleAccumRad = 0;
  let prevTheta = noseAngleInPlaneRad(getForward(state.orientation, scratchFwd), h0);
  let ticks = 0;
  let maxAltM = y0;
  let minIasMs = Infinity;
  let apexIasMs = Number.NaN;
  let maxDeviationM = 0;
  let maxNG = 0;
  let everStalled = false;
  let buffetTicks = 0;

  const maxTicks = 60 * PHYSICS_HZ;
  while (angleAccumRad < 2 * Math.PI) {
    pilot.steerPull(pilot.pullLeadRad(0.85), FIXED_DT_S);
    const tick = pilot.tick(FIXED_DT_S, 'playerLoopTest/pętla');
    const theta = noseAngleInPlaneRad(getForward(state.orientation, scratchFwd), h0);
    const beforeApex = angleAccumRad < Math.PI;
    angleAccumRad += wrapPiRad(theta - prevTheta);
    prevTheta = theta;

    maxAltM = Math.max(maxAltM, state.position.y);
    minIasMs = Math.min(minIasMs, state.iasMs);
    if (beforeApex && angleAccumRad >= Math.PI) apexIasMs = state.iasMs;
    maxDeviationM = Math.max(maxDeviationM, Math.abs(state.position.x));
    maxNG = Math.max(maxNG, state.loadFactor);
    everStalled ||= tick.stall.phase === 'stalled';
    if (tick.stall.phase === 'buffet') buffetTicks++;
    if (++ticks > maxTicks) {
      throw new PhysicsError(
        `playerLoopTest: pętla niedomknięta po 60 s (kąt ${(angleAccumRad * RAD_TO_DEG).toFixed(0)}°, IAS ${(state.iasMs * MS_TO_KMH).toFixed(0)} km/h)`,
      );
    }
  }

  getUp(state.orientation, scratchUp);
  return {
    loopTimeS: ticks * FIXED_DT_S,
    altitudeGainM: maxAltM - y0,
    apexIasKmh: apexIasMs * MS_TO_KMH,
    minIasKmh: minIasMs * MS_TO_KMH,
    exitHeadingDriftDeg: wrapPiRad(headingRad(state.velocity) - heading0) * RAD_TO_DEG,
    exitBankDeg: Math.acos(Math.min(1, Math.max(-1, scratchUp.y))) * RAD_TO_DEG,
    maxPlaneDeviationM: maxDeviationM,
    maxNG,
    everStalled,
    buffetTimeS: buffetTicks * FIXED_DT_S,
  };
}

export interface PlayerDiveResult {
  maxIasKmh: number;
  /** Najmniejsze up.y w fazie pchnięcia — dodatnie = bez przewrotu na plecy. */
  pushoverMinUpY: number;
  minNG: number;
  maxNG: number;
  pulloutAltitudeLossM: number;
  minAltitudeM: number;
  /** Największy jednotickowy przyrost energii całkowitej [J] (silnik zdławiony → ≤ 0). */
  maxTickEnergyGainJ: number;
  finalGammaDeg: number;
  everStalled: boolean;
}

/**
 * Nurkowanie z wyprowadzeniem, samą myszą, silnik zdławiony: pchnięcie do
 * −45° (cel prowadzony w stożku pushover — instruktor NIE może przewracać
 * na plecy), rozpędzanie, wyprowadzenie z dawkowaniem G. Limit płatowca
 * z Pilot's Notes: 450 mph IAS — pilot wyprowadza, zanim go dotknie.
 */
export function playerDiveTest(
  plane: PlaneConfig,
  entryIasKmh = 400,
  altitudeM = 3200,
  pulloutStartAltM = 1500,
): PlayerDiveResult {
  const tasMs = iasToTasMs(entryIasKmh / MS_TO_KMH, altitudeM);
  const pilot = new VirtualPilot(plane, 9);
  pilot.setLevelFlight(altitudeM, tasMs, 0);

  const state = pilot.state;
  const energyJ = (): number =>
    0.5 * plane.massKg * state.velocity.lengthSq() +
    plane.massKg * GRAVITY_MS2 * state.position.y;
  let prevE = energyJ();
  let maxTickEnergyGainJ = -Infinity;
  let maxIasMs = 0;
  let minNG = Infinity;
  let maxNG = -Infinity;
  let pushoverMinUpY = Infinity;
  let everStalled = false;

  const afterTick = (): void => {
    const e = energyJ();
    maxTickEnergyGainJ = Math.max(maxTickEnergyGainJ, e - prevE);
    prevE = e;
    maxIasMs = Math.max(maxIasMs, state.iasMs);
    minNG = Math.min(minNG, state.loadFactor);
    maxNG = Math.max(maxNG, state.loadFactor);
    everStalled ||= pilot.lastTick?.stall.phase === 'stalled';
  };

  for (let i = 0; i < PHYSICS_HZ / 2; i++) {
    pilot.tick(FIXED_DT_S, 'playerDiveTest/ustalenie');
    afterTick();
  }

  // faza pchnięcia: cel prowadzony ≤15° pod nosem (stożek pushover ma 20°),
  // nos celuje −47°, żeby tor przeszedł przez −45°
  const targetNosePitchRad = -47 * DEG_TO_RAD;
  let guard = 25 * PHYSICS_HZ;
  while (flightPathAngleRad(state.velocity) > -44 * DEG_TO_RAD) {
    getForward(state.orientation, scratchFwd);
    const nosePitchRad = Math.asin(Math.min(1, Math.max(-1, scratchFwd.y)));
    const leadRad = Math.min(15 * DEG_TO_RAD, Math.max(0, nosePitchRad - targetNosePitchRad));
    pilot.steerPush(leadRad, FIXED_DT_S);
    pilot.tick(FIXED_DT_S, 'playerDiveTest/pchnięcie');
    afterTick();
    pushoverMinUpY = Math.min(pushoverMinUpY, getUp(state.orientation, scratchUp).y);
    if (--guard <= 0) {
      throw new PhysicsError(
        `playerDiveTest: pchnięcie nie osiągnęło −44° po 25 s (γ=${(flightPathAngleRad(state.velocity) * RAD_TO_DEG).toFixed(1)}°)`,
      );
    }
  }

  // faza nurkowania: cel trzymany na stałym kierunku −45° w płaszczyźnie manewru
  scratchDesired.set(0, -Math.sin(45 * DEG_TO_RAD), Math.cos(45 * DEG_TO_RAD));
  guard = 60 * PHYSICS_HZ;
  while (state.position.y > pulloutStartAltM) {
    pilot.moveMouseTowards(scratchDesired, FIXED_DT_S);
    pilot.tick(FIXED_DT_S, 'playerDiveTest/nurkowanie');
    afterTick();
    if (--guard <= 0) {
      throw new PhysicsError(
        `playerDiveTest: nurkowanie nie zeszło do ${String(pulloutStartAltM)} m po 60 s (alt ${state.position.y.toFixed(0)} m)`,
      );
    }
  }

  // wyprowadzenie: ciągnięcie wg dostępnego G (clRatio 0.9 — próg buffetu)
  const pulloutEntryAltM = state.position.y;
  let minAltitudeM = pulloutEntryAltM;
  guard = 30 * PHYSICS_HZ;
  while (flightPathAngleRad(state.velocity) < -2 * DEG_TO_RAD) {
    pilot.steerPull(pilot.pullLeadRad(0.9), FIXED_DT_S);
    pilot.tick(FIXED_DT_S, 'playerDiveTest/wyprowadzenie');
    afterTick();
    minAltitudeM = Math.min(minAltitudeM, state.position.y);
    if (--guard <= 0) {
      throw new PhysicsError(
        `playerDiveTest: wyprowadzenie nie wróciło do poziomu po 30 s (γ=${(flightPathAngleRad(state.velocity) * RAD_TO_DEG).toFixed(1)}°)`,
      );
    }
  }

  return {
    maxIasKmh: maxIasMs * MS_TO_KMH,
    pushoverMinUpY,
    minNG,
    maxNG,
    pulloutAltitudeLossM: pulloutEntryAltM - minAltitudeM,
    minAltitudeM,
    maxTickEnergyGainJ,
    finalGammaDeg: flightPathAngleRad(state.velocity) * RAD_TO_DEG,
    everStalled,
  };
}

export interface PlayerSplitSResult {
  totalTimeS: number;
  altitudeLossM: number;
  exitIasKmh: number;
  maxIasKmh: number;
  exitHeadingDriftDeg: number;
  exitUpY: number;
  /** Skok żądania n na ticku przejęcia klawiatura→mysz [G] (test "bez szarpnięcia"). */
  handoffJumpG: number;
  /** up.y po półbeczce (oczekiwane ≈ −1 = na plecach). */
  invertedUpY: number;
  maxNG: number;
  everStalled: boolean;
}

/**
 * Split-S: półbeczka z KLAWIATURY do lotu na plecach, puszczenie klawiszy
 * (przejęcie przez mysz od nosa — bez szarpnięcia), dociągnięcie MYSZĄ przez
 * pion w dół do odwróconego kursu. Testuje arbitraż wejścia na szwie.
 */
export function playerSplitSTest(
  plane: PlaneConfig,
  entryIasKmh = 400,
  altitudeM = 2200,
): PlayerSplitSResult {
  const tasMs = iasToTasMs(entryIasKmh / MS_TO_KMH, altitudeM);
  const pilot = new VirtualPilot(plane, 11);
  pilot.setLevelFlight(altitudeM, tasMs, pilot.trimThrottleForLevel(altitudeM, tasMs));
  for (let i = 0; i < PHYSICS_HZ; i++) pilot.tick(FIXED_DT_S, 'playerSplitSTest/ustalenie');

  const state = pilot.state;
  const y0 = state.position.y;
  const heading0 = headingRad(state.velocity);
  const h0 = getForward(state.orientation, new Vector3());
  h0.y = 0;
  h0.normalize();

  // półbeczka klawiaturą
  pilot.deflections.rollRight = 1;
  let rolledRad = 0;
  let ticks = 0;
  let everStalled = false;
  let maxNG = -Infinity;
  let maxIasMs = 0;
  let guard = 20 * PHYSICS_HZ;
  while (rolledRad < Math.PI) {
    const tick = pilot.tick(FIXED_DT_S, 'playerSplitSTest/półbeczka');
    rolledRad += state.angularRates.roll * FIXED_DT_S;
    everStalled ||= tick.stall.phase === 'stalled';
    maxNG = Math.max(maxNG, state.loadFactor);
    maxIasMs = Math.max(maxIasMs, state.iasMs);
    ticks++;
    if (--guard <= 0) throw new PhysicsError('playerSplitSTest: półbeczka niedomknięta po 20 s');
  }
  const invertedUpY = getUp(state.orientation, scratchUp).y;

  // przejęcie przez mysz: puszczenie klawiszy; skok żądania n = miara szarpnięcia
  const nBeforeHandoffG = pilot.demands.nDemandG;
  pilot.deflections.rollRight = 0;
  pilot.tick(FIXED_DT_S, 'playerSplitSTest/przejęcie');
  ticks++;
  const handoffJumpG = Math.abs(pilot.demands.nDemandG - nBeforeHandoffG);

  // dociągnięcie myszą przez pion w dół (kąt w płaszczyźnie idzie 0 → −π)
  let angleAccumRad = 0;
  let prevTheta = noseAngleInPlaneRad(getForward(state.orientation, scratchFwd), h0);
  guard = 45 * PHYSICS_HZ;
  while (!(angleAccumRad <= -0.95 * Math.PI && getForward(state.orientation, scratchFwd).y > -0.15)) {
    pilot.steerPull(pilot.pullLeadRad(0.85), FIXED_DT_S);
    const tick = pilot.tick(FIXED_DT_S, 'playerSplitSTest/dociągnięcie');
    const theta = noseAngleInPlaneRad(getForward(state.orientation, scratchFwd), h0);
    angleAccumRad += wrapPiRad(theta - prevTheta);
    prevTheta = theta;
    everStalled ||= tick.stall.phase === 'stalled';
    maxNG = Math.max(maxNG, state.loadFactor);
    maxIasMs = Math.max(maxIasMs, state.iasMs);
    ticks++;
    if (--guard <= 0) {
      throw new PhysicsError(
        `playerSplitSTest: dociągnięcie niedomknięte po 45 s (kąt ${(angleAccumRad * RAD_TO_DEG).toFixed(0)}°)`,
      );
    }
  }

  return {
    totalTimeS: ticks * FIXED_DT_S,
    altitudeLossM: y0 - state.position.y,
    exitIasKmh: state.iasMs * MS_TO_KMH,
    maxIasKmh: maxIasMs * MS_TO_KMH,
    exitHeadingDriftDeg: wrapPiRad(headingRad(state.velocity) - heading0) * RAD_TO_DEG,
    exitUpY: getUp(state.orientation, scratchUp).y,
    handoffJumpG,
    invertedUpY,
    maxNG,
    everStalled,
  };
}

export interface PlayerImmelmannResult {
  totalTimeS: number;
  altitudeGainM: number;
  exitIasKmh: number;
  minIasKmh: number;
  exitHeadingDriftDeg: number;
  exitUpY: number;
  /** Najdalsze wychylenie pitch celownika [°] — > 90° dowodzi przejścia przez pion. */
  maxAimPitchDeg: number;
  /** cos(pitch celownika) na końcu ≥ 0 = renormalizacja po manewrze zadziałała. */
  finalAimPitchCos: number;
  everStalled: boolean;
}

/**
 * Immelmann (Pilot's Notes: half roll off loop 320–350 mph): półpętla MYSZĄ
 * przez pion (celownik przechodzi pitch > 90° — pełna swoboda myszy),
 * półbeczka KLAWIATURĄ do poziomu, wyrównanie myszą. Sprawdza renormalizację
 * parametryzacji celownika po manewrze przez pion.
 */
export function playerImmelmannTest(
  plane: PlaneConfig,
  entryIasKmh = 530,
  altitudeM = 1200,
): PlayerImmelmannResult {
  const tasMs = iasToTasMs(entryIasKmh / MS_TO_KMH, altitudeM);
  const pilot = new VirtualPilot(plane, 13);
  pilot.setLevelFlight(altitudeM, tasMs, 1);
  for (let i = 0; i < PHYSICS_HZ; i++) pilot.tick(FIXED_DT_S, 'playerImmelmannTest/ustalenie');

  const state = pilot.state;
  const y0 = state.position.y;
  const heading0 = headingRad(state.velocity);
  const h0 = getForward(state.orientation, new Vector3());
  h0.y = 0;
  h0.normalize();

  // półpętla myszą: kąt w płaszczyźnie idzie 0 → +π (nos na plecach, poziomo)
  let angleAccumRad = 0;
  let prevTheta = noseAngleInPlaneRad(getForward(state.orientation, scratchFwd), h0);
  let ticks = 0;
  let minIasMs = Infinity;
  let everStalled = false;
  let guard = 45 * PHYSICS_HZ;
  while (!(angleAccumRad >= 0.95 * Math.PI && Math.abs(getForward(state.orientation, scratchFwd).y) < 0.2)) {
    pilot.steerPull(pilot.pullLeadRad(0.85), FIXED_DT_S);
    const tick = pilot.tick(FIXED_DT_S, 'playerImmelmannTest/półpętla');
    const theta = noseAngleInPlaneRad(getForward(state.orientation, scratchFwd), h0);
    angleAccumRad += wrapPiRad(theta - prevTheta);
    prevTheta = theta;
    minIasMs = Math.min(minIasMs, state.iasMs);
    everStalled ||= tick.stall.phase === 'stalled';
    ticks++;
    if (--guard <= 0) {
      throw new PhysicsError(
        `playerImmelmannTest: półpętla niedomknięta po 45 s (kąt ${(angleAccumRad * RAD_TO_DEG).toFixed(0)}°, IAS ${(state.iasMs * MS_TO_KMH).toFixed(0)} km/h)`,
      );
    }
  }

  // półbeczka klawiaturą do poziomych skrzydeł
  pilot.deflections.rollRight = 1;
  let rolledRad = 0;
  guard = 20 * PHYSICS_HZ;
  while (rolledRad < Math.PI) {
    const tick = pilot.tick(FIXED_DT_S, 'playerImmelmannTest/półbeczka');
    rolledRad += state.angularRates.roll * FIXED_DT_S;
    minIasMs = Math.min(minIasMs, state.iasMs);
    everStalled ||= tick.stall.phase === 'stalled';
    ticks++;
    if (--guard <= 0) {
      throw new PhysicsError('playerImmelmannTest: półbeczka niedomknięta po 20 s');
    }
  }
  pilot.deflections.rollRight = 0;

  // wyrównanie myszą: cel na horyzoncie przed nosem (tu odpala renormalizacja)
  for (let i = 0; i < 3 * PHYSICS_HZ; i++) {
    getForward(state.orientation, scratchDesired);
    scratchDesired.y = 0;
    scratchDesired.normalize();
    pilot.moveMouseTowards(scratchDesired, FIXED_DT_S);
    pilot.tick(FIXED_DT_S, 'playerImmelmannTest/wyrównanie');
    minIasMs = Math.min(minIasMs, state.iasMs);
    ticks++;
  }

  return {
    totalTimeS: ticks * FIXED_DT_S,
    altitudeGainM: state.position.y - y0,
    exitIasKmh: state.iasMs * MS_TO_KMH,
    minIasKmh: minIasMs * MS_TO_KMH,
    exitHeadingDriftDeg: wrapPiRad(headingRad(state.velocity) - heading0) * RAD_TO_DEG,
    exitUpY: getUp(state.orientation, scratchUp).y,
    maxAimPitchDeg: pilot.maxAimPitchAbsRad * RAD_TO_DEG,
    finalAimPitchCos: Math.cos(pilot.control.mouseAim.pitchRad),
    everStalled,
  };
}

export interface PlayerStallRecoveryResult {
  /** Czy szarpnięcie wywołało pełne przeciągnięcie. */
  sawStall: boolean;
  /** Maks. odchylenie od poziomych skrzydeł podczas trzymania przeciągnięcia [°] (wing drop). */
  maxBankDeg: number;
  /** Czas od oddania drążka do wyjścia z fazy 'stalled' [s]. */
  timeToUnstallS: number;
  /** Łączny czas w 'stalled' PO oddaniu drążka [s] (nawroty = źle). */
  stalledAfterReleaseS: number;
  altitudeLossM: number;
  finalIasKmh: number;
  finalGammaDeg: number;
}

/**
 * Przeciągnięcie z wyprowadzeniem: w wolnym locie pilot szarpie pełne
 * ciągnięcie z KLAWIATURY (n_demand ≫ n_avail → stall + wing drop po 1 s),
 * po czym oddaje drążek i MYSZĄ podąża za torem aż do nabrania prędkości,
 * wreszcie wyrównuje. Klasyczna procedura ma działać (fizyka-lotu.md 6.5).
 */
export function playerStallRecoveryTest(
  plane: PlaneConfig,
  altitudeM = 1000,
): PlayerStallRecoveryResult {
  // 1.35×V_stall — wolny lot, z którego szarpnięcie na pewno przeciąga
  const stallIasMs = Math.sqrt(
    (2 * plane.massKg * GRAVITY_MS2) /
      (SEA_LEVEL_AIR_DENSITY_KGM3 * plane.wingAreaM2 * plane.clMax),
  );
  const entryTasMs = iasToTasMs(1.35 * stallIasMs, altitudeM);
  const pilot = new VirtualPilot(plane, 17);
  pilot.setLevelFlight(altitudeM, entryTasMs, pilot.trimThrottleForLevel(altitudeM, entryTasMs));
  for (let i = 0; i < 2 * PHYSICS_HZ; i++) {
    pilot.tick(FIXED_DT_S, 'playerStallRecoveryTest/ustalenie');
  }

  const state = pilot.state;
  const y0 = state.position.y;

  // szarpnięcie: pełne ciągnięcie przez 1.6 s (> wingDropDelayS) — trzymamy stall
  pilot.deflections.pitchUp = 1;
  let sawStall = false;
  let maxBankDeg = 0;
  for (let i = 0; i < Math.round(1.6 * PHYSICS_HZ); i++) {
    const tick = pilot.tick(FIXED_DT_S, 'playerStallRecoveryTest/szarpnięcie');
    sawStall ||= tick.stall.phase === 'stalled';
    const bankDeg =
      Math.acos(Math.min(1, Math.max(-1, getUp(state.orientation, scratchUp).y))) * RAD_TO_DEG;
    maxBankDeg = Math.max(maxBankDeg, bankDeg);
  }

  // oddanie drążka: mysz przejmuje od nosa i podąża za TOREM (klasyczne wyjście)
  pilot.deflections.pitchUp = 0;
  let unstallTicks = -1;
  let stalledTicksAfterRelease = 0;
  let ticks = 0;
  const recoverIasMs = 1.25 * stallIasMs;
  let guard = 15 * PHYSICS_HZ;
  // min. pół sekundy fazy oddania — IAS mogła nie zdążyć spaść poniżej progu
  while (state.iasMs < recoverIasMs || ticks < PHYSICS_HZ / 2) {
    scratchDesired.copy(state.velocity).normalize();
    pilot.moveMouseTowards(scratchDesired, FIXED_DT_S);
    const tick = pilot.tick(FIXED_DT_S, 'playerStallRecoveryTest/oddanie');
    ticks++;
    if (tick.stall.phase === 'stalled') stalledTicksAfterRelease++;
    else if (unstallTicks < 0) unstallTicks = ticks;
    if (--guard <= 0) {
      throw new PhysicsError(
        `playerStallRecoveryTest: brak odzysku prędkości po 15 s (IAS ${(state.iasMs * MS_TO_KMH).toFixed(0)} km/h)`,
      );
    }
  }

  // wyrównanie: ciągnięcie wg dostępnego G aż tor wróci do poziomu
  guard = 15 * PHYSICS_HZ;
  while (flightPathAngleRad(state.velocity) < -3 * DEG_TO_RAD) {
    pilot.steerPull(pilot.pullLeadRad(0.8), FIXED_DT_S);
    const tick = pilot.tick(FIXED_DT_S, 'playerStallRecoveryTest/wyrównanie');
    if (tick.stall.phase === 'stalled') stalledTicksAfterRelease++;
    if (--guard <= 0) {
      throw new PhysicsError(
        `playerStallRecoveryTest: brak wyrównania po 15 s (γ=${(flightPathAngleRad(state.velocity) * RAD_TO_DEG).toFixed(1)}°)`,
      );
    }
  }

  return {
    sawStall,
    maxBankDeg,
    timeToUnstallS: unstallTicks < 0 ? Infinity : unstallTicks * FIXED_DT_S,
    stalledAfterReleaseS: stalledTicksAfterRelease * FIXED_DT_S,
    altitudeLossM: y0 - state.position.y,
    finalIasKmh: state.iasMs * MS_TO_KMH,
    finalGammaDeg: flightPathAngleRad(state.velocity) * RAD_TO_DEG,
  };
}
