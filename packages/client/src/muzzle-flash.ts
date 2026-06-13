import {
  AdditiveBlending,
  CanvasTexture,
  InstancedMesh,
  Object3D,
  PlaneGeometry,
  MeshBasicMaterial,
  type Quaternion,
  Scene,
  type Texture,
  Vector3,
} from 'three';

// Błysk luf (faza-05.md krok 5): krótki, miękki rozbłysk w pozycji każdego
// wylotu przy oddaniu salwy. Billboard (zawsze do kamery), additive, gaśnie
// w ~2-3 klatki. InstancedMesh — jeden draw call na wszystkie lufy.
//
// Miękka, OKRĄGŁA tekstura (gradient radialny) zamiast płaskiego kwadratu —
// inaczej additive robi z luf przepalone, kanciaste białe bloki na całym
// skrzydle (feedback playtestu). Mały rozmiar: spark przy lufie, nie chmura.

/** Czas życia błysku [s] — krótki strob synchroniczny z kadencją. */
const FLASH_S = 0.045;
/** Rozmiar błysku [m] u szczytu jasności (mały — pojedyncza lufa). */
const FLASH_SIZE_M = 0.85;
/** Szczytowa nieprzezroczystość (additive — pełna 1.0 przepala). */
const FLASH_PEAK_OPACITY = 0.55;

const scratchPos = new Vector3();
const dummy = new Object3D();

/** Miękki okrągły rozbłysk: gradient od ciepłej bieli do przezroczystości. */
function makeFlashTexture(): Texture {
  const px = 64;
  const canvas = document.createElement('canvas');
  canvas.width = px;
  canvas.height = px;
  const ctx = canvas.getContext('2d');
  if (!ctx) return new CanvasTexture(canvas); // nieosiągalne w realnej przeglądarce
  const g = ctx.createRadialGradient(px / 2, px / 2, 0, px / 2, px / 2, px / 2);
  g.addColorStop(0, 'rgba(255,255,240,1)');
  g.addColorStop(0.35, 'rgba(255,225,150,0.55)');
  g.addColorStop(1, 'rgba(255,200,90,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, px, px);
  return new CanvasTexture(canvas);
}

export class MuzzleFlash {
  private readonly mesh: InstancedMesh;
  private readonly material: MeshBasicMaterial;
  private readonly texture: Texture;
  private readonly muzzles: readonly (readonly [number, number, number])[];
  private ageS = FLASH_S; // start wygaszony

  constructor(scene: Scene, muzzles: readonly (readonly [number, number, number])[]) {
    this.muzzles = muzzles;
    this.texture = makeFlashTexture();
    this.material = new MeshBasicMaterial({
      map: this.texture,
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
    this.material.opacity = FLASH_PEAK_OPACITY * life01;
    const size = FLASH_SIZE_M * (0.7 + 0.3 * life01);
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
