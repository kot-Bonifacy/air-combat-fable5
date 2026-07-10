import { Vector3 } from 'three';
import { dragForce } from '../aero/drag';
import { liftDirection, liftForce } from '../aero/lift';
import { enginePowerW, thrustForce } from '../aero/thrust';
import {
  FIXED_DT_S,
  GRAVITY_MS2,
  MS_TO_KMH,
  PHYSICS_HZ,
  SEA_LEVEL_AIR_DENSITY_KGM3,
} from '../constants';
import { PhysicsError } from '../errors';
import { createPilotDemands } from '../instructor/instructor';
import { inducedDragFactor, type PlaneConfig } from '../planes/loader';
import { airDensityKgM3, dynamicPressurePa, tasToIasMs } from '../physics/atmosphere';
import { nAvailG } from '../physics/envelope';
import { validatePlaneState } from '../physics/nan-guard';
import { createSimPlane, pilotStep, type SimPlane } from '../physics/pilot-step';
import { nDemandForPitchRate } from '../physics/plane-step';
import { createPlaneState } from '../physics/state';
import { bestSteadyClimbPoint } from './maneuvers';

// Harness manewrów BOJOWYCH (fizyka v2, etap R0 — docs/fizyka-v2-rekalibracja.md §8.2):
// utrwalenie tymczasowego harnessu z sesji 2026-07-09. Wszystkie testy czasowe idą przez
// PEŁNY pipeline pilota (pilotStep: koperta + G-LOC + maszyna przeciągnięcia + weathervane),
// bo lekcja „punktu pracy Zero" mówi, że sama fizyka translacji to za mało — mierzyć trzeba
// to, co dostaje gracz. psBleedTest i timeToAltitudeTest są analityczne (bilans sił/mocy):
// tam kontroler czasowy tylko wnosiłby własne artefakty do mapy energetycznej.

/** TAS [m/s] dająca zadaną IAS na wysokości (odwrócenie IAS = TAS·√(ρ/ρ0)). */
export function tasForIasMs(iasMs: number, altitudeM: number): number {
  return iasMs / Math.sqrt(airDensityKgM3(altitudeM) / SEA_LEVEL_AIR_DENSITY_KGM3);
}

/**
 * Gaz trymujący T = D w locie poziomym (n=1) przy zadanej TAS — ten sam wzorzec
 * co w rollRateTest: trzyma prędkość w oknie pomiaru bez regulatora. Nasycony do 1
 * (powyżej Vmax poziomej pomiar i tak startuje z zadanej prędkości i hamuje oporem).
 */
function levelTrimThrottle(plane: PlaneConfig, tasMs: number, altitudeM: number): number {
  const rho = airDensityKgM3(altitudeM);
  const qS = dynamicPressurePa(rho, tasMs) * plane.wingAreaM2;
  const cl = (plane.massKg * GRAVITY_MS2) / qS;
  const dragN = qS * (plane.cd0 + inducedDragFactor(plane) * cl * cl + plane.dragHighClK * cl ** 4);
  const availablePowerW = plane.propEfficiency * enginePowerW(plane, altitudeM);
  return Math.min(1, Math.max(0, (dragN * tasMs) / availablePowerW));
}

/** Wspólny setup symulacji: lot poziomy na +z, zadana IAS na zadanej wysokości. */
function setupLevelSim(
  plane: PlaneConfig,
  iasKmh: number,
  altitudeM: number,
  stallSeed: number,
): SimPlane {
  const iasMs = iasKmh / MS_TO_KMH;
  const tasMs = tasForIasMs(iasMs, altitudeM);
  const sim = createSimPlane(stallSeed);
  sim.state.position.set(0, altitudeM, 0);
  sim.state.velocity.set(0, 0, tasMs);
  sim.state.iasMs = iasMs;
  return sim;
}

const clamp01Abs = (v: number): number => Math.min(1, Math.max(-1, v));

