import type { StallPhase } from '@air-combat/shared';

export interface HudData {
  iasKmh: number;
  tasKmh: number;
  altM: number;
  /**
   * Prędkość pionowa (wariometr) [m/s], + w górę. Uwidacznia wymianę wysokość↔prędkość:
   * w ostrym zakręcie na suficie G-LOC samolot zniża się, a IAS stoi/rośnie — bez tego
   * wiersza gracz „nie widzi", że traci energię całkowitą (½mV²+mgh) przez utratę wysokości.
   */
  verticalSpeedMs: number;
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
  /** Zapas paliwa 0..1 (pełny bak = 1). Przy 0 silnik zgasł — HUD ostrzega. */
  fuel01: number;
  /** Pozostała amunicja (suma luf). */
  ammo: number;
  /** Pełny zapas amunicji (do wyróżnienia stanu niskiego). */
  ammoMax: number;
  /** Osobny licznik amunicji grupy wtórnej (np. działko 20 mm Bf 109); pomijany, gdy undefined. */
  secondaryAmmo?: number;
  /** Pełny zapas grupy wtórnej (do wyróżnienia stanu niskiego). */
  secondaryAmmoMax?: number;
  /** Etykieta wiersza grupy wtórnej (np. „20 mm"). */
  secondaryLabel?: string;
  extraLines: readonly string[];
}

/** Próg ostrzeżenia o niskiej amunicji (udział pełnego zapasu). */
const LOW_AMMO_RATIO = 0.15;

/** Sufiks ostrzeżenia o stanie amunicji (puste / mało) — wspólny dla broni głównej i wtórnej. */
function ammoWarning(ammo: number, ammoMax: number): string {
  if (ammo === 0) return '   *** PUSTE ***';
  if (ammo <= ammoMax * LOW_AMMO_RATIO) return '   ! mało !';
  return '';
}

/** Próg paliwa, poniżej którego HUD ostrzega o niskim baku (udział pełnego baku). */
const LOW_FUEL_RATIO = 0.15;

/** Sufiks ostrzeżenia o stanie paliwa (silnik zgasł / mało). */
function fuelWarning(fuel01: number): string {
  if (fuel01 <= 0) return '   *** SILNIK STANĄŁ ***';
  if (fuel01 <= LOW_FUEL_RATIO) return '   ! mało !';
  return '';
}

/** Martwa strefa wariometru [m/s] — poniżej |tego| lot ~poziomy, pokazujemy „·" zamiast
 *  migotania strzałki kierunku przy drobnym szumie prędkości pionowej. */
const VARIO_DEADBAND_MS = 0.5;

/** Wartość wariometru: strzałka kierunku (▲ wznoszenie / ▼ opadanie / · poziom) + |wartość|. */
function varioValue(verticalSpeedMs: number): string {
  const arrow =
    verticalSpeedMs > VARIO_DEADBAND_MS ? '▲' : verticalSpeedMs < -VARIO_DEADBAND_MS ? '▼' : '·';
  return `${arrow} ${Math.abs(verticalSpeedMs).toFixed(0)}`;
}

/** Próg, poniżej którego HUD ostrzega, że karta graficzna jest za słaba [fps]. */
export const LOW_FPS_THRESHOLD = 30;
/** Pełny cykl naprzemiennego ostrzeżenia o niskim FPS [ms] — celowo wolny (po połowie cyklu
 *  liczba klatek / komunikat), żeby nie migało zbyt szybko (życzenie usera 2026-06-21). */
const LOW_FPS_BLINK_MS = 5000;

/**
 * Wiersz FPS do HUD (extraLines). Powyżej progu pokazuje samą liczbę; poniżej miga
 * NAPRZEMIENNIE (wolno, ~2,5 s na stan) liczbą klatek i ostrzeżeniem o zbyt słabej karcie
 * graficznej. fps≤0 (przed pierwszym pomiarem) → bez ostrzeżenia. Sterowane zegarem
 * (HUD odświeżany co klatkę) — bez timerów.
 */
export function fpsHudLine(fps: number): string {
  const fpsRow = hudRow('fps', String(fps));
  if (fps <= 0 || fps >= LOW_FPS_THRESHOLD) return fpsRow;
  return Date.now() % LOW_FPS_BLINK_MS < LOW_FPS_BLINK_MS / 2 ? fpsRow : 'KARTA GRAFICZNA ZA SŁABA';
}

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
    const ammoWarn = ammoWarning(data.ammo, data.ammoMax);
    // osobny licznik grupy wtórnej (działko 20 mm Bf 109) — tylko gdy samolot ją ma
    const secondaryRow =
      data.secondaryAmmo !== undefined && data.secondaryAmmoMax !== undefined
        ? hudRow(data.secondaryLabel ?? '20 mm', String(data.secondaryAmmo), `/ ${String(data.secondaryAmmoMax)}`) +
          ammoWarning(data.secondaryAmmo, data.secondaryAmmoMax)
        : null;
    this.textEl.textContent = [
      hudRow('IAS', data.iasKmh.toFixed(0), 'km/h'),
      hudRow('TAS', data.tasKmh.toFixed(0), 'km/h'),
      hudRow('alt', data.altM.toFixed(0), 'm'),
      hudRow('wznosz.', varioValue(data.verticalSpeedMs), 'm/s'),
      hudRow('gaz', (data.throttle01 * 100).toFixed(0), '%'),
      hudRow('paliwo', (data.fuel01 * 100).toFixed(0), '%') + fuelWarning(data.fuel01),
      hudRow('n', data.nG.toFixed(1), 'G') + gLocText,
      hudRow('ster', data.controlMode),
      hudRow('amun.', String(data.ammo), `/ ${String(data.ammoMax)}`) + ammoWarn,
      ...(secondaryRow !== null ? [secondaryRow] : []),
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
    } else if (data.fuel01 <= 0) {
      // pusty bak — silnik zgasł (najniższy priorytet ostrzeżeń, ale stale widoczne)
      this.warningEl.textContent = 'BRAK PALIWA — SILNIK STANĄŁ';
      this.warningEl.className = 'stall';
      this.warningEl.style.opacity = '1';
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
