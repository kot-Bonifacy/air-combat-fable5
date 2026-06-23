// Menu pauzy wywoływane klawiszem Esc w trakcie meczu (życzenie usera 2026-06-23: zakończenie
// misji w dowolnym momencie i powrót do poczekalni). Mecz jest autorytatywny po stronie serwera,
// więc świat NIE zatrzymuje się pod spodem — menu tylko zwalnia kursor i daje akcje. Pełnoekranowy
// półprzezroczysty backdrop łapie kliknięcia (pointer-events), więc nie trafiają w canvas (brak
// strzału/celowania). Etykieta akcji zależy od kontekstu: gdy w grze są SAME boty — „ZAKOŃCZ MISJĘ"
// (serwer kończy mecz całkowicie); gdy grają inni ludzie — „WRÓĆ DO POCZEKALNI" (wycofanie z meczu
// bez kończenia go pozostałym). Czysty DOM/CSS nad canvasem, jak DownedOverlay/ResultsOverlay.

function styleButton(b: HTMLButtonElement, accent: string): void {
  b.style.cssText =
    'font:600 16px/1 monospace;padding:13px 26px;margin:4px;cursor:pointer;min-width:240px;' +
    `color:#eef;background:rgba(20,32,46,0.95);border:1px solid ${accent};border-radius:7px;`;
}

export class PauseMenu {
  private readonly root: HTMLElement;
  private readonly endBtn: HTMLButtonElement;
  private readonly hint: HTMLElement;
  private shown = false;

  /** `onResume` — wróć do gry (zamknij menu); `onEnd` — zakończ misję / wróć do poczekalni
   *  (wybór akcji zależny od kontekstu rozstrzyga wywołujący — patrz endMissionContextual). */
  constructor(onResume: () => void, onEnd: () => void) {
    this.root = document.createElement('div');
    this.root.style.cssText =
      'position:fixed;inset:0;z-index:9;display:none;flex-direction:column;align-items:center;' +
      'justify-content:center;gap:6px;background:rgba(4,8,14,0.62);font-family:monospace;' +
      'text-align:center;pointer-events:auto;';

    const title = document.createElement('div');
    title.textContent = 'PAUZA';
    title.style.cssText =
      'font:700 30px/1 monospace;color:#ffd24a;letter-spacing:4px;margin-bottom:8px;' +
      'text-shadow:0 2px 10px rgba(0,0,0,0.8);';

    const resumeBtn = document.createElement('button');
    resumeBtn.textContent = 'WRÓĆ DO GRY';
    styleButton(resumeBtn, '#4a6c8c');
    resumeBtn.addEventListener('click', onResume);

    this.endBtn = document.createElement('button');
    this.endBtn.textContent = 'ZAKOŃCZ MISJĘ';
    styleButton(this.endBtn, '#8c4a4a');
    this.endBtn.addEventListener('click', onEnd);

    this.hint = document.createElement('div');
    this.hint.style.cssText = 'font:13px monospace;color:#9ab;margin-top:10px;max-width:30em;';

    this.root.append(title, resumeBtn, this.endBtn, this.hint);
    document.body.appendChild(this.root);
  }

  /** Pokazuje menu; `otherHumansPresent` dobiera akcję końca: same boty → zakończenie meczu,
   *  inni ludzie → powrót do poczekalni bez kończenia gry pozostałym. */
  show(otherHumansPresent: boolean): void {
    if (otherHumansPresent) {
      this.endBtn.textContent = 'WRÓĆ DO POCZEKALNI';
      this.hint.textContent = 'Mecz toczy się dalej dla pozostałych graczy — dołączysz przy kolejnym starcie.';
    } else {
      this.endBtn.textContent = 'ZAKOŃCZ MISJĘ';
      this.hint.textContent = 'Mecz zostanie zakończony — wrócisz do poczekalni.';
    }
    this.root.style.display = 'flex';
    this.shown = true;
  }

  hide(): void {
    this.root.style.display = 'none';
    this.shown = false;
  }

  get visible(): boolean {
    return this.shown;
  }
}
