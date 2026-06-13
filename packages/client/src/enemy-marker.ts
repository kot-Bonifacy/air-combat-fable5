import { PerspectiveCamera, Vector3 } from 'three';

// Znacznik przeciwnika w HUD (faza-06.md krok 5): na ekranie ramka nad celem
// z dystansem; poza ekranem strzałka przy krawędzi wskazująca kierunek. Czysty
// DOM — pozycjonowany co klatkę z projekcji pozycji świata na ekran.

const MARGIN_PX = 48;
const scratchCs = new Vector3();
const scratchNdc = new Vector3();

export class EnemyMarker {
  private readonly el: HTMLElement;
  private readonly arrow: HTMLElement;
  private readonly label: HTMLElement;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.style.cssText =
      'position:fixed;display:none;pointer-events:none;transform:translate(-50%,-50%);' +
      'text-align:center;z-index:5;';
    this.arrow = document.createElement('div');
    this.arrow.style.cssText =
      'font:18px/1 monospace;color:#ff5a4a;text-shadow:0 0 6px rgba(255,60,40,0.8);';
    this.label = document.createElement('div');
    this.label.style.cssText =
      'font:bold 12px/1.2 monospace;color:#ff8a6a;text-shadow:0 0 4px rgba(0,0,0,0.9);';
    this.el.append(this.arrow, this.label);
    parent.append(this.el);
  }

  hide(): void {
    this.el.style.display = 'none';
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
