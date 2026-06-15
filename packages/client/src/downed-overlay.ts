// Nakładka decyzji gracza po zestrzeleniu w powietrzu (faza 7+). Gdy samolot gracza
// staje się spadającym wrakiem, gracz może NIM STEROWAĆ (klawiatura) albo kliknąć
// jedną z akcji: przejść w tryb obserwatora (jeśli walczą jeszcze sojusznicze
// maszyny) lub zakończyć misję. Czysty DOM/CSS u dołu ekranu, pod ekranem wyniku
// (z-index niższy niż menu), pointer-events: auto — kursor jest wolny (wrak sterowany
// klawiaturą), więc przyciski są klikalne.

function styleActionButton(b: HTMLButtonElement, accent: string): void {
  b.style.cssText =
    'font:600 15px/1 monospace;padding:11px 20px;margin:0 6px;cursor:pointer;' +
    `color:#eef;background:rgba(20,32,46,0.92);border:1px solid ${accent};border-radius:6px;`;
}

export class DownedOverlay {
  private readonly root: HTMLElement;
  private readonly spectateBtn: HTMLButtonElement;

  constructor(onSpectate: () => void, onStandings: () => void, onEnd: () => void) {
    this.root = document.createElement('div');
    this.root.style.cssText =
      'position:fixed;left:50%;bottom:14%;transform:translateX(-50%);z-index:8;' +
      'display:none;flex-direction:column;align-items:center;gap:10px;' +
      'font-family:monospace;text-align:center;pointer-events:auto;';

    const title = document.createElement('div');
    title.textContent = 'ZESTRZELONY';
    title.style.cssText =
      'font:700 20px/1 monospace;color:#ff6a4a;letter-spacing:2px;' +
      'text-shadow:0 0 12px rgba(255,90,60,0.6);';

    const hint = document.createElement('div');
    hint.textContent = 'steruj wrakiem: W/S/A/D, Q/E   •   Spacja: ogień   — albo:';
    hint.style.cssText = 'font:12px monospace;color:#9ab;';

    const buttons = document.createElement('div');
    buttons.style.cssText = 'display:flex;justify-content:center;';

    this.spectateBtn = document.createElement('button');
    this.spectateBtn.textContent = 'TRYB OBSERWATORA';
    styleActionButton(this.spectateBtn, '#4a8c6c');
    this.spectateBtn.addEventListener('click', onSpectate);

    const standingsBtn = document.createElement('button');
    standingsBtn.textContent = 'TABELA WYNIKÓW';
    styleActionButton(standingsBtn, '#4a6c8c');
    standingsBtn.addEventListener('click', onStandings);

    const endBtn = document.createElement('button');
    endBtn.textContent = 'ZAKOŃCZ MISJĘ';
    styleActionButton(endBtn, '#8c4a4a');
    endBtn.addEventListener('click', onEnd);

    buttons.append(this.spectateBtn, standingsBtn, endBtn);
    this.root.append(title, hint, buttons);
    document.body.appendChild(this.root);
  }

  /** Pokazuje nakładkę; `canSpectate` decyduje, czy dostępny jest tryb obserwatora. */
  show(canSpectate: boolean): void {
    this.spectateBtn.style.display = canSpectate ? 'inline-block' : 'none';
    this.root.style.display = 'flex';
  }

  hide(): void {
    this.root.style.display = 'none';
  }
}
