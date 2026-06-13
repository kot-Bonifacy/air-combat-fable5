import {
  AdditiveBlending,
  BoxGeometry,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  Quaternion,
  Scene,
  Vector3,
} from 'three';
import type { Bullet } from '@air-combat/shared';

// Smugacze (faza-05.md krok 5): JEDEN InstancedMesh na wszystkie pociski-smugacze
// (nie mesh per pocisk — inaczej fps zjedzony). Rysujemy tylko pociski z flagą
// `tracer` (co 3.); reszta leci niewidzialnie, ale fizycznie (realistyczne —
// większość amunicji bez smugi). Pozycja interpolowana prev→curr alfą renderu.

/** Grubość smugi [m]. */
const STREAK_THICK_M = 0.16;
/** Długość smugi [m] — krótki ślad rozmycia CIĄGNĄCY SIĘ ZA pociskiem. */
const STREAK_LENGTH_M = 9;
const TRACER_COLOR = 0xffb840;

const UNIT_Z = new Vector3(0, 0, 1);
const scratchPos = new Vector3();
const scratchDir = new Vector3();
const scratchQuat = new Quaternion();
const scratchScale = new Vector3(STREAK_THICK_M, STREAK_THICK_M, STREAK_LENGTH_M);
const scratchMat = new Matrix4();

export class BulletTracers {
  private readonly mesh: InstancedMesh;

  constructor(scene: Scene, capacity: number) {
    const geometry = new BoxGeometry(1, 1, 1); // jednostkowy; skala per instancja
    const material = new MeshBasicMaterial({
      color: TRACER_COLOR,
      transparent: true,
      opacity: 0.6,
      blending: AdditiveBlending,
      depthWrite: false,
      fog: false,
    });
    this.mesh = new InstancedMesh(geometry, material, capacity);
    this.mesh.frustumCulled = false; // pociski rozsiane szeroko; własny bbox bez sensu
    this.mesh.count = 0;
    scene.add(this.mesh);
  }

  /** Przebuduj instancje z aktywnych smugaczy w puli. `alpha` z akumulatora renderu. */
  update(bullets: readonly Bullet[], alpha: number): void {
    let n = 0;
    for (const b of bullets) {
      if (!b.active || !b.tracer) continue;
      scratchPos.lerpVectors(b.prevPosition, b.position, alpha);
      scratchDir.copy(b.velocity);
      if (scratchDir.lengthSq() > 0) scratchDir.normalize();
      else scratchDir.copy(UNIT_Z);
      scratchQuat.setFromUnitVectors(UNIT_Z, scratchDir);
      // przedni koniec smugi DOKŁADNIE na pocisku — cofamy środek o pół długości,
      // żeby ślad ciągnął się ZA pociskiem (nic nie renderuje się przed lufą)
      scratchPos.addScaledVector(scratchDir, -STREAK_LENGTH_M / 2);
      scratchMat.compose(scratchPos, scratchQuat, scratchScale);
      this.mesh.setMatrixAt(n, scratchMat);
      n++;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
