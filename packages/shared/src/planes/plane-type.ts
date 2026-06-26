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
  /** Pełna nazwa wariantu do karty wyboru w poczekalni (np. „Spitfire Mk IIa"). */
  fullName: string;
  /** Jednowyrazowa charakterystyka roli (karta wyboru): „Zwrotny" / „Energia". */
  trait: string;
  /** Glif roli przy charakterystyce na karcie (czysto wizualny). */
  traitIcon: string;
  /** Skrót uzbrojenia do karty (np. „8× .303 (7,7 mm)"). */
  weapons: string;
  /** Jedno zdanie charakterystyki/roli do karty wyboru. */
  blurb: string;
}

// Dane KART wyboru w poczekalni (faza: przebudowa wyboru samolotu 2026-06-26). To etykiety UI,
// nie strojenie fizyki (liczby żyją w JSON — niezmiennik nr 3), więc opisy roli stoją obok `label`.
// Asymetria turn↔energy jest celowa (memory faza 19a): Spitfire = wirażówka, Bf 109 = energia/pion.
const PLANE_INFO: Record<PlaneType, PlaneTypeInfo> = {
  spitfire: {
    config: SPITFIRE_MK2,
    label: 'Spitfire',
    fullName: 'Spitfire Mk IIa',
    trait: 'Zwrotny',
    traitIcon: '⟳',
    weapons: '8× .303 (7,7 mm)',
    blurb: 'Duże skrzydło — ciasny zakręt, król wirażówki.',
  },
  bf109: {
    config: BF109_E,
    label: 'Bf 109',
    fullName: 'Bf 109 E-3',
    trait: 'Energia',
    traitIcon: '⚡',
    weapons: '2× MG 17 + 2× 20 mm',
    blurb: 'Mocne działka i przewaga w pionie — boom & zoom.',
  },
};

/** Konfiguracja fizyki/uzbrojenia danego typu (JSON walidowany przy imporcie loadera). */
export function planeConfigOf(type: PlaneType): PlaneConfig {
  return PLANE_INFO[type].config;
}

/** Krótka etykieta typu do UI (HUD przy markerze, lobby). */
export function planeLabelOf(type: PlaneType): string {
  return PLANE_INFO[type].label;
}

/** Dane karty wyboru samolotu w poczekalni (nazwa, rola, uzbrojenie, opis). Czysto UI. */
export interface PlaneCardInfo {
  type: PlaneType;
  label: string;
  fullName: string;
  trait: string;
  traitIcon: string;
  weapons: string;
  blurb: string;
}

/** Pełny opis typu do karty wyboru w poczekalni (faza: karty samolotów 2026-06-26). */
export function planeCardInfoOf(type: PlaneType): PlaneCardInfo {
  const i = PLANE_INFO[type];
  return {
    type,
    label: i.label,
    fullName: i.fullName,
    trait: i.trait,
    traitIcon: i.traitIcon,
    weapons: i.weapons,
    blurb: i.blurb,
  };
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

// Uwaga: do 2026-06-25 istniały tu planeTypeForTeam/teamForPlaneType, które wiązały typ samolotu
// ze stroną w trybie drużynowym (Spitfire↔Alianci, Bf 109↔Oś). Decyzja użytkownika 2026-06-25:
// drużyna i samolot są ROZDZIELONE (gracz wybiera jedno i drugie niezależnie, dowolny samolot w
// dowolnej drużynie), więc to sprzężenie zostało usunięte. Drużynę wybiera gracz osobno (selectTeam).
