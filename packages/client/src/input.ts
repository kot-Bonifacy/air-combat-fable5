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
  'KeyF',
  'ShiftLeft',
  'ControlLeft',
]);

export class KeyboardInput {
  private readonly held = new Set<string>();
  /** Zbocze wciśnięcia F (cykl klap) — ustawiane na przejściu up→down, zjadane przez consumeFlapCycle().
   *  Osobno od `held`, bo klapy przełączają się RAZ na wciśnięcie (nie co klatkę auto-repeatu). */
  private flapCyclePending = false;
  /** Przepustnica 0..1 — integrowana z LShift/LCtrl w update(). */
  throttle = 0.8;

  constructor(target: Window) {
    target.addEventListener('keydown', (event) => {
      // gdy fokus jest w polu tekstowym (nick, czat poczekalni) NIE przechwytuj klawiszy
      // sterowania — inaczej WSAD/QE itp. są zjadane przez preventDefault i nie da się ich
      // wpisać (gracz traci litery „wsadqe", a przechodzą tylko klawisze spoza CAPTURED_CODES).
      if (CAPTURED_CODES.has(event.code) && !isEditingText()) {
        event.preventDefault(); // strzałki/spacja scrollują stronę
        // zbocze klapy: tylko świeże wciśnięcie F (nie auto-repeat trzymania)
        if (event.code === 'KeyF' && !this.held.has('KeyF')) this.flapCyclePending = true;
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

  /** WEP / boost (fizyka v2 R2): „detent" za pełnym gazem — przytrzymanie L.Shift, GDY gaz jest już
   *  na 100%, włącza dopalacz (L.Shift dalej podnosi gaz; po osiągnięciu maksa dokłada WEP). Puszczenie
   *  L.Shift gasi WEP, ale zostawia gaz na 100% (tylko L.Ctrl go zmniejsza). Serwer i tak niezależnie
   *  bramkuje WEP progiem WEP_MIN_THROTTLE; klient wysyła surowy bit (echo w PilotCommand → reconcile). */
  get wepHeld(): boolean {
    return this.held.has('ShiftLeft') && this.throttle >= 1;
  }

  /** Klapy (fizyka v2 R3): true RAZ na każde świeże wciśnięcie F (zjada zbocze). Caller cyklicznie
   *  zmienia indeks pozycji klap modulo liczba pozycji samolotu. Zwraca false przy trzymaniu/braku. */
  consumeFlapCycle(): boolean {
    if (!this.flapCyclePending) return false;
    this.flapCyclePending = false;
    return true;
  }
}
