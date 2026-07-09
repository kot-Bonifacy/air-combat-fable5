import { describe, expect, it } from 'vitest';
import { AILERON_CONCRETE_FRAC, AILERON_STIFF_FRAC, aileronWarning } from './hud';

// Ostrzeżenie o sztywnieniu lotek (2026-07-09): autorytet = maxRoll(IAS)/szczyt krzywej.
// Progi mają odzwierciedlać charakter A6M2 (lekki <320 km/h, sztywny ~400, beton >445).

describe('aileronWarning', () => {
  it('pełny autorytet i próg sztywności włącznie → brak ostrzeżenia', () => {
    expect(aileronWarning(1)).toBe('');
    expect(aileronWarning(AILERON_STIFF_FRAC)).toBe('');
  });

  it('poniżej progu sztywności → „lotki sztywne"', () => {
    expect(aileronWarning(AILERON_STIFF_FRAC - 0.01)).toContain('sztywne');
    expect(aileronWarning(AILERON_CONCRETE_FRAC)).toContain('sztywne');
  });

  it('poniżej progu betonu → „ZABETONOWANE"', () => {
    expect(aileronWarning(AILERON_CONCRETE_FRAC - 0.01)).toContain('ZABETONOWANE');
  });

  it('kotwica krzywej Zero (szczyt 85°/s): 300 km/h czysto, 400 sztywno, 450 beton', () => {
    expect(aileronWarning(74 / 85)).toBe('');
    expect(aileronWarning(24 / 85)).toContain('sztywne');
    expect(aileronWarning(12 / 85)).toContain('ZABETONOWANE');
  });
});
