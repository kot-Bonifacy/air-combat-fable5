import type { StallPhase } from '@air-combat/shared';

export interface HudData {
  iasKmh: number;
  tasKmh: number;
  altM: number;
  throttle01: number;
  nG: number;
  nAvailG: number;
  /** Sufit dodatniego G od tolerancji pilota (G-LOC); < nAvailG, gdy zmęczenie G gryzie. */
  gLimitG: number;
  /** Intensywność zaciemnienia 0..1 (greyout) — do ostrzeżenia tekstowego. */
  blackoutFactor: number;
  stallPhase: StallPhase;
  buffetIntensity: number;
  /** Przechylenie [rad], + w prawo (do sztucznego horyzontu). */
  bankRad: number;
  /** Pochylenie nosa nad horyzont [rad]. */
  pitchRad: number;
  controlMode: 'mysz' | 'klawiatura';
  /** Pozostała amunicja (suma luf). */
  ammo: number;
  /** Pełny zapas amunicji (do wyróżnienia stanu niskiego). */
  ammoMax: number;
  extraLines: readonly string[];
}

/** Próg ostrzeżenia o niskiej amunicji (udział pełnego zapasu). */
const LOW_AMMO_RATIO = 0.15;

const PITCH_PX_PER_RAD = 120;

/** Szerokość kolumny etykiety [znaki] — mieści najdłuższą („pociski") z zapasem; wartości
 *  zaczynają się w tej samej kolumnie dla każdego wiersza (monospace, white-space: pre). */
const LABEL_W = 8;

/** Wiersz HUD: etykieta (stała szerokość) + wartość wyrównana do LEWEJ + jednostka.
 *  Lewy brzeg wartości jest wspólny dla wszystkich wierszy — także tekstowych (np. „mysz”). */
export function hudRow(label: string, value: string, unit = ''): string {
  return `${label.padEnd(LABEL_W)}${value}${unit ? ` ${unit}` : ''}`;
}

/**
 * HUD gracza (faza 3): IAS, wysokość, throttle, G, ostrzeżenie przeciągnięcia,
 * sztuczny horyzont. Czysty DOM/CSS — bez zależności od renderera.
 */
export class Hud {
  private readonly textEl: HTMLElement;
  private readonly warningEl: HTMLElement;
  private readonly horizonDiscEl: HTMLElement;

  constructor(textEl: HTMLElement, warningEl: HTMLElement, horizonDiscEl: HTMLElement) {
    this.textEl = textEl;
    this.warningEl = warningEl;
    this.horizonDiscEl = horizonDiscEl;
  }

  update(data: HudData): void {
    // sufit od pilota (G-LOC) pokazujemy tylko, gdy realnie ogranicza poniżej fizyki
    const gLocText =
      data.gLimitG < data.nAvailG - 0.1 && data.blackoutFactor > 0.02
        ? `   G-LOC ${data.gLimitG.toFixed(1)} G`
        : '';
    const ammoWarn =
      data.ammo === 0
        ? '   *** PUSTE ***'
        : data.ammo <= data.ammoMax * LOW_AMMO_RATIO
          ? '   ! mało !'
          : '';
    this.textEl.textContent = [
      hudRow('IAS', data.iasKmh.toFixed(0), 'km/h'),
      hudRow('TAS', data.tasKmh.toFixed(0), 'km/h'),
      hudRow('alt', data.altM.toFixed(0), 'm'),
      hudRow('gaz', (data.throttle01 * 100).toFixed(0), '%'),
      hudRow('n', data.nG.toFixed(1), 'G') + gLocText,
      hudRow('ster', data.controlMode),
      hudRow('amun.', String(data.ammo), `/ ${String(data.ammoMax)}`) + ammoWarn,
      ...data.extraLines,
    ].join('\n');

    if (data.stallPhase === 'stalled') {
      this.warningEl.textContent = 'PRZECIĄGNIĘCIE';
      this.warningEl.className = 'stall';
      // miganie sterowane czasem — bez timerów, HUD odświeżany co klatkę
      this.warningEl.style.opacity = Date.now() % 500 < 300 ? '1' : '0.25';
    } else if (data.stallPhase === 'buffet') {
      this.warningEl.textContent = 'BUFFET';
      this.warningEl.className = 'buffet';
      this.warningEl.style.opacity = String(0.35 + 0.65 * data.buffetIntensity);
    } else if (data.blackoutFactor > 0.05) {
      // szarzenie od przeciążenia (G-LOC) — stall ma priorytet (inny reżim prędkości)
      this.warningEl.textContent = 'SZARZENIE — ODPUŚĆ G';
      this.warningEl.className = 'buffet';
      this.warningEl.style.opacity = String(0.35 + 0.6 * data.blackoutFactor);
    } else {
      this.warningEl.textContent = '';
      this.warningEl.style.opacity = '0';
    }

    const bankDeg = (data.bankRad * 180) / Math.PI;
    const pitchPx = data.pitchRad * PITCH_PX_PER_RAD;
    // dysk obraca się PRZECIWNIE do przechylenia i przesuwa zgodnie z pochyleniem
    this.horizonDiscEl.style.transform = `rotate(${(-bankDeg).toFixed(2)}deg) translateY(${pitchPx.toFixed(1)}px)`;
  }
}
