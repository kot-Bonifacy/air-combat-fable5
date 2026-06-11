import { PerspectiveCamera, Vector3 } from 'three';

/**
 * Mysz → punkt celu na sferze wokół samolotu (pointer lock + akumulacja delty).
 * Celownik NIE jest sprzężony 1:1 z kamerą (pułapka z faza-03.md: choroba
 * symulatorowa) — kamera podąża za samolotem, celownik za myszą.
 */
const SENSITIVITY_RAD_PER_PX = 0.0022;
const MAX_PITCH_RAD = (85 * Math.PI) / 180;
/** Promień sfery celownika [m] — tylko do projekcji znacznika na ekran. */
const RETICLE_DISTANCE_M = 1500;

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
      this.pitchRad = Math.min(
        MAX_PITCH_RAD,
        Math.max(-MAX_PITCH_RAD, this.pitchRad - event.movementY * SENSITIVITY_RAD_PER_PX),
      );
    });
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
