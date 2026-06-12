import { Vector3 } from 'three';

/**
 * Matematyka celownika myszy (mouse-aim): cel jako para {yaw, pitch} na sferze
 * wokół samolotu. Wydzielona z klienta, żeby harness testów manewrów symulował
 * mysz DOKŁADNIE tym samym kodem, którym gra zamienia ruch ręki na kierunek
 * celu. Warstwa DOM (pointer lock, eventy, projekcja na ekran) zostaje w kliencie.
 *
 * Pitch NIE jest ograniczony do ±90°: ciągnięcie myszy w górę prowadzi cel
 * przez pion na drugą stronę (pętla/immelmann samą myszą). Parametryzacja
 * yaw/pitch z cos(pitch) < 0 = cel "za plecami przez górę/dół"; po domknięciu
 * manewru renormalize() wraca do normalnej połówki (patrz komentarz metody).
 */
export const MOUSE_SENSITIVITY_RAD_PER_PX = 0.0022;

/** Renormalizacja tylko blisko horyzontu — |elewacja celu| < 45°. */
const RENORM_MAX_ELEVATION_SIN = Math.sin((45 * Math.PI) / 180);
/** Renormalizacja dopiero, gdy nos dogonił cel (manewr domknięty). */
const RENORM_MAX_NOSE_ANGLE_RAD = (20 * Math.PI) / 180;

const scratchDir = new Vector3();

export class MouseAimCore {
  private yawRadCurrent = 0;
  private pitchRadCurrent = 0;

  /** Kąt poziomy celu [rad] — bez wrapu (sin/cos i tak okresowe). */
  get yawRad(): number {
    return this.yawRadCurrent;
  }

  /** Kąt pionowy celu [rad] w (−π, π]; cos < 0 = połówka "za plecami". */
  get pitchRad(): number {
    return this.pitchRadCurrent;
  }

  /** Ruch myszy [px]: w prawo/dół = dodatnie (konwencja movementX/Y DOM). */
  applyMovementPx(dxPx: number, dyPx: number): void {
    this.yawRadCurrent -= dxPx * MOUSE_SENSITIVITY_RAD_PER_PX;
    this.pitchRadCurrent -= dyPx * MOUSE_SENSITIVITY_RAD_PER_PX;
    // wrap do (−π, π] — wielokrotne pętle nie akumulują kąta
    if (this.pitchRadCurrent > Math.PI) this.pitchRadCurrent -= 2 * Math.PI;
    else if (this.pitchRadCurrent <= -Math.PI) this.pitchRadCurrent += 2 * Math.PI;
  }

  /**
   * Powrót do normalnej parametryzacji po manewrze przez pion: gdy cel jest
   * w "odwróconej" połówce (cos(pitch) < 0), ale samolot już go dogonił blisko
   * horyzontu — przepisz {yaw, pitch} na równoważne z pitch ∈ (−90°, 90°).
   * Kierunek celu się NIE zmienia; zmienia się znaczenie przyszłych ruchów
   * myszy (bez tego po pętli oś pozioma działa lustrzanie). Wołać co tick.
   */
  renormalize(noseDirWorld: Vector3): void {
    if (Math.cos(this.pitchRadCurrent) >= 0) return;
    this.targetDir(scratchDir);
    if (Math.abs(scratchDir.y) > RENORM_MAX_ELEVATION_SIN) return;
    if (scratchDir.angleTo(noseDirWorld) > RENORM_MAX_NOSE_ANGLE_RAD) return;
    this.pitchRadCurrent = Math.asin(Math.min(1, Math.max(-1, scratchDir.y)));
    this.yawRadCurrent = Math.atan2(scratchDir.x, scratchDir.z);
  }

  /** Kierunek celu w świecie (jednostkowy). */
  targetDir(out: Vector3): Vector3 {
    const cosP = Math.cos(this.pitchRadCurrent);
    return out.set(
      Math.sin(this.yawRadCurrent) * cosP,
      Math.sin(this.pitchRadCurrent),
      Math.cos(this.yawRadCurrent) * cosP,
    );
  }

  /** Ustaw cel na zadany kierunek (po respawnie / przejęciu od klawiatury). */
  alignTo(dir: Vector3): void {
    this.pitchRadCurrent = Math.asin(Math.min(1, Math.max(-1, dir.y)));
    this.yawRadCurrent = Math.atan2(dir.x, dir.z);
  }
}
