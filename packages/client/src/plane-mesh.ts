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
import { DEFAULT_PLANE_TYPE, type PlaneType } from '@air-combat/shared';

// Rejestr modeli 3D per typ samolotu (faza 19b: drugi samolot). Każdy typ ma własny
// ModelSpec: URL, korektę orientacji do naszego body frame oraz NAZWANE węzły śmigła i
// podwozia (nazwy ze Sketchfaba są nic nieznaczące → trzymamy je w danych, nie zgadujemy
// regexem). Bf 109 dodatkowo ukrywa podwozie po NAZWIE MATERIAŁU (109_Landing_Gear..., Tire)
// — to odporne na re-eksport modelu. Błąd wczytania KAŻDEGO typu → bryła zastępcza (gra leci
// dalej). Spitfire bez zmian względem faz 7/14.

/**
 * Opis modelu 3D jednego typu. Pozycję/skalę/orientację reszta loadera liczy sama z bbox;
 * tu tylko to, czego z geometrii nie da się zgadnąć: orientacja źródła i które węzły to
 * śmigło/podwozie.
 */
interface ModelSpec {
  /** Ścieżka serwowana przez Vite z `assets/` (publicDir → ../../assets). */
  url: string;
  /**
   * Korekta orientacji modelu do naszego body frame (+Z nos, +Y góra, +X lewe skrzydło).
   * Orientacji ze Sketchfaba nie da się przewidzieć — ŚCIĄGA do strojenia wzrokowego:
   *   leci tyłem (nos w −Z) ........ y: 180
   *   leci bokiem .................. y: 90  lub  y: −90
   *   do góry nogami ............... z: 180
   *   nos w dół/górę (model Z-up) .. x: 90  lub  x: −90
   */
  fixEulerDeg: { x: number; y: number; z: number };
  /** Dokładne nazwy węzłów podwozia do ukrycia (po sanityzacji three: kropki znikają). */
  gearNodeNames: ReadonlySet<string>;
  /**
   * Opcjonalny wzorzec NAZWY MATERIAŁU podwozia — ukrywa mesh niezależnie od nazwy węzła
   * (Bf 109: 109_Landing_Gear_and_Exausts, Tire). Bardziej odporne niż nazwy węzłów.
   */
  gearMaterialRe: RegExp | null;
  /** Dokładne nazwy węzłów śmigła (kręcone jako całość). */
  propNodeNames: ReadonlySet<string>;
  /** Węzeł na osi wału (kołpak) — środek obrotu śmigła; null → bbox wszystkich węzłów śmigła. */
  hubNode: string | null;
  /** Węzły łopat wygaszane w tarczę przy obrotach; pusty → wszystkie węzły śmigła. */
  bladeNodes: ReadonlySet<string>;
}

/** Węzły dopasowane do tych wzorców znikają (podwozie schowane w locie) — wspólne dla typów. */
const GEAR_NAME_RE = /gear|wheel|undercarriage|landing|podwozie|ko[łl]o|strut|oleo|tire|tyre/i;
/** Węzły pasujące tu są kręcone jak śmigło — wspólne dla typów. */
const PROP_NAME_RE = /prop|spinner|airscrew|blade|śmig/i;

const MODEL_SPECS: Record<PlaneType, ModelSpec> = {
  // Spitfire ze Sketchfaba (barking_dogo) — konfiguracja z faz 7/14, nazwy węzłów z analizy
  // geometrii (Cube.004_128 → Cube004_128: three sanityzuje kropki do pustego znaku).
  spitfire: {
    url: '/models/spitfire/scene.gltf',
    fixEulerDeg: { x: 0, y: 0, z: 0 },
    gearNodeNames: new Set<string>([
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
    ]),
    gearMaterialRe: null,
    propNodeNames: new Set<string>(['Cube041_86', 'Circle_91']),
    hubNode: 'Circle_91',
    bladeNodes: new Set<string>(['Cube041_86']),
  },
  // Bf 109 ze Sketchfaba (Jankenstein) — faza 19b. Nazwy z bf109-web.glb (zachowane po
  // optymalizacji; kropki sanityzowane: Cube.030 → Cube030). Śmigło: spinner Cube030 + 3
  // łopaty Cube036/037/038. Podwozie po MATERIALE (pewniejsze niż nazwy goleni/kół) — uwaga:
  // dzieli materiał z wydechami, więc znikają też króćce wydechowe (akceptowalne w widoku lotu).
  // fixEulerDeg = best-guess {0,0,0}: jeśli model leci źle, popraw STOPNIE wg ściągi wyżej.
  bf109: {
    url: '/models/bf109/bf109-web.glb',
    fixEulerDeg: { x: 0, y: 0, z: 0 },
    gearNodeNames: new Set<string>([
      'Cube032',
      'Cylinder011',
      'Cylinder022',
      'Cylinder029',
      'Cylinder023',
      'Cylinder030',
    ]),
    gearMaterialRe: /landing_gear|exaust|exhaust|tire|tyre/i,
    propNodeNames: new Set<string>(['Cube030', 'Cube036', 'Cube037', 'Cube038']),
    hubNode: 'Cube030',
    bladeNodes: new Set<string>(['Cube036', 'Cube037', 'Cube038']),
  },
};

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
/**
 * Stała czasowa dochodzenia obrotów śmigła do wartości docelowej [s] — bezwładność
 * wirnika. Po zestrzeleniu (silnik martwy → cel 0) śmigło wytraca obroty i wreszcie
 * staje, zamiast zniknąć skokowo; łopaty „wyostrzają się" z tarczy w miarę zwalniania.
 */
