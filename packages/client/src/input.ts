/**
 * TYMCZASOWE sterowanie fazy 2 (docs/phases/faza-02.md): strzałki zadają
 * surowe prędkości kątowe pitch/roll, Z/X reguluje gaz. Celowo bez koperty
 * sterowności — pełne sterowanie (instruktor + koperta) to faza 3.
 * Konwencja symulatorowa: strzałka W DÓŁ = nos w górę (drążek do siebie).
 *
 * Stałe rate'ów to scaffolding debugowy tej fazy, nie strojenie samolotu —
 * docelowe wartości przyjdą z krzywych w JSON (faza 3).
 */
const PITCH_RATE_RAD_S = (40 * Math.PI) / 180;
const ROLL_RATE_RAD_S = (100 * Math.PI) / 180;
const THROTTLE_PER_S = 0.5;

const CAPTURED_CODES = new Set([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'KeyZ',
  'KeyX',
]);

export class TempInput {
  private readonly held = new Set<string>();
  /** Przepustnica 0..1 — integrowana z Z/X w update(). */
  throttle = 0.8;

  constructor(target: Window) {
    target.addEventListener('keydown', (event) => {
      if (CAPTURED_CODES.has(event.code)) {
        event.preventDefault(); // strzałki scrollują stronę
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
    const delta =
      (this.held.has('KeyZ') ? 1 : 0) - (this.held.has('KeyX') ? 1 : 0);
    this.throttle = Math.min(1, Math.max(0, this.throttle + delta * THROTTLE_PER_S * dtS));
  }

  /** [rad/s], >0 = nos w górę (strzałka w dół — konwencja symulatorowa). */
  get pitchRate(): number {
    const sign = (this.held.has('ArrowDown') ? 1 : 0) - (this.held.has('ArrowUp') ? 1 : 0);
    return sign * PITCH_RATE_RAD_S;
  }

  /** [rad/s], >0 = przechylenie w prawo. */
  get rollRate(): number {
    const sign = (this.held.has('ArrowRight') ? 1 : 0) - (this.held.has('ArrowLeft') ? 1 : 0);
    return sign * ROLL_RATE_RAD_S;
  }
}
