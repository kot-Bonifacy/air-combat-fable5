import { Vector3 } from 'three';

// Hit detection (faza-05.md krok 2): przecięcie ODCINKA (pozycja pocisku
// tick→tick) ze SFERĄ otaczającą cel. Odcinek, nie punkt — przy 744 m/s pocisk
// przeskakuje ~12 m na tick (1/60 s), więc punktowy test "przelatywałby" przez
// cel; segment łapie trafienie nawet gdy oba końce są POZA sferą (tunelowanie).
//
// Jedna sfera na cel w MVP (strefy trafień → faza 17). Matematyka czysta —
// używa jej klient teraz, serwer od fazy 11 (z lag compensation).

const scratchD = new Vector3();
const scratchF = new Vector3();

/**
 * Najwcześniejszy parametr t ∈ [0,1] przecięcia odcinka p0→p1 ze sferą
 * (center, radius), albo -1 gdy brak trafienia. t=0 oznacza p0, t=1 oznacza p1.
 * Start wewnątrz sfery (p0 w środku) liczy się jako trafienie z t=0.
 */
export function segmentSphereHitT(
  p0: Vector3,
  p1: Vector3,
  center: Vector3,
  radius: number,
): number {
  scratchD.subVectors(p1, p0); // kierunek odcinka
  scratchF.subVectors(p0, center); // od środka sfery do startu
  const r2 = radius * radius;

  // p0 już w sferze → trafienie natychmiast (łapie też zerowy odcinek wewnątrz)
  if (scratchF.lengthSq() <= r2) return 0;

  const a = scratchD.lengthSq();
  if (a === 0) return -1; // zerowy odcinek poza sferą (p0 już sprawdzone)

  const b = 2 * scratchF.dot(scratchD);
  const c = scratchF.lengthSq() - r2;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return -1; // prosta odcinka mija sferę

  // najmniejszy pierwiastek = wejście do sfery; styczna (disc=0) → t podwójne
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  if (t < 0 || t > 1) return -1; // przecięcie poza odcinkiem
  return t;
}

/** Czy odcinek p0→p1 przecina sferę (center, radius). */
export function segmentSphereHit(
  p0: Vector3,
  p1: Vector3,
  center: Vector3,
  radius: number,
): boolean {
  return segmentSphereHitT(p0, p1, center, radius) >= 0;
}
