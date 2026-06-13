import {
  BoxGeometry,
  ConeGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  type Object3D,
  Scene,
  SphereGeometry,
  Vector3,
} from 'three';
import {
  applyDamage,
  createHealth,
  segmentSphereHit,
  TARGET_BALLOON_HP,
  TARGET_BALLOON_RADIUS_M,
  TARGET_DRONE_HP,
  TARGET_DRONE_RADIUS_M,
  TARGET_RESPAWN_DELAY_S,
  type BulletPool,
  type Health,
} from '@air-combat/shared';

// Strzelnica testowa (faza-05.md krok 6): 1 nieruchomy balon + 2 drony krążące
// po okręgu ze stałą prędkością (bez AI — to ma być stabilny cel do kalibracji
// celowania z wyprzedzeniem). Cele NIE są samolotami; po fazie 6 zastąpią je boty.
// Sfera trafień = widoczny rozmiar, żeby trafienia czuć spójnie z tracerami.

interface Orbit {
  center: Vector3;
  radiusM: number;
  angSpeedRadS: number;
  phaseRad: number;
}

interface Target {
  label: string;
  health: Health;
  hitRadiusM: number;
  /** Bieżąca pozycja świata (aktualizowana co tick). */
  position: Vector3;
  mesh: Object3D;
  respawnTimerS: number;
  baseY: number;
  tS: number;
  orbit?: Orbit;
}

/** Zdarzenie trafienia dla warstwy efektów (hit marker, wybuch, kill feed). */
export interface TargetHit {
  position: Vector3;
  destroyed: boolean;
  label: string;
}

function buildBalloonMesh(): Object3D {
  const group = new Group();
  const skin = new MeshStandardMaterial({
    color: 0xc23a2f,
    emissive: 0x3a0a06,
    roughness: 0.7,
  });
  const body = new Mesh(new SphereGeometry(TARGET_BALLOON_RADIUS_M, 20, 16), skin);
  body.scale.y = 1.25; // lekko wydłużony jak balon zaporowy
  group.add(body);
  const basket = new Mesh(
    new BoxGeometry(3, 2.5, 3),
    new MeshStandardMaterial({ color: 0x6b5230, roughness: 0.9 }),
  );
  basket.position.y = -TARGET_BALLOON_RADIUS_M * 1.25 - 2;
  group.add(basket);
  return group;
}

function buildDroneMesh(): Object3D {
  const group = new Group();
  const skin = new MeshStandardMaterial({
    color: 0xf08a1e,
    emissive: 0x4a2700,
    roughness: 0.6,
  });
  const r = TARGET_DRONE_RADIUS_M;
  const body = new Mesh(new ConeGeometry(r * 0.5, r * 2, 12), skin);
  body.geometry.rotateX(Math.PI / 2); // nos w +Z (kierunek lotu)
  group.add(body);
  const wing = new Mesh(new BoxGeometry(r * 2.2, 0.3, r * 0.7), skin);
  group.add(wing);
  return group;
}

export class Targets {
  private readonly scene: Scene;
  private readonly targets: Target[] = [];

  constructor(scene: Scene) {
    this.scene = scene;
    this.add({
      label: 'Balon',
      maxHp: TARGET_BALLOON_HP,
      hitRadiusM: TARGET_BALLOON_RADIUS_M,
      mesh: buildBalloonMesh(),
      position: new Vector3(0, 850, -5200),
    });
    this.add({
      label: 'Dron',
      maxHp: TARGET_DRONE_HP,
      hitRadiusM: TARGET_DRONE_RADIUS_M,
      mesh: buildDroneMesh(),
      position: new Vector3(0, 800, -4900),
      orbit: { center: new Vector3(350, 800, -4900), radiusM: 380, angSpeedRadS: 0.25, phaseRad: 0 },
    });
    this.add({
      label: 'Dron',
      maxHp: TARGET_DRONE_HP,
      hitRadiusM: TARGET_DRONE_RADIUS_M,
      mesh: buildDroneMesh(),
      position: new Vector3(0, 760, -4600),
      orbit: {
        center: new Vector3(-450, 760, -4600),
        radiusM: 520,
        angSpeedRadS: -0.18,
        phaseRad: Math.PI,
      },
    });
  }

  private add(spec: {
    label: string;
    maxHp: number;
    hitRadiusM: number;
    mesh: Object3D;
    position: Vector3;
    orbit?: Orbit;
  }): void {
    const target: Target = {
      label: spec.label,
      health: createHealth(spec.maxHp),
      hitRadiusM: spec.hitRadiusM,
      position: spec.position.clone(),
      mesh: spec.mesh,
      respawnTimerS: 0,
      baseY: spec.position.y,
      tS: 0,
      orbit: spec.orbit,
    };
    target.mesh.position.copy(target.position);
    this.scene.add(target.mesh);
    this.targets.push(target);
  }

  /** Włącza/wyłącza strzelnicę (tryb treningu vs pojedynek): chowa/pokazuje cele. */
  setActive(active: boolean): void {
    for (const t of this.targets) t.mesh.visible = active && t.health.alive;
  }

  update(dtS: number): void {
    for (const t of this.targets) {
      t.tS += dtS;
      // ruch po okręgu (drony) lub delikatne bujanie (balon)
      if (t.orbit) {
        const a = t.orbit.phaseRad + t.orbit.angSpeedRadS * t.tS;
        t.position.set(
          t.orbit.center.x + Math.cos(a) * t.orbit.radiusM,
          t.baseY + Math.sin(t.tS * 0.5) * 4,
          t.orbit.center.z + Math.sin(a) * t.orbit.radiusM,
        );
      } else {
        t.position.y = t.baseY + Math.sin(t.tS * 0.6) * 1.5;
      }
      // pozycja PRZED lookAt — inaczej orientacja liczona ze starego miejsca
      t.mesh.position.copy(t.position);
      if (t.orbit) {
        // dziób drona wzdłuż stycznej toru (znak = kierunek obiegu)
        const a = t.orbit.phaseRad + t.orbit.angSpeedRadS * t.tS;
        const dir = Math.sign(t.orbit.angSpeedRadS);
        t.mesh.lookAt(
          t.position.x - Math.sin(a) * dir,
          t.position.y,
          t.position.z + Math.cos(a) * dir,
        );
      }

      if (!t.health.alive) {
        t.respawnTimerS -= dtS;
        if (t.respawnTimerS <= 0) {
          t.health.hp = t.health.maxHp;
          t.health.alive = true;
          t.mesh.visible = true;
        }
      }
    }
  }

  /**
   * Rozwiązuje trafienia pocisków w cele (odcinek prev→pos vs sfera). Trafiony
   * pocisk gaśnie; przy zniszczeniu celu chowa mesh i startuje timer respawnu.
   * `onHit` woła warstwę efektów (hit marker / wybuch / kill feed).
   */
  resolveBulletHits(pool: BulletPool, onHit: (hit: TargetHit) => void): void {
    for (const b of pool.bullets) {
      if (!b.active) continue;
      for (const t of this.targets) {
        if (!t.health.alive) continue;
        if (!segmentSphereHit(b.prevPosition, b.position, t.position, t.hitRadiusM)) continue;
        const destroyed = applyDamage(t.health, b.damage) === 'destroyed';
        b.active = false;
        if (destroyed) {
          t.respawnTimerS = TARGET_RESPAWN_DELAY_S;
          t.mesh.visible = false;
        }
        onHit({ position: b.position, destroyed, label: t.label });
        break; // pocisk zużyty — nie testuj kolejnych celów
      }
    }
  }
}
