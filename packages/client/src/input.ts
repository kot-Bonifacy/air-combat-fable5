/**
 * Klawiatura jako pełnoprawny fallback sterowania (faza 3): WSAD/QE + strzałki
 * zadają wychylenia −1..1, które main.ts zamienia na żądania PRZEZ kopertę
 * (n z nMax/nMin, roll z krzywej IAS). Konwencja symulatorowa (decyzja
 * użytkownika z fazy 2): S / strzałka w dół = nos w górę (drążek do siebie).
 */
const THROTTLE_PER_S = 0.5;

const CAPTURED_CODES = new Set([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'KeyW',
  'KeyS',
  'KeyA',
  'KeyD',
  'KeyQ',
  'KeyE',
  'KeyZ',
  'KeyX',
]);

export class KeyboardInput {
  private readonly held = new Set<string>();
  /** Przepustnica 0..1 — integrowana z Z/X w update(). */
  throttle = 0.8;

  constructor(target: Window) {
    target.addEventListener('keydown', (event) => {
      if (CAPTURED_CODES.has(event.code)) {
        event.preventDefault(); // strzałki/spacja scrollują stronę
        this.held.add(event.code);
      }
    });
    target.addEventListener('keyup', (event) => {
      this.held.delete(event.code);
    });
    // utrata fokusu zostawiłaby "wciśnięte" klawisze
    target.addEventListener('blur', () => {
      this.held.clear();
    });
  }

  /** Integracja przepustnicy; wołać raz na tick fizyki. */
  update(dtS: number): void {
    const delta = (this.held.has('KeyZ') ? 1 : 0) - (this.held.has('KeyX') ? 1 : 0);
    this.throttle = Math.min(1, Math.max(0, this.throttle + delta * THROTTLE_PER_S * dtS));
  }

  private axis(positive: readonly string[], negative: readonly string[]): number {
    const pos = positive.some((code) => this.held.has(code)) ? 1 : 0;
    const neg = negative.some((code) => this.held.has(code)) ? 1 : 0;
    return pos - neg;
  }

  /** −1..1, +1 = nos w górę (S / strzałka w dół — konwencja symulatorowa). */
  get pitchDeflection(): number {
    return this.axis(['KeyS', 'ArrowDown'], ['KeyW', 'ArrowUp']);
  }

  /** −1..1, +1 = przechylenie w prawo. */
  get rollDeflection(): number {
    return this.axis(['KeyD', 'ArrowRight'], ['KeyA', 'ArrowLeft']);
  }

  /** −1..1, +1 = nos w prawo (E). */
  get yawDeflection(): number {
    return this.axis(['KeyE'], ['KeyQ']);
  }

  /** Czy gracz steruje rotacją z klawiatury (wtedy omijamy instruktora). */
  get hasRotationInput(): boolean {
    return (
      this.pitchDeflection !== 0 || this.rollDeflection !== 0 || this.yawDeflection !== 0
    );
  }
}
