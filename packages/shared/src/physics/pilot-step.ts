import { Vector3 } from 'three';
import type { PilotDemands } from '../instructor/instructor';
import {
  computeDamageModifiers,
  NO_DAMAGE_MODIFIERS,
  type DamageModifiers,
} from '../combat/damage-model';
import { GRAVITY_MS2 } from '../constants';
import { stepEngineHeat } from './engine-heat';
import { getRight } from '../math/frame';
import type { PlaneConfig } from '../planes/loader';
import { airDensityKgM3, dynamicPressurePa } from './atmosphere';
import {
  clampLoadFactorG,
  dampSideslip,
  maxRollRateRadS,
  nAvailG,
  peakRollRateRadS,
  pitchAuthorityFrac,
  weathervaneRates,
} from './envelope';
import { GLoadMachine, createGLoadEffects, type GLoadEffects } from './g-load';
import { pitchRateForLoadFactor, stepPlane, type PlaneTickResult } from './plane-step';
import { StallMachine, createStallEffects, type StallEffects } from './stall';
import { createPlaneState, type AngularRates, type PlaneState } from './state';

// Pełny tick "pilot → samolot" (fizyka-lotu.md rozdz. 6–8): żądania pilota
// (z instruktora LUB klawiatury) przechodzą przez kopertę i maszynę
// przeciągnięcia, stają się kinematycznymi prędkościami kątowymi
// (+ weathervaning), po czym działa fizyka translacji i koordynacja yaw.
// Klient, serwer i harness używają TEGO wejścia — nie składają pipeline'u sami.

/** Samolot jako jednostka symulacji: stan + maszyny + bufory. */
export interface SimPlane {
  state: PlaneState;
  stallMachine: StallMachine;
  stallEffects: StallEffects;
  /** Tolerancja przeciążenia pilota (G-LOC) — sufit dodatniego n + zaciemnienie. */
  gLoadMachine: GLoadMachine;
  gLoadEffects: GLoadEffects;
  /** Bufor poprawek weathervane (bez alokacji per tick). */
  weathervane: AngularRates;
  /**
   * Poziomy uszkodzeń stref (faza 22; indeks = ZONE_ROLES, 0..3) albo null = sprawny.
   * Modyfikatory lotu (moc/clMax/cd0/roll bias/autorytet ogona/wyciek) liczone TYLKO z poziomów,
   * bo klient zna ze snapshotu tylko poziomy (2 bity/strefa) — serwer i predykcja klienta liczą
   * to samo (spójny reconcile). null → modyfikatory neutralne (złote testy nietknięte).
   */
  damageLevels: number[] | null;
  /** Bufor policzonych modyfikatorów uszkodzeń (no-alloc per tick). */
  damageMods: DamageModifiers;
}

export function createSimPlane(stallSeed: number): SimPlane {
  return {
    state: createPlaneState(),
    stallMachine: new StallMachine(stallSeed),
    stallEffects: createStallEffects(),
    gLoadMachine: new GLoadMachine(),
    gLoadEffects: createGLoadEffects(),
    weathervane: { pitch: 0, roll: 0, yaw: 0 },
    damageLevels: null,
    damageMods: { ...NO_DAMAGE_MODIFIERS },
  };
}

/**
 * Efektywna konfiguracja po uszkodzeniach: klon bazy z nadpisanymi polami AERO/silnika (moc,
 * ciąg statyczny, clMax, cd0). Pozostałe pola (i obiekty zagnieżdżone) współdzielone przez
 * referencję. Alokuje TYLKO gdy któreś pole faktycznie zmienione — sprawny samolot zwraca bazę
 * (zero kosztu, ścieżka złotych testów bez zmian). Roll bias / autorytet ogona / wyciek paliwa
 * NIE są tu — aplikowane osobno na poziomie rate'ów/paliwa w pilotStep.
 */
function effectivePlaneConfig(base: PlaneConfig, mods: DamageModifiers): PlaneConfig {
  if (mods.enginePowerFactor === 1 && mods.clMaxFactor === 1 && mods.cd0Add === 0) return base;
  return {
    ...base,
    enginePowerW: base.enginePowerW * mods.enginePowerFactor,
    staticThrustN: base.staticThrustN * mods.enginePowerFactor,
    clMax: base.clMax * mods.clMaxFactor,
    cd0: base.cd0 + mods.cd0Add,
  };
}

