import type { Vector3 } from 'three';

// Wybór punktu (re)spawnu (faza 13). CZYSTA geometria — bez stanu serwera: spośród
// kandydatów (sloty pierścienia startowego) wybiera ten, którego najbliższy żywy wróg
// jest NAJDALEJ (maksymalizacja prześwitu). Cel: spawn-kill niemożliwy w typowej sytuacji
// (kryterium fazy 13). Przy pełnym pokoju może się nie udać dotrzymać progu 1,5 km — wtedy
// bierzemy najlepszy dostępny slot (nigdy nie zawodzimy spawnu, tylko optymalizujemy).

/**
 * Indeks kandydata o największym prześwicie (min. dystans do dowolnego zajętego punktu).
 * Brak zajętych punktów → 0 (pierwszy kandydat). Pusta lista kandydatów → −1.
 * Remis prześwitu → niższy indeks (deterministycznie).
 */
export function chooseSpawnIndex(
  candidates: readonly Vector3[],
  occupants: readonly Vector3[],
): number {
  if (candidates.length === 0) return -1;
  if (occupants.length === 0) return 0;

  let bestIndex = 0;
  let bestClearance = -Infinity;
  for (let i = 0; i < candidates.length; i++) {
    const clearance = minDistance(candidates[i]!, occupants);
    if (clearance > bestClearance) {
      bestClearance = clearance;
      bestIndex = i;
    }
  }
  return bestIndex;
}

/** Najmniejsza odległość punktu `p` do dowolnego z `points` (Infinity dla pustej listy). */
export function minDistance(p: Vector3, points: readonly Vector3[]): number {
  let min = Infinity;
  for (const q of points) {
    const d = p.distanceTo(q);
    if (d < min) min = d;
  }
  return min;
}
