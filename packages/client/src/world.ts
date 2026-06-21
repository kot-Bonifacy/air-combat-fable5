import {
  AmbientLight,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  Fog,
  Mesh,
  MeshLambertMaterial,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
  TextureLoader,
  Vector3,
} from 'three';
import { Lensflare, LensflareElement } from 'three/examples/jsm/objects/Lensflare.js';
import type { Terrain } from '@air-combat/shared';

// Świat fazy 4 → Faza 20 (teren v2): JEDEN mesh wyspy (vertex colors wg wysokości
// + szum, flat shading), płaszczyzna oceanu, kopuła nieba (gradient + glow słońca)
// i mgła dystansowa. Mgła celowo maskuje brak LOD (faza-04.md) — to feature.
// Faza 20 „złota godzina lekka": ciepłe światło kierunkowe + chłodne wypełnienie,
// słońce z lens flare (three.js examples), cieplejszy horyzont/mgła.

/** Kolor mgły = kolor horyzontu nieba — zlewają się w jedną linię (ciepły, złota godzina). */
export const HORIZON_COLOR = 0xe6d2b0;
const ZENITH_COLOR = 0x315f9e;
const FOG_NEAR_M = 2_500;
const FOG_FAR_M = 12_500;
const OCEAN_SIZE_M = 44_000;
const OCEAN_COLOR = 0x1a4a60;
const SKY_RADIUS_M = 24_000;

// --- Słońce (jedno źródło prawdy: światło kierunkowe + glow nieba + lens flare) ---
/** Kierunek DO słońca (znormalizowany). Niskie popołudniowe słońce ~23° nad horyzontem. */
const SUN_DIR = new Vector3(0.45, 0.42, 0.79).normalize();
/** Dystans tarczy słońca od kamery [m] — wewnątrz kopuły nieba, przed jej tylną ścianą. */
const SUN_DISTANCE_M = 20_000;
const SUN_GLOW_COLOR = new Color(0xffe7b8);
/** Ciepłe światło kluczowe (złota godzina) — intensywność zachowana, by nie rozstroić PBR samolotów. */
const SUN_LIGHT_COLOR = 0xffe6c4;
const SUN_LIGHT_INTENSITY = 1.25;
/** Chłodne wypełnienie nieba równoważy ciepłe słońce — łączna ekspozycja ≈ jak przed fazą 20. */
const AMBIENT_COLOR = 0xc4d2e4;
const AMBIENT_INTENSITY = 0.4;

// Pasma wysokości wyspy: plaża → trawa → skała → śnieg, z miękkim przejściem.
const SAND_COLOR = new Color(0xd0bd80);
const GRASS_COLOR = new Color(0x4f7a3e);
const ROCK_COLOR = new Color(0x726c61);
const SNOW_COLOR = new Color(0xf1f4f6);
/** Górne granice pasm [m]. */
const SAND_TOP_M = 6;
const GRASS_TOP_M = 340;
const ROCK_TOP_M = 820;
/** Połowa szerokości strefy mieszania kolorów wokół granicy pasma [m]. */
const BAND_BLEND_M = 25;
/** Kolor dna pod wodą (widoczne płycizny przy plaży). */
const SEABED_COLOR = new Color(0x2c5066);

/** Domieszaj kolor wyższego pasma, gdy hM przekracza granicę edgeM (±BAND_BLEND_M). */
function mixAbove(out: Color, next: Color, hM: number, edgeM: number): void {
  if (hM <= edgeM - BAND_BLEND_M) return;
  out.lerp(next, Math.min(1, (hM - (edgeM - BAND_BLEND_M)) / (2 * BAND_BLEND_M)));
}

function colorForHeight(hM: number, out: Color): Color {
  if (hM <= 0) return out.copy(SEABED_COLOR);
  out.copy(SAND_COLOR);
  mixAbove(out, GRASS_COLOR, hM, SAND_TOP_M);
  mixAbove(out, ROCK_COLOR, hM, GRASS_TOP_M);
  mixAbove(out, SNOW_COLOR, hM, ROCK_TOP_M);
  return out;
}

/** Amplituda szumu jasności per-węzeł — rozbija płaskie pasma na żywszy teren. */
const COLOR_NOISE_AMP = 0.06;
/**
 * Deterministyczny szum w [-1, 1] z indeksów węzła (hash całkowitoliczbowy) —
 * ten sam świat po obu stronach sieci, bez zależności od kolejności renderu.
 */
