import {
  Box3,
  BoxGeometry,
  ConeGeometry,
  Group,
  type Material,
  Mesh,
  MeshStandardMaterial,
  type Object3D,
  Quaternion,
  Vector3,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/**
 * Ścieżka modelu serwowana przez Vite z `assets/` (publicDir → ../../assets).
 * Rozpakuj paczkę "glTF" ze Sketchfaba do `assets/models/spitfire/`, tak by
 * istniał `assets/models/spitfire/scene.gltf`. Pojedynczy plik glb → zmień na
 * '/models/spitfire.glb'. Patrz assets/models/spitfire/README.md.
 */
const MODEL_URL = '/models/spitfire/scene.gltf';

/**
 * Korekta orientacji modelu do naszego body frame (+Z nos, +Y góra, +X lewe
 * skrzydło). Orientacji modelu ze Sketchfaba nie da się przewidzieć z góry.
 * JEŚLI po wczytaniu samolot leci nie tak — popraw te STOPNIE (ściąga):
 *   leci tyłem (nos w −Z) ........ y: 180
 *   leci bokiem .................. y: 90  lub  y: −90
 *   do góry nogami ............... z: 180
 *   nos w dół/górę (model Z-up) .. x: 90  lub  x: −90
 */
const MODEL_FIX_EULER_DEG = { x: 0, y: 0, z: 0 };

/** Węzły dopasowane do tych wzorców znikają (podwozie schowane w locie). */
const GEAR_NAME_RE = /gear|wheel|undercarriage|landing|podwozie|ko[łl]o|strut|oleo|tire|tyre/i;
/** Węzły pasujące tu są kręcone jak śmigło. */
const PROP_NAME_RE = /prop|spinner|airscrew|blade|śmig/i;

// Model ze Sketchfaba ma nic nieznaczące nazwy węzłów (Cube043_12, …), więc
// poza wzorcami trzymamy DOKŁADNE nazwy wskazane ręcznie (dev: Alt+klik).
// Nazwy ustalone z analizy geometrii scene.gltf (tmp-analyze-gltf): kropki
// z glTF three sanityzuje do pustego znaku (Cube.004_128 → Cube004_128).
/** Dokładne nazwy węzłów podwozia do ukrycia (golenie + koła główne, pary L/P). */
const GEAR_NODE_NAMES = new Set<string>([
  'Cube004_128',
  'Cube022_116',
  'Cylinder012_111',
  'Cylinder046_132',
  'Cylinder004_113',
  'Cylinder033_131',
  'Cube032_112',
  'Cube006_130',
  'Cylinder013_110',
  'Cylinder027_129',
]);
/** Dokładne nazwy węzłów śmigła (kręcone jako całość): łopaty + kołpak. */
const PROP_NODE_NAMES = new Set<string>(['Cube041_86', 'Circle_91']);
/** Węzeł leżący na osi wału (kołpak) — wyznacza środek obrotu śmigła. */
const PROP_HUB_NODE = 'Circle_91';
/** Węzeł łopat (bez kołpaka) — tylko on jest wygaszany do tarczy przy obrotach. */
const PROP_BLADE_NODE = 'Cube041_86';

/** Dev: ustaw na true, by wypisać drzewo węzłów modelu (np. po podmianie .glb). */
const DUMP_NODES = false;

// Obroty śmigła [obr./s] — czysto wizualne. Trzymane wysoko (wrażenie mocy);
// aliasing (wagon-wheel) maskujemy wygaszaniem łopat do półprzezroczystej tarczy.
const PROP_IDLE_REV_S = 6;
const PROP_FULL_REV_S = 30;
// Zakres RPM, na którym łopaty przechodzą z pełnych w rozmytą tarczę.
const PROP_BLUR_START_REV_S = 12;
const PROP_BLUR_FULL_REV_S = 24;
/** Minimalna nieprzezroczystość łopat przy pełnych obrotach (iluzja rozmycia). */
const PROP_BLADE_MIN_OPACITY = 0.2;

const DEG_TO_RAD = Math.PI / 180;
const TAU = Math.PI * 2;

/** Model 3D samolotu: kontener do scenografii + hak do animacji co klatkę. */
export interface PlaneModel {
  /** Obiekt do dodania na scenę; fizyka ustawia jego position/quaternion. */
  object: Group;
  /** Wołać co klatkę: kręci śmigłem proporcjonalnie do gazu (0..1). */
  update(dtS: number, throttle01: number): void;
}

/**
 * Bryła zastępcza samolotu z prymitywów (faza 2) — stożek kadłuba + skrzydła
 * + usterzenie. Zbudowana w body frame: +Z nos, +Y góra, +X lewe skrzydło.
 * Wymiary tylko wizualne (≈ sylwetka myśliwca), bez znaczenia dla fizyki.
 * Używana też jako fallback, gdy modelu 3D nie udało się wczytać.
 */
function buildPlaceholder(): Group {
  const group = new Group();
  const fuselageMat = new MeshStandardMaterial({ color: 0x5a7d4a });
  const wingMat = new MeshStandardMaterial({ color: 0x6e8e5e });

  const fuselage = new Mesh(new ConeGeometry(0.55, 7, 12), fuselageMat);
  fuselage.geometry.rotateX(Math.PI / 2); // stożek domyślnie celuje w +Y → nos w +Z
  group.add(fuselage);

  const wings = new Mesh(new BoxGeometry(11, 0.16, 1.9), wingMat);
  wings.position.set(0, -0.1, 0.4);
  group.add(wings);

  const tailplane = new Mesh(new BoxGeometry(4, 0.12, 1.1), wingMat);
  tailplane.position.set(0, 0, -3);
  group.add(tailplane);

  const fin = new Mesh(new BoxGeometry(0.12, 1.3, 1.1), wingMat);
  fin.position.set(0, 0.65, -3);
  group.add(fin);

  return group;
}

function disposePlaceholder(group: Group): void {
  group.traverse((obj) => {
    if (obj instanceof Mesh) {
      obj.geometry.dispose();
      const mat = obj.material;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else mat.dispose();
    }
  });
}

/** Dev: wypisz drzewo nazwanych węzłów modelu (do namierzenia śmigła/podwozia). */
function dumpNodeTree(root: Object3D): void {
  const lines: string[] = [];
  root.traverse((o) => {
    if (!o.name) return;
    let depth = 0;
    for (let p = o.parent; p && p !== root.parent; p = p.parent) depth++;
    lines.push(`${'  '.repeat(depth)}${o.name} [${o.type}]`);
  });
  console.info(`[plane-mesh] węzły modelu:\n${lines.join('\n')}`);
}

/**
 * Lokalna oś obrotu śmigła = nos samolotu (+Z grupy) wyrażony w układzie
 * lokalnym węzła śmigła. Liczona raz, niezależna od bieżącej orientacji
 * fizyki (chwilowo zerujemy obrót grupy, by wyciąć go z rachunku).
 */
function propLocalSpinAxis(group: Group, prop: Object3D): Vector3 {
  const savedQ = group.quaternion.clone();
  group.quaternion.identity();
  group.updateMatrixWorld(true);
  const q = new Quaternion();
  prop.matrixWorld.decompose(new Vector3(), q, new Vector3());
  const axis = new Vector3(0, 0, 1).applyQuaternion(q.invert()).normalize();
  group.quaternion.copy(savedQ);
  group.updateMatrixWorld(true);
  return axis;
}

/**
 * Spina węzły śmigła pod jednym pivotem ustawionym w środku piasty (wspólny
 * bbox), tak by obrót pivota kręcił całością wokół właściwej osi. `attach`
 * zachowuje transformację świata każdego węzła.
 */
function buildSpinPivot(group: Group, nodes: Object3D[], hubNode: Object3D | null): Group {
  // KLUCZOWE: model dostał już skalę/pozycję/obrót — odśwież cały podgraf, inaczej
  // bbox liczy się ze starych macierzy i pivot ląduje przy zerze świata (śmigło
  // zaczyna wtedy orbitować daleki punkt zamiast kręcić się w miejscu).
  group.updateMatrixWorld(true);
  // Środek piasty z węzła kołpaka (leży na osi wału). Wspólny bbox łopat bywa
  // niesymetryczny w pionie i przesuwałby oś obrotu obok rzeczywistej piasty.
  const box = new Box3();
  if (hubNode) {
    box.setFromObject(hubNode);
  } else {
    const tmp = new Box3();
    nodes.forEach((n) => box.union(tmp.setFromObject(n)));
  }
  const hubWorld = box.getCenter(new Vector3());
  const pivot = new Group();
  group.add(pivot);
  group.updateMatrixWorld(true);
  pivot.position.copy(group.worldToLocal(hubWorld));
  pivot.updateMatrixWorld(true);
  nodes.forEach((n) => pivot.attach(n));
  pivot.updateMatrixWorld(true);
  return pivot;
}

/**
 * Klonuje materiały łopat (dzielą materiał z kadłubem!) i włącza im
 * przezroczystość, by dało się je wygaszać niezależnie od reszty modelu.
 * Kołpak pomijamy — ma zostać pełny.
 */
function collectBladeMaterials(pivot: Group): Material[] {
  let bladeRoot: Object3D | null = null;
  pivot.traverse((o) => {
    if (!bladeRoot && o.name === PROP_BLADE_NODE) bladeRoot = o;
  });
  const mats: Material[] = [];
  const prep = (mat: Material): Material => {
    const c = mat.clone();
    c.transparent = true;
    return c;
  };
  (bladeRoot ?? pivot).traverse((o) => {
    if (!(o instanceof Mesh)) return;
    o.material = Array.isArray(o.material) ? o.material.map(prep) : prep(o.material);
    if (Array.isArray(o.material)) mats.push(...o.material);
    else mats.push(o.material);
  });
  return mats;
}

function matchesGear(name: string): boolean {
  return GEAR_NODE_NAMES.has(name) || GEAR_NAME_RE.test(name);
}

function matchesProp(name: string): boolean {
  return PROP_NODE_NAMES.has(name) || (PROP_NAME_RE.test(name) && !GEAR_NAME_RE.test(name));
}

interface ModelRefs {
  prop: Object3D | null;
  propAxis: Vector3;
  bladeMats: Material[];
}

/**
 * Wczytuje model Spitfire'a i podmienia placeholder w `group`. Skaluje model
 * do `targetWingspanM` (z fizyki), wyśrodkowuje, koryguje orientację osi,
 * chowa podwozie i namierza śmigło do animacji. Błąd wczytania NIE wywraca
 * gry — zostaje bryła zastępcza, a `refs` pozostaje pusty.
 */
async function loadSpitfireModel(
  group: Group,
  placeholder: Group,
  targetWingspanM: number,
  refs: ModelRefs,
): Promise<void> {
  let gltf;
  try {
    gltf = await new GLTFLoader().loadAsync(MODEL_URL);
  } catch (err) {
    console.warn(
      `[plane-mesh] Nie udało się wczytać modelu (${MODEL_URL}) — używam bryły zastępczej. ` +
        `Wgraj model do assets/models/spitfire/ (patrz README).`,
      err,
    );
    return;
  }

  const model = gltf.scene;
  model.updateMatrixWorld(true);

  // Auto-skala + wyśrodkowanie liczone z bbox w jednostkach modelu (jednorazowo).
  const box = new Box3().setFromObject(model);
  const size = box.getSize(new Vector3());
  const center = box.getCenter(new Vector3());
  // myśliwiec: rozpiętość > długość, więc większy wymiar poziomy = rozpiętość,
  // niezależnie od tego, którą osią poziomą zorientowany jest model.
  const horizontalSpan = Math.max(size.x, size.z) || 1;
  const scale = targetWingspanM / horizontalSpan;

  model.scale.setScalar(scale);
  // po przeskalowaniu środek przesuwa się o center*scale → cofamy, by pivot
  // (origin grupy, którym kręci fizyka) leżał w środku samolotu
  model.position.copy(center).multiplyScalar(-scale);
  model.rotation.set(
    MODEL_FIX_EULER_DEG.x * DEG_TO_RAD,
    MODEL_FIX_EULER_DEG.y * DEG_TO_RAD,
    MODEL_FIX_EULER_DEG.z * DEG_TO_RAD,
  );

  group.add(model);
  group.remove(placeholder);
  disposePlaceholder(placeholder);

  if (import.meta.env.DEV && DUMP_NODES) dumpNodeTree(model);

  // Podwozie: schowane w locie (na razie ukrycie węzłów; brak animacji chowania).
  let gearHidden = 0;
  model.traverse((o) => {
    if (o.name && matchesGear(o.name)) {
      o.visible = false;
      gearHidden++;
    }
  });

  // Śmigło: wszystkie pasujące węzły spięte pod jednym pivotem w piaście.
  const propNodes: Object3D[] = [];
  model.traverse((o) => {
    if (o.name && matchesProp(o.name) && !propNodes.some((p) => isAncestor(p, o))) propNodes.push(o);
  });
  let hubNode: Object3D | null = null;
  model.traverse((o) => {
    if (!hubNode && o.name === PROP_HUB_NODE) hubNode = o;
  });
  if (propNodes.length) {
    const pivot = buildSpinPivot(group, propNodes, hubNode);
    refs.prop = pivot;
    refs.propAxis = propLocalSpinAxis(group, pivot);
    refs.bladeMats = collectBladeMaterials(pivot);
  }

  if (import.meta.env.DEV) {
    console.info(
      `[plane-mesh] podwozie ukryte: ${gearHidden} węzł(y); ` +
        `śmigło: ${propNodes.length} węzł(y)${propNodes.length ? '' : ' (wskaż je: Alt+klik)'}`,
    );
  }
}

/** Czy `maybe` jest przodkiem `node` (do odsiania zagnieżdżonych dopasowań). */
function isAncestor(maybe: Object3D, node: Object3D): boolean {
  for (let p = node.parent; p; p = p.parent) if (p === maybe) return true;
  return false;
}

/**
 * Zwraca natychmiast model z bryłą zastępczą i startuje asynchroniczne
 * wczytanie modelu 3D (podmieni placeholder po udanym pobraniu).
 * `targetWingspanM` = rozpiętość skrzydeł [m] (z fizyki) do auto-skalowania.
 */
export function createPlaneMesh(targetWingspanM: number): PlaneModel {
  const group = new Group();
  const placeholder = buildPlaceholder();
  group.add(placeholder);

  const refs: ModelRefs = { prop: null, propAxis: new Vector3(0, 0, 1), bladeMats: [] };
  void loadSpitfireModel(group, placeholder, targetWingspanM, refs);

  return {
    object: group,
    update(dtS, throttle01) {
      if (!refs.prop) return;
      const revPerS = PROP_IDLE_REV_S + throttle01 * (PROP_FULL_REV_S - PROP_IDLE_REV_S);
      refs.prop.rotateOnAxis(refs.propAxis, revPerS * TAU * dtS);
      // iluzja rozmycia: im szybciej, tym bardziej przezroczyste łopaty — szybkie
      // i półprzezroczyste zlewają się w tarczę zamiast strobić ostrymi pozycjami
      const blur = clamp01(
        (revPerS - PROP_BLUR_START_REV_S) / (PROP_BLUR_FULL_REV_S - PROP_BLUR_START_REV_S),
      );
      const opacity = 1 - blur * (1 - PROP_BLADE_MIN_OPACITY);
      for (const m of refs.bladeMats) m.opacity = opacity;
    },
  };
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
