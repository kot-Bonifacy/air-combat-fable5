import { Vector3 } from 'three';
import { ARENA_SIZE_M, ARENA_WARNING_DISTANCE_M } from '../constants';

// Granice areny (faza 4 → 7): kwadrat ARENA_SIZE_M × ARENA_SIZE_M wokół (0,0).
// Świat jest TORUSEM: po przekroczeniu krawędzi w X/Z pozycja zawija się na
// przeciwległą stronę (lot kontynuowany w tym samym kierunku — patrz wrapToArena).
// Strefa `warning` służy tylko do ostrzeżenia HUD przed nadchodzącym przeniesieniem.

const HALF_ARENA_M = ARENA_SIZE_M / 2;

export type ArenaZone = 'inside' | 'warning' | 'outside';

/** Odległość do najbliższej granicy areny [m]; ujemna = poza areną. */
export function distanceToArenaEdgeM(xM: number, zM: number): number {
  return Math.min(HALF_ARENA_M - Math.abs(xM), HALF_ARENA_M - Math.abs(zM));
}

export function arenaZone(xM: number, zM: number): ArenaZone {
  const edgeM = distanceToArenaEdgeM(xM, zM);
  if (edgeM < 0) return 'outside';
  return edgeM <= ARENA_WARNING_DISTANCE_M ? 'warning' : 'inside';
}

/** Zawija współrzędną do [−HALF, HALF): wartość na/za krawędzią ląduje po drugiej stronie. */
function wrapCoordM(v: number): number {
  return (((v + HALF_ARENA_M) % ARENA_SIZE_M) + ARENA_SIZE_M) % ARENA_SIZE_M - HALF_ARENA_M;
}

/**
 * Torus świata: jeśli pozycja wyszła poza arenę w X lub Z, przenosi ją na
 * przeciwległą krawędź (Y bez zmian) i zapisuje przesunięcie do `outDelta`
 * (= pozycja_po − pozycja_przed). Zwraca true, gdy nastąpiło zawinięcie — wtedy
 * wywołujący przesuwa o ten sam `outDelta` stan poprzedni (interpolacja renderu)
 * oraz kamerę, by przeniesienie było bezszwowe (bez skoku/smugi obrazu).
 */
export function wrapToArena(position: Vector3, outDelta: Vector3): boolean {
  const x = wrapCoordM(position.x);
  const z = wrapCoordM(position.z);
  outDelta.set(x - position.x, 0, z - position.z);
  if (outDelta.x === 0 && outDelta.z === 0) return false;
  position.x = x;
  position.z = z;
  return true;
}

/** Sprowadza różnicę współrzędnej do najkrótszego obrazu toroidalnego: [−HALF, HALF]. */
function nearestDeltaM(d: number): number {
  return d - ARENA_SIZE_M * Math.round(d / ARENA_SIZE_M);
}

/**
 * Najbliższy obraz toroidalny punktu `p` widziany z `ref` (osie X/Z sprowadzone do
 * najkrótszej różnicy; Y bez zmian), zapisany do `out`. Na torusie to „prawdziwa"
 * pozycja celu dla geometrii/wyprzedzenia — bez korekty cel tuż za szwem wygląda
 * jak oddalony o ~całą arenę i AI generuje błędne komendy.
 */
export function nearestToroidalImage(p: Vector3, ref: Vector3, out: Vector3): Vector3 {
  return out.set(ref.x + nearestDeltaM(p.x - ref.x), p.y, ref.z + nearestDeltaM(p.z - ref.z));
}

/** Kwadrat odległości toroidalnej (3D, z najkrótszymi różnicami w X/Z). */
export function toroidalDistanceSqM(a: Vector3, b: Vector3): number {
  const dx = nearestDeltaM(a.x - b.x);
  const dy = a.y - b.y;
  const dz = nearestDeltaM(a.z - b.z);
  return dx * dx + dy * dy + dz * dz;
}
