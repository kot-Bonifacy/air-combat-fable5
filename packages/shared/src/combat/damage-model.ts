import { Quaternion, Vector3 } from 'three';
import { segmentSphereHitT } from './hit';
import { segmentCapsuleHitT } from './capsule';

// Model modułowych uszkodzeń (faza 22a). Dwie warstwy:
//
//  1. STAN PEŁNY (serwer, autorytatywny): HP każdej strefy + globalna „integralność"
//     strukturalna (backstop hybrydowego modelu śmierci — patrz docs/phases/faza-22.md)
//     + flagi pożaru. Mutowany przez hit detection i upływ czasu (pożar). NIE jedzie w
//     snapshocie wprost.
//
//  2. POZIOMY (obie strony, lekkie): każda strefa kwantyzowana do 4 poziomów (0=ok,
//     1=lekkie, 2=ciężkie, 3=zniszczona) + bit pożaru. To one jadą w snapshocie (2 bity
//     na strefę) i z nich liczone są MODYFIKATORY fizyki. Kluczowy niezmiennik spójności:
//     klient predykuje lot lokalnego samolotu z TYCH SAMYCH poziomów co serwer (klient nie
//     zna surowego HP), więc modyfikatory MUSZĄ zależeć tylko od poziomów, nie od HP.
//
// Skutki uszkodzeń to wyłącznie MODYFIKATORY istniejących parametrów fizyki (niezmiennik
// nr 3 + zasada fazy 22: żaden skutek nie wprowadza nowego mechanizmu do rdzenia). Magnitudy
// strojeniowe żyją w JSON samolotu (sekcja `damage`) — tu tylko logika mapowania.

/**
 * Kanoniczna kolejność stref — indeks w tablicy poziomów i w bitach snapshotu. JSON samolotu
 * może listować strefy w dowolnej kolejności; loader mapuje je na te role. 6 stref = 12 bitów.
 */
export const ZONE_ROLES = ['engine', 'cockpit', 'tank', 'wingL', 'wingR', 'tail'] as const;
export type ZoneRole = (typeof ZONE_ROLES)[number];

export const ZONE_COUNT = ZONE_ROLES.length;

// indeksy kanoniczne (czytelność map modyfikatorów)
const Z_ENGINE = 0;
const Z_COCKPIT = 1;
const Z_TANK = 2;
const Z_WING_L = 3;
const Z_WING_R = 4;
const Z_TAIL = 5;

/** Indeks kanoniczny roli (−1 dla nieznanej — defensywnie, loader i tak waliduje). */
export function zoneRoleIndex(role: ZoneRole): number {
  return ZONE_ROLES.indexOf(role);
}

/** Bryła strefy w body frame [m] (+Z nos, +Y góra, +X lewe skrzydło). */
export type HitShape =
  | { kind: 'sphere'; center: readonly [number, number, number]; radius: number }
  | {
      kind: 'capsule';
      a: readonly [number, number, number];
      b: readonly [number, number, number];
      radius: number;
    };

/** Definicja strefy trafień: rola (skutek), bryła (geometria), wytrzymałość. */
export interface HitZone {
  role: ZoneRole;
  shape: HitShape;
  /** HP strefy — po zejściu do 0 strefa „zniszczona" (poziom 3, skutek krytyczny). */
  maxHp: number;
}

/**
 * Parametry strojeniowe skutków uszkodzeń (sekcja `damage` w JSON samolotu). Wszystkie
 * magnitudy/ progi tutaj, by balans 22b był knobem bez kodu (niezmiennik nr 3).
 */
