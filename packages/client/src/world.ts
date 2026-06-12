import {
  BackSide,
  BufferAttribute,
  BufferGeometry,
  Color,
  Fog,
  Mesh,
  MeshLambertMaterial,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from 'three';
import type { Terrain } from '@air-combat/shared';

// Świat fazy 4: JEDEN mesh wyspy (vertex colors wg wysokości, flat shading),
// płaszczyzna oceanu, kopuła nieba (gradient w shaderze) i mgła dystansowa.
// Mgła celowo maskuje brak LOD (faza-04.md) — to feature, nie oszustwo.

/** Kolor mgły = kolor horyzontu nieba — zlewają się w jedną linię. */
export const HORIZON_COLOR = 0xc3d4e2;
const ZENITH_COLOR = 0x3a6cb4;
const FOG_NEAR_M = 2_500;
const FOG_FAR_M = 15_000;
const OCEAN_SIZE_M = 44_000;
const OCEAN_COLOR = 0x16455e;
const SKY_RADIUS_M = 24_000;

// Pasma wysokości wyspy: plaża → trawa → skała → śnieg, z miękkim przejściem.
const SAND_COLOR = new Color(0xcbb87a);
const GRASS_COLOR = new Color(0x49703c);
const ROCK_COLOR = new Color(0x6e6a62);
const SNOW_COLOR = new Color(0xeef3f6);
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
      varying vec3 vDir;
      void main() {
        float up = clamp(normalize(vDir).y, 0.0, 1.0);
        gl_FragColor = vec4(mix(horizonColor, zenithColor, pow(up, 0.55)), 1.0);
      }
    `,
  });
  return new Mesh(new SphereGeometry(SKY_RADIUS_M, 24, 12), material);
}

export interface World {
  /** Wołać co klatkę: kopuła nieba podąża za kamerą (gracz nigdy nie doleci do jej krawędzi). */
  update(cameraPosition: Vector3): void;
}

export function createWorld(scene: Scene, terrain: Terrain): World {
  scene.fog = new Fog(HORIZON_COLOR, FOG_NEAR_M, FOG_FAR_M);
  scene.background = new Color(HORIZON_COLOR);

  scene.add(createIslandMesh(terrain));

  const ocean = new Mesh(
    new PlaneGeometry(OCEAN_SIZE_M, OCEAN_SIZE_M),
    new MeshLambertMaterial({ color: OCEAN_COLOR }),
  );
  ocean.rotation.x = -Math.PI / 2;
  scene.add(ocean);

  const sky = createSkyDome();
  scene.add(sky);

  return {
    update: (cameraPosition) => {
      sky.position.copy(cameraPosition);
    },
  };
}