const DEG_TO_RAD = Math.PI / 180;

const scratchRightCoord = new Vector3();

export interface PilotTickResult extends PlaneTickResult {
  stall: StallEffects;
  /** Tolerancja przeciążenia pilota (G-LOC): sufit n, rezerwa, zaciemnienie. */
  gLoad: GLoadEffects;
  /** n po kopercie ORAZ po limicie pilota [G] — to poleciało do siły nośnej. */
  nClampedG: number;
  /** Fizycznie dostępne n przy bieżącym q [G]. */
  nAvailG: number;
}

/**
 * Jeden tick z pełnym pipeline'em sterowania. Kolejność jest częścią kontraktu:
 * 1. koperta: clamp n (struktura + n_avail), clamp roll z krzywej IAS
 * 2. maszyna przeciągnięcia na surowym żądaniu (clRatio = n_demand/n_avail)
 * 3. rates: pitch z n (nos podąża za torem) + weathervane — przeciągnięcie NIE
 *    wymusza nosa, tor sam opada przy obciętym Cl (gracz wyprowadza nurkując);
 *    roll po kopercie × sterowność lotek + wing drop; yaw + weathervane
 * 4. stepPlane (siły + integracja) — state.stalled pochodzi z maszyny stanów
 * 5. dampSideslip (koordynacja yaw na nowym wektorze prędkości)
 */
