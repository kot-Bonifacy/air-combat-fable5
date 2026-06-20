import { NetError } from '../errors';
import { BF109_E, SPITFIRE_MK2, type PlaneConfig } from './loader';

// Rejestr typów samolotów (faza 19b). Drugi samolot (Bf 109) wymaga, by KAŻDA encja
// niosła swój typ: serwer trzyma per-gracz konfigurację, klient wybiera mesh/HUD, a
// protokół v4 koduje typ jednym bajtem w snapshocie. Identyfikatory i ich KOLEJNOŚĆ są
// częścią formatu binarnego — patrz PLANE_TYPES.

/** Typ samolotu wybieralny przez gracza (faza 19). Stabilny identyfikator w protokole. */
export type PlaneType = 'spitfire' | 'bf109';

/**
 * Kolejność = kod na drucie (bajt typu w snapshocie, protokół v4). NIE zmieniać kolejności
 * ani nie usuwać wpisów bez bumpu protokołu — indeks jest częścią formatu binarnego.
 */
export const PLANE_TYPES: readonly PlaneType[] = ['spitfire', 'bf109'];

/** Domyślny typ (Spitfire — pierwszy samolot, parytet z SP); fallback walidacji wejścia z sieci. */
export const DEFAULT_PLANE_TYPE: PlaneType = 'spitfire';

interface PlaneTypeInfo {
  config: PlaneConfig;
  /** Krótka etykieta do HUD przy markerze wroga i do lobby (np. „Spitfire", „Bf 109"). */
  label: string;
}

const PLANE_INFO: Record<PlaneType, PlaneTypeInfo> = {
  spitfire: { config: SPITFIRE_MK2, label: 'Spitfire' },
  bf109: { config: BF109_E, label: 'Bf 109' },
};

/** Konfiguracja fizyki/uzbrojenia danego typu (JSON walidowany przy imporcie loadera). */
export function planeConfigOf(type: PlaneType): PlaneConfig {
  return PLANE_INFO[type].config;
}

/** Krótka etykieta typu do UI (HUD przy markerze, lobby). */
export function planeLabelOf(type: PlaneType): string {
  return PLANE_INFO[type].label;
}

/** Typ → kod bajtowy (snapshot v4). Rzuca NetError dla nieznanego typu (programistyczny błąd). */
export function planeTypeToCode(type: PlaneType): number {
  const i = PLANE_TYPES.indexOf(type);
  if (i < 0) throw new NetError(`nieznany typ samolotu: ${type}`);
  return i;
}

/** Kod bajtowy → typ (dekodowanie snapshotu). Rzuca NetError dla kodu spoza zakresu. */
export function planeTypeFromCode(code: number): PlaneType {
  const t = PLANE_TYPES[code];
  if (!t) throw new NetError(`nieznany kod typu samolotu: ${String(code)}`);
  return t;
}

/** Walidacja wyboru z sieci (niezmiennik nr 11): nieznana wartość → domyślny Spitfire. */
export function clampPlaneType(raw: unknown): PlaneType {
  return PLANE_TYPES.includes(raw as PlaneType) ? (raw as PlaneType) : DEFAULT_PLANE_TYPE;
}

/**
 * Sprzęt drużyny w trybie drużynowym (faza 19b, decyzja użytkownika 2026-06-20): drużyna 0 =
 * Spitfire (Alianci), drużyna 1 = Bf 109 (Oś) — klimat Alianci↔Oś. FFA NIE używa tej funkcji
 * (wolny wybór per gracz). Frakcje spoza {0,1} (nie powinny wystąpić: TEAM_COUNT=2) → Spitfire.
 */
export function planeTypeForTeam(faction: number): PlaneType {
  return faction === 1 ? 'bf109' : 'spitfire';
}