export interface DamageTuning {
  /** Próg ułamka HP strefy ok→lekkie (np. 0.66). */
  lightFrac: number;
  /** Próg ułamka HP strefy lekkie→ciężkie (np. 0.33). */
  heavyFrac: number;
  /** Moc silnika na poziomie 1 (lekkie) jako ułamek (np. 0.6). Poziom 0 = 1.0, poziom 3 = 0. */
  enginePowerMid: number;
  /** Moc silnika na poziomie 2 (ciężkie) jako ułamek (np. 0.3). */
  enginePowerLow: number;
  /** Utrata clMax PO STRONIE przy zniszczonym skrzydle (poziom 3); skaluje się poziom/3. */
  wingClMaxLossFull: number;
  /** Przyrost cd0 po stronie przy zniszczonym skrzydle (poziom 3); skaluje się poziom/3. */
  wingCd0AddFull: number;
  /** Bias roll rate [rad/s] przy pełnej asymetrii (jedno skrzydło 3, drugie 0). */
  wingRollBiasFullRadS: number;
  /** Dolny próg mnożnika autorytetu pitch/yaw przy zniszczonym ogonie (poziom 3), np. 0.3. */
  tailAuthorityFloor: number;
  /** Mnożnik zużycia paliwa przy przebitym zbiorniku (wyciek), np. 3. */
  tankLeakDrainFactor: number;
  /** Szansa zapłonu na trafienie z karabinu maszynowego (7,7 mm), np. 0.01. */
  fireIgniteChanceMg: number;
  /** Szansa zapłonu na trafienie z działka (20 mm) — dużo wyższa, np. 0.08. */
  fireIgniteChanceCannon: number;
  /** Obrażenia pożaru do integralności [HP/s]. */
  fireDotPerS: number;
  /** Czas, po którym pożar gaśnie sam [s] (jeśli wcześniej nie dobije). */
  fireSelfExtinguishS: number;
}

// ============================ POZIOMY → MODYFIKATORY (obie strony) ============================

/** Kwantyzacja ułamka HP strefy do poziomu 0..3 (wspólna dla wszystkich stref). */
export function quantizeZoneLevel(hpFrac: number, tuning: DamageTuning): number {
  if (hpFrac <= 0) return 3;
  if (hpFrac <= tuning.heavyFrac) return 2;
  if (hpFrac <= tuning.lightFrac) return 1;
  return 0;
}

/**
 * Modyfikatory fizyki wynikające ze stanu uszkodzeń. Tożsamość (NO_DAMAGE_MODIFIERS) przy
 * braku uszkodzeń — złote testy nieuszkodzonego samolotu zostają bez zmian (niezmiennik fazy 22).
 */
export interface DamageModifiers {
  /** Mnożnik mocy silnika (enginePowerW i staticThrustN). */
  enginePowerFactor: number;
  /** Mnożnik clMax (gorsze ze skrzydeł). */
  clMaxFactor: number;
  /** Przyrost cd0 (suma uszkodzeń skrzydeł). */
  cd0Add: number;
  /** Stały bias roll rate [rad/s] z asymetrii skrzydeł (+ = w prawo). Gracz kontruje lotką. */
  rollBiasRadS: number;
  /** Mnożnik autorytetu steru wysokości (ogon). */
  pitchAuthorityFactor: number;
  /** Mnożnik autorytetu steru kierunku (ogon). */
  yawAuthorityFactor: number;
  /** Mnożnik zużycia paliwa (wyciek ze zbiornika). */
  fuelDrainFactor: number;
  /** Utrata skrzydła → korkociąg (autorotacja, brak kontroli). */
  spin: boolean;
  /** Pilot ranny (okresowe zaburzenie inputu — serwer aplikuje do żądań). */
  pilotWounded: boolean;
}

export const NO_DAMAGE_MODIFIERS: DamageModifiers = Object.freeze({
  enginePowerFactor: 1,
  clMaxFactor: 1,
  cd0Add: 0,
  rollBiasRadS: 0,
  pitchAuthorityFactor: 1,
  yawAuthorityFactor: 1,
  fuelDrainFactor: 1,
  spin: false,
  pilotWounded: false,
});

/** Reset bufora modyfikatorów do tożsamości (no-alloc per tick). */
export function resetDamageModifiers(out: DamageModifiers): DamageModifiers {
  out.enginePowerFactor = 1;
  out.clMaxFactor = 1;
  out.cd0Add = 0;
  out.rollBiasRadS = 0;
  out.pitchAuthorityFactor = 1;
  out.yawAuthorityFactor = 1;
  out.fuelDrainFactor = 1;
  out.spin = false;
  out.pilotWounded = false;
  return out;
}

/**
 * Liczy modyfikatory z poziomów stref (indeks = ZONE_ROLES). Mutuje `out` (no-alloc).
 * `levels` musi mieć długość ZONE_COUNT (brakujące strefy = poziom 0). Czyste — identycznie
 * po obu stronach sieci (klient i serwer podają te same poziomy → spójny reconcile).
 */
