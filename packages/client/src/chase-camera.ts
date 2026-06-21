import { PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { getForward, getUp } from '@air-combat/shared';

// Kamera pościgowa (faza 3): za ogonem, smoothing wykładniczy pozycji
// + wyprzedzenie skrętu (punkt patrzenia ciągnięty w stronę wektora prędkości).
// Horyzont w miarę stabilny: up kamery to mieszanka pionu świata i góry kadłuba.

const DISTANCE_M = 16;
const HEIGHT_M = 4.5;
const POSITION_TAU_S = 0.22;
/**
 * Stała czasowa wygładzania wektora prędkości [s]. Surowa prędkość aktualizuje się
 * skokowo co tick fizyki 60 Hz — przy fps > 60 ten schodek przebija do punktu lookAt
 * i objawia się drżeniem kierunku patrzenia (horyzontu). Filtr 1. rzędu (krótszy niż
 * pozycyjny — wyprzedzenie skrętu zostaje czujne) sprawia, że kamera zależy WYŁĄCZNIE
 * od gładkich wielkości. Pozycja i orientacja przychodzą już interpolowane.
 */
const VELOCITY_TAU_S = 0.1;
/** Ile przechylenia samolotu przejmuje kamera (0 = sztywny horyzont). */
const ROLL_FOLLOW = 0.35;
/** Wyprzedzenie skrętu: punkt patrzenia = pozycja + mix(nos, kierunek lotu). */
const LOOK_AHEAD_M = 60;
const LOOK_VELOCITY_BLEND = 0.45;
/** Amplituda drgań buffetu przy pełnej intensywności [m]. */
const BUFFET_SHAKE_M = 0.35;

const WORLD_UP = new Vector3(0, 1, 0);

const scratchFwd = new Vector3();
const scratchUp = new Vector3();
const scratchTargetPos = new Vector3();
const scratchLook = new Vector3();
const scratchVHat = new Vector3();

export class ChaseCamera {
  private readonly smoothedPos = new Vector3();
  private readonly smoothedVel = new Vector3();
  private initialized = false;

  constructor(private readonly camera: PerspectiveCamera) {}

  reset(): void {
    this.initialized = false;
  }

  /** Przesuwa wygładzoną pozycję o wektor zawinięcia torusa — teleport bez przelotu kamery. */
  translate(delta: Vector3): void {
    this.smoothedPos.add(delta);
  }

  update(
    dtS: number,
    planePos: Vector3,
    orientation: Quaternion,
    velocity: Vector3,
    buffetIntensity: number,
  ): void {
    getForward(orientation, scratchFwd);
    getUp(orientation, scratchUp);

    scratchTargetPos
      .copy(planePos)
      .addScaledVector(scratchFwd, -DISTANCE_M)
      .addScaledVector(WORLD_UP, HEIGHT_M * (1 - ROLL_FOLLOW))
      .addScaledVector(scratchUp, HEIGHT_M * ROLL_FOLLOW);

    if (!this.initialized) {
      this.smoothedPos.copy(scratchTargetPos);
      this.smoothedVel.copy(velocity);
      this.initialized = true;
    } else {
      const blend = -Math.expm1(-dtS / POSITION_TAU_S);
      this.smoothedPos.lerp(scratchTargetPos, blend);
      // prędkość wygładzana osobno (krótszy tau) — surowa schodkuje co tick i drży lookAt
      this.smoothedVel.lerp(velocity, -Math.expm1(-dtS / VELOCITY_TAU_S));
    }

    this.camera.position.copy(this.smoothedPos);
    if (buffetIntensity > 0) {
      // drganie czysto wizualne — Math.random() poza logiką symulacji jest OK
      const amp = BUFFET_SHAKE_M * buffetIntensity;
      this.camera.position.x += (Math.random() - 0.5) * amp;
      this.camera.position.y += (Math.random() - 0.5) * amp;
      this.camera.position.z += (Math.random() - 0.5) * amp;
    }

    // wyprzedzenie skrętu: patrz tam, dokąd samolot LECI, nie tylko gdzie celuje nos
    const speed = this.smoothedVel.length();
    if (speed > 1) {
      scratchVHat.copy(this.smoothedVel).divideScalar(speed);
    } else {
      scratchVHat.copy(scratchFwd);
    }
    scratchLook
      .copy(planePos)
      .addScaledVector(scratchFwd, LOOK_AHEAD_M * (1 - LOOK_VELOCITY_BLEND))
      .addScaledVector(scratchVHat, LOOK_AHEAD_M * LOOK_VELOCITY_BLEND);

    this.camera.up.copy(WORLD_UP).lerp(scratchUp, ROLL_FOLLOW).normalize();
    this.camera.lookAt(scratchLook);
  }
}
