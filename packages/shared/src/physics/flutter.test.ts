import { describe, expect, it } from 'vitest';
import { MS_TO_KMH } from '../constants';
import { A6M2_ZERO, BF109_E, SPITFIRE_MK2 } from '../planes/loader';
import { flutterWingDamageHp, vneWarnLevel } from './flutter';

// Flutter / Vne (fizyka v2 R2, §6.2): powyżej prędkości nieprzekraczalnej Vne (IAS) drżenie strukturalne
// niszczy skrzydła proporcjonalnie do WZGLĘDNEGO przekroczenia. Kanoniczna słabość A6M2 (Vne 630) vs
// mocne Spitfire/Bf 109 (720/750). Funkcje czyste — server aplikuje wynik do stref, HUD czyta poziom.

const kmhToMs = (kmh: number) => kmh / MS_TO_KMH;

describe('flutter: poziom ostrzeżenia Vne (HUD)', () => {
  it('poniżej progu ostrzegawczego = 0', () => {
    expect(vneWarnLevel(kmhToMs(SPITFIRE_MK2.vneKmh * 0.5), SPITFIRE_MK2)).toBe(0);
    // tuż pod progiem flutterWarnFrac·Vne
    expect(vneWarnLevel(kmhToMs(SPITFIRE_MK2.vneKmh * SPITFIRE_MK2.flutterWarnFrac - 1), SPITFIRE_MK2)).toBe(0);
  });

  it('między flutterWarnFrac·Vne a Vne = 1 (zbliżanie)', () => {
    const mid = kmhToMs((SPITFIRE_MK2.vneKmh * SPITFIRE_MK2.flutterWarnFrac + SPITFIRE_MK2.vneKmh) / 2);
    expect(vneWarnLevel(mid, SPITFIRE_MK2)).toBe(1);
  });

  it('na/ponad Vne = 2 (flutter — obrażenia skrzydeł)', () => {
    expect(vneWarnLevel(kmhToMs(SPITFIRE_MK2.vneKmh), SPITFIRE_MK2)).toBe(2);
    expect(vneWarnLevel(kmhToMs(SPITFIRE_MK2.vneKmh + 100), SPITFIRE_MK2)).toBe(2);
  });
});

describe('flutter: obrażenia skrzydeł', () => {
  it('poniżej lub na Vne = zero obrażeń', () => {
    expect(flutterWingDamageHp(kmhToMs(SPITFIRE_MK2.vneKmh - 1), SPITFIRE_MK2, 1)).toBe(0);
    expect(flutterWingDamageHp(kmhToMs(SPITFIRE_MK2.vneKmh), SPITFIRE_MK2, 1)).toBe(0);
  });

  it('powyżej Vne rosną liniowo ze WZGLĘDNYM przekroczeniem', () => {
    const d10 = flutterWingDamageHp(kmhToMs(SPITFIRE_MK2.vneKmh * 1.1), SPITFIRE_MK2, 1);
    const d20 = flutterWingDamageHp(kmhToMs(SPITFIRE_MK2.vneKmh * 1.2), SPITFIRE_MK2, 1);
    expect(d10).toBeGreaterThan(0);
    expect(d20).toBeCloseTo(2 * d10, 6); // przekroczenie 20% = 2× przekroczenia 10%
    expect(d10).toBeCloseTo(SPITFIRE_MK2.flutterDamagePerS * 0.1, 6);
  });

  it('skaluje z dt (obrażenia to tempo × czas)', () => {
    const ias = kmhToMs(SPITFIRE_MK2.vneKmh * 1.2);
    expect(flutterWingDamageHp(ias, SPITFIRE_MK2, 0.5)).toBeCloseTo(flutterWingDamageHp(ias, SPITFIRE_MK2, 1) * 0.5, 6);
  });

  it('A6M2 Zero ma NAJNIŻSZE Vne (kanoniczna kruchość w nurkowaniu) — wcześniej urywa skrzydła', () => {
    expect(A6M2_ZERO.vneKmh).toBeLessThan(SPITFIRE_MK2.vneKmh);
    expect(A6M2_ZERO.vneKmh).toBeLessThan(BF109_E.vneKmh);
    // przy tej samej IAS ponad Vne Zero (630) bierze więcej obrażeń niż Spitfire (720): niższe Vno →
    // większe względne przekroczenie, a przy tym wyższy flutterDamagePerS
    const ias = kmhToMs(700);
    expect(flutterWingDamageHp(ias, A6M2_ZERO, 1)).toBeGreaterThan(0);
    expect(flutterWingDamageHp(ias, SPITFIRE_MK2, 1)).toBe(0); // 700 < Spit Vne 720
  });
});
