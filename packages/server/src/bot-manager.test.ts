import { describe, expect, it } from 'vitest';
import { BotManager } from './bot-manager';

// Nazwiska botów wg samolotu (decyzja użytkownika 2026-06-21): polskie na Spitfire, niemieckie
// na Bf 109 — skład pasuje narodowością do strony. Pule nie są eksportowane, więc weryfikujemy
// przez publiczne `nextName` + `nickMatchesType` (to samo, czego używa GameRoom.refreshBotName).
describe('BotManager — nazwiska wg samolotu', () => {
  it('nadaje polskie nazwiska na Spitfire, niemieckie na Bf 109 (z prefiksem [BOT])', () => {
    const bm = new BotManager();
    const spitNick = bm.nextName('spitfire');
    const bfNick = bm.nextName('bf109');

    expect(spitNick.startsWith('[BOT] ')).toBe(true);
    expect(bfNick.startsWith('[BOT] ')).toBe(true);

    expect(bm.nickMatchesType(spitNick, 'spitfire')).toBe(true);
    expect(bm.nickMatchesType(spitNick, 'bf109')).toBe(false);
    expect(bm.nickMatchesType(bfNick, 'bf109')).toBe(true);
    expect(bm.nickMatchesType(bfNick, 'spitfire')).toBe(false);
  });

  it('rozpoznaje narodowość także w numerowanej nadwyżce puli', () => {
    const bm = new BotManager();
    let last = '';
    for (let i = 0; i < 12; i++) last = bm.nextName('bf109'); // przekrocz rozmiar puli → numeracja
    expect(/\s\d+$/.test(last)).toBe(true);
    expect(bm.nickMatchesType(last, 'bf109')).toBe(true);
    expect(bm.nickMatchesType(last, 'spitfire')).toBe(false);
  });

  it('notifyHit dla nieznanego id jest no-op (nie rzuca)', () => {
    const bm = new BotManager();
    expect(() => bm.notifyHit(12345)).not.toThrow();
  });
});
