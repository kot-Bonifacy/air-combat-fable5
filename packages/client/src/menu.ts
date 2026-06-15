import {
  DIFFICULTY_LEVELS,
  MAX_BOTS,
  ZONE_CAPTURE_SECONDS,
  type DifficultyLevel,
} from '@air-combat/shared';

// Ekran startowy i końcowy gry offline (faza-06.md krok 5; faza 7: tryby multi).
// Czysty DOM/CSS — nakładka nad canvasem (pointer-events: auto), oddzielona od
// HUD-u. Tryby walki:
//   • FFA (wolna amerykanka) — gracz vs N niezależnych botów (każdy sam za siebie),
//   • drużynowy — gracz + boty-skrzydłowi vs boty-wrogowie (po `perTeam` na stronę).
// Liczbę przeciwników/skrzydłowych wybiera stepper; oba tryby są eliminacyjne
// (jedno życie na uczestnika — zestrzelenie eliminuje).

export type GameModeChoice =
  | { mode: 'ffa'; difficulty: DifficultyLevel; botCount: number }
  | { mode: 'team'; difficulty: DifficultyLevel; perTeam: number };

/** Wiersz pilota w tabeli wyników (gotowy do renderu — kolor i etykiety policzone w kliencie). */
export interface ResultPilotRow {
  rank: number;
  name: string;
  /** Kolor CSS kropki = kolor drużyny (gracz złoty, sojusznik zielony, wróg czerwony). */
  color: string;
  kills: number;
  /** Asysty: trafienia wrogów, którzy zginęli później. */
  assists: number;
  /** Czas w strefie „m:ss" albo „—". */
  zoneLabel: string;
  points: number;
  isPlayer: boolean;
}

/** Wiersz drużyny (tylko tryb drużynowy — strefa policzona raz). */
export interface ResultTeamRow {
  name: string;
  color: string;
  kills: number;
  assists: number;
  zoneLabel: string;
  points: number;
  isPlayerTeam: boolean;
}

/** Komplet danych ekranu wyniku przekazywany z gry do menu. */
export interface ResultData {
  playerWon: boolean;
  /** Powód zakończenia, np. „przejąłeś strefę". */
  headline: string;
  modeLabel: string;
  difficulty: string;
  pilots: ResultPilotRow[];
  /** Pusta w FFA; w drużynowym 2 wiersze. */
  teams: ResultTeamRow[];
}

/** Komórka tabeli wyników o zadanym wyrównaniu. */
function resultCell(text: string, align: 'left' | 'center' | 'right'): HTMLTableCellElement {
  const c = document.createElement('td');
  c.textContent = text;
  c.style.cssText = `text-align:${align};padding:5px 14px;white-space:nowrap;`;
  return c;
}

/** Wiersz nagłówka tabeli z par (tekst, wyrównanie). */
function resultHeader(cols: readonly (readonly [string, 'left' | 'center' | 'right'])[]): HTMLTableRowElement {
  const tr = document.createElement('tr');
  for (const [txt, align] of cols) {
    const th = document.createElement('th');
    th.textContent = txt;
    th.style.cssText =
      `text-align:${align};padding:5px 14px;color:#89a;font-weight:600;` +
      'border-bottom:1px solid #2c4a66;';
    tr.append(th);
  }
  return tr;
}

/** Komórka „nazwa" z kropką w kolorze drużyny + tekstem. */
function nameCell(name: string, color: string, emphasize: boolean): HTMLTableCellElement {
  const td = document.createElement('td');
  td.style.cssText =
    'text-align:left;padding:5px 14px;white-space:nowrap;' + (emphasize ? 'font-weight:700;color:#fff;' : '');
  const dot = document.createElement('span');
  dot.style.cssText =
    'display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:8px;' +
    `background:${color};box-shadow:0 0 6px ${color};`;
  td.append(dot, document.createTextNode(name));
  return td;
}

/** Komórka „punkty" — pogrubiona, złota. */
function pointsCell(points: number): HTMLTableCellElement {
  const td = resultCell(String(points), 'right');
  td.style.cssText += 'font-weight:700;color:#ffd24a;';
  return td;
}

