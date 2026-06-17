import { MATCH_DEFAULT_SCORE_LIMIT, MATCH_SCORE_LIMIT_OPTIONS } from '../constants';

// Pętla meczu FFA (faza 13). CZYSTA logika rozstrzygnięcia — jak match.ts/scoreboard.ts:
// bez Three, bez DOM, bez stanu serwera. Decyduje KIEDY mecz się kończy i KTO wygrał na
// podstawie tablicy wyników i upływu czasu. Orkiestracja (respawny, broadcast, ekran
// wyników) żyje w GameRoom/kliencie — niezmiennik nr 5: zegar i wynik liczy serwer.
//
// Model FFA (free-for-all): każdy walczy z każdym. Mecz kończy się, gdy KTOKOLWIEK
// osiągnie limit zestrzeleń (host: 5/10/20) ALBO upłynie twardy limit czasu — co pierwsze.
// Zwycięzca = najlepszy w rankingu (kolejność: więcej zestrzeleń → mniej śmierci → niższy
// id, deterministycznie). match.ts (tryb eliminacyjny offline) zostaje nietknięty — to
// osobny tryb; FFA sieciowe ma własną, prostszą regułę „do N fragów".

/** Minimum stanu uczestnika do rozstrzygnięcia meczu FFA (gracz lub bot). */
export interface FfaScore {
  id: number;
  kills: number;
  deaths: number;
}

/** Powód zakończenia meczu: osiągnięty limit zestrzeleń albo limit czasu. */
export type FfaEndReason = 'score' | 'time';

export interface FfaResult {
  ended: boolean;
  /** Id zwycięzcy (najlepszy ranking) albo null, gdy nie ma kandydatów. */
  winnerId: number | null;
  reason: FfaEndReason | null;
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

/** Lider rankingu (najlepszy) albo null dla pustej tablicy. */
function leader(scores: readonly FfaScore[]): FfaScore | null {
  let best: FfaScore | null = null;
  for (const s of scores) {
    if (best === null || compareFfa(s, best) < 0) best = s;
  }
  return best;
}

/**
 * Rozstrzyga stan meczu FFA: kończy, gdy lider osiągnął `scoreLimit` (reason 'score')
 * albo upłynął `timeLimitS` (reason 'time') — co pierwsze. Limit punktów ma pierwszeństwo
 * (gdy oba spełnione w tym samym ticku, to jednak ktoś dobił limit). Zwraca zwycięzcę =
 * lidera rankingu. Pusta tablica → mecz trwa (pokój i tak zniknie, gdy wyjdą ludzie).
 */
export function evaluateFfa(
  scores: readonly FfaScore[],
  elapsedS: number,
  scoreLimit: number,
  timeLimitS: number,
): FfaResult {
  const top = leader(scores);
  if (top === null) return { ended: false, winnerId: null, reason: null };
  if (top.kills >= scoreLimit) return { ended: true, winnerId: top.id, reason: 'score' };
  if (elapsedS >= timeLimitS) return { ended: true, winnerId: top.id, reason: 'time' };
  return { ended: false, winnerId: null, reason: null };
}

/** Klampuje limit punktów do najbliższej dozwolonej wartości (brak zaufania do klienta). */
export function clampScoreLimit(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return MATCH_DEFAULT_SCORE_LIMIT;
  let best = MATCH_SCORE_LIMIT_OPTIONS[0]!;
  let bestDist = Math.abs(raw - best);
  for (const opt of MATCH_SCORE_LIMIT_OPTIONS) {
    const d = Math.abs(raw - opt);
    if (d < bestDist) {
      best = opt;
      bestDist = d;
    }
  }
  return best;
}
