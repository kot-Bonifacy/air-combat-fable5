import {
  scorePoints,
  type MatchEndReason,
  type MatchEndedMessage,
  type MatchMode,
  type StandingRow,
} from '@air-combat/shared';

// Nakładki pętli meczu (faza 13) jako vanilla DOM nad canvasem (jak lobby-ui — Preact
// dopiero, gdy vanilla zaboli). Dwie nakładki:
//  • ScoreboardOverlay — tabela wyników na Tab (zestrzelenia / śmierci / asysty / ping),
//    podświetlenie własnego wiersza, zegar meczu. Dane są AUTORYTETEM serwera (standings).
//  • ResultsOverlay — ekran końca meczu: zwycięzca + finalna tabela + rewanż / wyjście.
// Nicki innych graczy trafiają do DOM → ZAWSZE przez textContent (XSS). Moduł nie zna
// sieci: woła callbacki (rewanż/wyjście), a online-main spina go z NetClient.
//
// Faza 18 cz.2: render zależny od trybu (StandingsMessage.mode). W FFA — płaska lista
// rankingowa (jak f13). W drużynowym — grupowanie po frakcji z nagłówkiem drużyny (agregat
// Z/Ś/A + strefa), własna drużyna pierwsza; baner wyniku i powód zależne od trybu (eliminacja
// vs limit zestrzeleń), zwycięstwo wg `winningFaction` zamiast pojedynczego `winnerId`.

/** Kolory nagłówków drużyn na scoreboardzie (spójne z markerami foe/friend i ZoneBar). */
const TEAM_OWN_COLOR = '#5fe88a';
const TEAM_FOE_COLOR = '#ff6a4a';

/** Powód zakończenia jako tekst. P1 (2026-06-19): oba tryby eliminacyjne — `'score'` znaczy
 *  eliminację (drużynowy: przeciwna drużyna; FFA: ostatni ocalały), nie limit zestrzeleń. */
function reasonText(reason: MatchEndReason, mode: MatchMode): string {
  if (reason === 'zone') return 'przejęto strefę kontroli';
  if (mode === 'team') return 'przeciwna drużyna wyeliminowana';
  return 'ostatni ocalały';
}

/** Frakcje w kolejności renderu: własna drużyna pierwsza, potem rosnąco po numerze. */
function orderedFactions(rows: readonly StandingRow[], localFaction: number): number[] {
  const set = new Set<number>();
  for (const r of rows) set.add(r.faction);
  return [...set].sort((a, b) => {
    if (a === localFaction) return -1;
    if (b === localFaction) return 1;
    return a - b;
  });
}

/** Nagłówek drużyny: nazwa (kolor wg „swoja/wroga") + agregat Z/Ś/A i czas strefy (liczony raz). */
function teamHeaderRow(faction: number, localFaction: number, rows: readonly StandingRow[]): HTMLDivElement {
  const own = faction === localFaction;
  const tr = el('div', 'mui-row mui-team');
  const rankCell = el('span', 'mui-cell mui-rank');
  const nameCell = el('span', 'mui-cell mui-name');
  nameCell.textContent = own ? 'Twoja drużyna' : 'Wrogowie';
  nameCell.style.color = own ? TEAM_OWN_COLOR : TEAM_FOE_COLOR;
  let kills = 0;
  let deaths = 0;
  let assists = 0;
  let groundKills = 0;
  let zoneSeconds = 0;
  for (const r of rows) {
    kills += r.kills;
    deaths += r.deaths;
    assists += r.assists;
    groundKills += r.groundKills;
    zoneSeconds = Math.max(zoneSeconds, r.zoneSeconds); // strefa wspólna dla drużyny → bierzemy raz
  }
  const killsCell = el('span', 'mui-cell mui-num');
  killsCell.textContent = String(kills);
  const deathsCell = el('span', 'mui-cell mui-num');
  deathsCell.textContent = String(deaths);
  const assistsCell = el('span', 'mui-cell mui-num');
  assistsCell.textContent = String(assists);
  const zoneCell = el('span', 'mui-cell mui-num');
  zoneCell.textContent = formatClock(zoneSeconds);
  const pointsCell = el('span', 'mui-cell mui-num');
  pointsCell.textContent = String(scorePoints(kills, assists, zoneSeconds, groundKills));
  const pingCell = el('span', 'mui-cell mui-num');
  tr.append(rankCell, nameCell, killsCell, deathsCell, assistsCell, zoneCell, pointsCell, pingCell);
  return tr;
}

/**
 * Wiersze tabeli wyników gotowe do wstawienia. FFA: nagłówek + płaska lista (ranking serwera).
 * Drużynowy: nagłówek + dla każdej frakcji (własna pierwsza) nagłówek drużyny i jej piloci.
 */
