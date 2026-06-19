// Ranking FFA (faza 13). CZYSTA logika porównania wyników — bez Three, bez DOM, bez stanu
// serwera. P1 (2026-06-19): FFA przeszło z deathmatchu („do N fragów") na ELIMINACJĘ jak SP
// (last-man-standing, bez limitu zestrzeleń i czasu — koniec liczy world/match.ts:factionsInPlay).
// Tu zostaje już TYLKO porządek rankingu (sort tabeli wyników, wybór lidera frakcji); funkcja
// evaluateFfa/clampScoreLimit usunięte razem z mechaniką limitu (martwy kod po P1).

/** Minimum stanu uczestnika do rankingu FFA (gracz lub bot). */
export interface FfaScore {
  id: number;
  kills: number;
  deaths: number;
}

/**
 * Porządek rankingu FFA (malejąco „lepszy pierwszy"): więcej zestrzeleń → mniej śmierci →
 * niższy id (stabilny tie-break, jak w scoreboard.ts). Zwraca <0, gdy `a` jest wyżej.
 */
export function compareFfa(a: FfaScore, b: FfaScore): number {
  return b.kills - a.kills || a.deaths - b.deaths || a.id - b.id;
}

/** Kopia tablicy posortowana rankingiem FFA (najlepszy pierwszy). Nie mutuje wejścia. */
export function rankFfa(scores: readonly FfaScore[]): FfaScore[] {
  return [...scores].sort(compareFfa);
}
