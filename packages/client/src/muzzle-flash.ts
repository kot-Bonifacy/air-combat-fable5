import {
  AdditiveBlending,
  InstancedMesh,
  Object3D,
  PlaneGeometry,
  MeshBasicMaterial,
  type Quaternion,
  Scene,
  Vector3,
} from 'three';

// Błysk luf (faza-05.md krok 5): krótki, jasny rozbłysk w pozycji każdego wylotu
// przy oddaniu salwy. Billboard (zawsze do kamery), additive, gaśnie w ~2-3
// klatki. InstancedMesh — jeden draw call na wszystkie lufy.

/** Czas życia błysku [s] — krótki strob synchroniczny z kadencją. */
const FLASH_S = 0.05;
/** Rozmiar błysku [m] u szczytu jasności. */
const FLASH_SIZE_M = 2.6;
const FLASH_COLOR = 0xffe8a0;

const scratchPos = new Vector3();
const dummy = new Object3D();

export class MuzzleFlash {
  private readonly mesh: InstancedMesh;
  private readonly material: MeshBasicMaterial;
  private readonly muzzles: readonly (readonly [number, number, number])[];
  private ageS = FLASH_S; // start wygaszony

  constructor(scene: Scene, muzzles: readonly (readonly [number, number, number])[]) {
    this.muzzles = muzzles;
    this.material = new MeshBasicMaterial({
      color: FLASH_COLOR,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      fog: false,
    });
    this.mesh = new InstancedMesh(new PlaneGeometry(1, 1), this.material, muzzles.length);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    scene.add(this.mesh);
  }

  /** Odpal błysk (na każdej oddanej salwie — re-strob). */
  flash(): void {
    this.ageS = 0;
  }

  /**
   * Pozycjonuje i wygasza błyski. `planePos`/`planeQuat` = interpolowana poza
   * meshu samolotu; `cameraPos` do billboardingu.
   */
  update(planePos: Vector3, planeQuat: Quaternion, cameraPos: Vector3, dtS: number): void {
    if (this.ageS >= FLASH_S) {
      this.mesh.count = 0;
      return;
    }
    this.ageS += dtS;
    const life01 = Math.max(0, 1 - this.ageS / FLASH_S);
    this.material.opacity = life01;
    const size = FLASH_SIZE_M * (0.6 + 0.4 * life01);
    for (let i = 0; i < this.muzzles.length; i++) {
      const m = this.muzzles[i];
      if (!m) continue; // nieosiągalne — pętla po this.muzzles
      scratchPos.set(m[0], m[1], m[2]).applyQuaternion(planeQuat).add(planePos);
      dummy.position.copy(scratchPos);
      dummy.lookAt(cameraPos); // billboard
      dummy.scale.setScalar(size);
      dummy.updateMatrix();
      this.mesh.setMatrixAt(i, dummy.matrix);
    }
    this.mesh.count = this.muzzles.length;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
