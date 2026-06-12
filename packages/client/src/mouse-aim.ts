import { PerspectiveCamera, Vector3 } from 'three';

/**
 * Mysz → punkt celu na sferze wokół samolotu (pointer lock + akumulacja delty).
 * Celownik NIE jest sprzężony 1:1 z kamerą (pułapka z faza-03.md: choroba
 * symulatorowa) — kamera podąża za samolotem, celownik za myszą.
 *
 * Pitch NIE jest ograniczony do ±90°: ciągnięcie myszy w górę prowadzi cel
 * przez pion na drugą stronę (pętla/immelmann samą myszą). Parametryzacja
 * yaw/pitch z cos(pitch) < 0 = cel "za plecami przez górę/dół"; po domknięciu
 * manewru renormalize() wraca do normalnej połówki (patrz komentarz metody).
 */
const SENSITIVITY_RAD_PER_PX = 0.0022;
/** Promień sfery celownika [m] — tylko do projekcji znacznika na ekran. */
const RETICLE_DISTANCE_M = 1500;
/** Renormalizacja tylko blisko horyzontu — |elewacja celu| < 45°. */
const RENORM_MAX_ELEVATION_SIN = Math.sin((45 * Math.PI) / 180);
/** Renormalizacja dopiero, gdy nos dogonił cel (manewr domknięty). */
const RENORM_MAX_NOSE_ANGLE_RAD = (20 * Math.PI) / 180;

const scratchWorld = new Vector3();

export class MouseAim {
  private yawRad = 0;
  private pitchRad = 0;
  locked = false;

  constructor(private readonly dom: HTMLElement) {
    dom.addEventListener('click', () => {
      if (!this.locked) void this.dom.requestPointerLock();
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.dom;
    });
    document.addEventListener('mousemove', (event) => {
      if (!this.locked) return;
      this.yawRad -= event.movementX * SENSITIVITY_RAD_PER_PX;
      this.pitchRad -= event.movementY * SENSITIVITY_RAD_PER_PX;
      // wrap do (−π, π] — wielokrotne pętle nie akumulują kąta
      if (this.pitchRad > Math.PI) this.pitchRad -= 2 * Math.PI;
      else if (this.pitchRad <= -Math.PI) this.pitchRad += 2 * Math.PI;
    });
  }

  /**
   * Powrót do normalnej parametryzacji po manewrze przez pion: gdy cel jest
   * w "odwróconej" połówce (cos(pitch) < 0), ale samolot już go dogonił blisko
   * horyzontu — przepisz {yaw, pitch} na równoważne z pitch ∈ (−90°, 90°).
   * Kierunek celu się NIE zmienia; zmienia się znaczenie przyszłych ruchów
   * myszy (bez tego po pętli oś pozioma działa lustrzanie). Wołać co tick.
   */
  renormalize(noseDirWorld: Vector3): void {
    if (Math.cos(this.pitchRad) >= 0) return;
    this.targetDir(scratchWorld);
    if (Math.abs(scratchWorld.y) > RENORM_MAX_ELEVATION_SIN) return;
    if (scratchWorld.angleTo(noseDirWorld) > RENORM_MAX_NOSE_ANGLE_RAD) return;
    this.pitchRad = Math.asin(Math.min(1, Math.max(-1, scratchWorld.y)));
    this.yawRad = Math.atan2(scratchWorld.x, scratchWorld.z);
  }

  /** Kierunek celu w świecie (jednostkowy). */
  targetDir(out: Vector3): Vector3 {
    const cosP = Math.cos(this.pitchRad);
    return out.set(
      Math.sin(this.yawRad) * cosP,
      Math.sin(this.pitchRad),
      Math.cos(this.yawRad) * cosP,
    );
  }

  /** Ustaw cel na zadany kierunek (po respawnie / przejęciu od klawiatury). */
  alignTo(dir: Vector3): void {
    this.pitchRad = Math.asin(Math.min(1, Math.max(-1, dir.y)));
    this.yawRad = Math.atan2(dir.x, dir.z);
  }

  /**
   * Pozycja znacznika celu na ekranie [px] względem lewego górnego rogu,
   * albo null gdy cel za kamerą. planePos = środek sfery celownika.
   */
  reticleScreenPos(
    planePos: Vector3,
    camera: PerspectiveCamera,
    widthPx: number,
    heightPx: number,
  ): { x: number; y: number } | null {
    this.targetDir(scratchWorld).multiplyScalar(RETICLE_DISTANCE_M).add(planePos);
    scratchWorld.project(camera);
    if (scratchWorld.z > 1) return null; // za płaszczyzną daleką / za kamerą
    return {
      x: (scratchWorld.x * 0.5 + 0.5) * widthPx,
      y: (-scratchWorld.y * 0.5 + 0.5) * heightPx,
    };
  }
}

/** Projekcja dowolnego kierunku świata na ekran (znacznik nosa itp.). */
export function projectDirToScreen(
  dir: Vector3,
  planePos: Vector3,
  camera: PerspectiveCamera,
  widthPx: number,
  heightPx: number,
): { x: number; y: number } | null {
  scratchWorld.copy(dir).multiplyScalar(RETICLE_DISTANCE_M).add(planePos);
  scratchWorld.project(camera);
  if (scratchWorld.z > 1) return null;
  return {
    x: (scratchWorld.x * 0.5 + 0.5) * widthPx,
    y: (-scratchWorld.y * 0.5 + 0.5) * heightPx,
  };
}
