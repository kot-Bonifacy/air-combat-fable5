import { FLAP_DISABLE_WING_LEVEL, MS_TO_KMH } from '../constants';
import { zoneRoleIndex } from '../combat/damage-model';
import type { PlaneConfig } from '../planes/loader';

// Klapy (fizyka v2 R3, §6.4). Model:
//  - ŻĄDANY indeks pozycji klap jest INPUTEM (state.flapIndex, echo 2 bitów INPUT) — deterministyczny
//    przy replayu (reconcile-safe, jak WEP).
//  - EFEKTYWNY indeks = żądany, chyba że klapy są URWANE. Urwanie wywodzimy z POZIOMU uszkodzenia
//    skrzydła (snapshot v8, ta sama liczba po obu stronach) zamiast osobnego ukrytego stanu „ripped",
//    który przy replayu mógłby się fałszywie zatrzasnąć na kliencie. Skutek: mocne postrzelenie skrzydła
//    też wyłącza klapy (decyzja usera 2026-07-11 — przyjęte świadomie).
//  - Aerodynamika (clMax/cd0) liczona z efektywnej pozycji w `pilotStep` (effectivePlaneConfig).
//  - Obrażenia urwania aplikuje SERWER autorytatywnie (jak flutter/przegrzanie) — patrz flapRipWingDamageHp.

// Indeksy skrzydeł w kanonicznej tablicy poziomów (ZONE_ROLES) — policzone raz, bez duplikacji liczb.
const Z_WING_L = zoneRoleIndex('wingL');
const Z_WING_R = zoneRoleIndex('wingR');

/** Ogranicza żądany indeks klap do dostępnych pozycji samolotu (0..positions.length−1). */
export function clampFlapIndex(index: number, plane: PlaneConfig): number {
  const n = plane.flaps.positions.length;
  const i = Math.round(index);
  return i < 0 ? 0 : i >= n ? n - 1 : i;
}

/**
 * Czy klapy są jeszcze sprawne (nie urwane). Urwane = którekolwiek skrzydło na poziomie
 * ≥ FLAP_DISABLE_WING_LEVEL. `damageLevels` = null (sprawny samolot) → zawsze sprawne. Liczone z
 * poziomów (te same, które jadą w snapshocie) → klient i serwer identycznie (reconcile-safe).
 */
export function flapsAvailable(damageLevels: readonly number[] | null): boolean {
  if (!damageLevels) return true;
  return (
    (damageLevels[Z_WING_L] ?? 0) < FLAP_DISABLE_WING_LEVEL &&
    (damageLevels[Z_WING_R] ?? 0) < FLAP_DISABLE_WING_LEVEL
  );
}

/**
 * Efektywny indeks pozycji klap po sprawdzeniu urwania: żądany (clampowany) gdy sprawne, 0 gdy urwane.
 * `damageLevels` z bieżącego stanu uszkodzeń (snapshot v8 po stronie klienta, refreshDamageLevels na serwerze).
 */
export function effectiveFlapIndex(
  commandedIndex: number,
  damageLevels: readonly number[] | null,
  plane: PlaneConfig,
): number {
  return flapsAvailable(damageLevels) ? clampFlapIndex(commandedIndex, plane) : 0;
}

/**
 * Obrażenia urwania klap do JEDNEGO skrzydła w tym ticku [HP] — proporcjonalne do WZGLĘDNEGO
 * przekroczenia ripIasKmh EFEKTYWNEJ pozycji klap (max(0, IAS/ripIas − 1)), jak flutter. 0 przy klapach
 * schowanych (effIndex=0) albo w granicy prędkości. Serwer (autorytatywnie) aplikuje wynik do OBU stref
 * skrzydeł; gdy skrzydło osiągnie poziom ≥ FLAP_DISABLE_WING_LEVEL, effectiveFlapIndex spada do 0 i
 * obrażenia ustają (klapy urwane trwale). Czyste; klient tego NIE liczy (skutek dostaje jako poziom stref).
 */
export function flapRipWingDamageHp(
  effIndex: number,
  iasMs: number,
  plane: PlaneConfig,
  dtS: number,
): number {
  if (effIndex <= 0) return 0;
  const pos = plane.flaps.positions[effIndex];
  if (!pos) return 0;
  const overFrac = (iasMs * MS_TO_KMH) / pos.ripIasKmh - 1;
  if (overFrac <= 0) return 0;
  return plane.flaps.ripDamagePerS * overFrac * dtS;
}
