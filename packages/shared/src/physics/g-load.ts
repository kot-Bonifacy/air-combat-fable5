import type { PlaneConfig } from '../planes/loader';

// Tolerancja przeciążenia pilota / G-LOC (decyzja 2026-06-14): bez kombinezonu
// przeciążeniowego pilot Bitwy o Anglię szarzeje już przy ~4 G, a UTRZYMYWANIE
// wysokiego G prowadzi do utraty wzroku/przytomności po kilku sekundach. Bez tego
// model pozwalał trzymać strukturalne nMaxG dowolnie długo — „max zawracanie" było
// za mocne (weryfikacja 2026-06-14). Modelujemy malejącą REZERWĘ fizjologiczną:
//   • chwilowe szarpnięcie do nMaxG zostaje dozwolone (zakręt INSTANTANEOUS),
//   • ale SUFIT ciągnięcia opada ku onsetG, gdy gracz trzyma wysokie G — pilot
//     instynktownie odpuszcza do G, które jeszcze wytrzymuje (likwiduje wieczny
//     max zakręt); jednocześnie obraz szarzeje (sygnał dla gracza),
//   • po zejściu poniżej onsetG rezerwa (i wzrok) wracają.
// Symetria z maszyną przeciągnięcia (stall.ts): stan + bufor efektów per tick.
// Limit dotyczy TYLKO dodatniego G (ciągnięcie = zakręt); ujemne G (redout
// przy pchaniu) — backlog. Dotyczy gracza I botów (oba idą przez pilotStep).

export interface GLoadEffects {
  /** Rezerwa fizjologiczna 0..1 (1 = świeży pilot, →0 = na granicy zaciemnienia). */
  reserve: number;
  /** Bieżący SUFIT dodatniego przeciążenia [G] po uwzględnieniu zmęczenia G. */
  gLimitG: number;
  /**
   * Przeciążenie faktycznie wyciągnięte w tym ticku [G] = min(żądane-po-kopercie,
   * gLimitG) dla dodatniego, bez zmian dla ujemnego. To ono idzie w siłę nośną.
   */
  nLimitedG: number;
  /** Intensywność zaciemnienia obrazu 0..1 (greyout → blackout) — dla klienta. */
  blackoutFactor: number;
}

/** Bufor efektów świeżego pilota; gLimitG/nLimitedG nadpisywane w pierwszym ticku. */
export function createGLoadEffects(): GLoadEffects {
  return { reserve: 1, gLimitG: 1, nLimitedG: 1, blackoutFactor: 0 };
}

export class GLoadMachine {
  /** Rezerwa fizjologiczna [0..1]; spada przy G > onsetG, wraca poniżej. */
  private reserve = 1;

  /** Po (re)spawnie: świeży pilot. */
  reset(): void {
    this.reserve = 1;
  }

  /**
   * Jeden tick. `nClampedG` = przeciążenie po kopercie (struktura + n_avail),
   * PRZED limitem od pilota. Metoda liczy sufit z bieżącej rezerwy, obcina do
   * niego dodatnie G (ujemne zostawia), zużywa rezerwę proporcjonalnie do
   * nadwyżki FAKTYCZNIE wyciągniętego G ponad onsetG, a poniżej onsetG ją
   * odbudowuje. Wynik (sufit, n po limicie, zaciemnienie) zapisuje do `effects`.
   */
  update(nClampedG: number, plane: PlaneConfig, dtS: number, effects: GLoadEffects): GLoadEffects {
    const cfg = plane.gTolerance;
    // sufit liczony z rezerwy SPRZED zużycia: pełna rezerwa → nMaxG (chwilowe G),
    // pusta → onsetG (sustained). Liniowo między nimi.
    const gLimitG = cfg.onsetG + this.reserve * (plane.nMaxG - cfg.onsetG);
    const nLimitedG = nClampedG > gLimitG ? gLimitG : nClampedG;

    // rezerwa ZAWSZE częściowo wraca, a nadwyżka G ją zżera. Równowaga przy
    // utrzymywanym wysokim G to TRWAŁE CZĘŚCIOWE szarzenie (sufit ~ onsetG +
    // recovery·toleranceGS), nie pełna ślepota — fizjologicznie sensowniej niż
    // sufit zatrzaśnięty na onsetG przy rezerwie 0 (artefakt „czerń na zawsze").
    this.reserve += cfg.recoveryRatePerS * dtS;
    const excessG = nLimitedG - cfg.onsetG;
    if (excessG > 0) this.reserve -= (excessG / cfg.toleranceGS) * dtS;
    this.reserve = this.reserve < 0 ? 0 : this.reserve > 1 ? 1 : this.reserve;

    effects.reserve = this.reserve;
    effects.gLimitG = gLimitG;
    effects.nLimitedG = nLimitedG;
    // zaciemnienie zaczyna się dopiero przy realnie niskiej rezerwie (greyoutReserve)
    effects.blackoutFactor =
      this.reserve >= cfg.greyoutReserve
        ? 0
        : (cfg.greyoutReserve - this.reserve) / cfg.greyoutReserve;
    return effects;
  }
}
