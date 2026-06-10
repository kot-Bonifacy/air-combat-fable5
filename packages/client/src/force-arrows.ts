import { ArrowHelper, Scene, Vector3 } from 'three';
import type { ForceContribution } from '@air-combat/shared';

const COLORS: Record<string, number> = {
  grawitacja: 0xff4444,
  'siła nośna': 0x44ff44,
  opór: 0xffaa00,
  ciąg: 0x44aaff,
  wypadkowa: 0xffffff,
};

/**
 * Strzałki sił 3D — jeden ArrowHelper per siła, skala logarytmiczna
 * (siły różnią się rzędami wielkości; liniowa skala = nieczytelna).
 */
export class ForceArrows {
  private readonly arrows = new Map<string, ArrowHelper>();
  private visible = true;
  private readonly dir = new Vector3();

  constructor(private readonly scene: Scene) {}

  update(origin: Vector3, contributions: readonly ForceContribution[]): void {
    for (const { name, force } of contributions) {
      let arrow = this.arrows.get(name);
      if (!arrow) {
        arrow = new ArrowHelper(
          new Vector3(0, 1, 0),
          origin,
          1,
          COLORS[name] ?? 0xff44ff,
          0.6,
          0.35,
        );
        this.arrows.set(name, arrow);
        this.scene.add(arrow);
      }
      const magnitude = force.length();
      const lengthM = Math.log10(1 + magnitude) * 1.5;
      arrow.visible = this.visible && magnitude > 1e-6;
      if (arrow.visible) {
        arrow.position.copy(origin);
        this.dir.copy(force).normalize();
        arrow.setDirection(this.dir);
        arrow.setLength(lengthM, 0.6, 0.35);
      }
    }
  }

  toggle(): boolean {
    this.visible = !this.visible;
    for (const arrow of this.arrows.values()) arrow.visible = this.visible;
    return this.visible;
  }
}