function standingsNodes(
  rows: readonly StandingRow[],
  localId: number | null,
  localFaction: number,
  mode: MatchMode,
): HTMLElement[] {
  if (mode !== 'team') {
    return [headerRow(), ...rows.map((row, i) => standingRow(row, i + 1, localId))];
  }
  const nodes: HTMLElement[] = [headerRow()];
  for (const faction of orderedFactions(rows, localFaction)) {
    const teamRows = rows.filter((r) => r.faction === faction);
    nodes.push(teamHeaderRow(faction, localFaction, teamRows));
    teamRows.forEach((row, i) => nodes.push(standingRow(row, i + 1, localId)));
  }
  return nodes;
}

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
  const zoneCell = el('span', 'mui-cell mui-num');
  zoneCell.textContent = formatClock(row.zoneSeconds); // czas wyłącznej kontroli strefy (faza 17)
  const pointsCell = el('span', 'mui-cell mui-num');
  // punkty = zestrzelenia·100 + asysty·50 + zniszczone stanowiska·20 + sekundy strefy·1 (scorePoints)
  pointsCell.textContent = String(scorePoints(row.kills, row.assists, row.zoneSeconds, row.groundKills));
  const pingCell = el('span', 'mui-cell mui-num');
  pingCell.textContent = row.isBot ? 'BOT' : `${String(row.pingMs)}`;

  tr.append(rankCell, nameCell, killsCell, deathsCell, assistsCell, zoneCell, pointsCell, pingCell);
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
    ['Strefa', 'mui-num'],
    ['Pkt', 'mui-num'],
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
  private mode: MatchMode = 'ffa';
  private localFaction = 0;
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
  update(rows: StandingRow[], mode: MatchMode, localFaction: number): void {
    this.lastRows = rows;
    this.mode = mode;
    this.localFaction = localFaction;
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
    // P1 (2026-06-19): oba tryby eliminacyjne (bez limitu czasu/zestrzeleń) → tytuł bez zegara.
    this.titleEl.textContent =
      this.mode === 'team'
        ? 'TABELA WYNIKÓW — eliminacja drużynowa'
        : 'TABELA WYNIKÓW — eliminacja (każdy na każdego)';
    this.tableEl.replaceChildren(
      ...standingsNodes(this.lastRows, this.localId, this.localFaction, this.mode),
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
   * W trybie drużynowym zwycięstwo jest DRUŻYNOWE (`winningFaction`) — baner i tabela
   * mówią o drużynie, nie o pojedynczym pilocie.
   */
  show(msg: MatchEndedMessage, localId: number | null, localFaction: number, isHost: boolean): void {
    const { mode, winnerId, winningFaction, reason, rows } = msg;
    const reasonStr = reasonText(reason, mode);

    if (mode === 'team') {
      const won = winningFaction !== null && winningFaction === localFaction;
      this.bannerEl.classList.toggle('mui-banner-win', won);
      if (winningFaction === null) {
        this.bannerEl.textContent = `Remis (${reasonStr})`; // obustronna eliminacja w jednym ticku
      } else if (won) {
        this.bannerEl.textContent = `🏆 ZWYCIĘSTWO DRUŻYNY! (${reasonStr})`;
      } else {
        this.bannerEl.textContent = `Wygrywają Wrogowie (${reasonStr})`;
      }
    } else {
      const winner = winnerId !== null ? rows.find((r) => r.id === winnerId) : undefined;
      const won = winnerId !== null && winnerId === localId;
      this.bannerEl.classList.toggle('mui-banner-win', won);
      if (won) {
        this.bannerEl.textContent = `🏆 ZWYCIĘSTWO! (${reasonStr})`;
      } else if (winner) {
        this.bannerEl.textContent = `🏆 Wygrywa ${winner.nick} (${reasonStr})`;
      } else {
        this.bannerEl.textContent = `Koniec (${reasonStr})`;
      }
    }

    this.tableEl.replaceChildren(...standingsNodes(rows, localId, localFaction, mode));

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
.mui-row { display: grid; grid-template-columns: 32px 1fr 44px 44px 44px 56px 52px 56px; align-items: center; padding: 4px 8px; border-radius: 4px; }
.mui-head { color: #9fc4e6; border-bottom: 1px solid #2a3f54; border-radius: 0; font-size: 13px; }
.mui-row-self { background: rgba(200,88,31,0.28); }
.mui-team { background: rgba(40,60,80,0.4); font-weight: 700; border-top: 1px solid #2a3f54; margin-top: 4px; }
.mui-team .mui-name { padding-left: 2px; letter-spacing: 0.5px; }
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
