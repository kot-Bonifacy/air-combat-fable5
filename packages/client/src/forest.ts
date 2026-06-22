import {
  Box3,
  DoubleSide,
  type Group,
  InstancedMesh,
  type Material,
  Matrix4,
  Mesh,
  type Object3D,
  Quaternion,
  type Scene,
  Vector3,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { SEA_LEVEL_M, type Terrain } from '@air-combat/shared';

// Las MIESZANY (doszlif 2026-06-22): instancing kilku gatunków drzew na niższych, łagodnych
// zielonych zboczach, w kępach. Modele z Polyhaven (CC0) — oryginały to skany fotogrametryczne
// 0,5–1 GB (~7–14 mln trójkątów), nieużywalne wprost; odchudzone pipeline'em gltf-transform
// (simplify ~1% trójkątów + tekstury 1024 px WebP q92 + Draco) do ~2–5 MB. NIE używać `optimize`
// (jego `join` scala osobne drzewa modelu w jeden blok → instancja byłaby identyczną grupą). Każdy
// model bywa „kępą" kilku osobnych drzew (np. jodła i sosna po 3) → traktujemy KAŻDE drzewo jako
// osobny prototyp sadzony pojedynczo i losowo (las nie jest jednolity). Czysto wizualne i LOKALNE
// (klient): drzewa BEZ kolizji, NIE synchronizowane w MP (jak chmury). Foliage modeli to karty z alfą
// (alphaMode BLEND) → zamieniamy na alphaTest (instancing nie lubi półprzezroczystości — sortowanie).

/** Gatunki drzew: model, docelowa wysokość NAJWYŻSZEGO drzewa w modelu [m] i waga udziału w lesie. */
interface Species {
  url: string;
  topM: number;
  weight: number;
}
const SPECIES: readonly Species[] = [
  { url: '/models/fir/fir-web.glb', topM: 26, weight: 3 }, // jodły (3 warianty) — alpejskie iglaki
  { url: '/models/pine/pine-web.glb', topM: 31, weight: 3 }, // sosny (3 warianty) — wyższe, smuklejsze
  { url: '/models/broadleaf/broadleaf-web.glb', topM: 19, weight: 2 }, // liściaste — niżej, dla różnorodności
];

/** Twardy limit liczby drzew (wydajność) — kilkaset modeli wystarcza na kępy; łatwo stroić. */
const TREE_COUNT = 300;
/** Wariacja skali per drzewo (±) — by nawet ten sam wariant nie wyglądał na sklonowany. */
const TREE_SCALE_JITTER = 0.28;
/** Pas wysokości terenu, w którym sadzimy: nad plażą i poniżej linii skały (~440 m w shaderze). */
const TREE_MIN_TERRAIN_H = SEA_LEVEL_M + 18;
const TREE_MAX_TERRAIN_H = 380;
/** Maks. nachylenie (tan kąta) — drzewa na łagodnych stokach, nie na klifach. */
const TREE_MAX_SLOPE = 0.55;
/** Kępy lasu — środki rozrzucane w obrębie lądu, drzewa skupione wokół nich. */
const CLUSTER_COUNT = 18;
const CLUSTER_RADIUS_M = 340;
const PLACEMENT_HALF_M = 3_000;
const FOREST_SEED = 0x0f0235;

const UP = new Vector3(0, 1, 0);
/** Powyżej tego ior to artefakt eksportu/kompresji (jak w plane-mesh.ts) → przywróć dielektryk. */
const MAX_PHYSICAL_IOR = 2.5;

interface Placement {
  x: number;
  z: number;
  y: number;
  rotY: number;
  scale: number;
  /** [0,1) — wybór prototypu (ważony spośród wszystkich drzew wszystkich gatunków). */
  variant: number;
}

/** mulberry32 — deterministyczny RNG: ten sam las w obrębie sesji (i u wszystkich klientów). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Nachylenie terenu (tan kąta) z różnic skończonych heightAt — drzewa omijają klify. */
function slopeAt(terrain: Terrain, x: number, z: number): number {
  const d = 24;
  const dhx = terrain.heightAt(x + d, z) - terrain.heightAt(x - d, z);
  const dhz = terrain.heightAt(x, z + d) - terrain.heightAt(x, z - d);
  return Math.hypot(dhx, dhz) / (2 * d);
}

/** Punkt nadaje się pod drzewo: w pasie wysokości i na łagodnym stoku (nie woda, nie skała, nie klif). */
function plantable(terrain: Terrain, x: number, z: number): boolean {
  const h = terrain.heightAt(x, z);
  if (h < TREE_MIN_TERRAIN_H || h > TREE_MAX_TERRAIN_H) return false;
  return slopeAt(terrain, x, z) <= TREE_MAX_SLOPE;
}

/** Deterministyczne pozycje drzew: kępy wokół losowych środków, odrzucanie nieodpowiednich punktów. */
function generatePlacements(terrain: Terrain): Placement[] {
  const rng = mulberry32(FOREST_SEED);
  // środki kęp tylko tam, gdzie da się sadzić (inaczej kępa „w wodzie" marnuje próby)
  const centers: { x: number; z: number }[] = [];
  for (let guard = 0; centers.length < CLUSTER_COUNT && guard < CLUSTER_COUNT * 40; guard++) {
    const x = (rng() * 2 - 1) * PLACEMENT_HALF_M;
    const z = (rng() * 2 - 1) * PLACEMENT_HALF_M;
    if (plantable(terrain, x, z)) centers.push({ x, z });
  }
  if (centers.length === 0) return [];

  const placements: Placement[] = [];
  for (let guard = 0; placements.length < TREE_COUNT && guard < TREE_COUNT * 40; guard++) {
    const c = centers[Math.floor(rng() * centers.length)]!;
    // rozkład skupiony do środka kępy (rng·rng zamiast sqrt) — gęściej w środku, rzadziej na obrzeżu
    const ang = rng() * Math.PI * 2;
    const rad = rng() * rng() * CLUSTER_RADIUS_M;
    const x = c.x + Math.cos(ang) * rad;
    const z = c.z + Math.sin(ang) * rad;
    if (!plantable(terrain, x, z)) continue;
    placements.push({
      x,
      z,
      y: terrain.heightAt(x, z),
      rotY: rng() * Math.PI * 2,
      scale: 1 + (rng() * 2 - 1) * TREE_SCALE_JITTER,
      variant: rng(),
    });
  }
  return placements;
}

function asArray(material: Material | Material[]): Material[] {
  return Array.isArray(material) ? material : [material];
}

/**
 * Przygotowanie materiałów drzewa do instancingu: foliage (karty z alfą, BLEND) → alphaTest
 * (bez sortowania, depthWrite on, dwustronne, bo to płaszczyzny). Plus neutralizacja absurdalnego
 * ior wstrzykniętego przez kompresję (jak w plane-mesh.ts — inaczej materiał staje się lustrem).
 */
function prepareMaterial(material: Material | Material[]): void {
  for (const m of asArray(material)) {
    const phys = m as { ior?: number };
    if (typeof phys.ior === 'number' && phys.ior > MAX_PHYSICAL_IOR) phys.ior = 1.5;
    if (m.transparent) {
      m.transparent = false;
      m.alphaTest = 0.5;
      m.depthWrite = true;
      m.side = DoubleSide;
      m.needsUpdate = true;
    }
  }
}

/** Jeden wspólny dekoder Draco + loader (te same pliki dekodera co Bf 109: publicDir → assets/draco). */
function makeLoader(): GLTFLoader {
  const draco = new DRACOLoader();
  draco.setDecoderPath('/draco/');
  const loader = new GLTFLoader();
  loader.setDRACOLoader(draco);
  return loader;
}

/** Jedna geometria + materiał + macierz lokalna (geometria → przestrzeń prototypu, podstawa w y=0). */
interface SubMesh {
  geometry: Mesh['geometry'];
  material: Mesh['material'];
  local: Matrix4;
}
/** Prototyp = jedno drzewo (zestaw pod-meshy) z wagą udziału w lesie. */
interface Prototype {
  subs: SubMesh[];
  weight: number;
}

function hasMesh(node: Object3D): boolean {
  let found = false;
  node.traverse((o) => {
    if (o instanceof Mesh) found = true;
  });
  return found;
}

/**
 * Buduje prototyp drzewa z węzła modelu: zbiera jego pod-meshe i przesuwa je tak, by PODSTAWA pnia
 * tego konkretnego drzewa leżała w y=0, a pień był wyśrodkowany w x/z (macierze już po skali modelu).
 */
function buildPrototype(node: Object3D, weight: number): Prototype {
  const box = new Box3().setFromObject(node);
  const center = box.getCenter(new Vector3());
  const offset = new Matrix4().makeTranslation(-center.x, -box.min.y, -center.z);
  const subs: SubMesh[] = [];
  node.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    prepareMaterial(o.material);
    subs.push({
      geometry: o.geometry,
      material: o.material,
      local: offset.clone().multiply(o.matrixWorld),
    });
  });
  return { subs, weight };
}

