import type { StallPhase } from '@air-combat/shared';

export interface HudData {
  iasKmh: number;
  tasKmh: number;
  altM: number;
  throttle01: number;
  nG: number;
  nAvailG: number;
  alphaDeg: number;
  energyMj: number;
  stallPhase: StallPhase;
  buffetIntensity: number;
  /** Przechylenie [rad], + w prawo (do sztucznego horyzontu). */
  bankRad: number;
  /** Pochylenie nosa nad horyzont [rad]. */
  pitchRad: number;
  controlMode: 'mysz' | 'klawiatura';
  extraLines: readonly string[];
}

const PITCH_PX_PER_RAD = 120;

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
    const stallText =
      data.stallPhase === 'stalled'
        ? '   *** PRZECIĄGNIĘCIE — ODDAJ DRĄŻEK ***'
        : data.stallPhase === 'buffet'
          ? '   ! BUFFET !'
          : '';
    this.textEl.textContent = [
      `IAS   ${data.iasKmh.toFixed(0).padStart(4)} km/h   TAS ${data.tasKmh.toFixed(0).padStart(4)} km/h`,
      `alt   ${data.altM.toFixed(0).padStart(5)} m     gaz ${(data.throttle01 * 100).toFixed(0).padStart(3)}%`,
      `n     ${data.nG.toFixed(1).padStart(5)} G     (dostępne ${data.nAvailG.toFixed(1)} G)`,
      `α     ${data.alphaDeg.toFixed(1).padStart(5)}°     E ${data.energyMj.toFixed(1)} MJ${stallText}`,
      `ster  ${data.controlMode}`,
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
