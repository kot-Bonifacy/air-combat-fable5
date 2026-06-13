import { describe, expect, it } from 'vitest';
import { applyDamage, createHealth, resetHealth } from './health';

describe('HP i obrażenia', () => {
  it('trafienie nieśmiertelne odejmuje HP i zwraca "absorbed"', () => {
    const h = createHealth(100);
    expect(applyDamage(h, 30)).toBe('absorbed');
    expect(h.hp).toBe(70);
    expect(h.alive).toBe(true);
  });

  it('zejście do 0 → "destroyed", HP nie schodzi poniżej zera', () => {
    const h = createHealth(20);
    expect(applyDamage(h, 25)).toBe('destroyed');
    expect(h.hp).toBe(0);
    expect(h.alive).toBe(false);
  });

  it('dokładne zero też zabija', () => {
    const h = createHealth(20);
    expect(applyDamage(h, 20)).toBe('destroyed');
    expect(h.alive).toBe(false);
  });

  it('kill liczy się raz: kolejne trafienia w martwy cel → "ignored"', () => {
    const h = createHealth(10);
    expect(applyDamage(h, 10)).toBe('destroyed');
    expect(applyDamage(h, 5)).toBe('ignored');
    expect(h.hp).toBe(0);
  });

  it('zerowe/ujemne obrażenia są ignorowane', () => {
    const h = createHealth(10);
    expect(applyDamage(h, 0)).toBe('ignored');
    expect(applyDamage(h, -5)).toBe('ignored');
    expect(h.hp).toBe(10);
  });

  it('resetHealth przywraca pełne HP (respawn)', () => {
    const h = createHealth(50);
    applyDamage(h, 50);
    resetHealth(h);
    expect(h.hp).toBe(50);
    expect(h.alive).toBe(true);
  });
});