export interface Turn180Result {
  /** Czas zawrócenia kursu o 180° [s] (od pierwszego ticku, z wliczonym wkręcaniem w przechył). */
  timeS: number;
  /** IAS na wyjściu z zawrotu [km/h] — ile energii zjadł manewr. */
  exitIasKmh: number;
  /** Zmiana wysokości w manewrze [m]; dodatnia = zysk (zoom), ujemna = zniżanie. */
  altitudeDeltaM: number;
}

/**
 * Zawrócenie 180° max-rate: pełny gaz, przechylenie do kąta zakrętu poziomego przy
 * dostępnym n. Ciągnięcie NARASTA z osiągniętym przechyleniem (pull przy skrzydłach
 * w poziomie robiłby zoom-climb zamiast zawrotu) i jest klampowane do 0,85·n_avail —
 * ten sam margines co instruktor (lekcja 2026-06-25: powyżej over-pull dławi manewr
 * oporem oderwania). G-LOC może w trakcie zejść niżej — to celowo część pomiaru
 * „pełnego pipeline'u". Czas liczony po kursie WEKTORA PRĘDKOŚCI (nie nosa).
 */
export function turn180Test(plane: PlaneConfig, entryIasKmh: number, altitudeM = 1000): Turn180Result {
  const sim = setupLevelSim(plane, entryIasKmh, altitudeM, 13);
  const { state } = sim;
  state.throttle = 1;

  const demands = createPilotDemands();
  const liftDir = new Vector3();
  const BANK_GAIN_PER_S = 3;
  const ENVELOPE_MARGIN = 0.85;
  let headingPrevRad: number | undefined;
  let accumulatedRad = 0;

  const maxTicks = 60 * PHYSICS_HZ;
  for (let i = 0; i < maxTicks; i++) {
    const qPa = dynamicPressurePa(airDensityKgM3(state.position.y), state.velocity.length());
    const nTarget = Math.min(plane.nMaxG, Math.max(1.05, ENVELOPE_MARGIN * nAvailG(qPa, plane)));
    const bankTargetRad = Math.acos(1 / nTarget);
    if (!liftDirection(state, liftDir)) {
      throw new PhysicsError('turn180Test: zdegenerowany kierunek nośnej');
    }
    const bankRad = Math.acos(clamp01Abs(liftDir.y));
    const bankProgress = Math.min(1, bankRad / Math.max(0.05, bankTargetRad));
    demands.rollRateRadS = BANK_GAIN_PER_S * (bankTargetRad - bankRad);
    demands.nDemandG = 1 + (nTarget - 1) * bankProgress;
    pilotStep(sim, plane, demands, FIXED_DT_S);
    validatePlaneState(state, 'turn180Test');

    const headingRad = Math.atan2(state.velocity.x, state.velocity.z);
    if (headingPrevRad !== undefined) {
      let delta = headingRad - headingPrevRad;
      if (delta > Math.PI) delta -= 2 * Math.PI;
      if (delta < -Math.PI) delta += 2 * Math.PI;
      accumulatedRad += delta;
      if (Math.abs(accumulatedRad) >= Math.PI) {
        return {
          timeS: (i + 1) * FIXED_DT_S,
          exitIasKmh: state.iasMs * MS_TO_KMH,
          altitudeDeltaM: state.position.y - altitudeM,
        };
      }
    }
    headingPrevRad = headingRad;
  }
  throw new PhysicsError(
    `turn180Test(${plane.name}, ${String(entryIasKmh)} km/h): brak zawrotu 180° w 60 s`,
  );
}

/**
 * Czas pełnej beczki 360° przy zadanej IAS: pełna lotka od pierwszego ticku (roll jest
 * kinematyczny — nasycenie robi koperta), gaz trymowany na wejściu. Zwraca czas [s]
 * albo Infinity, gdy beczka nie domyka się w 90 s (zabetonowane lotki przy dużej IAS).
 */