/** Tytuł sekcji wyniku drużyn (wspólny: ekran końcowy i żywa nakładka). */
export function teamTableTitle(): HTMLElement {
  const el = document.createElement('div');
  el.textContent = 'WYNIK DRUŻYN';
  el.style.cssText = 'font:600 13px monospace;color:#89a;letter-spacing:1px;margin:18px 0 2px;';
  return el;
}

/** Tabela pilotów: #, pilot (kropka drużyny), zestrzelenia, asysty, strefa, punkty. */
export function renderPilotScoreTable(rows: readonly ResultPilotRow[]): HTMLElement {
  const table = document.createElement('table');
  table.style.cssText = 'border-collapse:collapse;min-width:30em;font:14px monospace;color:#cde;';
  table.append(
    resultHeader([
      ['#', 'center'],
      ['Pilot', 'left'],
      ['Zestrz.', 'center'],
      ['Asysty', 'center'],
      ['Strefa', 'center'],
      ['Punkty', 'right'],
    ]),
  );
  for (const r of rows) {
    const tr = document.createElement('tr');
    if (r.isPlayer) tr.style.background = 'rgba(255,210,74,0.10)';
    const rankTd = resultCell(String(r.rank), 'center');
    rankTd.style.color = '#9ab';
    const assistTd = resultCell(String(r.assists), 'center');
    assistTd.style.color = '#9ab';
    const zoneTd = resultCell(r.zoneLabel, 'center');
    zoneTd.style.color = '#9ab';
    tr.append(
      rankTd,
      nameCell(r.name, r.color, r.isPlayer),
      resultCell(String(r.kills), 'center'),
      assistTd,
      zoneTd,
      pointsCell(r.points),
    );
    table.append(tr);
  }
  return table;
}

/** Tabela drużyn: drużyna (kropka), zestrzelenia, asysty, strefa, punkty (strefa liczona raz). */
export function renderTeamScoreTable(rows: readonly ResultTeamRow[]): HTMLElement {
  const table = document.createElement('table');
  table.style.cssText = 'border-collapse:collapse;min-width:30em;font:14px monospace;color:#cde;';
  table.append(
    resultHeader([
      ['Drużyna', 'left'],
      ['Zestrz.', 'center'],
      ['Asysty', 'center'],
      ['Strefa', 'center'],
      ['Punkty', 'right'],
    ]),
  );
  for (const r of rows) {
    const tr = document.createElement('tr');
    if (r.isPlayerTeam) tr.style.background = 'rgba(255,210,74,0.08)';
    const assistTd = resultCell(String(r.assists), 'center');
    assistTd.style.color = '#9ab';
    const zoneTd = resultCell(r.zoneLabel, 'center');
    zoneTd.style.color = '#9ab';
    tr.append(
      nameCell(r.name, r.color, r.isPlayerTeam),
      resultCell(String(r.kills), 'center'),
      assistTd,
      zoneTd,
      pointsCell(r.points),
    );
    table.append(tr);
  }
  return table;
}

const DIFFICULTY_LABELS: Record<DifficultyLevel, string> = {
  latwy: 'Łatwy',
  normalny: 'Normalny',
  trudny: 'Trudny',
};

/** Maksymalny rozmiar drużyny: oba zespoły razem ≤ gracz + MAX_BOTS samolotów. */
const MAX_PER_TEAM = Math.floor((MAX_BOTS + 1) / 2);

function styleButton(b: HTMLButtonElement): void {
  b.style.cssText =
    'font:600 16px/1 monospace;padding:12px 22px;margin:6px;cursor:pointer;' +
    'color:#cde;background:rgba(40,60,80,0.9);border:1px solid #4a6c8c;border-radius:6px;';
}