export function computeDamageModifiers(
  levels: readonly number[],
  tuning: DamageTuning,
  out: DamageModifiers,
): DamageModifiers {
  resetDamageModifiers(out);

  // silnik: 100 / mid / low / 0 %
  const eng = levels[Z_ENGINE] ?? 0;
  out.enginePowerFactor = eng <= 0 ? 1 : eng === 1 ? tuning.enginePowerMid : eng === 2 ? tuning.enginePowerLow : 0;

  // skrzydła: utrata clMax (gorsze ze skrzydeł) + przyrost cd0 (suma) + bias z asymetrii
  const lL = levels[Z_WING_L] ?? 0;
  const lR = levels[Z_WING_R] ?? 0;
  const lossL = tuning.wingClMaxLossFull * (lL / 3);
  const lossR = tuning.wingClMaxLossFull * (lR / 3);
  out.clMaxFactor = 1 - Math.max(lossL, lossR);
  out.cd0Add = tuning.wingCd0AddFull * (lL / 3) + tuning.wingCd0AddFull * (lR / 3);
  // bardziej uszkodzone skrzydło daje mniej nośnej → samolot przewala się w jego stronę
  out.rollBiasRadS = ((lR - lL) / 3) * tuning.wingRollBiasFullRadS;
  out.spin = lL >= 3 || lR >= 3;

  // ogon: degradacja autorytetu pitch/yaw do podłogi
  const tail = levels[Z_TAIL] ?? 0;
  const authority = 1 - (1 - tuning.tailAuthorityFloor) * (tail / 3);
  out.pitchAuthorityFactor = authority;
  out.yawAuthorityFactor = authority;

  // zbiornik: wyciek paliwa przy jakimkolwiek uszkodzeniu
  const tank = levels[Z_TANK] ?? 0;
  out.fuelDrainFactor = tank >= 1 ? tuning.tankLeakDrainFactor : 1;

  // kabina: pilot ranny przy ciężkim uszkodzeniu (kill = poziom 3 obsługuje serwer → 'dying')
  out.pilotWounded = (levels[Z_COCKPIT] ?? 0) >= 2;

  return out;
}

// ============================ STAN PEŁNY (serwer) ============================

/**
 * Pełny, autorytatywny stan uszkodzeń encji (serwer). `zoneHp` równoległe do `plane.zones[]`
 * (kolejność JSON, nie kanoniczna — mapowanie na role robi `zoneLevels`). UWAGA: globalna
 * „integralność" hybrydowego modelu śmierci to istniejące `player.health` (HP w snapshocie),
 * NIE pole tutaj — pożar i obrażenia kadłuba serwer aplikuje do `health` przez `applyDamage`.
 */
export interface DamageState {
  /** HP każdej strefy, równoległe do plane.zones[]. */
  zoneHp: number[];
  /** Czy płatowiec się pali (DoT do integralności = health). */
  onFire: boolean;
  /** Czas palenia [s] — pożar gaśnie sam po fireSelfExtinguishS. */
  fireTimerS: number;
}

export function createDamageState(zones: readonly HitZone[]): DamageState {
  return { zoneHp: zones.map((z) => z.maxHp), onFire: false, fireTimerS: 0 };
}

/** Reset do pełnej sprawności (respawn). */
export function resetDamageState(state: DamageState, zones: readonly HitZone[]): void {
  for (let i = 0; i < zones.length; i++) state.zoneHp[i] = zones[i]!.maxHp;
  state.zoneHp.length = zones.length;
  state.onFire = false;
  state.fireTimerS = 0;
}

// ============================ NARROW-PHASE: WYBÓR STREFY (serwer) ============================

const scratchZoneCenter = new Vector3();
const scratchZoneA = new Vector3();
const scratchZoneB = new Vector3();

/**
 * Indeks strefy w `zones[]` trafionej NAJWCZEŚNIEJ przez tor pocisku p0→p1, albo −1, gdy żadnej.
 * Bryły stref są w body frame — transformujemy je do świata pozą celu (`center` = pozycja,
 * `q` = orientacja). „Najwcześniej" = najmniejszy parametr t wzdłuż toru pocisku (segmentSphere/
 * CapsuleHitT zwracają położenie zbliżenia na torze), więc przy przebiciu kilku stref wygrywa ta
 * od strony lufy. Caller (serwer) odpala to PO broad-phase (sfera hitRadiusM) — tu już wiadomo, że
 * pocisk wszedł w obrys; pytanie tylko, w którą strefę. Czyste, scratch modułowy (jeden wątek).
 */
