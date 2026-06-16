// Lista uczestników walki na ekranie (lewy górny róg): nazwa, zestrzelenia, asysty.
// Stały panel odświeżany co klatkę, niezależny od renderera (czysty DOM/CSS, jak HUD
// i pozostałe nakładki). Status wyłącznie kolorem — bez tekstu: kolor frakcji = wciąż
// w walce (żywy / spadający wrak / oczekiwanie na respawn), wyszarzenie = wyeliminowany
// z meczu (wyczerpane życia, brak powrotu).

/** Szerokości kolumn [znaki] — wyrównanie w monospace (white-space: pre). */
const NAME_PAD = 11;
const KILLS_PAD = 3;
const ASSIST_PAD = 5;

export interface RosterRow {
  /** Nazwa pilota (np. „Ty”, „Bot 2”, „Wróg 1”). */
  name: string;
  /** Zestrzelenia wrogów w bieżącym meczu. */
  kills: number;
  /** Asysty (trafienie wroga, który zginął później) w bieżącym meczu. */
  assists: number;
  /** Kolor wg frakcji (#rrggbb) — spójny z markerami i tabelą wyników. */
  colorCss: string;
  /** Wiersz gracza — wyróżnienie (pogrubienie). */
  isPlayer: boolean;
  /** true = wyeliminowany z meczu (brak żyć) → wyszarzenie. */
  isLost: boolean;
}

export class RosterOverlay {
  private readonly root: HTMLElement;
  /** Wiersze DOM trzymane między klatkami — alokacja tylko przy zmianie składu. */
  private readonly rowEls: HTMLElement[] = [];

  constructor() {
    this.root = document.createElement('div');
    this.root.style.cssText =
      'position:fixed;top:14px;left:14px;display:none;flex-direction:column;gap:2px;' +
      'font:400 16px/1.4 monospace;color:#eaf3ff;white-space:pre;pointer-events:none;' +
      'text-shadow:0 1px 2px rgba(0,0,0,0.9),0 0 6px rgba(0,0,0,0.75);';
    document.body.appendChild(this.root);
  }

  /** Odświeża listę bieżącymi danymi (wołać co klatkę — dane są żywe). */
  update(rows: readonly RosterRow[]): void {
    // dopasuj liczbę wierszy DOM do danych (dodaj/usuń tylko przy zmianie składu)
    while (this.rowEls.length < rows.length) {
      const el = document.createElement('div');
      this.root.appendChild(el);
      this.rowEls.push(el);
    }
    while (this.rowEls.length > rows.length) {
      const el = this.rowEls.pop();
      if (el) this.root.removeChild(el);
    }

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const el = this.rowEls[i];
      if (!row || !el) continue;
      el.textContent =
        row.name.padEnd(NAME_PAD) +
        String(row.kills).padStart(KILLS_PAD) +
        String(row.assists).padStart(ASSIST_PAD);
      el.style.color = row.isLost ? '#7d8794' : row.colorCss;
      el.style.opacity = row.isLost ? '0.55' : '1';
      el.style.fontWeight = row.isPlayer ? '600' : '400';
    }

    this.root.style.display = rows.length > 0 ? 'flex' : 'none';
  }

  hide(): void {
    this.root.style.display = 'none';
  }
}
