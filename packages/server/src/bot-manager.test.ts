import { describe, expect, it } from 'vitest';
import { BotManager } from './bot-manager';

// Neutralne nazwy botów (2026-06-26: koniec historycznego dobierania narodowości do samolotu —
// drużyna i samolot są rozdzielone). Pula nie jest eksportowana, więc weryfikujemy przez publiczne
// `nextName` + `hasBotName` (to samo, czego używa GameRoom.refreshBotName).
describe('BotManager — neutralne nazwy', () => {
  it('nadaje callsigny z prefiksem [BOT], rozpoznawane przez hasBotName', () => {
    const bm = new BotManager();
    const a = bm.nextName();
    const b = bm.nextName();

    expect(a.startsWith('[BOT] ')).toBe(true);
    expect(b.startsWith('[BOT] ')).toBe(true);
    expect(a).not.toBe(b); // kolejne nicki są różne (kursor po puli)

    expect(bm.hasBotName(a)).toBe(true);
    expect(bm.hasBotName(b)).toBe(true);
    expect(bm.hasBotName('Pilot123')).toBe(false); // nick gracza nie należy do puli botów
  });

  it('rozpoznaje nick także w numerowanej nadwyżce puli', () => {
    const bm = new BotManager();
    let last = '';
    for (let i = 0; i < 14; i++) last = bm.nextName(); // przekrocz rozmiar puli → numeracja
    expect(/\s\d+$/.test(last)).toBe(true);
    expect(bm.hasBotName(last)).toBe(true);
  });

  it('notifyHit dla nieznanego id jest no-op (nie rzuca)', () => {
    const bm = new BotManager();
    expect(() => bm.notifyHit(12345)).not.toThrow();
  });
});