function nodeColorNoise(ix: number, iz: number): number {
  let h = (ix * 374761393 + iz * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  h ^= h >>> 16;
  return (h & 0xffff) / 0x7fff - 1;
}

function createIslandMesh(terrain: Terrain): Mesh {
  const n = terrain.gridN;
  const positions = new Float32Array(n * n * 3);
  const colors = new Float32Array(n * n * 3);
  const scratchColor = new Color();
  for (let iz = 0; iz < n; iz++) {
    for (let ix = 0; ix < n; ix++) {
      const i3 = (iz * n + ix) * 3;
      const hM = terrain.nodeHeightM(ix, iz);
      positions[i3] = terrain.nodeCoordM(ix);
      positions[i3 + 1] = hM;
      positions[i3 + 2] = terrain.nodeCoordM(iz);
      colorForHeight(hM, scratchColor);
      // szum jasności tylko na lądzie (dno pod wodą zostaje gładkie)
      if (hM > 0) {
        const j = 1 + nodeColorNoise(ix, iz) * COLOR_NOISE_AMP;
        scratchColor.multiplyScalar(j);
      }
      colors[i3] = scratchColor.r;
      colors[i3 + 1] = scratchColor.g;
      colors[i3 + 2] = scratchColor.b;
    }
  }

  const cells = n - 1;
  const indices = new Uint32Array(cells * cells * 6);
  let w = 0;
  for (let iz = 0; iz < cells; iz++) {
    for (let ix = 0; ix < cells; ix++) {
      const a = iz * n + ix;
      const b = a + 1;
      const c = a + n;
      const d = c + 1;
      indices[w++] = a;
      indices[w++] = c;
      indices[w++] = b;
      indices[w++] = b;
      indices[w++] = c;
      indices[w++] = d;
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('color', new BufferAttribute(colors, 3));
  geometry.setIndex(new BufferAttribute(indices, 1));
  // flatShading liczy normalne ścian w shaderze (WebGL2) — bez computeVertexNormals
  const material = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
  return new Mesh(geometry, material);
}

function createSkyDome(): Mesh {
  const material = new ShaderMaterial({
    side: BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      zenithColor: { value: new Color(ZENITH_COLOR) },
      horizonColor: { value: new Color(HORIZON_COLOR) },
      sunColor: { value: SUN_GLOW_COLOR },
      sunDir: { value: SUN_DIR },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 zenithColor;
      uniform vec3 horizonColor;
      uniform vec3 sunColor;
      uniform vec3 sunDir;
      varying vec3 vDir;
      void main() {
        vec3 dir = normalize(vDir);
        float up = clamp(dir.y, 0.0, 1.0);
        vec3 col = mix(horizonColor, zenithColor, pow(up, 0.55));
        // atmosferyczny poblask wokół słońca: ostry rdzeń + szeroka ciepła aureola
        float s = max(dot(dir, sunDir), 0.0);
        col += sunColor * (pow(s, 200.0) * 0.8 + pow(s, 8.0) * 0.35 + pow(s, 2.0) * 0.10);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  return new Mesh(new SphereGeometry(SKY_RADIUS_M, 24, 12), material);
}

/** Lens flare słońca (three.js examples, MIT) — tarcza + duchy wzdłuż osi ekran↔słońce. */
function createSunFlare(): Lensflare {
  const loader = new TextureLoader();
  const tex0 = loader.load('/textures/lensflare0.png');
  tex0.colorSpace = SRGBColorSpace;
  const tex3 = loader.load('/textures/lensflare3.png');
  tex3.colorSpace = SRGBColorSpace;
  const flare = new Lensflare();
  flare.addElement(new LensflareElement(tex0, 480, 0, new Color(0xffe9c6)));
  flare.addElement(new LensflareElement(tex3, 60, 0.6));
  flare.addElement(new LensflareElement(tex3, 70, 0.7));
  flare.addElement(new LensflareElement(tex3, 120, 0.9));
  flare.addElement(new LensflareElement(tex3, 70, 1.0));
  return flare;
}

export interface World {
  /** Wołać co klatkę: kopuła nieba podąża za kamerą (gracz nigdy nie doleci do jej krawędzi). */
  update(cameraPosition: Vector3): void;
}

export function createWorld(scene: Scene, terrain: Terrain): World {
  scene.fog = new Fog(HORIZON_COLOR, FOG_NEAR_M, FOG_FAR_M);
  scene.background = new Color(HORIZON_COLOR);

  // Światła scentralizowane tu (faza 20): kierunek słońca = SUN_DIR, wspólny z
  // glow nieba i lens flare — by świecenie i cień zgadzały się po obu stronach.
  scene.add(new AmbientLight(AMBIENT_COLOR, AMBIENT_INTENSITY));
  const sunLight = new DirectionalLight(SUN_LIGHT_COLOR, SUN_LIGHT_INTENSITY);
  sunLight.position.copy(SUN_DIR).multiplyScalar(10_000);
  scene.add(sunLight);

  scene.add(createIslandMesh(terrain));

  const ocean = new Mesh(
    new PlaneGeometry(OCEAN_SIZE_M, OCEAN_SIZE_M),
    // polygonOffset: przy brzegu teren leży tuż pod wodą i depth buffer migotał
    // (z-fighting) — ocean odsunięty w głębi przegrywa tam spójnie z terenem
    new MeshLambertMaterial({
      color: OCEAN_COLOR,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    }),
  );
  ocean.rotation.x = -Math.PI / 2;
  scene.add(ocean);

  const sky = createSkyDome();
  scene.add(sky);

  const sunFlare = createSunFlare();
  scene.add(sunFlare);

  return {
    update: (cameraPosition) => {
      // niebo i słońce „w nieskończoności" — podążają za kamerą, gracz nie dolatuje do krawędzi
      sky.position.copy(cameraPosition);
      sunFlare.position.copy(cameraPosition).addScaledVector(SUN_DIR, SUN_DISTANCE_M);
    },
  };
}
