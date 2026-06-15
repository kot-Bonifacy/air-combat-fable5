// Lista uczestników walki na ekranie (lewy górny róg): kto wciąż w walce, a kto
// został już stracony (wyeliminowany z meczu). Stały panel odświeżany co klatkę,
// niezależny od renderera (czysty DOM/CSS, jak HUD i pozostałe nakładki). Status
// binarny: żywy / spadający wrak / oczekiwanie na respawn liczą się jako „w walce";
// dopiero wyczerpanie żyć (brak powrotu) daje „stracony".

/** Szerokość kolumny nazwy [znaki] — wyrównanie kolumn w monospace (white-space: pre). */
const NAME_PAD = 11;

export interface RosterRow {
  /** Nazwa pilota (np. „Ty”, „Bot 2”, „Wróg 1”). */
  name: string;
  /** Zestrzelenia wrogów w bieżącym meczu. */
  kills: number;
  /** Kolor wg frakcji (#rrggbb) — spójny z markerami i tabelą wyników. */
  colorCss: string;
  /** Wiersz gracza — wyróżnienie (pogrubienie). */
  isPlayer: boolean;
  /** true = wyeliminowany z meczu (brak żyć) → „stracony”. */
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
      'font:600 18px/1.3 monospace;color:#eaf3ff;white-space:pre;pointer-events:none;' +
      'text-shadow:-1px -1px 0 #000,1px -1px 0 #000,-1px 1px 0 #000,1px 1px 0 #000,0 0 6px rgba(0,0,0,0.9);';
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
      const status = row.isLost ? 'STRACONY' : 'w walce';
      el.textContent = `${row.name.padEnd(NAME_PAD)} ✕${String(row.kills).padStart(2)}   ${status}`;
      el.style.color = row.isLost ? '#7d8794' : row.colorCss;
      el.style.opacity = row.isLost ? '0.55' : '1';
      el.style.fontWeight = row.isPlayer ? '800' : '600';
    }

    this.root.style.display = rows.length > 0 ? 'flex' : 'none';
  }

  hide(): void {
    this.root.style.display = 'none';
  }
}
