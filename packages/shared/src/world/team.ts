// Tryb gry meczu sieciowego (faza 18): FFA (free-for-all, każdy za siebie) albo
// drużynowy (dwie drużyny, eliminacja jak w single-player). CZYSTA logika/typy —
// bez Three, bez DOM, bez stanu serwera (jak ffa.ts/match.ts): da się przetestować
// tablicą. Sam model rozstrzygnięcia drużynowego reużywa match.ts (factionsInPlay /
// matchOutcome) — niezmiennik parytetu MP↔SP: drużynowy MP to ten sam model co SP
// (MATCH_LIVES żyć na samolot, ostatnia drużyna w grze wygrywa), tylko liczony
// autorytatywnie na serwerze. Strefa KotH (faza 17) działa OBOK eliminacji jako
// dodatkowy warunek zwycięstwa — frakcja = drużyna.

/** Tryb meczu pokoju (ustawiany przez hosta przy tworzeniu, klampowany na serwerze). */
export type MatchMode = 'ffa' | 'team';

/** Dozwolone tryby — do walidacji wejścia z sieci (brak zaufania do klienta, niezm. 11). */
export const MATCH_MODES: readonly MatchMode[] = ['ffa', 'team'];

/** Liczba drużyn w trybie drużynowym (Sojusznicy vs Wrogowie, jak SP). */
export const TEAM_COUNT = 2;

/** Domyślny tryb, gdy host nie poda (lub poda nieznany): FFA (deathmatch z fazy 13). */
export const DEFAULT_MATCH_MODE: MatchMode = 'ffa';

/** Przyjmuje tryb tylko z listy znanych — inaczej domyślny FFA (brak zaufania do klienta). */
export function clampMatchMode(raw: unknown): MatchMode {
  return MATCH_MODES.includes(raw as MatchMode) ? (raw as MatchMode) : DEFAULT_MATCH_MODE;
}

/**
 * Indeks drużyny z najmniejszą liczbą członków (remis → niższy indeks) — auto-balans:
 * serwer dokłada każdego nowego uczestnika do mniejszej drużyny. Dla pustej tablicy
 * zwraca 0. Czysta funkcja (testowalna), bez zależności od stanu pokoju.
 */
export function smallerTeamIndex(counts: readonly number[]): number {
  if (counts.length === 0) return 0;
  let best = 0;
  for (let i = 1; i < counts.length; i++) {
    if ((counts[i] ?? 0) < (counts[best] ?? 0)) best = i;
  }
  return best;
}
