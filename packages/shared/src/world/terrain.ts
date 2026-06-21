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

// Sylwetka wyspy = stroma GÓRA w centrum (brzeg bazowy ~3 km) + DWA lokalne,
// kierunkowe detale łamiące symetrię (modulacja kątem dirZ = z/r):
//  • PLAŻA po stronie −Z („dół" mapy, strona nalotu): niski piaszczysty szelf
//    wysunięty poza bazowy brzeg → szeroki pas piasku tylko z tej strony;
//  • ZATOKA po stronie +Z („góra" mapy): elewacja ścinana pod poziom morza →
//    woda wcina się w ląd.
// Reszta brzegu pozostaje wąska/stroma (jak w fazie 4). decyzja użytkownika 2026-06-21.
/** Promień maski wyspy [m] — brzeg bazowy ~3 km (poza sektorami plaży/zatoki). */
const ISLAND_RADIUS_M = 4300;
/** Wysokość rdzenia góry w centrum [m] (noise dodaje/odejmuje swoje). */
const CORE_PEAK_M = 1010;
/** Amplituda FBM [m] — rzeźba zboczy i nieregularność wybrzeża. */
const NOISE_AMP_M = 400;

// --- Plaża (sektor −Z): niski piaszczysty szelf-plateau wysunięty poza bazowy brzeg ---
/** Sektor plaży wg −dirZ: 0 przy LO, pełna siła przy HI (≈ w stożku ~±50° od −Z). */
const BEACH_DIR_LO = 0.5;
const BEACH_DIR_HI = 0.92;
/** Plateau plaży trzyma stałą wysokość do BEACH_FLAT_R, potem KRÓTKI, czysty zjazd do dna przy BEACH_OUTER_R [m]. */
const BEACH_FLAT_R = 3700;
const BEACH_OUTER_R = 3900;
/** Podniesienie plateau plaży nad dno [m] → ~(SEABED_M + LIFT) = +10 m n.p.m. (nisko, w pasie piasku). */
const BEACH_LIFT_M = 70;
/** Amplituda delikatnych wydm na plaży [m] — mała, by plaża była gładka i piaszczysta. */
const BEACH_NOISE_AMP_M = 5;
/** Szum plaży gaśnie na tym odcinku PRZED BEACH_FLAT_R [m] → linia wody bez szumu = brak wysepek. */
const BEACH_NOISE_FADE_R = 500;

// --- Zatoka (sektor +Z): woda wcięta w ląd (ścięcie elewacji pod poziom morza) ---
/** Sektor zatoki wg dirZ: węższy niż plaża (cypel wody, ~±35° od +Z). */
const BAY_DIR_LO = 0.62;
const BAY_DIR_HI = 0.95;
/** Zatoka ścina elewację od BAY_REACH_R (głębokość wnętrza) narastająco do gardła BAY_MOUTH_R [m]. */
const BAY_REACH_R = 2200;
const BAY_MOUTH_R = 2900;
/** Maks. ścięcie elewacji w gardle zatoki [m] — z naddatkiem, by zejść pod wodę. */
const BAY_CUT_M = 440;
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

/** Hermite smoothstep dla u∈[0,1] (zerowa pochodna na końcach → brak „stopnia"). */
function smoothstep01(u: number): number {
  return u * u * (3 - 2 * u);
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function rawHeightM(noise2D: NoiseFunction2D, xM: number, zM: number): number {
  const r = Math.hypot(xM, zM);
  if (r >= ISLAND_RADIUS_M) return SEABED_M;
  const dirZ = r > 1e-3 ? zM / r : 0; // cos kąta od osi +Z: +1 = „góra", −1 = „dół" mapy
  const f = fbm(noise2D, xM, zM);

  // baza: pojedyncza maska wyspy (jak faza 4), brzeg ~3 km, „elewacja nad dnem" e
  const t = 1 - r / ISLAND_RADIUS_M;
  const baseMask = t <= 0 ? 0 : smoothstep01(t);
  let e = (CORE_PEAK_M - SEABED_M) * baseMask * baseMask + NOISE_AMP_M * f * baseMask;

  // plaża (−Z): niski szelf dorzucany przez max → podnosi tylko morze/płyciznę poza
  // bazowym brzegiem, nigdy góry. Daje szeroki pas piasku TYLKO z tej strony.
  const beachW = smoothstep01(clamp01((-dirZ - BEACH_DIR_LO) / (BEACH_DIR_HI - BEACH_DIR_LO)));
  if (beachW > 0) {
    // plateau: pełna wysokość do BEACH_FLAT_R, krótki zjazd do zera przy BEACH_OUTER_R.
    // clamp01 KONIECZNY: bez niego smoothstep01 dla r>BEACH_OUTER_R (u>1) oscyluje w minus
    // i „odradza" ląd za plażą → łańcuszek wysepek (bug ze zrzutu 2026-06-21).
    const plateau =
      r <= BEACH_FLAT_R
        ? 1
        : 1 - smoothstep01(clamp01((r - BEACH_FLAT_R) / (BEACH_OUTER_R - BEACH_FLAT_R)));
    // szum (wydmy) tylko w GŁĘBI plaży — gaśnie zanim plateau zacznie schodzić do wody,
    // więc na samej linii brzegu szumu nie ma → brzeg jest gładki, bez odrywających się wysepek
    const noiseFade =
      1 - smoothstep01(clamp01((r - (BEACH_FLAT_R - BEACH_NOISE_FADE_R)) / BEACH_NOISE_FADE_R));
    const beachE = beachW * (plateau * BEACH_LIFT_M + noiseFade * BEACH_NOISE_AMP_M * f);
    if (beachE > e) e = beachE;
  }

  // zatoka (+Z): ścięcie elewacji narastające ku gardłu → woda wcina się w ląd
  const bayW = smoothstep01(clamp01((dirZ - BAY_DIR_LO) / (BAY_DIR_HI - BAY_DIR_LO)));
  if (bayW > 0) {
    const band = smoothstep01(clamp01((r - BAY_REACH_R) / (BAY_MOUTH_R - BAY_REACH_R)));
    e -= bayW * band * BAY_CUT_M;
  }

  // dno zatoki/zagłębień przycięte do poziomu dna oceanu (i tak pod nieprzezroczystą wodą)
  return e <= 0 ? SEABED_M : SEABED_M + e;
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