/** Wczytuje jeden gatunek i zwraca jego prototypy (drzewa), każdy z wagą = waga gatunku / liczba drzew. */
async function loadSpecies(loader: GLTFLoader, species: Species): Promise<Prototype[]> {
  const gltf = await loader.loadAsync(species.url);
  const model: Group = gltf.scene;
  // JEDNA wspólna skala (topM / wysokość modelu) → zachowane proporcje między drzewami w modelu
  model.updateMatrixWorld(true);
  const size = new Box3().setFromObject(model).getSize(new Vector3());
  model.scale.setScalar(species.topM / (size.y || 1));
  model.updateMatrixWorld(true);
  // prototypy = węzły-drzewa (bezpośrednie dzieci sceny z geometrią); fallback: cały model jako 1
  const nodes = model.children.filter(hasMesh);
  const protoNodes = nodes.length > 0 ? nodes : [model];
  const w = species.weight / protoNodes.length;
  return protoNodes.map((n) => buildPrototype(n, w));
}

/**
 * Sadzi mieszany las na scenie (asynchronicznie — drzewa pojawią się po wczytaniu modeli).
 * Awaria pojedynczego gatunku nie wywraca reszty (Promise.allSettled); brak modeli = świat bez drzew.
 * Drzewa są statyczne (brak update co klatkę).
 */