const PROP_SPIN_TAU_S = 1.1;

const DEG_TO_RAD = Math.PI / 180;
const TAU = Math.PI * 2;

/** Model 3D samolotu: kontener do scenografii + hak do animacji co klatkę. */
export interface PlaneModel {
  /** Obiekt do dodania na scenę; fizyka ustawia jego position/quaternion. */
  object: Group;
  /**
   * Spełnia się, gdy asynchroniczne wczytanie modelu glTF dobiegło końca —
   * zarówno po sukcesie, jak i po błędzie (zostaje wtedy bryła zastępcza).
   * Ekran ładowania czeka na to, by menu pokazało się z gotowym modelem.
   */
  ready: Promise<void>;
  /**
   * Wołać co klatkę: kręci śmigłem proporcjonalnie do gazu (0..1).
   * `engineRunning=false` (zestrzelony wrak) → śmigło wytraca obroty.
   */
  update(dtS: number, throttle01: number, engineRunning?: boolean): void;
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
 * `bladeNodes` zawęża do łopat (kołpak zostaje pełny); pusty → cały pivot.
 */
function collectBladeMaterials(pivot: Group, bladeNodes: ReadonlySet<string>): Material[] {
  const roots: Object3D[] = [];
  if (bladeNodes.size > 0) {
    pivot.traverse((o) => {
      if (o.name && bladeNodes.has(o.name)) roots.push(o);
    });
  }
  const sources = roots.length > 0 ? roots : [pivot];
  const mats: Material[] = [];
  const prep = (mat: Material): Material => {
    const c = mat.clone();
    c.transparent = true;
    return c;
  };
  for (const root of sources) {
    root.traverse((o) => {
      if (!(o instanceof Mesh)) return;
      o.material = Array.isArray(o.material) ? o.material.map(prep) : prep(o.material);
      if (Array.isArray(o.material)) mats.push(...o.material);
      else mats.push(o.material);
    });
  }
  return mats;
}

function matchesGear(name: string, spec: ModelSpec): boolean {
  return spec.gearNodeNames.has(name) || GEAR_NAME_RE.test(name);
}

function matchesProp(name: string, spec: ModelSpec): boolean {
  return spec.propNodeNames.has(name) || (PROP_NAME_RE.test(name) && !GEAR_NAME_RE.test(name));
}

/** Czy któryś materiał mesha pasuje do wzorca podwozia (Bf 109: detekcja po materiale). */
function materialNameMatches(material: Material | Material[], re: RegExp): boolean {
  if (Array.isArray(material)) return material.some((m) => re.test(m.name));
  return re.test(material.name);
}

interface ModelRefs {
  prop: Object3D | null;
  propAxis: Vector3;
  bladeMats: Material[];
}

/**
 * Wczytuje model danego typu i podmienia placeholder w `group`. Skaluje model do
 * `targetWingspanM` (z fizyki), wyśrodkowuje, koryguje orientację osi, chowa podwozie i
 * namierza śmigło do animacji. Błąd wczytania NIE wywraca gry — zostaje bryła zastępcza,
 * a `refs` pozostaje pusty.
 */
async function loadPlaneModel(
  group: Group,
  placeholder: Group,
  targetWingspanM: number,
  refs: ModelRefs,
  spec: ModelSpec,
): Promise<void> {
  let gltf;
  try {
    gltf = await new GLTFLoader().loadAsync(spec.url);
  } catch (err) {
    console.warn(
      `[plane-mesh] Nie udało się wczytać modelu (${spec.url}) — używam bryły zastępczej.`,
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
    spec.fixEulerDeg.x * DEG_TO_RAD,
    spec.fixEulerDeg.y * DEG_TO_RAD,
    spec.fixEulerDeg.z * DEG_TO_RAD,
  );

  group.add(model);
  group.remove(placeholder);
  disposePlaceholder(placeholder);

  if (import.meta.env.DEV && DUMP_NODES) dumpNodeTree(model);

  // Podwozie: schowane w locie (ukrycie węzłów po nazwie i/lub po materiale; brak animacji chowania).
  let gearHidden = 0;
  model.traverse((o) => {
    if (o.name && matchesGear(o.name, spec)) {
      o.visible = false;
      gearHidden++;
      return;
    }
    if (spec.gearMaterialRe && o instanceof Mesh && materialNameMatches(o.material, spec.gearMaterialRe)) {
      o.visible = false;
      gearHidden++;
    }
  });

  // Śmigło: wszystkie pasujące węzły spięte pod jednym pivotem w piaście.
  const propNodes: Object3D[] = [];
  model.traverse((o) => {
    if (o.name && matchesProp(o.name, spec) && !propNodes.some((p) => isAncestor(p, o))) propNodes.push(o);
  });
  let hubNode: Object3D | null = null;
  if (spec.hubNode) {
    const wanted = spec.hubNode;
    model.traverse((o) => {
      if (!hubNode && o.name === wanted) hubNode = o;
    });
  }
  if (propNodes.length) {
    const pivot = buildSpinPivot(group, propNodes, hubNode);
    refs.prop = pivot;
    refs.propAxis = propLocalSpinAxis(group, pivot);
    refs.bladeMats = collectBladeMaterials(pivot, spec.bladeNodes);
  }

  if (import.meta.env.DEV) {
    console.info(
      `[plane-mesh] ${spec.url}: podwozie ukryte ${String(gearHidden)} węzł(y); ` +
        `śmigło ${String(propNodes.length)} węzł(y)${propNodes.length ? '' : ' (wskaż je: DUMP_NODES)'}`,
    );
  }
}

/** Czy `maybe` jest przodkiem `node` (do odsiania zagnieżdżonych dopasowań). */
function isAncestor(maybe: Object3D, node: Object3D): boolean {
  for (let p = node.parent; p; p = p.parent) if (p === maybe) return true;
  return false;
}

/**
 * Zwraca natychmiast model z bryłą zastępczą i startuje asynchroniczne wczytanie modelu 3D
 * danego typu (podmieni placeholder po udanym pobraniu). `targetWingspanM` = rozpiętość
 * skrzydeł [m] (z fizyki, helper `wingspanM`) do auto-skalowania.
 */
export function createPlaneMesh(type: PlaneType, targetWingspanM: number): PlaneModel {
  const spec = MODEL_SPECS[type] ?? MODEL_SPECS[DEFAULT_PLANE_TYPE];
  const group = new Group();
  const placeholder = buildPlaceholder();
  group.add(placeholder);

  const refs: ModelRefs = { prop: null, propAxis: new Vector3(0, 0, 1), bladeMats: [] };
  // loadPlaneModel nigdy nie rzuca (błąd → bryła zastępcza), więc `ready` domyka się
  // też przy nieudanym pobraniu — ekran ładowania nie zawiśnie.
  const ready = loadPlaneModel(group, placeholder, targetWingspanM, refs, spec);

  // Bieżące obroty śmigła [obr./s] — dochodzą do celu z bezwładnością (PROP_SPIN_TAU_S),
  // żeby zestrzelony silnik wytracał obroty płynnie, a nie zatrzymywał się skokowo.
  let currentRevPerS = PROP_IDLE_REV_S;

  return {
    object: group,
    ready,
    update(dtS, throttle01, engineRunning = true) {
      if (!refs.prop) return;
      const targetRevPerS = engineRunning
        ? PROP_IDLE_REV_S + throttle01 * (PROP_FULL_REV_S - PROP_IDLE_REV_S)
        : 0;
      // wygładzanie wykładnicze (niezależne od dt) — rdzeń wirnika dobiega do celu
      const k = 1 - Math.exp(-dtS / PROP_SPIN_TAU_S);
      currentRevPerS += (targetRevPerS - currentRevPerS) * k;
      refs.prop.rotateOnAxis(refs.propAxis, currentRevPerS * TAU * dtS);
      // iluzja rozmycia: im szybciej, tym bardziej przezroczyste łopaty — szybkie
      // i półprzezroczyste zlewają się w tarczę zamiast strobić ostrymi pozycjami
      const blur = clamp01(
        (currentRevPerS - PROP_BLUR_START_REV_S) / (PROP_BLUR_FULL_REV_S - PROP_BLUR_START_REV_S),
      );
      const opacity = 1 - blur * (1 - PROP_BLADE_MIN_OPACITY);
      for (const m of refs.bladeMats) m.opacity = opacity;
    },
  };
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
