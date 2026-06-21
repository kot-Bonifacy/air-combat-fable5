import { PerspectiveCamera, Vector3 } from 'three';

// Znacznik samolotu w HUD (faza-06.md krok 5; faza 7: wielu + sojusznicy):
// na ekranie ramka nad celem z dystansem; poza ekranem strzałka przy krawędzi
// wskazująca kierunek. Czysty DOM — pozycjonowany co klatkę z projekcji pozycji
// świata na ekran. Paleta foe/friend odróżnia wroga (czerwony) od sojusznika
// (zielony) — w trybie drużynowym oba kolory są na ekranie naraz.

const MARGIN_PX = 48;
const scratchCs = new Vector3();
const scratchNdc = new Vector3();

interface Palette {
  arrow: string;
  label: string;
}
const FOE_PALETTE: Palette = { arrow: '#ff5a4a', label: '#ff8a6a' };
const FRIEND_PALETTE: Palette = { arrow: '#46e07a', label: '#8af0a6' };

export class EnemyMarker {
  private readonly el: HTMLElement;
  private readonly arrow: HTMLElement;
  private readonly label: HTMLElement;
  private foe = true;
  /** Dowolny kolor (FFA: unikatowy per frakcja); null = paleta foe/friend (drużynowy). */
  private colorCss: string | null = null;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.style.cssText =
      'position:fixed;display:none;pointer-events:none;transform:translate(-50%,-50%);' +
      'text-align:center;z-index:5;';
    this.arrow = document.createElement('div');
    this.label = document.createElement('div');
    this.el.append(this.arrow, this.label);
    parent.append(this.el);
    this.applyPalette();
  }

  /** Przełącza kolor markera: foe=true wróg (czerwony), false sojusznik (zielony). */
  setFoe(foe: boolean): void {
    if (foe === this.foe && this.colorCss === null) return;
    this.foe = foe;
    this.colorCss = null; // wróć do palety foe/friend (slot mógł być wcześniej w FFA)
    this.applyPalette();
  }

  /** Ustawia unikatowy kolor markera (FFA: per frakcja). Nadpisuje paletę foe/friend. */
  setColorHex(hex: number): void {
    const css = `#${hex.toString(16).padStart(6, '0')}`;
    if (css === this.colorCss) return;
    this.colorCss = css;
    this.applyColor(css, css);
  }

  private applyPalette(): void {
    const p = this.foe ? FOE_PALETTE : FRIEND_PALETTE;
    this.applyColor(p.arrow, p.label);
  }

  private applyColor(arrow: string, label: string): void {
    this.arrow.style.cssText = `font:18px/1 monospace;color:${arrow};text-shadow:0 0 6px rgba(0,0,0,0.7);`;
    this.label.style.cssText =
      `font:bold 12px/1.2 monospace;color:${label};text-shadow:0 0 4px rgba(0,0,0,0.9);`;
  }

  hide(): void {
    this.el.style.display = 'none';
  }

  /** Przygasza znacznik (faza 20): cel schowany w chmurze → 1=pełny, ~0.2=ledwo widoczny. */
  setOpacity(alpha: number): void {
    this.el.style.opacity = alpha >= 1 ? '' : alpha.toFixed(2);
  }

  /** Pozycjonuje znacznik dla pozycji świata przeciwnika; `selfPos` do dystansu. */
  update(
    enemyPos: Vector3,
    selfPos: Vector3,
    camera: PerspectiveCamera,
    widthPx: number,
    heightPx: number,
  ): void {
    this.el.style.display = 'block';
    const distM = selfPos.distanceTo(enemyPos);
    this.label.textContent = `${distM < 1000 ? distM.toFixed(0) + ' m' : (distM / 1000).toFixed(1) + ' km'}`;

    // pozycja w przestrzeni kamery: z<0 = przed kamerą (three patrzy w −Z)
    scratchCs.copy(enemyPos).applyMatrix4(camera.matrixWorldInverse);
    const inFront = scratchCs.z < 0;
    scratchNdc.copy(enemyPos).project(camera);

    const onScreen =
      inFront && Math.abs(scratchNdc.x) <= 1 && Math.abs(scratchNdc.y) <= 1;

    if (onScreen) {
      const x = (scratchNdc.x * 0.5 + 0.5) * widthPx;
      const y = (-scratchNdc.y * 0.5 + 0.5) * heightPx;
      this.el.style.left = `${x.toFixed(0)}px`;
      this.el.style.top = `${y.toFixed(0)}px`;
      this.arrow.textContent = '◎';
      this.arrow.style.transform = 'none';
      return;
    }

    // poza ekranem: kierunek od środka; gdy za kamerą — odwróć
    let dx = scratchNdc.x;
    let dy = scratchNdc.y;
    if (!inFront) {
      dx = -dx;
      dy = -dy;
    }
    if (dx === 0 && dy === 0) dy = -1;
    // w pikselach oś Y jest w dół, NDC w górę → minus przy dy
    const pdx = dx;
    const pdy = -dy;
    const cx = widthPx / 2;
    const cy = heightPx / 2;
    const halfW = cx - MARGIN_PX;
    const halfH = cy - MARGIN_PX;
    // skala, by (cx,cy)+s·(pdx,pdy) trafiło w prostokąt krawędzi
    const sx = pdx !== 0 ? halfW / Math.abs(pdx) : Infinity;
    const sy = pdy !== 0 ? halfH / Math.abs(pdy) : Infinity;
    const s = Math.min(sx, sy);
    this.el.style.left = `${(cx + pdx * s).toFixed(0)}px`;
    this.el.style.top = `${(cy + pdy * s).toFixed(0)}px`;
    this.arrow.textContent = '➤';
    this.arrow.style.transform = `rotate(${Math.atan2(pdy, pdx).toFixed(3)}rad)`;
  }
}
