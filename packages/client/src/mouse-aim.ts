import { PerspectiveCamera, Vector3 } from 'three';
import type { MouseAimCore } from '@air-combat/shared';

/**
 * Warstwa DOM celownika myszy: pointer lock + przekazywanie delt do
 * MouseAimCore (matematyka sfery celu żyje w shared — używa jej też harness
 * testów manewrów). Celownik NIE jest sprzężony 1:1 z kamerą (pułapka
 * z faza-03.md: choroba symulatorowa) — kamera podąża za samolotem,
 * celownik za myszą.
 */
/** Promień sfery celownika [m] — tylko do projekcji znacznika na ekran. */
const RETICLE_DISTANCE_M = 1500;

const scratchWorld = new Vector3();

export class MouseAim {
  locked = false;

  constructor(
    private readonly dom: HTMLElement,
    private readonly core: MouseAimCore,
  ) {
    dom.addEventListener('click', () => {
      if (!this.locked) void this.dom.requestPointerLock();
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.dom;
    });
    document.addEventListener('mousemove', (event) => {
      if (!this.locked) return;
      this.core.applyMovementPx(event.movementX, event.movementY);
    });
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
    this.core.targetDir(scratchWorld).multiplyScalar(RETICLE_DISTANCE_M).add(planePos);
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
