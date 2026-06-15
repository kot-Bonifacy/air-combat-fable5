// Wygaszanie obrazu przy przeciążeniu (G-LOC, decyzja 2026-06-14). Model w
// shared (physics/g-load.ts) zwraca blackoutFactor 0..1; tu zamieniamy go na
// efekt „tunelu" — czysty radialny gradient na pełnym ekranie, którego czysty
// środek kurczy się, a ciemne obrzeże gęstnieje wraz z przeciążeniem. Nigdy
// pełna czerń (cap < 1), żeby gracz nie tracił całkowicie orientacji. Tylko
// dla widoku gracza w locie; pointer-events: none — nie blokuje kursora/UI.

/** Górny limit krycia — nawet przy pełnym G-LOC zostaje wąski prześwit. */
const MAX_ALPHA = 0.94;

export class GreyoutOverlay {
  private readonly el: HTMLElement;
  private lastFactor = -1;

  constructor() {
    this.el = document.createElement('div');
    this.el.style.cssText =
      'position:fixed;inset:0;z-index:6;pointer-events:none;display:none;' +
      'transition:opacity 80ms linear;';
    document.body.appendChild(this.el);
  }

  /** factor 0..1 (blackoutFactor z fizyki). Wołać co klatkę dla widoku gracza. */
  update(factor: number): void {
    const f = factor < 0 ? 0 : factor > 1 ? 1 : factor;
    if (Math.abs(f - this.lastFactor) < 0.01) return; // bez przemalowań przy znikomej zmianie
    this.lastFactor = f;
    if (f <= 0.01) {
      this.el.style.display = 'none';
      return;
    }
    const alpha = (MAX_ALPHA * f).toFixed(2);
    const clearPct = ((1 - f) * 65).toFixed(0); // promień czystego środka — kurczy się
    const darkPct = ((1 - f) * 65 + 30).toFixed(0);
    this.el.style.background = `radial-gradient(circle at 50% 50%, rgba(0,0,0,0) ${clearPct}%, rgba(0,0,0,${alpha}) ${darkPct}%)`;
    this.el.style.display = 'block';
  }

  hide(): void {
    this.update(0);
  }
}