export function firstZoneHit(
  zones: readonly HitZone[],
  center: Vector3,
  q: Quaternion,
  p0: Vector3,
  p1: Vector3,
): number {
  let bestIdx = -1;
  let bestT = Infinity;
  for (let i = 0; i < zones.length; i++) {
    const shape = zones[i]!.shape;
    let t: number;
    if (shape.kind === 'sphere') {
      scratchZoneCenter.set(shape.center[0], shape.center[1], shape.center[2]).applyQuaternion(q).add(center);
      t = segmentSphereHitT(p0, p1, scratchZoneCenter, shape.radius);
    } else {
      scratchZoneA.set(shape.a[0], shape.a[1], shape.a[2]).applyQuaternion(q).add(center);
      scratchZoneB.set(shape.b[0], shape.b[1], shape.b[2]).applyQuaternion(q).add(center);
      t = segmentCapsuleHitT(p0, p1, scratchZoneA, scratchZoneB, shape.radius);
    }
    if (t >= 0 && t < bestT) {
      bestT = t;
      bestIdx = i;
    }
  }
  return bestIdx;
}

/** Wynik aplikacji obrażeń do strefy — serwer decyduje o skutkach krytycznych (pilot/skrzydło). */
export interface ZoneHitResult {
  role: ZoneRole;
  /** Czy to trafienie sprowadziło HP strefy do 0 (skutek krytyczny: pilot kill / utrata skrzydła). */
  zoneDestroyed: boolean;
}

/**
 * Aplikuje obrażenia pocisku do HP STREFY (model hybrydowy: skutki krytyczne ze stref; globalny
 * backstop = `health` ujmuje serwer osobno tym samym `amount`). Trafienie w strefę już zniszczoną
 * (hp=0) jest no-opem dla strefy. `zoneIndex` to indeks w plane.zones[]. Mutuje `state`.
 */
export function applyZoneHit(
  zones: readonly HitZone[],
  state: DamageState,
  zoneIndex: number,
  amount: number,
): ZoneHitResult {
  const zone = zones[zoneIndex]!;
  const before = state.zoneHp[zoneIndex]!;
  const after = Math.max(0, before - amount);
  state.zoneHp[zoneIndex] = after;
  return { role: zone.role, zoneDestroyed: before > 0 && after <= 0 };
}

/**
 * Poziomy stref (indeks = ZONE_ROLES) z pełnego stanu. Mutuje `out` (długość ZONE_COUNT).
 * Strefy nieobecne w konfiguracji zostają na poziomie 0.
 */
export function zoneLevels(
  zones: readonly HitZone[],
  state: DamageState,
  tuning: DamageTuning,
  out: number[],
): number[] {
  for (let i = 0; i < ZONE_COUNT; i++) out[i] = 0;
  for (let i = 0; i < zones.length; i++) {
    const zone = zones[i]!;
    const idx = zoneRoleIndex(zone.role);
    if (idx < 0) continue;
    const frac = zone.maxHp > 0 ? state.zoneHp[i]! / zone.maxHp : 0;
    out[idx] = quantizeZoneLevel(frac, tuning);
  }
  return out;
}

/**
 * Próba zapłonu po trafieniu — szansa zależna od kalibru (20 mm >> 7,7 mm; faza 22: pożar
 * groźniejszy od działka). Heurystyka kalibru: `cannon=true` dla grup o większym damagePerHit.
 * Zwraca true, gdy zapaliło się TERAZ.
 */
export function maybeIgnite(
  state: DamageState,
  tuning: DamageTuning,
  cannon: boolean,
  rng: () => number,
): boolean {
  if (state.onFire) return false;
  const chance = cannon ? tuning.fireIgniteChanceCannon : tuning.fireIgniteChanceMg;
  if (rng() < chance) {
    state.onFire = true;
    state.fireTimerS = 0;
    return true;
  }
  return false;
}

/**
 * Krok pożaru (serwer, co tick): zwraca obrażenia do aplikacji do integralności (`health`)
 * w tym ticku i samoczynnie gasi pożar po fireSelfExtinguishS. 0, gdy nie pali się. Caller
 * aplikuje wynik przez `applyDamage(health, dot)` — to ono decyduje o ewentualnym zestrzeleniu.
 */
export function stepFire(state: DamageState, tuning: DamageTuning, dtS: number): number {
  if (!state.onFire) return 0;
  state.fireTimerS += dtS;
  const dot = tuning.fireDotPerS * dtS;
  if (state.fireTimerS >= tuning.fireSelfExtinguishS) state.onFire = false;
  return dot;
}
