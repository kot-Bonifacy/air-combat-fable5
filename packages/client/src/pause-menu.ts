// Menu pauzy wywoływane klawiszem Esc w trakcie meczu (życzenie usera 2026-06-23: zakończenie
// misji w dowolnym momencie i powrót do poczekalni). Mecz jest autorytatywny po stronie serwera,
// więc świat NIE zatrzymuje się pod spodem — menu tylko zwalnia kursor i daje akcje. Pełnoekranowy
// półprzezroczysty backdrop łapie kliknięcia (pointer-events), więc nie trafiają w canvas (brak
// strzału/celowania). Etykieta akcji zależy od kontekstu: gdy w grze są SAME boty — „ZAKOŃCZ MISJĘ"
// (serwer kończy mecz całkowicie); gdy grają inni ludzie — „WRÓĆ DO POCZEKALNI" (wycofanie z meczu
// bez kończenia go pozostałym). Czysty DOM/CSS nad canvasem, jak DownedOverlay/ResultsOverlay.

import { onLangChange, t } from './i18n';

function styleButton(b: HTMLButtonElement, accent: string): void {
  b.style.cssText =
    'font:600 16px/1 monospace;padding:13px 26px;margin:4px;cursor:pointer;min-width:240px;' +
    `color:#eef;background:rgba(20,32,46,0.95);border:1px solid ${accent};border-radius:7px;`;
}

export class PauseMenu {
  private readonly root: HTMLElement;
  private readonly title: HTMLElement;
  private readonly resumeBtn: HTMLButtonElement;
  private readonly endBtn: HTMLButtonElement;
  private readonly hint: HTMLElement;
  private shown = false;
  /** Ostatni kontekst z show() — do odświeżenia etykiety akcji/podpowiedzi przy zmianie języka. */
  private lastOtherHumans = false;

  /** `onResume` — wróć do gry (zamknij menu); `onEnd` — zakończ misję / wróć do poczekalni
   *  (wybór akcji zależny od kontekstu rozstrzyga wywołujący — patrz endMissionContextual). */
  constructor(onResume: () => void, onEnd: () => void) {
    this.root = document.createElement('div');
    this.root.style.cssText =
      'position:fixed;inset:0;z-index:9;display:none;flex-direction:column;align-items:center;' +
      'justify-content:center;gap:6px;background:rgba(4,8,14,0.62);font-family:monospace;' +
      'text-align:center;pointer-events:auto;';

    const title = document.createElement('div');
    title.style.cssText =
      'font:700 30px/1 monospace;color:#ffd24a;letter-spacing:4px;margin-bottom:8px;' +
      'text-shadow:0 2px 10px rgba(0,0,0,0.8);';
    this.title = title;

    this.resumeBtn = document.createElement('button');
    styleButton(this.resumeBtn, '#4a6c8c');
    this.resumeBtn.addEventListener('click', onResume);

    this.endBtn = document.createElement('button');
    styleButton(this.endBtn, '#8c4a4a');
    this.endBtn.addEventListener('click', onEnd);

    this.hint = document.createElement('div');
    this.hint.style.cssText = 'font:13px monospace;color:#9ab;margin-top:10px;max-width:30em;';

    this.root.append(title, this.resumeBtn, this.endBtn, this.hint);
    document.body.appendChild(this.root);
    this.applyStaticTexts();
    onLangChange(() => this.applyStaticTexts());
  }

  /** Ustawia/odświeża teksty (tytuł, „wróć do gry" + akcja końca zależna od kontekstu). */
  private applyStaticTexts(): void {
    this.title.textContent = t('pause.title');
    this.resumeBtn.textContent = t('pause.resume');
    if (this.lastOtherHumans) {
      this.endBtn.textContent = t('pause.backToLobby');
      this.hint.textContent = t('pause.hintHumans');
    } else {
      this.endBtn.textContent = t('pause.end');
      this.hint.textContent = t('pause.hintBots');
    }
  }

  /** Pokazuje menu; `otherHumansPresent` dobiera akcję końca: same boty → zakończenie meczu,
   *  inni ludzie → powrót do poczekalni bez kończenia gry pozostałym. */
  show(otherHumansPresent: boolean): void {
    this.lastOtherHumans = otherHumansPresent;
    this.applyStaticTexts();
    this.root.style.display = 'flex';
    this.shown = true;
  }

  /** Dokłada własny element (np. panel głośności audio) na dole menu — przed podpowiedzią. */
  mount(el: HTMLElement): void {
    this.root.insertBefore(el, this.hint);
  }

  hide(): void {
    this.root.style.display = 'none';
    this.shown = false;
  }

  get visible(): boolean {
    return this.shown;
  }
}
