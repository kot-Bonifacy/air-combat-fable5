import type { MatchEndReason, StandingRow } from '@air-combat/shared';

// Nakładki pętli meczu (faza 13) jako vanilla DOM nad canvasem (jak lobby-ui — Preact
// dopiero, gdy vanilla zaboli). Dwie nakładki:
//  • ScoreboardOverlay — tabela wyników na Tab (zestrzelenia / śmierci / asysty / ping),
//    podświetlenie własnego wiersza, zegar meczu. Dane są AUTORYTETEM serwera (standings).
//  • ResultsOverlay — ekran końca meczu: zwycięzca + finalna tabela + rewanż / wyjście.
// Nicki innych graczy trafiają do DOM → ZAWSZE przez textContent (XSS). Moduł nie zna
// sieci: woła callbacki (rewanż/wyjście), a online-main spina go z NetClient.

/** Formatuje sekundy jako MM:SS (zegar meczu). */
function formatClock(totalS: number): string {
  const s = Math.max(0, Math.floor(totalS));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${String(m)}:${String(sec).padStart(2, '0')}`;
}

/** Buduje jeden wiersz tabeli wyników (wspólny dla scoreboardu i ekranu końca). */
function standingRow(row: StandingRow, rank: number, localId: number | null): HTMLDivElement {
  const tr = el('div', 'mui-row');
  if (row.id === localId) tr.classList.add('mui-row-self');

  const rankCell = el('span', 'mui-cell mui-rank');
  rankCell.textContent = String(rank);
  const nameCell = el('span', 'mui-cell mui-name');
  nameCell.textContent = row.nick; // textContent → bez interpretacji HTML (XSS)
  const killsCell = el('span', 'mui-cell mui-num');
  killsCell.textContent = String(row.kills);
  const deathsCell = el('span', 'mui-cell mui-num');
  deathsCell.textContent = String(row.deaths);
  const assistsCell = el('span', 'mui-cell mui-num');
  assistsCell.textContent = String(row.assists);
  const pingCell = el('span', 'mui-cell mui-num');
  pingCell.textContent = row.isBot ? 'BOT' : `${String(row.pingMs)}`;

  tr.append(rankCell, nameCell, killsCell, deathsCell, assistsCell, pingCell);
  return tr;
}

/** Nagłówek kolumn tabeli wyników. */
function headerRow(): HTMLDivElement {
  const head = el('div', 'mui-row mui-head');
  const cells: [string, string][] = [
    ['#', 'mui-rank'],
    ['Pilot', 'mui-name'],
    ['Z', 'mui-num'],
    ['Ś', 'mui-num'],
    ['A', 'mui-num'],
    ['ping', 'mui-num'],
  ];
  for (const [text, cls] of cells) {
    const c = el('span', `mui-cell ${cls}`);
    c.textContent = text;
    head.append(c);
  }
  return head;
}

export class ScoreboardOverlay {
  private readonly root: HTMLDivElement;
  private readonly titleEl: HTMLDivElement;
  private readonly tableEl: HTMLDivElement;
  private lastRows: StandingRow[] = [];
  private lastScoreLimit = 0;
  private lastTimeLeftS = 0;
  private localId: number | null = null;
  private shown = false;

  constructor() {
    injectStyles();
    this.root = el('div', 'mui-scoreboard');
    const panel = el('div', 'mui-panel');
    this.titleEl = el('div', 'mui-title');
    this.tableEl = el('div', 'mui-table');
    panel.append(this.titleEl, this.tableEl);
    this.root.append(panel);
    document.body.appendChild(this.root);
  }

  get visible(): boolean {
    return this.shown;
  }

  setLocalId(id: number | null): void {
    this.localId = id;
  }

  /** Aktualizuje dane (z wiadomości standings); przerysowuje, jeśli widoczne. */
  update(rows: StandingRow[], scoreLimit: number, timeLeftS: number): void {
    this.lastRows = rows;
    this.lastScoreLimit = scoreLimit;
    this.lastTimeLeftS = timeLeftS;
    if (this.shown) this.render();
  }

  show(): void {
    this.shown = true;
    this.render();
    this.root.classList.add('show');
  }

  hide(): void {
    this.shown = false;
    this.root.classList.remove('show');
  }

  toggle(): void {
    if (this.shown) this.hide();
    else this.show();
  }

  private render(): void {
    this.titleEl.textContent = `TABELA WYNIKÓW — do ${String(this.lastScoreLimit)} zestrzeleń · pozostało ${formatClock(this.lastTimeLeftS)}`;
    this.tableEl.replaceChildren(
      headerRow(),
      ...this.lastRows.map((row, i) => standingRow(row, i + 1, this.localId)),
    );
  }
}

export interface ResultsActions {
  onRematch(): void;
  onLeave(): void;
}

export class ResultsOverlay {
  private readonly root: HTMLDivElement;
  private readonly bannerEl: HTMLDivElement;
  private readonly tableEl: HTMLDivElement;
  private readonly hintEl: HTMLDivElement;
  private readonly rematchBtn: HTMLButtonElement;

  constructor(private readonly actions: ResultsActions) {
    injectStyles();
    this.root = el('div', 'mui-results');
    const panel = el('div', 'mui-panel mui-results-panel');
    const title = el('div', 'mui-title');
    title.textContent = 'KONIEC MECZU';
    this.bannerEl = el('div', 'mui-banner');
    this.tableEl = el('div', 'mui-table');
    this.hintEl = el('div', 'mui-hint');
    this.rematchBtn = button('Rewanż', 'mui-btn mui-btn-primary', () => this.actions.onRematch());
    const leaveBtn = button('Do lobby', 'mui-btn', () => this.actions.onLeave());
    const btnRow = el('div', 'mui-btn-row');
    btnRow.append(this.rematchBtn, leaveBtn);
    panel.append(title, this.bannerEl, this.tableEl, this.hintEl, btnRow);
    this.root.append(panel);
    document.body.appendChild(this.root);
  }

  /**
   * Pokazuje ekran wyników. `isHost` decyduje o dostępności przycisku rewanżu (rewanż
   * startuje tylko host); pozostali czekają, aż host zagra ponownie (albo wychodzą).
   */
  show(
    winnerId: number | null,
    reason: MatchEndReason,
    rows: StandingRow[],
    localId: number | null,
    isHost: boolean,
  ): void {
    const winner = winnerId !== null ? rows.find((r) => r.id === winnerId) : undefined;
    const won = winnerId !== null && winnerId === localId;
    const reasonText = reason === 'score' ? 'osiągnięto limit zestrzeleń' : 'upłynął czas meczu';
    this.bannerEl.classList.toggle('mui-banner-win', won);
    if (won) {
      this.bannerEl.textContent = `🏆 ZWYCIĘSTWO! (${reasonText})`;
    } else if (winner) {
      this.bannerEl.textContent = `🏆 Wygrywa ${winner.nick} (${reasonText})`;
    } else {
      this.bannerEl.textContent = `Koniec (${reasonText})`;
    }

    this.tableEl.replaceChildren(
      headerRow(),
      ...rows.map((row, i) => standingRow(row, i + 1, localId)),
    );

    this.rematchBtn.style.display = isHost ? '' : 'none';
    this.hintEl.textContent = isHost
      ? 'Zagraj rewanż albo wróć do lobby.'
      : 'Czekaj, aż host zagra rewanż… (albo wróć do lobby)';
    this.root.classList.add('show');
  }

  hide(): void {
    this.root.classList.remove('show');
  }
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function button(label: string, className: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = className;
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

let stylesInjected = false;
function injectStyles(): void {
  if (stylesInjected) return;
  stylesInjected = true;
  const style = document.createElement('style');
  style.textContent = MATCH_UI_CSS;
  document.head.appendChild(style);
}

const MATCH_UI_CSS = `
.mui-scoreboard, .mui-results {
  position: fixed; inset: 0; display: none;
  align-items: center; justify-content: center;
  font: 15px/1.4 monospace; color: #eaf3ff; pointer-events: none;
}
.mui-scoreboard { z-index: 44; }
.mui-results { z-index: 46; background: rgba(7,13,21,0.72); pointer-events: auto; }
.mui-scoreboard.show, .mui-results.show { display: flex; }
.mui-panel {
  pointer-events: auto;
  min-width: 460px; max-width: 92vw;
  padding: 20px 26px; border-radius: 12px;
  background: rgba(7,13,21,0.88); border: 1px solid #2a3f54;
  box-shadow: 0 10px 40px rgba(0,0,0,0.55);
  display: flex; flex-direction: column; gap: 12px;
}
.mui-title { font: 700 18px monospace; letter-spacing: 1px; color: #ffd24a; text-align: center; }
.mui-table { display: flex; flex-direction: column; gap: 2px; }
.mui-row { display: grid; grid-template-columns: 32px 1fr 44px 44px 44px 56px; align-items: center; padding: 4px 8px; border-radius: 4px; }
.mui-head { color: #9fc4e6; border-bottom: 1px solid #2a3f54; border-radius: 0; font-size: 13px; }
.mui-row-self { background: rgba(200,88,31,0.28); }
.mui-cell { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mui-rank { color: #9fc4e6; }
.mui-name { padding-right: 8px; }
.mui-num { text-align: right; font-variant-numeric: tabular-nums; }
.mui-results-panel { min-width: 480px; }
.mui-banner { text-align: center; font: 700 22px monospace; color: #eaf3ff; padding: 6px 0; }
.mui-banner-win { color: #ffd24a; text-shadow: 0 2px 10px rgba(255,210,74,0.5); }
.mui-hint { text-align: center; color: #9fc4e6; font-size: 13px; }
.mui-btn-row { display: flex; gap: 10px; justify-content: center; margin-top: 4px; }
.mui-btn {
  font: 600 15px/1 monospace; padding: 11px 22px; cursor: pointer; min-width: 150px;
  color: #eaf3ff; background: rgba(40,60,80,0.92);
  border: 1px solid #4a6c8c; border-radius: 6px;
}
.mui-btn:hover { background: rgba(56,82,108,0.95); }
.mui-btn-primary { background: #c8581f; border-color: #e2772f; color: #fff; }
.mui-btn-primary:hover { background: #db6322; }
`;
