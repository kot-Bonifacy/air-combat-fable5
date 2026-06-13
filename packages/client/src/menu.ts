import { DIFFICULTY_LEVELS, type DifficultyLevel } from '@air-combat/shared';

// Ekran startowy i końcowy gry offline (faza-06.md krok 5). Czysty DOM/CSS —
// nakładka nad canvasem (pointer-events: auto), oddzielona od HUD-u. Wybór:
// pojedynek 1v1 (z poziomem trudności) albo trening (strzelnica z fazy 5).

export type GameModeChoice =
  | { mode: 'dogfight'; difficulty: DifficultyLevel }
  | { mode: 'training' };

const DIFFICULTY_LABELS: Record<DifficultyLevel, string> = {
  latwy: 'Łatwy',
  normalny: 'Normalny',
  trudny: 'Trudny',
};

function styleButton(b: HTMLButtonElement): void {
  b.style.cssText =
    'font:600 16px/1 monospace;padding:12px 22px;margin:6px;cursor:pointer;' +
    'color:#cde;background:rgba(40,60,80,0.9);border:1px solid #4a6c8c;border-radius:6px;';
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

  /** Ekran startowy: tytuł, wybór trudności, przyciski trybów. */
  showStart(): void {
    this.root.style.display = 'flex';
    this.panel.replaceChildren();

    const title = document.createElement('div');
    title.textContent = 'AIR COMBAT — Bitwa o Anglię';
    title.style.cssText = 'font:700 24px/1.2 monospace;color:#ffd24a;margin-bottom:6px;';
    const subtitle = document.createElement('div');
    subtitle.textContent = 'Spitfire Mk IA';
    subtitle.style.cssText = 'font:14px monospace;color:#9ab;margin-bottom:22px;';
    this.panel.append(title, subtitle);

    const diffLabel = document.createElement('div');
    diffLabel.textContent = 'Poziom trudności bota';
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

    const duel = document.createElement('button');
    duel.textContent = '▶ Pojedynek 1v1';
    styleButton(duel);
    duel.style.background = 'rgba(60,110,70,0.95)';
    duel.style.fontSize = '18px';
    duel.addEventListener('click', () => {
      this.hide();
      this.onStart({ mode: 'dogfight', difficulty: this.difficulty });
    });

    const training = document.createElement('button');
    training.textContent = 'Trening (strzelnica)';
    styleButton(training);
    training.addEventListener('click', () => {
      this.hide();
      this.onStart({ mode: 'training' });
    });

    this.panel.append(duel, training);

    const hint = document.createElement('div');
    hint.textContent = 'Po starcie kliknij w ekran, by przejąć sterowanie myszą.';
    hint.style.cssText = 'font:12px monospace;color:#778;margin-top:18px;';
    this.panel.append(hint);
  }

  private refreshDiffButtons(): void {
    for (const [lvl, b] of this.diffButtons) {
      const active = lvl === this.difficulty;
      b.style.background = active ? 'rgba(70,120,160,0.95)' : 'rgba(40,60,80,0.9)';
      b.style.borderColor = active ? '#8fd0ff' : '#4a6c8c';
    }
  }

  /** Ekran wyniku pojedynku. */
  showResult(playerWon: boolean, playerScore: number, enemyScore: number): void {
    this.root.style.display = 'flex';
    this.panel.replaceChildren();

    const verdict = document.createElement('div');
    verdict.textContent = playerWon ? 'ZWYCIĘSTWO' : 'PORAŻKA';
    verdict.style.cssText =
      `font:700 34px/1.2 monospace;margin-bottom:10px;color:${playerWon ? '#7ef08a' : '#ff6a4a'};` +
      `text-shadow:0 0 14px ${playerWon ? 'rgba(120,255,140,0.6)' : 'rgba(255,90,60,0.6)'};`;
    const score = document.createElement('div');
    score.textContent = `Ty ${String(playerScore)} : ${String(enemyScore)} Bot`;
    score.style.cssText = 'font:600 20px monospace;color:#cde;margin-bottom:24px;';
    this.panel.append(verdict, score);

    const back = document.createElement('button');
    back.textContent = 'Menu';
    styleButton(back);
    back.style.fontSize = '18px';
    back.addEventListener('click', () => this.showStart());
    this.panel.append(back);
  }
}
