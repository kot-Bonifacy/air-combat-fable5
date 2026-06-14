import {
  ZONE_CAPTURE_SECONDS,
  ZONE_CENTER_X_M,
  ZONE_CENTER_Z_M,
  ZONE_RADIUS_M,
} from '../constants';

// Kontrola strefy (faza 7: główny cel — „przeciąganie liny" nad górą w centrum
// wyspy). CZYSTA logika (bez Three, bez stanu klienta) — jak match.ts: każdą
// regułę da się przetestować tablicą okupantów + dt.
//
// Model: King-of-the-Hill BEZ cofania (decyzja briefingu). Każda FRAKCJA
// akumuluje sekundy WYŁĄCZNEJ obecności w poziomym walcu strefy. Strefa sporna
// (≥2 różne frakcje obecne) albo pusta NIE zmienia żadnego licznika — pauza, bez
// zaniku (nikt nie traci postępu). Pierwsza frakcja, która uzbiera
// ZONE_CAPTURE_SECONDS, przejmuje strefę = zwycięstwo. Działa w każdym trybie:
// FFA → N niezależnych liczników; drużynowy → 2 frakcje.

const ZONE_RADIUS_SQ_M2 = ZONE_RADIUS_M * ZONE_RADIUS_M;

/** Minimum stanu uczestnika potrzebne do rozstrzygnięcia kontroli strefy. */
export interface ZoneOccupant {
  faction: number;
  alive: boolean;
  xM: number;
  zM: number;
}

/** Czy punkt (x,z) leży w poziomym walcu strefy (środek = szczyt góry, bez limitu wysokości). */
export function isInZone(xM: number, zM: number): boolean {
  const dx = xM - ZONE_CENTER_X_M;
  const dz = zM - ZONE_CENTER_Z_M;
  return dx * dx + dz * dz <= ZONE_RADIUS_SQ_M2;
}

export interface ZoneOccupancy {
  /** Jedyny żywy okupant strefy (frakcja) albo null (pusta LUB sporna). */
  controlling: number | null;
  /** Czy w strefie jest co najmniej jeden żywy samolot (pauza spornej ≠ pusta). */
  occupied: boolean;
}

/**
 * Kto kontroluje strefę w tej chwili. `count` pozwala podać bufor wielokrotnego
 * użytku BEZ przycinania (zero alokacji w pętli gry — niezmiennik nr 6 ducha).
 * Sporna strefa → controlling=null, occupied=true (HUD rozróżnia pauzę spornej
 * od pustej; obie jednakowo zatrzymują liczniki).
 */
export function zoneOccupancy(
  occupants: readonly ZoneOccupant[],
  count = occupants.length,
): ZoneOccupancy {
  let controlling: number | null = null;
  let occupied = false;
  let contested = false;
  for (let i = 0; i < count; i++) {
    const o = occupants[i];
    if (!o || !o.alive || !isInZone(o.xM, o.zM)) continue;
    occupied = true;
    if (controlling === null) controlling = o.faction;
    else if (controlling !== o.faction) contested = true;
  }
  return { controlling: contested ? null : controlling, occupied };
}

/** Wynik aktualizacji strefy w jednym ticku. */
export interface ZoneTick {
  controlling: number | null;
  occupied: boolean;
  /** Frakcja, która właśnie przejęła strefę (przekroczyła próg), albo null. */
  captured: number | null;
}

/**
 * Stan przejmowania strefy (KotH bez cofania). Stan = Map sekund per frakcja +
 * pojedyncza frakcja, która przejęła (po przejęciu liczniki zamrożone). Bez Three
 * — wołający dostarcza okupantów (pozycja+frakcja+życie) i dt.
 */
export class ZoneControl {
  /** Zakumulowane sekundy WYŁĄCZNEJ kontroli per frakcja. */
  readonly secondsByFaction = new Map<number, number>();
  /** Frakcja, która przejęła strefę, albo null (mecz trwa). */
  captured: number | null = null;

  reset(): void {
    this.secondsByFaction.clear();
    this.captured = null;
  }

  /** Zakumulowane sekundy wyłącznej kontroli danej frakcji. */
  seconds(faction: number): number {
    return this.secondsByFaction.get(faction) ?? 0;
  }

  /** Postęp [0..1] danej frakcji ku przejęciu strefy. */
  progress(faction: number): number {
    return Math.min(1, this.seconds(faction) / ZONE_CAPTURE_SECONDS);
  }

  update(occupants: readonly ZoneOccupant[], dtS: number, count = occupants.length): ZoneTick {
    const occ = zoneOccupancy(occupants, count);
    if (this.captured === null && occ.controlling !== null) {
      const next = this.seconds(occ.controlling) + dtS;
      this.secondsByFaction.set(occ.controlling, next);
      if (next >= ZONE_CAPTURE_SECONDS) this.captured = occ.controlling;
    }
    return { controlling: occ.controlling, occupied: occ.occupied, captured: this.captured };
  }
}
