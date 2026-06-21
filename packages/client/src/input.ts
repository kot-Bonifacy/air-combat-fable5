/**
 * Klawiatura jako pełnoprawny fallback sterowania (faza 3): WSAD/QE + strzałki
 * zadają wychylenia −1..1, które main.ts zamienia na żądania PRZEZ kopertę
 * (n z nMax/nMin, roll z krzywej IAS). Konwencja symulatorowa (decyzja
 * użytkownika z fazy 2): S / strzałka w dół = nos w górę (drążek do siebie).
 */
const THROTTLE_PER_S = 0.5;

/** Czy fokus jest w polu edycji tekstu (input/textarea/select/contentEditable) — np. nick lub
 *  czat poczekalni. Wtedy klawisze sterowania lotem mają trafiać do pola, nie do gry. */
function isEditingText(): boolean {
  const el = typeof document !== 'undefined' ? document.activeElement : null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (el as HTMLElement).isContentEditable;
}

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
  'ShiftLeft',
  'ControlLeft',
]);

export class KeyboardInput {
  private readonly held = new Set<string>();
  /** Przepustnica 0..1 — integrowana z LShift/LCtrl w update(). */
  throttle = 0.8;

  constructor(target: Window) {
    target.addEventListener('keydown', (event) => {
      // gdy fokus jest w polu tekstowym (nick, czat poczekalni) NIE przechwytuj klawiszy
      // sterowania — inaczej WSAD/QE itp. są zjadane przez preventDefault i nie da się ich
      // wpisać (gracz traci litery „wsadqe", a przechodzą tylko klawisze spoza CAPTURED_CODES).
      if (CAPTURED_CODES.has(event.code) && !isEditingText()) {
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
    const delta = (this.held.has('ShiftLeft') ? 1 : 0) - (this.held.has('ControlLeft') ? 1 : 0);
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
}
