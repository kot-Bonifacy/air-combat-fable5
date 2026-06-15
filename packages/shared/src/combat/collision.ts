import { Vector3 } from 'three';
import { segmentSphereHitT } from './hit';

// Kolizja samolot↔samolot (faza 7): każdy płatowiec ma sferę kolizji o promieniu
// collisionRadiusM; dwie maszyny zderzają się, gdy odległość ich środków spadnie
// poniżej sumy promieni W DOWOLNEJ chwili ticku.
//
// Test ZAMIATANY, nie punktowy — z tego samego powodu co trafienia pocisków
// (hit.ts): przy locie czołowym prędkość zbliżania sięga ~600 m/s, czyli ~10 m na
// tick (1/60 s), więc porównanie samych pozycji końcowych „przelatywałoby" przez
// siebie (tunelowanie) i zderzenie czołowe bywałoby gubione.
//
// Sztuczka: w układzie WZGLĘDNYM (B widziany z A) ruch obu maszyn redukuje się do
// jednego odcinka (prevA−prevB) → (posA−posB), a warunek kolizji to wejście tego
// odcinka w sferę o promieniu (rA+rB) wokół początku układu — czyli dokładnie
// segmentSphereHitT (ten sam test, którego używają pociski).
//
// UWAGA — znane ograniczenie, identyczne jak w hit.ts: liczymy na SUROWYCH
// współrzędnych, bez korekty toroidalnej świata. Para maszyn rozdzielona szwem
// areny (±10 km) nie zderzy się, mimo że fizycznie są blisko. To skutkuje tylko
// POMINIĘTYM zderzeniem na samej krawędzi (nigdy fałszywym — surowa różnica ~20 km
// jest >> rA+rB), a samoloty przy krawędzi i tak są zawijane na drugą stronę.

const relPrev = new Vector3();
const relCurr = new Vector3();
const ORIGIN = new Vector3(); // (0,0,0) — niemutowany; segmentSphereHitT tylko go czyta

/**
 * Czy dwa płatowce zderzyły się w trakcie ticku. A przemieszcza się prevA→posA,
 * B przemieszcza się prevB→posB (pozycje środków na początku i końcu ticku).
 * Zderzenie = odległość środków spadła poniżej (radiusA+radiusB) w którejkolwiek
 * chwili odcinka ruchu (test zamiatany — odporny na tunelowanie). Start już w
 * zasięgu (maszyny się przenikają) liczy się jako zderzenie.
 */
export function planesCollide(
  prevA: Vector3,
  posA: Vector3,
  radiusA: number,
  prevB: Vector3,
  posB: Vector3,
  radiusB: number,
): boolean {
  relPrev.subVectors(prevA, prevB);
  relCurr.subVectors(posA, posB);
  return segmentSphereHitT(relPrev, relCurr, ORIGIN, radiusA + radiusB) >= 0;
}
