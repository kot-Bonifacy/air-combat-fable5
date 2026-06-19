import { describe, expect, it } from 'vitest';
import { clampMatchMode, smallerTeamIndex, MATCH_MODES, TEAM_COUNT } from './team';

describe('clampMatchMode', () => {
  it('przepuszcza znane tryby', () => {
    expect(clampMatchMode('ffa')).toBe('ffa');
    expect(clampMatchMode('team')).toBe('team');
  });

  it('nieznane/spreparowane wejście → domyślny FFA', () => {
    expect(clampMatchMode('teamdm')).toBe('ffa');
    expect(clampMatchMode(undefined)).toBe('ffa');
    expect(clampMatchMode(2)).toBe('ffa');
    expect(clampMatchMode(null)).toBe('ffa');
    expect(clampMatchMode({ t: 'team' })).toBe('ffa');
  });

  it('zna dokładnie dwa tryby', () => {
    expect(MATCH_MODES).toEqual(['ffa', 'team']);
    expect(TEAM_COUNT).toBe(2);
  });
});

describe('smallerTeamIndex (auto-balans)', () => {
  it('dokłada do mniejszej drużyny', () => {
    expect(smallerTeamIndex([2, 1])).toBe(1);
    expect(smallerTeamIndex([1, 3])).toBe(0);
  });

  it('remis → niższy indeks (stabilnie)', () => {
    expect(smallerTeamIndex([0, 0])).toBe(0);
    expect(smallerTeamIndex([2, 2])).toBe(0);
  });

  it('sekwencyjne dokładanie rozdziela na zmianę', () => {
    const counts = [0, 0];
    const picks: number[] = [];
    for (let i = 0; i < 4; i++) {
      const t = smallerTeamIndex(counts);
      picks.push(t);
      counts[t]!++;
    }
    expect(picks).toEqual([0, 1, 0, 1]);
    expect(counts).toEqual([2, 2]);
  });

  it('pusta tablica → 0 (brak wyjątku)', () => {
    expect(smallerTeamIndex([])).toBe(0);
  });
});
