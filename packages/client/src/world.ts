import {
  AmbientLight,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  DirectionalLight,
  Fog,
  Mesh,
  MeshLambertMaterial,
  PlaneGeometry,
  RepeatWrapping,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
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

/** Kolor mgły = kolor horyzontu nieba — zlewają się w jedną linię (ledwie ciepły, złota godzina lekka). */
export const HORIZON_COLOR = 0xd7d6cd;
const ZENITH_COLOR = 0x4a78b0;
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

// --- Teren w 2 poziomach gęstości (faza 20): pełna siatka w boksie wokół wyspy
// (zawiera CAŁY ląd nad wodą — wizualnie identyczny z fazą 4), rzadsza (JEDEN
// przeskok, nie LOD) w dalekim podwodnym pierścieniu. Granica leży pod
// nieprzezroczystym oceanem i we mgle → ew. pęknięcia siatki niewidoczne.
// terrainHeight() w `shared` NIE jest ruszany (niezmiennik fazy). ---
/** Pół-bok pełnej rozdzielczości [m] — linia brzegowa ~2.7 km, margines do ~3.6 km. */
const TERRAIN_INNER_HALF_M = 3_600;
/** Co który węzeł w dalekim pierścieniu (jeden przeskok gęstości). */
const TERRAIN_OUTER_STRIDE = 5;

function range(lo: number, hi: number, step = 1): number[] {
  const out: number[] = [];
  for (let i = lo; i <= hi; i += step) out.push(i);
  return out;
}

/**
 * Mesh terenu z regularnej podsiatki: węzły o indeksach `ixs`×`izs`, komórka
 * emitowana gdy `includeCell(gx,gz)`. Kolory + szum jak pełna siatka (ten sam ląd).
 */
function buildTerrainChunk(
  terrain: Terrain,
  ixs: number[],
  izs: number[],
  includeCell: (gx: number, gz: number) => boolean,
): Mesh {
  const nx = ixs.length;
  const nz = izs.length;
  const positions = new Float32Array(nx * nz * 3);
  const colors = new Float32Array(nx * nz * 3);
  const scratchColor = new Color();
  for (let gz = 0; gz < nz; gz++) {
    const iz = izs[gz]!;
    for (let gx = 0; gx < nx; gx++) {
      const ix = ixs[gx]!;
      const i3 = (gz * nx + gx) * 3;
      const hM = terrain.nodeHeightM(ix, iz);
      positions[i3] = terrain.nodeCoordM(ix);
      positions[i3 + 1] = hM;
      positions[i3 + 2] = terrain.nodeCoordM(iz);
      colorForHeight(hM, scratchColor);
      // szum jasności tylko na lądzie (dno pod wodą zostaje gładkie)
      if (hM > 0) scratchColor.multiplyScalar(1 + nodeColorNoise(ix, iz) * COLOR_NOISE_AMP);
      colors[i3] = scratchColor.r;
      colors[i3 + 1] = scratchColor.g;
      colors[i3 + 2] = scratchColor.b;
    }
  }

  const indices: number[] = [];
  for (let gz = 0; gz < nz - 1; gz++) {
    for (let gx = 0; gx < nx - 1; gx++) {
      if (!includeCell(gx, gz)) continue;
      const a = gz * nx + gx;
      const b = a + 1;
      const c = a + nx;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('color', new BufferAttribute(colors, 3));
  geometry.setIndex(indices); // three dobiera Uint16/Uint32 wg liczby węzłów
  // flatShading liczy normalne ścian w shaderze (WebGL2) — bez computeVertexNormals
  const material = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
  return new Mesh(geometry, material);
}

function createTerrainMeshes(terrain: Terrain): Mesh[] {
  const last = terrain.gridN - 1;
  const mid = last / 2;
  const stride = TERRAIN_OUTER_STRIDE;
  const halfNodes = Math.round(TERRAIN_INNER_HALF_M / terrain.gridSpacingM / stride) * stride;
  const innerLo = mid - halfNodes;
  const innerHi = mid + halfNodes;
  // siatka nietypowa (np. inny TERRAIN_GRID_N) → bezpieczny fallback: jeden pełny mesh
  if (
    !Number.isInteger(mid) ||
    last % stride !== 0 ||
    innerLo % stride !== 0 ||
    innerLo <= 0 ||
    innerHi >= last
  ) {
    const all = range(0, last);
    return [buildTerrainChunk(terrain, all, all, () => true)];
  }

  const innerIdx = range(innerLo, innerHi);
  const inner = buildTerrainChunk(terrain, innerIdx, innerIdx, () => true);

  // rzadka siatka co `stride` na całym regionie; komórki TYLKO poza boksem pełnym
  // (wnętrze pokrywa `inner` — żadnego podwójnego rysowania ani z-fightingu na lądzie)
  const coarseIdx = range(0, last, stride);
  const coarse = buildTerrainChunk(terrain, coarseIdx, coarseIdx, (gx, gz) => {
    const insideX = coarseIdx[gx]! >= innerLo && coarseIdx[gx + 1]! <= innerHi;
    const insideZ = coarseIdx[gz]! >= innerLo && coarseIdx[gz + 1]! <= innerHi;
    return !(insideX && insideZ);
  });
  return [inner, coarse];
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
        // atmosferyczny poblask wokół słońca: ostry rdzeń + wąska ciepła aureola (stonowana)
        float s = max(dot(dir, sunDir), 0.0);
        col += sunColor * (pow(s, 260.0) * 0.6 + pow(s, 16.0) * 0.16 + pow(s, 4.0) * 0.04);
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

// --- Woda v2 (faza 20): mapa normalnych (three.js examples) scrollowana w 2 warstwach,
// odbicie ANALITYCZNEGO nieba (ten sam gradient + glow co kopuła) — BEZ planar
// reflection (zakaz fazy). Fresnel + błysk słońca + mgła liniowa spójna ze sceną. ---
/** Rozmiar kafla mapy normalnych [m] — mniejszy = drobniejsze fale. */
const WATER_TILE_M = 220;
/** Siła zaburzenia normalnej (spokojne fale „złotej godziny"). */
const WATER_NORMAL_STRENGTH = 0.22;

interface Water {
  mesh: Mesh;
  /** Animacja: czas [s] do przewijania normalnej + pozycja kamery do odbicia. */
  update(elapsedS: number, cameraPos: Vector3): void;
}

function createOceanWater(): Water {
  const normalMap = new TextureLoader().load('/textures/waternormals.jpg');
  normalMap.wrapS = RepeatWrapping;
  normalMap.wrapT = RepeatWrapping;

  // uniformy animowane trzymane w lokalnych stałych (uniknięcie indeksowania
  // material.uniforms — strict noUncheckedIndexedAccess daje tam `| undefined`)
  const uTime = { value: 0 };
  const uCameraPos = { value: new Vector3() };

  const material = new ShaderMaterial({
    fog: false, // mgłę liczymy sami (spójnie z scene.fog), bez chunków three
    polygonOffset: true, // jak dawny ocean: brzeg leży tuż pod wodą → przeciw z-fightingowi
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
    uniforms: {
      uNormalMap: { value: normalMap },
      uCameraPos,
      uTime,
      uTile: { value: WATER_TILE_M },
      uStrength: { value: WATER_NORMAL_STRENGTH },
      zenithColor: { value: new Color(ZENITH_COLOR) },
      horizonColor: { value: new Color(HORIZON_COLOR) },
      sunColor: { value: SUN_GLOW_COLOR },
      sunDir: { value: SUN_DIR },
      waterColor: { value: new Color(OCEAN_COLOR) },
      fogColor: { value: new Color(HORIZON_COLOR) },
      fogNear: { value: FOG_NEAR_M },
      fogFar: { value: FOG_FAR_M },
    },
    vertexShader: /* glsl */ `
      uniform vec3 uCameraPos;
      varying vec3 vWorldPos;
      varying float vFogDepth;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        vec4 mv = viewMatrix * wp;
        vFogDepth = -mv.z;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uNormalMap;
      uniform vec3 uCameraPos;
      uniform float uTime, uTile, uStrength;
      uniform vec3 zenithColor, horizonColor, sunColor, sunDir, waterColor, fogColor;
      uniform float fogNear, fogFar;
      varying vec3 vWorldPos;
      varying float vFogDepth;

      vec3 skyAt(vec3 dir) {
        float up = clamp(dir.y, 0.0, 1.0);
        vec3 c = mix(horizonColor, zenithColor, pow(up, 0.55));
        float s = max(dot(dir, sunDir), 0.0);
        c += sunColor * (pow(s, 260.0) * 0.6 + pow(s, 16.0) * 0.16 + pow(s, 4.0) * 0.04);
        return c;
      }

      void main() {
        vec2 baseUv = vWorldPos.xz / uTile;
        vec3 n1 = texture2D(uNormalMap, baseUv + uTime * vec2(0.018, 0.011)).rgb * 2.0 - 1.0;
        vec3 n2 = texture2D(uNormalMap, baseUv * 1.7 + uTime * vec2(-0.013, 0.020)).rgb * 2.0 - 1.0;
        vec2 tilt = (n1.xy + n2.xy) * uStrength;
        vec3 N = normalize(vec3(tilt.x, 1.0, tilt.y));
        vec3 V = normalize(uCameraPos - vWorldPos);
        vec3 R = reflect(-V, N);
        R.y = abs(R.y); // woda odbija TYLKO niebo (nigdy „pod siebie")
        vec3 reflColor = skyAt(R);
        float fres = 0.02 + 0.98 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
        vec3 col = mix(waterColor, reflColor, fres);
        col += sunColor * pow(max(dot(R, sunDir), 0.0), 120.0) * 1.2; // błysk słońca
        float f = clamp((vFogDepth - fogNear) / (fogFar - fogNear), 0.0, 1.0);
        gl_FragColor = vec4(mix(col, fogColor, f), 1.0);
      }
    `,
  });

  const mesh = new Mesh(new PlaneGeometry(OCEAN_SIZE_M, OCEAN_SIZE_M), material);
  mesh.rotation.x = -Math.PI / 2;
  return {
    mesh,
    update: (elapsedS, cameraPos) => {
      uTime.value = elapsedS;
      uCameraPos.value.copy(cameraPos);
    },
  };
}

// --- Chmury billboardowe (faza 20): 2 warstwy wysokości, powolny dryf wiatru.
// Taktyczne: schowanie się w chmurze utrudnia namiar (znacznik HUD przygasa) —
// `cloudCoverAt` mówi, jak głęboko punkt tkwi w chmurze. Czysto kosmetyczne i
// lokalne (klient): w MP chmury NIE są synchronizowane (nie wpływają na serwer). ---
const CLOUD_CLUSTERS = 26;
const PUFFS_PER_CLUSTER = 5; // 130 sprite'ów (zakres fazy 50–150)
/** Pole chmur ±N m wokół środka mapy (kwadrat — proste zawijanie przy dryfie). */
const CLOUD_FIELD_HALF_M = 11_000;
const CLOUD_LOW_ALT_M = 720; // tuż nad pułapem spawnu (800 m) — w gąszczu walki
const CLOUD_HIGH_ALT_M = 1_500;
const CLOUD_TINT = new Color(0xf2e8d6); // ciepła biel (złota godzina)
const CLOUD_WIND = new Vector3(11, 0, 6); // ~12 m/s
const CLOUD_PUFF_OPACITY = 0.82;

interface Puff {
  sprite: Sprite;
  /** Promień rdzenia do testu „w chmurze" [m] — mniejszy niż sprite (miękkie brzegi). */
  coverRadiusM: number;
}

/** Mały deterministyczny RNG (mulberry32) — to samo pole chmur w obrębie sesji. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Miękki puff chmury rysowany w canvasie — kilka nałożonych radialnych kłębów. */
function makeCloudTexture(): CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('brak kontekstu 2d do tekstury chmury');
  const rng = mulberry32(0xc10d);
  const blobs = 7;
  for (let i = 0; i < blobs; i++) {
    const r = size * (0.16 + rng() * 0.16);
    const cx = size * (0.3 + rng() * 0.4);
    const cy = size * (0.38 + rng() * 0.3);
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, 'rgba(255,255,255,0.9)');
    g.addColorStop(0.55, 'rgba(255,255,255,0.45)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

interface CloudField {
  update(dtS: number): void;
  /** [0..1] jak głęboko punkt świata tkwi w chmurze (0 = czysto, 1 = gęsty rdzeń). */
  coverAt(point: Vector3): number;
}

function createCloudField(scene: Scene): CloudField {
  const tex = makeCloudTexture();
  const rng = mulberry32(0x5eed);
  const puffs: Puff[] = [];
  for (let c = 0; c < CLOUD_CLUSTERS; c++) {
    const cx = (rng() * 2 - 1) * CLOUD_FIELD_HALF_M;
    const cz = (rng() * 2 - 1) * CLOUD_FIELD_HALF_M;
    const baseAlt = rng() < 0.5 ? CLOUD_LOW_ALT_M : CLOUD_HIGH_ALT_M;
    for (let p = 0; p < PUFFS_PER_CLUSTER; p++) {
      const sizeM = 900 + rng() * 700; // 900–1600 m
      const mat = new SpriteMaterial({
        map: tex,
        transparent: true,
        depthWrite: false, // przezroczystość: nie zapisuj głębi (pułapka sortowania z faza-20.md)
        opacity: CLOUD_PUFF_OPACITY,
        color: CLOUD_TINT,
        fog: true,
      });
      const sprite = new Sprite(mat);
      sprite.scale.set(sizeM, sizeM * 0.62, 1); // spłaszczone — chmury szersze niż wyższe
      sprite.position.set(
        cx + (rng() * 2 - 1) * sizeM * 0.6,
        baseAlt + (rng() * 2 - 1) * 120,
        cz + (rng() * 2 - 1) * sizeM * 0.6,
      );
      scene.add(sprite);
      puffs.push({ sprite, coverRadiusM: sizeM * 0.32 });
    }
  }

  return {
    update: (dtS) => {
      const dx = CLOUD_WIND.x * dtS;
      const dz = CLOUD_WIND.z * dtS;
      for (const { sprite } of puffs) {
        // zawijanie pojedynczych puffów (nie całego pola) — przeskok daleko, ukryty we mgle
        let x = sprite.position.x + dx;
        let z = sprite.position.z + dz;
        if (x > CLOUD_FIELD_HALF_M) x -= 2 * CLOUD_FIELD_HALF_M;
        if (z > CLOUD_FIELD_HALF_M) z -= 2 * CLOUD_FIELD_HALF_M;
        sprite.position.x = x;
        sprite.position.z = z;
      }
    },
    coverAt: (point) => {
      let cover = 0;
      for (const { sprite, coverRadiusM } of puffs) {
        const dx = point.x - sprite.position.x;
        const dy = point.y - sprite.position.y;
        const dz = point.z - sprite.position.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 >= coverRadiusM * coverRadiusM) continue;
        const t = 1 - Math.sqrt(d2) / coverRadiusM;
        if (t > cover) cover = t;
        if (cover >= 0.999) break;
      }
      return cover;
    },
  };
}

export interface World {
  /** Wołać co klatkę: kopuła nieba podąża za kamerą (gracz nigdy nie doleci do jej krawędzi). */
  update(cameraPosition: Vector3): void;
  /** [0..1] jak bardzo punkt świata jest spowity chmurą — do przygaszania znacznika HUD. */
  cloudCoverAt(point: Vector3): number;
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

  for (const m of createTerrainMeshes(terrain)) scene.add(m);

  const water = createOceanWater();
  scene.add(water.mesh);

  const sky = createSkyDome();
  scene.add(sky);

  const sunFlare = createSunFlare();
  scene.add(sunFlare);

  const clouds = createCloudField(scene);

  let lastT = performance.now();
  let elapsedS = 0;
  return {
    update: (cameraPosition) => {
      const now = performance.now();
      // cap dt: po uśpieniu karty / przełączeniu zakładki delta byłaby ogromna
      const dtS = Math.min(0.1, (now - lastT) / 1000);
      lastT = now;
      elapsedS += dtS;
      // niebo i słońce „w nieskończoności" — podążają za kamerą, gracz nie dolatuje do krawędzi
      sky.position.copy(cameraPosition);
      sunFlare.position.copy(cameraPosition).addScaledVector(SUN_DIR, SUN_DISTANCE_M);
      clouds.update(dtS);
      water.update(elapsedS, cameraPosition);
    },
    cloudCoverAt: (point) => clouds.coverAt(point),
  };
}
