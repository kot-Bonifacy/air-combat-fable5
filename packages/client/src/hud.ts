/** Tekstowa nakładka telemetrii (faza 1: pozycja, V, energia; rośnie z fazami). */
export class Hud {
  constructor(private readonly el: HTMLElement) {}

  update(lines: readonly string[]): void {
    this.el.textContent = lines.join('\n');
  }
}