/** Stepper „− N +" zwracający bieżącą wartość; clamp do [min,max]. */
function makeStepper(min: number, max: number, initial: number): { el: HTMLElement; get(): number } {
  let value = Math.min(max, Math.max(min, initial));
  const row = document.createElement('div');
  row.style.cssText = 'display:inline-flex;align-items:center;gap:8px;';
  const valueEl = document.createElement('span');
  valueEl.style.cssText = 'font:700 18px monospace;color:#ffd24a;min-width:1.5em;text-align:center;';
  const mkBtn = (txt: string, delta: number): HTMLButtonElement => {
    const b = document.createElement('button');
    b.textContent = txt;
    b.style.cssText =
      'font:700 16px/1 monospace;width:30px;height:30px;cursor:pointer;color:#cde;' +
      'background:rgba(40,60,80,0.9);border:1px solid #4a6c8c;border-radius:6px;';
    b.addEventListener('click', () => {
      value = Math.min(max, Math.max(min, value + delta));
      valueEl.textContent = String(value);
    });
    return b;
  };
  valueEl.textContent = String(value);
  row.append(mkBtn('−', -1), valueEl, mkBtn('+', +1));
  return { el: row, get: () => value };
}

export class GameMenu {
  private readonly root: HTMLElement;
  private readonly panel: HTMLElement;
  private difficulty: DifficultyLevel = 'normalny';
  private readonly diffButtons = new Map<DifficultyLevel, HTMLButtonElement>();

  constructor(private readonly onStart: (choice: GameModeChoice) => void) {
    this.root = document.createElement('div');
    this.root.style.cssText =
      'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;' +
      'background:rgba(0,0,0,0.62);z-index:10;font-family:monospace;';
    this.panel = document.createElement('div');
    this.panel.style.cssText =
      'display:flex;flex-direction:column;align-items:center;text-align:center;' +
      'background:rgba(8,16,26,0.92);padding:32px 40px;border-radius:10px;border:1px solid #2c4a66;';
    this.root.appendChild(this.panel);
    document.body.appendChild(this.root);
  }

  get visible(): boolean {
    return this.root.style.display !== 'none';
  }

  hide(): void {
    this.root.style.display = 'none';
  }

  /** Ekran startowy: tytuł, wybór trudności, tryby walki (FFA/drużynowy). */
  showStart(): void {
    this.root.style.display = 'flex';
    this.panel.replaceChildren();
    this.panel.style.background = 'rgba(8,16,26,0.92)'; // przywróć po przezroczystym ekranie wyniku

    const title = document.createElement('div');
    title.textContent = 'AIR COMBAT — Bitwa o Anglię';
    title.style.cssText = 'font:700 24px/1.2 monospace;color:#ffd24a;margin-bottom:6px;';
    const subtitle = document.createElement('div');
    subtitle.textContent = 'Spitfire Mk IA';
    subtitle.style.cssText = 'font:14px monospace;color:#9ab;margin-bottom:22px;';
    this.panel.append(title, subtitle);

    const diffLabel = document.createElement('div');
    diffLabel.textContent = 'Poziom trudności botów';
    diffLabel.style.cssText = 'font:13px monospace;color:#9ab;margin-bottom:4px;';
    this.panel.append(diffLabel);

    const diffRow = document.createElement('div');
    diffRow.style.cssText = 'display:flex;margin-bottom:22px;';
    this.diffButtons.clear();
    for (const lvl of DIFFICULTY_LEVELS) {
      const b = document.createElement('button');
      b.textContent = DIFFICULTY_LABELS[lvl];
      styleButton(b);
      b.addEventListener('click', () => {
        this.difficulty = lvl;
        this.refreshDiffButtons();
      });
      this.diffButtons.set(lvl, b);
      diffRow.append(b);
    }
    this.panel.append(diffRow);
    this.refreshDiffButtons();

    // FFA: stepper liczby botów (1 = klasyczny pojedynek 1v1) + start
    this.panel.append(
      this.modeRow('Wolna amerykanka (FFA)', 'Gracz vs N botów — każdy sam za siebie', 1, MAX_BOTS, 3, (n) => {
        this.hide();
        this.onStart({ mode: 'ffa', difficulty: this.difficulty, botCount: n });
      }),
    );

    // Drużynowy: stepper liczby samolotów na drużynę (gracz + skrzydłowi vs wrogowie)
    this.panel.append(
      this.modeRow('Drużynowy (N vs N)', 'Ty + skrzydłowi vs wrogowie; friendly fire ON', 1, MAX_PER_TEAM, 2, (n) => {
        this.hide();
        this.onStart({ mode: 'team', difficulty: this.difficulty, perTeam: n });
      }),
    );

    const elimNote = document.createElement('div');
    const zoneMin = Math.round(ZONE_CAPTURE_SECONDS / 60);
    elimNote.textContent =
      `Cel: utrzymaj STREFĘ nad górą (2 km) przez ${String(zoneMin)} min ` +
      `ALBO wybij wrogów. Start na obrzeżach; jedno życie — zestrzelenie eliminuje.`;
    elimNote.style.cssText = 'font:12px monospace;color:#9ab;margin:6px 0 14px;max-width:32em;';
    this.panel.append(elimNote);

    const hint = document.createElement('div');
    hint.textContent = 'Po starcie kliknij w ekran, by przejąć sterowanie myszą.';
    hint.style.cssText = 'font:12px monospace;color:#778;margin-top:18px;';
    this.panel.append(hint);
  }