export function rollTime360Test(plane: PlaneConfig, iasKmh: number, altitudeM = 1000): number {
  const sim = setupLevelSim(plane, iasKmh, altitudeM, 17);
  const { state } = sim;
  state.throttle = levelTrimThrottle(plane, state.velocity.length(), altitudeM);

  const demands = createPilotDemands();
  let rolledRad = 0;
  const maxTicks = 90 * PHYSICS_HZ;
  for (let i = 0; i < maxTicks; i++) {
    demands.nDemandG = nDemandForPitchRate(state, 0); // tor prosty — czysta beczka
    demands.rollRateRadS = 100; // żądanie absurdalne — nasycenie robi koperta
    pilotStep(sim, plane, demands, FIXED_DT_S);
    validatePlaneState(state, 'rollTime360Test');
    rolledRad += Math.abs(state.angularRates.roll) * FIXED_DT_S;
    if (rolledRad >= 2 * Math.PI) return (i + 1) * FIXED_DT_S;
  }
  return Infinity;
}

export interface LoopResult {
  /** Czy tor prędkości domknął pełne 360° w pionie. */
  completed: boolean;
  /** Czas domknięcia pętli [s]; przy completed=false — czas przerwania pomiaru. */
  timeS: number;
  /** Minimalna TAS w manewrze [m/s] (jak blisko zawiśnięcia na szczycie). */
  minTasMs: number;
  /** Najwyższy punkt pętli ponad wejściem [m]. */
  apexGainM: number;
}

/**
 * Pętla: pełny gaz, ciągnięcie 0,85·n_avail (margines instruktora — stałe nMaxG
 * wpadałoby w opór oderwania i zrzut skrzydła na szczycie; lekcja aimExpo 2026-06-25),
 * zero lotek. Postęp mierzony kątem wektora prędkości w PŁASZCZYŹNIE pionowej wejścia
 * (rzut na [ẑ0, ŷ], odwijany) — zrzut skrzydła z przeciągnięcia wyprowadza z płaszczyzny
 * i naturalnie zatrzymuje postęp (completed=false). Przerwanie: 45 s albo zejście
 * poniżej 30 m AGL (pętla niedomknięta nurkuje z powrotem).
 */
export function loopTest(plane: PlaneConfig, entryIasKmh: number, altitudeM = 500): LoopResult {
  const sim = setupLevelSim(plane, entryIasKmh, altitudeM, 19);
  const { state } = sim;
  state.throttle = 1;

  const ENVELOPE_MARGIN = 0.85;
  const demands = createPilotDemands();
  const vHat = new Vector3();
  let anglePrevRad: number | undefined;
  let accumulatedRad = 0;
  let minTasMs = state.velocity.length();
  let apexM = altitudeM;

  const maxTicks = 45 * PHYSICS_HZ;
  let ticks = 0;
  for (; ticks < maxTicks; ticks++) {
    const qPa = dynamicPressurePa(airDensityKgM3(state.position.y), state.velocity.length());
    demands.nDemandG = Math.min(
      plane.nMaxG,
      Math.max(1.05, ENVELOPE_MARGIN * nAvailG(qPa, plane)),
    );
    pilotStep(sim, plane, demands, FIXED_DT_S);
    validatePlaneState(state, 'loopTest');
    minTasMs = Math.min(minTasMs, state.velocity.length());
    apexM = Math.max(apexM, state.position.y);
    if (state.position.y < 30) break;

    vHat.copy(state.velocity).normalize();
    // rzut kierunku prędkości na płaszczyznę pionową wejścia (u = składowa wzdłuż
    // pierwotnego kursu +z, w = pion); poza płaszczyzną rzut karleje → pomijamy tick
    const u = vHat.z;
    const w = vHat.y;
    if (u * u + w * w > 0.05) {
      const angleRad = Math.atan2(w, u);
      if (anglePrevRad !== undefined) {
        let delta = angleRad - anglePrevRad;
        if (delta > Math.PI) delta -= 2 * Math.PI;
        if (delta < -Math.PI) delta += 2 * Math.PI;
        accumulatedRad += delta;
        if (Math.abs(accumulatedRad) >= 2 * Math.PI) {
          return {
            completed: true,
            timeS: (ticks + 1) * FIXED_DT_S,
            minTasMs,
            apexGainM: apexM - altitudeM,
          };
        }
      }
      anglePrevRad = angleRad;
    }
  }
  return { completed: false, timeS: ticks * FIXED_DT_S, minTasMs, apexGainM: apexM - altitudeM };
}

