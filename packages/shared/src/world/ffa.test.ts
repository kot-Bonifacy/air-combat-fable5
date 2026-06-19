import { describe, expect, it } from 'vitest';
import { compareFfa, rankFfa, type FfaScore } from './ffa';

// Ranking FFA (faza 13). P1 (2026-06-19): mechanika limitu zestrzeleń/czasu (evaluateFfa,
// clampScoreLimit) usunięta — FFA jest eliminacyjne jak SP (koniec liczy world/match.ts).
// Zostaje już TYLKO porządek rankingu (sort tabeli wyników, wybór lidera frakcji).

function s(id: number, kills: number, deaths = 0): FfaScore {
  return { id, kills, deaths };
}

describe('FFA — ranking', () => {
  it('sortuje malejąco po zestrzeleniach, potem rosnąco po śmierciach, potem po id', () => {
    const ranked = rankFfa([s(3, 2, 5), s(1, 5, 1), s(2, 5, 0), s(4, 0, 0)]);
    expect(ranked.map((r) => r.id)).toEqual([2, 1, 3, 4]); // 5/0, 5/1, 2/5, 0/0
  });

  it('compareFfa daje deterministyczny tie-break przy równych killach i śmierciach', () => {
    expect(compareFfa(s(2, 3, 1), s(7, 3, 1))).toBeLessThan(0); // niższy id wyżej
  });

  it('nie mutuje wejścia', () => {
    const input = [s(1, 1), s(2, 3)];
    rankFfa(input);
    expect(input.map((r) => r.id)).toEqual([1, 2]);
  });
});