  /** Wiersz trybu: opis + stepper liczby + przycisk startu. */
  private modeRow(
    label: string,
    desc: string,
    min: number,
    max: number,
    initial: number,
    start: (n: number) => void,
  ): HTMLElement {
    const wrap = document.createElement('div');
    wrap.style.cssText =
      'display:flex;flex-direction:column;align-items:center;gap:6px;margin:6px 0;' +
      'padding:12px 16px;border:1px solid #2c4a66;border-radius:8px;width:100%;box-sizing:border-box;';
    const head = document.createElement('div');
    head.textContent = label;
    head.style.cssText = 'font:600 16px monospace;color:#cde;';
    const sub = document.createElement('div');
    sub.textContent = desc;
    sub.style.cssText = 'font:11px monospace;color:#89a;';
    const controls = document.createElement('div');
    controls.style.cssText = 'display:flex;align-items:center;gap:14px;margin-top:4px;';
    const stepper = makeStepper(min, max, initial);
    const btn = document.createElement('button');
    btn.textContent = '▶ Start';
    styleButton(btn);
    btn.style.background = 'rgba(60,110,70,0.95)';
    btn.addEventListener('click', () => start(stepper.get()));
    controls.append(stepper.el, btn);
    wrap.append(head, sub, controls);
    return wrap;
  }

  private refreshDiffButtons(): void {
    for (const [lvl, b] of this.diffButtons) {
      const active = lvl === this.difficulty;
      b.style.background = active ? 'rgba(70,120,160,0.95)' : 'rgba(40,60,80,0.9)';
      b.style.borderColor = active ? '#8fd0ff' : '#4a6c8c';
    }
  }

  /** Ekran wyniku meczu: werdykt + półprzezroczysta tabela (per pilot, plus drużyny). */
  showResult(data: ResultData): void {
    this.root.style.display = 'flex';
    this.panel.replaceChildren();
    // bardziej przezroczysty panel: tabela wyników „nakłada się" na zastygłą scenę
    this.panel.style.background = 'rgba(8,16,26,0.80)';

    const verdict = document.createElement('div');
    verdict.textContent = data.playerWon ? 'ZWYCIĘSTWO' : 'PORAŻKA';
    verdict.style.cssText =
      `font:700 34px/1.2 monospace;margin-bottom:4px;color:${data.playerWon ? '#7ef08a' : '#ff6a4a'};` +
      `text-shadow:0 0 14px ${data.playerWon ? 'rgba(120,255,140,0.6)' : 'rgba(255,90,60,0.6)'};`;

    const sub = document.createElement('div');
    sub.textContent = `${data.modeLabel}   •   ${data.headline}   •   [${data.difficulty}]`;
    sub.style.cssText = 'font:13px monospace;color:#9ab;margin-bottom:18px;';
    this.panel.append(verdict, sub);

    this.panel.append(renderPilotScoreTable(data.pilots));

    if (data.teams.length > 0) {
      this.panel.append(teamTableTitle(), renderTeamScoreTable(data.teams));
    }

    const back = document.createElement('button');
    back.textContent = 'Menu';
    styleButton(back);
    back.style.cssText += 'font-size:18px;margin-top:22px;';
    back.addEventListener('click', () => this.showStart());
    this.panel.append(back);
  }

}