export function pilotStep(
  sim: SimPlane,
  plane: PlaneConfig,
  demands: PilotDemands,
  dtS: number,
): PilotTickResult {
  const { state } = sim;

  // (0) modyfikatory uszkodzeń (faza 22): z poziomów stref → efektywna konfiguracja AERO/silnika
  // + osobne skutki na rate'y/paliwo. Sprawny samolot (damageLevels=null) → tożsamość, baza configu.
  let mods: DamageModifiers | null = null;
  let effPlane = plane;
  if (sim.damageLevels) {
    mods = computeDamageModifiers(sim.damageLevels, plane.damage, sim.damageMods);
    effPlane = effectivePlaneConfig(plane, mods);
  }
  const pitchAuth = mods ? mods.pitchAuthorityFactor : 1;
  const yawAuth = mods ? mods.yawAuthorityFactor : 1;
  const rollBias = mods ? mods.rollBiasRadS : 0;
  const fuelDrainFactor = mods ? mods.fuelDrainFactor : 1;
  // autorytet ogona: degraduje ZADANE n i yaw (mnożnik na komendę ponad neutralne 1 G)
  const nDemandAdj = 1 + (demands.nDemandG - 1) * pitchAuth;
  const yawDemandAdj = demands.yawRateRadS * yawAuth;

  // paliwo: spala się proporcjonalnie do gazu (pełny bak przy 100% starcza na
  // fuelEnduranceFullThrottleS sekund). Po wyczerpaniu silnik gaśnie — thrustForce daje
  // T=0 przy fuelFrac=0. Liczone przed siłami, by ciąg tego ticku znał już pusty bak.
  // stepWreck wymusza throttle=0 PRZED pilotStep, więc wrak nie pali paliwa. Wyciek z
  // przebitego zbiornika (fuelDrainFactor>1) przyspiesza deplecję.
  if (state.fuelFrac > 0) {
    state.fuelFrac = Math.max(
      0,
      state.fuelFrac - (state.throttle * dtS * fuelDrainFactor) / plane.fuelEnduranceFullThrottleS,
    );
  }

  // temperatura silnika: rośnie z gazem (∝ gaz²), spada z opływem chłodnicy (∝ IAS). Po obu stronach
  // identycznie (spójny reconcile); przegrzanie (heat>1) serwer karze obrażeniami strefy 'silnik'.
  // Bazowy `plane` (nie effPlane) — kalibracja termiczna jest niezależna od bieżących uszkodzeń.
  stepEngineHeat(state, plane, dtS);

  const tasMs = state.velocity.length();
  const qPa = dynamicPressurePa(airDensityKgM3(state.position.y), tasMs);

  // (0b) autorytet steru wysokości vs IAS (fizyka v2 R1, §6.2): przy dużej prędkości
  // ster fizycznie nie wychyli się do pełna → cap na ŻĄDANIE, PRZED kopertą i maszyną
  // przeciągnięcia (over-pull @ 700 km/h nie sięga nawet buffetu — realistyczne).
  // Strażniki max(1,·)/min(−1,·) gwarantują lot poziomy normalny i odwrócony przy
  // każdym IAS (bez nich frac < 1/nMaxG odbierałby możliwość utrzymania wysokości).
  const pitchAuthIas = pitchAuthorityFrac(state.iasMs, plane);
  const nCapHi = Math.max(1, effPlane.nMaxG * pitchAuthIas);
  const nCapLo = Math.min(-1, effPlane.nMinG * pitchAuthIas);
  const nDemandCapped = Math.min(nCapHi, Math.max(nCapLo, nDemandAdj));

  // (1) koperta — clMax (a więc nAvail) i clamp n liczone na EFEKTYWNYM configu (uszkodzone
  // skrzydło → mniejsze clMax → mniejsze dostępne n). Krzywa roll rate nie jest modyfikowana.
  const nAvail = nAvailG(qPa, effPlane);
  const nEnvelopeG = clampLoadFactorG(nDemandCapped, qPa, effPlane);
  const maxRoll = maxRollRateRadS(state.iasMs, plane);
  const rollClamped = Math.min(maxRoll, Math.max(-maxRoll, demands.rollRateRadS));

  // (1a) opór manewrowy sterów (fizyka v2 R1, §6.1): Cd_ctrl = k_ail·δa + k_rud·δr.
  // δa = REALNE wychylenie lotek: |roll żądany po kopercie| / SZCZYT krzywej rolla —
  // powyżej szczytu sztywnienie samo redukuje wychylenie (rollClamped ≤ maxRoll(IAS)),
  // więc Zero z betonem lotek przy 400+ km/h nie płaci oporem za pełny drążek.
  // Z rollClamped, NIE z state.angularRates.roll (tam siedzi wing drop i damage
  // rollBias — to nie jest wychylenie pilota). δr normalizowane jak w keyboardDemands.
  const peakRoll = peakRollRateRadS(plane);
  const aileronFrac = peakRoll > 0 ? Math.abs(rollClamped) / peakRoll : 0;
  const maxYawRadS = plane.instructor.maxYawRateDegS * DEG_TO_RAD;
  const rudderFrac = maxYawRadS > 0 ? Math.min(1, Math.abs(demands.yawRateRadS) / maxYawRadS) : 0;
  const ctrlCd = plane.ctrlDragK.aileron * aileronFrac + plane.ctrlDragK.rudder * rudderFrac;

  // (1b) tolerancja przeciążenia pilota (G-LOC): sufit dodatniego n opada przy
  // UTRZYMYWANIU wysokiego G — chwilowe szarpnięcie do nMaxG przechodzi, ale
  // wieczny max zakręt nie (decyzja 2026-06-14). Maszyna zużywa rezerwę z n PO
  // limicie i zwraca nLimitedG; od tej pory to ono jest "n po kopercie".
  const gLoad = sim.gLoadMachine.update(nEnvelopeG, plane, dtS, sim.gLoadEffects);
  const nClampedG = gLoad.nLimitedG;

  // (2) przeciągnięcie — próg na ŻĄDANIU obciętym strukturalnie I autorytetem steru
  // (R1: ster, który fizycznie nie da rady, nie wciąga w buffet — over-pull przy
  // dużej IAS jest ograniczony siłą na drążku, nie aerodynamiką skrzydła):
  // koperta n_avail z definicji nie pozwala przekroczyć clMax, a maszyna
  // ma wykrywać właśnie "chcę więcej, niż fizyka daje". Maszyna patrzy na
  // |clRatio| (znak bez znaczenia — przeciągnięcie i pchanie symetryczne);
  // liczymy go ze znakiem tylko po to, by przy q→0 (nAvail=0) ±Infinity
  // zachowało sens dla obu kierunków
  const nStructG = Math.min(effPlane.nMaxG, Math.max(effPlane.nMinG, nDemandCapped));
  const clRatio =
    nAvail > 0 ? nStructG / nAvail : nStructG === 0 ? 0 : Infinity * Math.sign(nStructG);
  sim.stallMachine.update(clRatio, plane, dtS, sim.stallEffects);
  const stall = sim.stallEffects;

  // (3) kinematyczne prędkości kątowe; α_implied liczona z n PO kopercie
  // (ten sam wzór co w lift.ts — tu potrzebna PRZED stepPlane dla weathervane)
  const qS = qPa * effPlane.wingAreaM2;
  const clNow =
    qS > 0
      ? Math.min(effPlane.clMax, Math.max(-effPlane.clMax, (nClampedG * effPlane.massKg * GRAVITY_MS2) / qS))
      : 0;
  const alphaImpliedRad = clNow / effPlane.clAlphaPerRad;
  const pathPitchRate = pitchRateForLoadFactor(state, nClampedG);
  weathervaneRates(state, alphaImpliedRad, plane, sim.weathervane);
  state.angularRates.pitch = pathPitchRate + sim.weathervane.pitch;
  // bias roll z asymetrii skrzydeł (faza 22): stały offset, który gracz MUSI kontrować lotką
  state.angularRates.roll = rollClamped * stall.aileronFactor + stall.rollRateOffsetRadS + rollBias;
  state.angularRates.yaw = yawDemandAdj + sim.weathervane.yaw;

  // (4) fizyka translacji
  // koordynacja zakrętu (feed-forward, nie regulator): w przechyleniu grawitacja
  // zagina tor BOKIEM względem płaszczyzny symetrii z przyspieszeniem g·sinφ
  // (= −g·right.y); nos musi yaw-ować w tym samym tempie, inaczej powstaje
  // trwały ślizg, którego tłumik kadłuba nie ma prawa nadgonić
  if (tasMs > 1) {
    getRight(state.orientation, scratchRightCoord);
    state.angularRates.yaw += (-GRAVITY_MS2 * scratchRightCoord.y) / tasMs;
  }

  // siły (nośna/opór/ciąg) na EFEKTYWNYM configu — degradacja silnika i skrzydeł działa tu;
  // ctrlCd = opór wychylonych sterów (R1 §6.1) dodawany do biegunowej w dragForce
  const tick = stepPlane(state, effPlane, nClampedG, dtS, ctrlCd);
  state.stalled = stall.phase === 'stalled';

  // (5) koordynacja yaw
  dampSideslip(state, plane, dtS);

  return { ...tick, stall, gLoad, nClampedG, nAvailG: nAvail };
}