export interface RollBleedResult {
  /** IAS po ustaleniu, tuż przed wejściem w beczki [km/h]. */
  iasStartKmh: number;
  /** Surowa IAS po zadanym czasie pełnych lotek [km/h] (UWAGA: beczkujący samolot
   *  nurkuje — surowa IAS zlewa koszt lotek z wymianą wysokość→prędkość). */
  iasEndKmh: number;
  /** IAS-ekwiwalent KOŃCOWEJ energii na wysokości wejścia [km/h] — porównywalny
   *  wprost z iasStartKmh; różnica to czysty koszt energetyczny beczek. */
  iasEquivEndKmh: number;
  /** Spadek IAS w ekwiwalencie energetycznym (start − equiv koniec) [km/h]. */
  iasEquivDropKmh: number;
  /** Spadek wysokości energetycznej E = h + V²/2g w oknie beczek [m]. */
  energyDropM: number;
  /** Ile pełnych obrotów wykręcono w oknie pomiaru. */
  rolledTurns: number;
}

/**
 * Bleed beczek: lot poziomy z gazem trymowanym na wejściową IAS, 1 s ustalenia,
 * potem pełna lotka przez `rollS` sekund (tor prosty, n bez ciągnięcia — czyli
 * w przechyle grawitacja zagina tor w dół: samolot beczkując nurkuje). Dlatego
 * miarą kosztu jest WYSOKOŚĆ ENERGETYCZNA (E = h + V²/2g), nie sama IAS —
 * ekwiwalent IAS liczony z powrotem na wysokości wejścia. Na STAREJ fizyce
 * (roll czysto kinematyczny) koszt ≈ tylko trym toru — baseline dla §6.1;
 * po R1 (opór lotek) iasEquivDropKmh ma być wyraźnie dodatni.
 */
export function rollBleedTest(
  plane: PlaneConfig,
  iasKmh = 400,
  altitudeM = 1000,
  rollS = 10,
): RollBleedResult {
  const sim = setupLevelSim(plane, iasKmh, altitudeM, 23);
  const { state } = sim;
  state.throttle = levelTrimThrottle(plane, state.velocity.length(), altitudeM);

  const demands = createPilotDemands();
  const settleTicks = 1 * PHYSICS_HZ;
  const rollTicks = Math.round(rollS * PHYSICS_HZ);
  let rolledRad = 0;
  let iasStartMs = state.iasMs;
  let energyStartM = 0;
  let altStartM = altitudeM;
  for (let i = 0; i < settleTicks + rollTicks; i++) {
    demands.nDemandG = nDemandForPitchRate(state, 0);
    demands.rollRateRadS = i < settleTicks ? 0 : 100;
    pilotStep(sim, plane, demands, FIXED_DT_S);
    validatePlaneState(state, 'rollBleedTest');
    if (i === settleTicks - 1) {
      iasStartMs = state.iasMs;
      altStartM = state.position.y;
      energyStartM = state.position.y + state.velocity.lengthSq() / (2 * GRAVITY_MS2);
    }
    if (i >= settleTicks) rolledRad += Math.abs(state.angularRates.roll) * FIXED_DT_S;
  }
  const energyEndM = state.position.y + state.velocity.lengthSq() / (2 * GRAVITY_MS2);
  // TAS, jaką miałby samolot po bezstratnym odzyskaniu wysokości wejściowej
  const tasEquivMs = Math.sqrt(Math.max(0, 2 * GRAVITY_MS2 * (energyEndM - altStartM)));
  const iasEquivMs = tasToIasMs(tasEquivMs, airDensityKgM3(altStartM));
  return {
    iasStartKmh: iasStartMs * MS_TO_KMH,
    iasEndKmh: state.iasMs * MS_TO_KMH,
    iasEquivEndKmh: iasEquivMs * MS_TO_KMH,
    iasEquivDropKmh: (iasStartMs - iasEquivMs) * MS_TO_KMH,
    energyDropM: energyStartM - energyEndM,
    rolledTurns: rolledRad / (2 * Math.PI),
  };
}

