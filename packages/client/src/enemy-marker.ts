import { PerspectiveCamera, Vector3 } from 'three';

// Znacznik samolotu w HUD (faza-06.md krok 5; faza 7: wielu + sojusznicy):
// na ekranie ramka nad celem z dystansem. Czysty DOM — pozycjonowany co klatkę
// z projekcji pozycji świata na ekran. Paleta foe/friend odróżnia wroga
// (czerwony) od sojusznika (zielony) — w trybie drużynowym oba kolory są na
// ekranie naraz.
// Decyzja usera 2026-06-25: BEZ strzałki przy krawędzi dla celu poza ekranem —
// znacznik off-screen zbyt ułatwiał lot w kierunku wroga (zamiast zmuszać do
// rozglądania się w swobodnej kamerze). Poza ekranem znacznik jest chowany.

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
    // pozycja w przestrzeni kamery: z<0 = przed kamerą (three patrzy w −Z)
    scratchCs.copy(enemyPos).applyMatrix4(camera.matrixWorldInverse);
    const inFront = scratchCs.z < 0;
    scratchNdc.copy(enemyPos).project(camera);

    const onScreen =
      inFront && Math.abs(scratchNdc.x) <= 1 && Math.abs(scratchNdc.y) <= 1;

    // Poza ekranem: brak znacznika (gracz musi sam odnaleźć wroga).
    if (!onScreen) {
      this.hide();
      return;
    }

    this.el.style.display = 'block';
    const distM = selfPos.distanceTo(enemyPos);
    this.label.textContent = `${distM < 1000 ? distM.toFixed(0) + ' m' : (distM / 1000).toFixed(1) + ' km'}`;

    const x = (scratchNdc.x * 0.5 + 0.5) * widthPx;
    const y = (-scratchNdc.y * 0.5 + 0.5) * heightPx;
    this.el.style.left = `${x.toFixed(0)}px`;
    this.el.style.top = `${y.toFixed(0)}px`;
    this.arrow.textContent = '◎';
    this.arrow.style.transform = 'none';
  }
}