// Bufor żądań wraku — stepWreck nie alokuje per tick (jeden wątek, sekwencyjnie).
const wreckDemands: PilotDemands = { nDemandG: 1, rollRateRadS: 0, yawRateRadS: 0 };

/**
 * Ogranicza żądania pilota do możliwości ZESTRZELONEGO wraku (zniszczenie w
 * powietrzu): lotki działają w pełni, ster wysokości tylko częściowo. Bazą jest
 * wreck.baseLoadG (< 1 G → wrak opada, nie utrzymuje wysokości); input pitch gracza
 * dodaje wokół niej ułamek (wreck.pitchAuthority). Ster kierunku martwy. Mutuje `out`.
 * Dla bota podaj neutralne żądania (nDemandG=1) → czysty opad bez prób wyprowadzania.
 */
export function applyWreckControl(demands: PilotDemands, plane: PlaneConfig, out: PilotDemands): void {
  out.rollRateRadS = demands.rollRateRadS; // lotki pełne — wrakiem da się przechylać
  // pitch: baza opadania + ułamek nadwyżki żądania ponad neutralne 1 G (gracz „macha", nie ratuje)
  out.nDemandG = plane.wreck.baseLoadG + (demands.nDemandG - 1) * plane.wreck.pitchAuthority;
  out.yawRateRadS = 0; // ster kierunku nie działa
}

/**
 * Jeden tick SPADAJĄCEGO WRAKU (life 'dying'). Silnik martwy → throttle wymuszony
 * na 0 (model ciągu skaluje się gazem, więc T = 0), sterowanie ograniczone przez
 * applyWreckControl. Reszta to zwykła fizyka (opór, grawitacja, weathervaning) —
 * wrak traci energię i opada, ale gracz może nim częściowo kierować (lotki + nikły
 * pitch). `demands` to surowe żądania (gracza z klawiatury albo zera dla bota).
 */
export function stepWreck(
  sim: SimPlane,
  plane: PlaneConfig,
  demands: PilotDemands,
  dtS: number,
): PilotTickResult {
  applyWreckControl(demands, plane, wreckDemands);
  sim.state.throttle = 0; // silnik stoi — brak ciągu (śmigło wytraca obroty po stronie wizualnej)
  return pilotStep(sim, plane, wreckDemands, dtS);
}
