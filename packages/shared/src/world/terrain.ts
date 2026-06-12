import { createNoise2D, type NoiseFunction2D } from 'simplex-noise';
import { TERRAIN_SEED } from '../constants';
import { createRng } from '../math/rng';

// Teren proceduralny (faza 4): heightmapa liczona RAZ przy starcie z seedowanego
// simplex noise (FBM + radialna maska wyspy), potem każde zapytanie to tylko
// odczyt siatki + interpolacja biliniowa. To celowe — serwer od fazy 8 woła
// heightAt() do kolizji botów w pętli gry, noise per zapytanie byłby za drogi.

/**
 * Rozstaw węzłów siatki [m]. 48 jest FP-dokładne (3·2⁴), a węzły leżą na
 * całkowitych współrzędnych — dzięki temu heightAt() w węźle zwraca DOKŁADNIE
 * (===) wartość siatki, z której klient buduje mesh (kryterium fazy 4).
 */
export const TERRAIN_GRID_SPACING_M = 48;
/** Węzłów na bok: 250 komórek × 48 m = region 12×12 km wokół wyspy. */
export const TERRAIN_GRID_N = 251;
/** Połowa boku regionu heightmapy [m] — poza nim teren to płaskie dno. */
export const TERRAIN_REGION_HALF_M = ((TERRAIN_GRID_N - 1) * TERRAIN_GRID_SPACING_M) / 2;
/** Dno oceanu [m] — wszędzie poza wyspą i poza regionem heightmapy. */
export const SEABED_M = -60;

/** Promień maski wyspy [m] — tu ląd zszedł już do dna; linia brzegowa ~r=2.7 km. */
const ISLAND_RADIUS_M = 4000;
/** Wysokość rdzenia góry w centrum [m] (noise dodaje/odejmuje swoje). */
const CORE_PEAK_M = 1010;
/** Amplituda FBM [m] — rzeźba zboczy i nieregularność wybrzeża. */
const NOISE_AMP_M = 400;
/** Częstotliwość bazowa FBM [1/m] — największe formy terenu ~1.8 km. */
const BASE_FREQ_PER_M = 1 / 1800;
const FBM_OCTAVES = 5;
const FBM_GAIN = 0.5;
const FBM_LACUNARITY = 2;
/** Suma amplitud oktaw — normalizacja FBM do ~[-1, 1]. */
const FBM_AMP_SUM = (1 - FBM_GAIN ** FBM_OCTAVES) / (1 - FBM_GAIN);

export interface Terrain {
  /** Liczba węzłów siatki na bok. */
  readonly gridN: number;
  /** Rozstaw węzłów [m]. */
  readonly gridSpacingM: number;
  /** Współrzędna świata węzła o indeksie i (wspólna dla osi X i Z). */
  nodeCoordM(i: number): number;
  /** Wysokość w węźle siatki [m] — dokładnie wartość, z której powstaje mesh. */
  nodeHeightM(ix: number, iz: number): number;
  /** Wysokość terenu [m] w dowolnym punkcie świata (bilinear; poza regionem: SEABED_M). */
  heightAt(xM: number, zM: number): number;
}

function fbm(noise2D: NoiseFunction2D, xM: number, zM: number): number {
  let sum = 0;
  let amp = 1;
  let freq = BASE_FREQ_PER_M;
  for (let i = 0; i < FBM_OCTAVES; i++) {
    sum += amp * noise2D(xM * freq, zM * freq);
    amp *= FBM_GAIN;
    freq *= FBM_LACUNARITY;
  }
  return sum / FBM_AMP_SUM;
}

function rawHeightM(noise2D: NoiseFunction2D, xM: number, zM: number): number {
  const t = 1 - Math.hypot(xM, zM) / ISLAND_RADIUS_M;
  if (t <= 0) return SEABED_M;
  const mask = t >= 1 ? 1 : t * t * (3 - 2 * t);
  // noise też ×mask: na brzegu wygasa do zera → region kończy się dokładnie dnem
  return SEABED_M + mask * ((CORE_PEAK_M - SEABED_M) * mask + NOISE_AMP_M * fbm(noise2D, xM, zM));
}

export function createTerrain(seed: number = TERRAIN_SEED): Terrain {
  const noise2D = createNoise2D(createRng(seed));
  const n = TERRAIN_GRID_N;
  const heights = new Float32Array(n * n);
  for (let iz = 0; iz < n; iz++) {
    const zM = iz * TERRAIN_GRID_SPACING_M - TERRAIN_REGION_HALF_M;
    for (let ix = 0; ix < n; ix++) {
      const xM = ix * TERRAIN_GRID_SPACING_M - TERRAIN_REGION_HALF_M;
      heights[iz * n + ix] = rawHeightM(noise2D, xM, zM);
    }
  }

  return {
    gridN: n,
    gridSpacingM: TERRAIN_GRID_SPACING_M,
    nodeCoordM: (i) => i * TERRAIN_GRID_SPACING_M - TERRAIN_REGION_HALF_M,
    // ?? nieosiągalne przy poprawnych indeksach (kontrakt API) — strict indexed access
    nodeHeightM: (ix, iz) => heights[iz * n + ix] ?? SEABED_M,
    heightAt: (xM, zM) => {
      const gx = (xM + TERRAIN_REGION_HALF_M) / TERRAIN_GRID_SPACING_M;
      const gz = (zM + TERRAIN_REGION_HALF_M) / TERRAIN_GRID_SPACING_M;
      if (gx < 0 || gz < 0 || gx > n - 1 || gz > n - 1) return SEABED_M;
      const ix = Math.min(n - 2, Math.floor(gx));
      const iz = Math.min(n - 2, Math.floor(gz));
      const fx = gx - ix;
      const fz = gz - iz;
      // ?? nieosiągalne: ix/iz po clampie zawsze wewnątrz siatki
      const h00 = heights[iz * n + ix] ?? SEABED_M;
      const h10 = heights[iz * n + ix + 1] ?? SEABED_M;
      const h01 = heights[(iz + 1) * n + ix] ?? SEABED_M;
      const h11 = heights[(iz + 1) * n + ix + 1] ?? SEABED_M;
      return (
        (1 - fz) * ((1 - fx) * h00 + fx * h10) + fz * ((1 - fx) * h01 + fx * h11)
      );
    },
  };
}
