import {
  renderPilotScoreTable,
  renderTeamScoreTable,
  teamTableTitle,
  type ResultPilotRow,
  type ResultTeamRow,
} from './menu';

// Żywa nakładka tabeli wyników (faza 7+). Inaczej niż terminalny ekran wyniku
// (menu.showResult) NIE kończy meczu — gracz zestrzelony w FFA może przełączać się
// między obserwacją trwającej walki a bieżącą tabelą (klawisz Tab albo przyciski).
// Mecz toczy się pod spodem; panel jest tylko półprzezroczystą warstwą DOM. Reużywa
// tych samych renderów tabel co ekran końcowy (jedno źródło wyglądu).

function styleOverlayButton(b: HTMLButtonElement, accent: string): void {
  b.style.cssText =
    'font:600 15px/1 monospace;padding:11px 20px;margin:0 6px;cursor:pointer;' +
    `color:#eef;background:rgba(20,32,46,0.92);border:1px solid ${accent};border-radius:6px;`;
}

export class StandingsOverlay {
  private readonly root: HTMLElement;
  private readonly panel: HTMLElement;
  private readonly onResume: () => void;
  private readonly onEnd: () => void;
  private visible = false;

  constructor(onResume: () => void, onEnd: () => void) {
    this.onResume = onResume;
    this.onEnd = onEnd;
    this.root = document.createElement('div');
    // z-index 9: nad HUD-em i nakładką zestrzelenia (8), pod menu startowym/wyniku (10)
    this.root.style.cssText =
      'position:fixed;inset:0;display:none;align-items:center;justify-content:center;z-index:9;' +
      'background:rgba(0,0,0,0.45);font-family:monospace;';
    this.panel = document.createElement('div');
    this.panel.style.cssText =
      'display:flex;flex-direction:column;align-items:center;text-align:center;' +
      'background:rgba(8,16,26,0.80);padding:26px 36px;border-radius:10px;border:1px solid #2c4a66;';
    this.root.appendChild(this.panel);
    document.body.appendChild(this.root);
  }

  get isOpen(): boolean {
    return this.visible;
  }

  /** Pokazuje tabelę z bieżącymi danymi (wywoływać przy każdym otwarciu — dane są żywe). */
  show(pilots: readonly ResultPilotRow[], teams: readonly ResultTeamRow[]): void {
    this.panel.replaceChildren();

    const title = document.createElement('div');
    title.textContent = 'TABELA WYNIKÓW';
    title.style.cssText =
      'font:700 22px/1 monospace;color:#ffd24a;letter-spacing:2px;margin-bottom:4px;';
    const hint = document.createElement('div');
    hint.textContent = 'mecz trwa — [Tab] zamknij tabelę';
    hint.style.cssText = 'font:12px monospace;color:#9ab;margin-bottom:16px;';
    this.panel.append(title, hint, renderPilotScoreTable(pilots));

    if (teams.length > 0) {
      this.panel.append(teamTableTitle(), renderTeamScoreTable(teams));
    }

    const buttons = document.createElement('div');
    buttons.style.cssText = 'display:flex;justify-content:center;margin-top:22px;';
    const resumeBtn = document.createElement('button');
    resumeBtn.textContent = 'ZAMKNIJ TABELĘ';
    styleOverlayButton(resumeBtn, '#4a8c6c');
    resumeBtn.addEventListener('click', () => this.onResume());
    const endBtn = document.createElement('button');
    endBtn.textContent = 'ZAKOŃCZ MISJĘ';
    styleOverlayButton(endBtn, '#8c4a4a');
    endBtn.addEventListener('click', () => this.onEnd());
    buttons.append(resumeBtn, endBtn);
    this.panel.append(buttons);

    this.root.style.display = 'flex';
    this.visible = true;
  }

  hide(): void {
    this.root.style.display = 'none';
    this.visible = false;
  }
}
