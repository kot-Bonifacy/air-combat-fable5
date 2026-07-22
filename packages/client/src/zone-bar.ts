import { ZONE_CAPTURE_SECONDS } from '@air-combat/shared';
import { onLangChange, t } from './i18n';

// Pasek postępu kontroli strefy u góry ekranu (faza 7). Czysty DOM/CSS nad
// canvasem — sama góra jest punktem orientacyjnym w świecie, więc strefy NIE
// rysujemy w 3D; tu gracz widzi, JAK blisko przejęcia jest on i wróg.
//
// Model „przeciąganie liny": dwa fronty rosną od ŚRODKA na zewnątrz — gracz w
// prawo (zieleń), najlepszy wróg w lewo (czerwień). Front dobity do końca paska =
// przejęcie strefy (3 min wyłącznej kontroli). Status nad paskiem zmienia kolor:
// przejmujesz / wróg przejmuje / sporna (pauza) / wolna.

export type ZoneBarState = 'own' | 'enemy' | 'contested' | 'neutral';

// kolory statusu stałe; tekst lokalizowany co klatkę (update woła t()) — patrz statusText
const STATUS_COLOR: Record<ZoneBarState, string> = {
  own: '#5fe88a',
  enemy: '#ff6a4a',
  contested: '#ffd24a',
  neutral: '#9fb6c8',
};

const STATUS_KEY: Record<ZoneBarState, 'zone.own' | 'zone.enemy' | 'zone.contested' | 'zone.neutral'> = {
  own: 'zone.own',
  enemy: 'zone.enemy',
  contested: 'zone.contested',
  neutral: 'zone.neutral',
};

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  css: string,
  text = '',
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.style.cssText = css;
  if (text) node.textContent = text;
  return node;
}

function fmtClock(totalS: number): string {
  const s = Math.max(0, Math.floor(totalS));
  return `${String(Math.floor(s / 60))}:${String(s % 60).padStart(2, '0')}`;
}

export class ZoneBar {
  private readonly root: HTMLDivElement;
  private readonly status: HTMLSpanElement;
  private readonly playerFill: HTMLDivElement;
  private readonly enemyFill: HTMLDivElement;
  private readonly playerTime: HTMLSpanElement;
  private readonly enemyTime: HTMLSpanElement;
  // statyczne etykiety (nagłówek WRÓG/TY + „cel MM:SS") — odświeżane przy zmianie języka
  private readonly enemyLabel: HTMLSpanElement;
  private readonly youLabel: HTMLSpanElement;
  private readonly targetLabel: HTMLSpanElement;
  private lastState: ZoneBarState = 'neutral';

  constructor(parent: HTMLElement) {
    this.root = el(
      'div',
      'position:fixed;top:10px;left:50%;transform:translateX(-50%);width:min(620px,64vw);' +
        'pointer-events:none;font-family:monospace;z-index:6;display:none;' +
        'text-shadow:0 0 4px rgba(0,0,0,0.85);',
    );

    const header = el(
      'div',
      'display:flex;justify-content:space-between;align-items:baseline;margin-bottom:3px;',
    );
    this.enemyLabel = el('span', 'font:600 12px monospace;color:#ff9a86;');
    this.youLabel = el('span', 'font:600 12px monospace;color:#7ef0a0;');
    header.append(
      this.enemyLabel,
      (this.status = el('span', 'font:700 14px monospace;letter-spacing:1px;')),
      this.youLabel,
    );

    const track = el(
      'div',
      'position:relative;height:18px;border-radius:4px;overflow:hidden;' +
        'background:rgba(8,16,26,0.7);border:1px solid rgba(180,210,235,0.4);',
    );
    // fronty rosną od środka (left/right:50%) na zewnątrz; brak nakładania
    this.enemyFill = el(
      'div',
      'position:absolute;top:0;bottom:0;right:50%;width:0%;' +
        'background:linear-gradient(90deg,rgba(255,80,55,0.95),rgba(255,140,90,0.85));',
    );
    this.playerFill = el(
      'div',
      'position:absolute;top:0;bottom:0;left:50%;width:0%;' +
        'background:linear-gradient(90deg,rgba(70,220,120,0.85),rgba(120,255,150,0.95));',
    );
    const centerTick = el(
      'div',
      'position:absolute;top:-2px;bottom:-2px;left:50%;width:2px;margin-left:-1px;' +
        'background:rgba(235,245,255,0.9);',
    );
    track.append(this.enemyFill, this.playerFill, centerTick);

    const sub = el(
      'div',
      'display:flex;justify-content:space-between;margin-top:2px;font:600 11px monospace;color:#bcd;',
    );
    this.enemyTime = el('span', 'color:#ff9a86;');
    this.playerTime = el('span', 'color:#7ef0a0;');
    this.targetLabel = el('span', 'color:#9ab;');
    sub.append(this.enemyTime, this.targetLabel, this.playerTime);

    this.root.append(header, track, sub);
    parent.appendChild(this.root);
    this.applyStaticTexts();
    onLangChange(() => this.applyStaticTexts());
  }

  /** Ustawia/odświeża statyczne etykiety (nagłówek WRÓG/TY, „cel MM:SS", bieżący status). */
  private applyStaticTexts(): void {
    this.enemyLabel.textContent = t('zone.enemyLabel');
    this.youLabel.textContent = t('zone.youLabel');
    this.targetLabel.textContent = t('zone.target', { clock: fmtClock(ZONE_CAPTURE_SECONDS) });
    this.status.textContent = t(STATUS_KEY[this.lastState]);
    this.status.style.color = STATUS_COLOR[this.lastState];
  }

  setVisible(visible: boolean): void {
    this.root.style.display = visible ? 'block' : 'none';
  }

  /** Aktualizuje fronty i status. `*Sec` to sekundy wyłącznej kontroli (0..próg). */
  update(state: ZoneBarState, playerSec: number, enemySec: number): void {
    this.lastState = state;
    this.status.textContent = t(STATUS_KEY[state]);
    this.status.style.color = STATUS_COLOR[state];

    // każdy front zajmuje maks. połowę paska (od środka do końca) przy 100%
    const pPct = Math.min(1, playerSec / ZONE_CAPTURE_SECONDS) * 50;
    const ePct = Math.min(1, enemySec / ZONE_CAPTURE_SECONDS) * 50;
    this.playerFill.style.width = `${pPct.toFixed(1)}%`;
    this.enemyFill.style.width = `${ePct.toFixed(1)}%`;
    // poświata po stronie aktualnie nabijającej czas (wyłączny okupant)
    this.playerFill.style.boxShadow = state === 'own' ? '0 0 8px rgba(90,255,140,0.85)' : 'none';
    this.enemyFill.style.boxShadow = state === 'enemy' ? '0 0 8px rgba(255,90,60,0.85)' : 'none';

    this.playerTime.textContent = fmtClock(playerSec);
    this.enemyTime.textContent = fmtClock(enemySec);
  }
}
