import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  type Object3D,
  type Scene,
} from 'three';
import { emplacementBasePositions, type Terrain } from '@air-combat/shared';

// Wizualizacja naziemnego stanowiska ogniowego (Część 2). Proceduralnie z brył Three (decyzja:
// najlżejsza ścieżka dla fps/kontekstu, pełna kontrola, trywialne „zczernienie" przy zniszczeniu —
// fallback z życzenia usera „a jeżeli nie znajdziesz w sieci, sam wygeneruj"). Gniazdo: niski wał z
// worków z piaskiem (cylinder) + platforma + obrotnica z tarczą + dwie uniesione lufy. Pozycje
// liczone z `emplacementBasePositions` (ten sam seed terenu co serwer) — bez protokołu.

const SANDBAG_COLOR = 0x6f6a47; // oliwkowo-piaskowy (worki)
const FLOOR_COLOR = 0x4a4738;
const METAL_COLOR = 0x3c4036;
const BARREL_COLOR = 0x22241e;
/** Wspólny ciemny materiał zniszczonego (zwęglonego) stanowiska — podmieniany przy trafieniu. */
const CHAR_MATERIAL = new MeshStandardMaterial({ color: 0x141414, roughness: 1, metalness: 0 });

function part(geometry: BoxGeometry | CylinderGeometry, color: number, metalness = 0.1, roughness = 0.85): Mesh {
  return new Mesh(geometry, new MeshStandardMaterial({ color, metalness, roughness }));
}

/** Buduje pojedyncze stanowisko (origin = podstawa na gruncie; +Y w górę). */
export function createEmplacementGroup(): Group {
  const g = new Group();

  // wał z worków: niski, lekko stożkowy cylinder (otwarty u góry)
  const wall = part(new CylinderGeometry(3.0, 3.5, 1.3, 14, 1, true), SANDBAG_COLOR, 0, 0.95);
  wall.position.y = 0.65;
  g.add(wall);

  // platforma wewnątrz wału
  const floor = part(new CylinderGeometry(3.0, 3.0, 0.2, 14), FLOOR_COLOR, 0, 1);
  floor.position.y = 0.1;
  g.add(floor);

  // podstawa + obrotnica działa
  const base = part(new BoxGeometry(1.3, 0.5, 1.3), METAL_COLOR, 0.3, 0.7);
  base.position.y = 0.45;
  g.add(base);
  const mount = part(new BoxGeometry(0.85, 0.8, 0.85), METAL_COLOR, 0.3, 0.7);
  mount.position.y = 0.95;
  g.add(mount);

  // tarcza osłonowa z przodu (lekko nad obrotnicą)
  const shield = part(new BoxGeometry(1.7, 1.0, 0.16), METAL_COLOR, 0.35, 0.65);
  shield.position.set(0, 1.25, 0.55);
  g.add(shield);

  // dwie lufy uniesione ku niebu (AA), lekko rozstawione
  for (const dx of [-0.2, 0.2]) {
    const barrel = part(new CylinderGeometry(0.08, 0.09, 2.6, 8), BARREL_COLOR, 0.5, 0.5);
    barrel.position.set(dx, 1.7, 1.0);
    barrel.rotation.x = -Math.PI / 3; // ~60° nad poziom (lufy w górę-przód)
    g.add(barrel);
  }

  return g;
}

/** Tworzy meshe wszystkich stanowisk i dodaje je do sceny (statyczne; widoczne też w poczekalni jak teren). */
export function buildEmplacements(scene: Scene, terrain: Terrain): Group[] {
  return emplacementBasePositions(terrain).map((p) => {
    const g = createEmplacementGroup();
    g.position.copy(p);
    scene.add(g);
    return g;
  });
}

/** Zwęgla stanowisko (podmiana materiałów na ciemny; oryginały w userData) — odwracalne. */
export function charEmplacement(group: Object3D): void {
  group.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    if (mesh.userData['origMat'] === undefined) mesh.userData['origMat'] = mesh.material;
    mesh.material = CHAR_MATERIAL;
  });
}

/** Przywraca oryginalne materiały stanowiska (nowy mecz / odbudowa). */
export function restoreEmplacement(group: Object3D): void {
  group.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    const orig = mesh.userData['origMat'] as Mesh['material'] | undefined;
    if (orig) mesh.material = orig;
  });
}
