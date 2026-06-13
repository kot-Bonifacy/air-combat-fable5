import { PerspectiveCamera, Vector3 } from 'three';

const MIN_PITCH_RAD = -1.4;
const MAX_PITCH_RAD = 1.4;
const MIN_DISTANCE_M = 8;
const MAX_DISTANCE_M = 150;

/**
 * Kamera orbitalna fazy 2: krąży wokół samolotu (przeciągnięcie myszą = obrót,
 * kółko = zoom). Kamera pościgowa przyjdzie w późniejszej fazie.
 */
export class OrbitCamera {
  private yawRad = Math.PI; // start za ogonem (samolot leci w +Z)
  private pitchRad = 0.25;
  private distanceM = 30;
  private dragging = false;
  private readonly offset = new Vector3();

  constructor(
    private readonly camera: PerspectiveCamera,
    dom: HTMLElement,
  ) {
    dom.addEventListener('pointerdown', (event) => {
      this.dragging = true;
      // setPointerCapture rzuca DOMException, gdy pointer jest w stanie locked
      // (po pointer lock z celownika myszy) — bez przechwycenia obsłużymy ruch
      try {
        dom.setPointerCapture(event.pointerId);
      } catch {
        // pointer niedostępny do przechwycenia — ignorujemy
      }
    });
    dom.addEventListener('pointerup', (event) => {
      this.dragging = false;
      try {
        dom.releasePointerCapture(event.pointerId);
      } catch {
        // nic nie było przechwycone
      }
    });
    dom.addEventListener('pointermove', (event) => {
      if (!this.dragging) return;
      this.yawRad -= event.movementX * 0.005;
      this.pitchRad = Math.min(
        MAX_PITCH_RAD,
        Math.max(MIN_PITCH_RAD, this.pitchRad + event.movementY * 0.005),
      );
    });
    dom.addEventListener(
      'wheel',
      (event) => {
        event.preventDefault();
        this.distanceM = Math.min(
          MAX_DISTANCE_M,
          Math.max(MIN_DISTANCE_M, this.distanceM * (event.deltaY > 0 ? 1.15 : 1 / 1.15)),
        );
      },
      { passive: false },
    );
  }

  update(targetPos: Vector3): void {
    const cosP = Math.cos(this.pitchRad);
    this.offset.set(
      Math.sin(this.yawRad) * cosP,
      Math.sin(this.pitchRad),
      Math.cos(this.yawRad) * cosP,
    );
    this.camera.position.copy(targetPos).addScaledVector(this.offset, this.distanceM);
    this.camera.lookAt(targetPos);
  }
}
