import { describe, expect, it } from 'vitest';
import { MATCH_DEFAULT_SCORE_LIMIT } from '../constants';
import { clampScoreLimit, compareFfa, evaluateFfa, rankFfa, type FfaScore } from './ffa';

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

describe('FFA — rozstrzygnięcie meczu', () => {
  const LIMIT = 5;
  const TIME = 900;

  it('mecz trwa, dopóki nikt nie osiągnął limitu i jest czas', () => {
    const r = evaluateFfa([s(0, 3), s(1, 4)], 100, LIMIT, TIME);
    expect(r).toEqual({ ended: false, winnerId: null, reason: null });
  });

  it('kończy się przy osiągnięciu limitu zestrzeleń — zwycięzcą lider', () => {
    const r = evaluateFfa([s(0, 5), s(1, 2)], 100, LIMIT, TIME);
    expect(r).toEqual({ ended: true, winnerId: 0, reason: 'score' });
  });

  it('limit punktów ma pierwszeństwo nad limitem czasu', () => {
    const r = evaluateFfa([s(0, 5), s(1, 4)], TIME + 1, LIMIT, TIME);
    expect(r.reason).toBe('score');
    expect(r.winnerId).toBe(0);
  });

  it('kończy się po upływie czasu — zwycięzcą lider rankingu', () => {
    const r = evaluateFfa([s(0, 2, 3), s(1, 2, 1)], TIME, LIMIT, TIME);
    expect(r).toEqual({ ended: true, winnerId: 1, reason: 'time' }); // remis killi → mniej śmierci
  });

  it('pusta tablica nie kończy meczu (brak kandydatów na zwycięzcę)', () => {
    expect(evaluateFfa([], TIME + 10, LIMIT, TIME)).toEqual({
      ended: false,
      winnerId: null,
      reason: null,
    });
  });
});

describe('FFA — clampScoreLimit', () => {
  it('przepuszcza dozwolone wartości', () => {
    expect(clampScoreLimit(5)).toBe(5);
    expect(clampScoreLimit(10)).toBe(10);
    expect(clampScoreLimit(20)).toBe(20);
  });

  it('klampuje do najbliższej dozwolonej', () => {
    expect(clampScoreLimit(7)).toBe(5); // równo blisko 5 i 10 → niższa (pierwsza)
    expect(clampScoreLimit(8)).toBe(10);
    expect(clampScoreLimit(100)).toBe(20);
    expect(clampScoreLimit(1)).toBe(5);
  });

  it('odrzuca śmieci do domyślnego', () => {
    expect(clampScoreLimit('dużo')).toBe(MATCH_DEFAULT_SCORE_LIMIT);
    expect(clampScoreLimit(NaN)).toBe(MATCH_DEFAULT_SCORE_LIMIT);
    expect(clampScoreLimit(undefined)).toBe(MATCH_DEFAULT_SCORE_LIMIT);
  });
});