export function createForest(scene: Scene, terrain: Terrain): void {
  const placements = generatePlacements(terrain);
  if (placements.length === 0) return;

  const loader = makeLoader();
  void Promise.allSettled(SPECIES.map((s) => loadSpecies(loader, s))).then((results) => {
    const prototypes: Prototype[] = [];
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') prototypes.push(...r.value);
      else console.warn(`[forest] gatunek ${SPECIES[i]!.url} nie wczytany.`, r.reason);
    });
    if (prototypes.length === 0) return;

    // ważony wybór prototypu po polu `variant`: skumulowane wagi w skali [0,1)
    const totalW = prototypes.reduce((s, p) => s + p.weight, 0);
    const cum: number[] = [];
    let acc = 0;
    for (const p of prototypes) {
      acc += p.weight / totalW;
      cum.push(acc);
    }
    const buckets: Placement[][] = prototypes.map(() => []);
    for (const p of placements) {
      let idx = cum.findIndex((c) => p.variant < c);
      if (idx < 0) idx = prototypes.length - 1;
      buckets[idx]!.push(p);
    }

    const m = new Matrix4();
    const place = new Matrix4();
    const q = new Quaternion();
    const pos = new Vector3();
    const scl = new Vector3();
    prototypes.forEach((proto, pi) => {
      const list = buckets[pi]!;
      if (list.length === 0) return;
      for (const sub of proto.subs) {
        const inst = new InstancedMesh(sub.geometry, sub.material, list.length);
        // bryła otaczająca instancingu liczona z origin, nie z rozrzutu instancji → frustum
        // culling odcinałby cały las, gdy środek wyspy poza kadrem. Przy kilkuset drzewach
        // taniej wyłączyć culling niż utrzymywać sztuczną bryłę.
        inst.frustumCulled = false;
        for (let i = 0; i < list.length; i++) {
          const p = list[i]!;
          pos.set(p.x, p.y, p.z);
          q.setFromAxisAngle(UP, p.rotY);
          scl.setScalar(p.scale);
          place.compose(pos, q, scl);
          // świat = umiejscowienie · (geometria → prototyp z podstawą w 0)
          m.multiplyMatrices(place, sub.local);
          inst.setMatrixAt(i, m);
        }
        inst.instanceMatrix.needsUpdate = true;
        scene.add(inst);
      }
    });
  });
}
