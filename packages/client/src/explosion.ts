import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  Points,
  PointsMaterial,
  Scene,
  Vector3,
} from 'three';

// Prosty particle burst rozbicia (faza 4): jedna chmura punktów na wybuch,
// integracja ruchu na CPU (≤ kilkaset punktów, żyje ~2 s). Math.random jest
// tu OK — to czysty efekt wizualny, nie logika symulacji.

const PARTICLE_COUNT = 160;
const LIFETIME_S = 2.2;
const MIN_SPEED_MS = 25;
const MAX_SPEED_MS = 130;
/** Cząstki lecą głównie w górę (odbicie od powierzchni). */
const UP_BIAS_MS = 45;
const PARTICLE_GRAVITY_MS2 = 25;
const COLOR_START = new Color(0xffc868);
const COLOR_END = new Color(0xb33a14);

interface Burst {
  points: Points<BufferGeometry, PointsMaterial>;
  velocities: Float32Array;
  ageS: number;
}

export class Explosions {
  private readonly scene: Scene;
  private readonly bursts: Burst[] = [];

  constructor(scene: Scene) {
    this.scene = scene;
  }

  /**
   * Wybuch w punkcie. `scale` skaluje zasięg rozlotu i rozmiar cząstek:
   * 1 = pełny wybuch (rozbicie o ziemię), ~0.35 = mały błysk/iskry w chwili
   * zestrzelenia w powietrzu (potem samolot leci dalej jako dymiący wrak).
   */
  spawn(positionM: Vector3, scale = 1): void {
    const positions = new Float32Array(PARTICLE_COUNT * 3);
    const velocities = new Float32Array(PARTICLE_COUNT * 3);
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const i3 = i * 3;
      positions[i3] = positionM.x;
      positions[i3 + 1] = positionM.y;
      positions[i3 + 2] = positionM.z;
      // losowy kierunek na sferze (odrzucanie spoza kuli zbędne przy normalizacji)
      const theta = Math.random() * 2 * Math.PI;
      const cosPhi = Math.random() * 2 - 1;
      const sinPhi = Math.sqrt(1 - cosPhi * cosPhi);
      const speed = (MIN_SPEED_MS + Math.random() * (MAX_SPEED_MS - MIN_SPEED_MS)) * scale;
      velocities[i3] = Math.cos(theta) * sinPhi * speed;
      velocities[i3 + 1] = cosPhi * speed + UP_BIAS_MS * scale;
      velocities[i3 + 2] = Math.sin(theta) * sinPhi * speed;
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    const material = new PointsMaterial({
      color: COLOR_START.clone(),
      size: 6 * scale,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    const points = new Points(geometry, material);
    points.frustumCulled = false; // chmura rozlatuje się szybciej niż bounding sphere
    this.scene.add(points);
    this.bursts.push({ points, velocities, ageS: 0 });
  }

  /** Natychmiast usuwa wszystkie żywe wybuchy (reset meczu / reconnect — bez artefaktów). */
  clear(): void {
    for (const burst of this.bursts) {
      this.scene.remove(burst.points);
      burst.points.geometry.dispose();
      burst.points.material.dispose();
    }
    this.bursts.length = 0;
  }

  update(dtS: number): void {
    for (let b = this.bursts.length - 1; b >= 0; b--) {
      const burst = this.bursts[b];
      if (burst === undefined) continue; // nieosiągalne — strict indexed access
      burst.ageS += dtS;
      if (burst.ageS >= LIFETIME_S) {
        this.scene.remove(burst.points);
        burst.points.geometry.dispose();
        burst.points.material.dispose();
        this.bursts.splice(b, 1);
        continue;
      }
      const positionAttr = burst.points.geometry.getAttribute('position') as BufferAttribute;
      const positions = positionAttr.array as Float32Array;
      const velocities = burst.velocities;
      for (let i = 0; i < positions.length; i += 3) {
        // ?? nieosiągalne — bufory mają wspólny rozmiar PARTICLE_COUNT*3
        const vyMs = (velocities[i + 1] ?? 0) - PARTICLE_GRAVITY_MS2 * dtS;
        velocities[i + 1] = vyMs;
        positions[i] = (positions[i] ?? 0) + (velocities[i] ?? 0) * dtS;
        positions[i + 1] = (positions[i + 1] ?? 0) + vyMs * dtS;
        positions[i + 2] = (positions[i + 2] ?? 0) + (velocities[i + 2] ?? 0) * dtS;
      }
      positionAttr.needsUpdate = true;
      const life01 = burst.ageS / LIFETIME_S;
      burst.points.material.opacity = 1 - life01 * life01;
      burst.points.material.color.copy(COLOR_START).lerp(COLOR_END, life01);
    }
  }
}