export interface PsResult {
  /** Nadmiar mocy właściwej Ps = V·(T−D)/W [m/s]; ujemny = manewr zjada energię. */
  psMs: number;
  /** n faktycznie osiągalne w tym punkcie (min z żądania, struktury i n_avail) [G]. */
  nEffectiveG: number;
}

/**
 * Mapa energetyczna (analitycznie, bilans sił): Ps przy zadanym n i IAS. Żądane n
 * nasycane jak w kopercie (struktura + n_avail przy bieżącym q); biegunowa pełna
 * (z członami Cl⁴ i oderwania — jak dragForce w locie). Ps < 0 oznacza, że zakręt
 * przy tym n jest nie do utrzymania bez zniżania/utraty prędkości.
 */
export function psBleedTest(
  plane: PlaneConfig,
  nG: number,
  iasKmh: number,
  altitudeM = 1000,
): PsResult {
  const iasMs = iasKmh / MS_TO_KMH;
  const tasMs = tasForIasMs(iasMs, altitudeM);
  const rho = airDensityKgM3(altitudeM);
  const qPa = dynamicPressurePa(rho, tasMs);

  const state = createPlaneState();
  state.position.set(0, altitudeM, 0);
  state.velocity.set(0, 0, tasMs);
  state.iasMs = iasMs;
  state.throttle = 1;

  const nEffectiveG = Math.min(nG, plane.nMaxG, nAvailG(qPa, plane));
  const lift = liftForce(state, plane, nEffectiveG, qPa);
  const dragN = dragForce(state, plane, qPa, lift.cl, lift.clRequired).force.length();
  const thrustN = thrustForce(state, plane).force.length();
  return {
    psMs: (tasMs * (thrustN - dragN)) / (plane.massKg * GRAVITY_MS2),
    nEffectiveG,
  };
}

/**
 * Czas wznoszenia na wysokość: quasi-statyczny profil po najlepszym punkcie wznoszenia
 * (bestSteadyClimbPoint co 100 m pasmo, t = Σ Δh/ROC). Konwencja jak w raportach
 * historycznych (bez segmentów rozpędzania między pasmami — błąd rzędu sekund).
 * Rzuca, gdy pułap praktyczny wypada poniżej celu.
 */
export function timeToAltitudeTest(
  plane: PlaneConfig,
  targetAltM: number,
  startAltM = 100,
): number {
  const bandM = 100;
  let timeS = 0;
  for (let h = startAltM; h < targetAltM; h += bandM) {
    const dh = Math.min(bandM, targetAltM - h);
    const midM = h + dh / 2;
    const rocMs = bestSteadyClimbPoint(plane, midM).rocMs;
    if (rocMs < 0.25) {
      throw new PhysicsError(
        `timeToAltitudeTest(${plane.name}): pułap praktyczny poniżej ${String(targetAltM)} m ` +
          `(ROC=${rocMs.toFixed(2)} m/s @ ${String(midM)} m)`,
      );
    }
    timeS += dh / rocMs;
  }
  return timeS;
}
