import { describe, expect, it } from 'vitest';
import { BOT_CONFIG } from './difficulty';
import { isOffensive, isThreatened, nextBotState, type BotPerception } from './fsm';

const t = BOT_CONFIG.tuning;

/** Domyślna percepcja: cel na szóstej, szybko, brak zagrożenia (sytuacja ofensywna). */
function p(over: Partial<BotPerception> = {}): BotPerception {
  return {
    hasTarget: true,
    rangeM: 500,
    attackerOffBoresightRad: 0.1,
    targetOffBoresightRad: Math.PI,
    aspectRad: 0,
    iasMs: 120,
    criticalDamage: false,
    ...over,
  };
}

/** Percepcja zagrożenia: cel za mną i celuje we mnie, blisko. */
function threat(over: Partial<BotPerception> = {}): BotPerception {
  return p({
    attackerOffBoresightRad: 3.0,
    targetOffBoresightRad: 0.2,
    rangeM: 400,
    ...over,
  });
}

describe('predykaty FSM', () => {
  it('isThreatened: cel za mną, celuje, w zasięgu', () => {
    expect(isThreatened(threat(), t)).toBe(true);
    expect(isThreatened(threat({ rangeM: 2000 }), t)).toBe(false); // za daleko
    expect(isThreatened(threat({ targetOffBoresightRad: 1.5 }), t)).toBe(false); // nie celuje
    expect(isThreatened(p(), t)).toBe(false); // cel przede mną
  });

  it('isOffensive: celuję w cel i blisko', () => {
    expect(isOffensive(p({ attackerOffBoresightRad: 0.1, rangeM: 300 }), t)).toBe(true);
    expect(isOffensive(p({ attackerOffBoresightRad: 0.8 }), t)).toBe(false); // poza stożkiem
    expect(isOffensive(p({ rangeM: 1500 }), t)).toBe(false); // za daleko
  });
});

describe('przejścia FSM', () => {
  it('brak celu → patrol z dowolnego stanu', () => {
    const none = p({ hasTarget: false });
    expect(nextBotState('engage', none, t)).toBe('patrol');
    expect(nextBotState('evade', none, t)).toBe('patrol');
    expect(nextBotState('extend', none, t)).toBe('patrol');
  });

  it('zagrożenie → evade (nadrzędne nad engage i patrol)', () => {
    expect(nextBotState('engage', threat(), t)).toBe('evade');
    expect(nextBotState('patrol', threat(), t)).toBe('evade');
    expect(nextBotState('extend', threat(), t)).toBe('evade');
  });

  it('krytyczne uszkodzenia → extend (ucieczka) z każdego stanu, mimo dobrej pozycji', () => {
    const crit = p({ criticalDamage: true });
    expect(nextBotState('engage', crit, t)).toBe('extend');
    expect(nextBotState('patrol', crit, t)).toBe('extend');
    // pozycja ofensywna i energia odbudowana nie wciągają z powrotem w walkę
    expect(nextBotState('extend', p({ criticalDamage: true, iasMs: 120, attackerOffBoresightRad: 0.1, rangeM: 300 }), t)).toBe('extend');
  });

  it('krytyczne uszkodzenia: zagrożenie ma pierwszeństwo (evade), a brak celu → patrol', () => {
    expect(nextBotState('engage', threat({ criticalDamage: true }), t)).toBe('evade');
    expect(nextBotState('engage', p({ criticalDamage: true, hasTarget: false }), t)).toBe('patrol');
  });

  it('patrol → engage gdy cel w zasięgu wykrycia', () => {
    expect(nextBotState('patrol', p({ rangeM: 2000 }), t)).toBe('engage');
  });

  it('patrol → patrol gdy cel poza zasięgiem wykrycia', () => {
    expect(nextBotState('patrol', p({ rangeM: 3000 }), t)).toBe('patrol');
  });

  it('engage → extend gdy mała energia i brak pozycji ofensywnej', () => {
    expect(nextBotState('engage', p({ iasMs: 40, attackerOffBoresightRad: 0.8 }), t)).toBe('extend');
  });

  it('engage → engage gdy mała energia ALE pozycja ofensywna (dokończ atak)', () => {
    expect(nextBotState('engage', p({ iasMs: 40, attackerOffBoresightRad: 0.1, rangeM: 300 }), t)).toBe(
      'engage',
    );
  });

  it('engage → patrol gdy cel uciekł poza disengage', () => {
    expect(nextBotState('engage', p({ rangeM: 4000 }), t)).toBe('patrol');
  });

  it('engage → engage w zasięgu, energia ok, brak zagrożenia', () => {
    expect(nextBotState('engage', p({ rangeM: 600 }), t)).toBe('engage');
  });

  it('evade → extend gdy zagrożenie minęło, ale mała energia', () => {
    expect(nextBotState('evade', p({ iasMs: 40 }), t)).toBe('extend');
  });

  it('evade → engage gdy zagrożenie minęło, energia ok, cel w zasięgu', () => {
    expect(nextBotState('evade', p({ rangeM: 1000 }), t)).toBe('engage');
  });

  it('evade → patrol gdy zagrożenie minęło, energia ok, cel daleko', () => {
    expect(nextBotState('evade', p({ rangeM: 3000 }), t)).toBe('patrol');
  });

  it('extend → engage gdy energia odbudowana i cel w zasięgu', () => {
    expect(nextBotState('extend', p({ iasMs: 120, rangeM: 1000 }), t)).toBe('engage');
  });

  it('extend → patrol gdy cel uciekł poza disengage', () => {
    expect(nextBotState('extend', p({ iasMs: 120, rangeM: 4000 }), t)).toBe('patrol');
  });

  it('extend → extend gdy energia jeszcze nieodbudowana', () => {
    expect(nextBotState('extend', p({ iasMs: 70, rangeM: 1000 }), t)).toBe('extend');
  });
});
