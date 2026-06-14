import { describe, expect, it } from 'vitest';
import { factionsInPlay, matchOutcome, type MatchMember } from './match';

// Reguły końca meczu eliminacyjnego (faza 7). Frakcja żyje, dopóki ma > 0 żyć.
// Mecz trwa, dopóki w grze są ≥ 2 frakcje; gracz wygrywa, gdy zostaje sam,
// przegrywa, gdy jego frakcja straci wszystkie samoloty.

const m = (faction: number, livesLeft: number): MatchMember => ({ faction, livesLeft });

describe('factionsInPlay', () => {
  it('pomija frakcje bez żyć', () => {
    const set = factionsInPlay([m(0, 2), m(1, 0), m(2, 1)]);
    expect([...set].sort()).toEqual([0, 2]);
  });

  it('frakcja z wieloma uczestnikami liczona raz', () => {
    const set = factionsInPlay([m(0, 3), m(0, 1), m(1, 2)]);
    expect(set.size).toBe(2);
  });

  it('wszyscy wyeliminowani → pusty zbiór', () => {
    expect(factionsInPlay([m(0, 0), m(1, 0)]).size).toBe(0);
  });
});

describe('matchOutcome (perspektywa frakcji gracza = 0)', () => {
  it('dwie frakcje żywe → ongoing', () => {
    expect(matchOutcome(0, [m(0, 3), m(1, 2)])).toBe('ongoing');
  });

  it('FFA: kilka frakcji żywych → ongoing', () => {
    expect(matchOutcome(0, [m(0, 1), m(1, 2), m(2, 1), m(3, 3)])).toBe('ongoing');
  });

  it('została tylko frakcja gracza → won', () => {
    expect(matchOutcome(0, [m(0, 2), m(1, 0), m(2, 0)])).toBe('won');
  });

  it('frakcja gracza bez żyć, wróg żyje → lost', () => {
    expect(matchOutcome(0, [m(0, 0), m(1, 1)])).toBe('lost');
  });

  it('FFA: gracz padł, ale dwa boty walczą dalej → lost (gracz nie obserwuje do końca)', () => {
    expect(matchOutcome(0, [m(0, 0), m(1, 2), m(2, 1)])).toBe('lost');
  });

  it('drużynowo: gracz padł, lecz sojusznik z tej samej frakcji żyje → ongoing', () => {
    // frakcja 0 = gracz (0 żyć) + sojusznik (1 życie) → frakcja wciąż w grze
    expect(matchOutcome(0, [m(0, 0), m(0, 1), m(1, 2)])).toBe('ongoing');
  });

  it('drużynowo: cała drużyna gracza wybita → lost', () => {
    expect(matchOutcome(0, [m(0, 0), m(0, 0), m(1, 1)])).toBe('lost');
  });

  it('obie ostatnie maszyny padły w tym samym ticku → lost ma pierwszeństwo', () => {
    expect(matchOutcome(0, [m(0, 0), m(1, 0)])).toBe('lost');
  });
});
