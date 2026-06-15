import { describe, expect, it } from 'vitest';
import { createTestPlane } from '../testing/fixtures';
import { GLoadMachine, createGLoadEffects } from './g-load';

// Tolerancja przeciążenia pilota (G-LOC): chwilowe wysokie G dozwolone,
// UTRZYMYWANE — obcinane; rezerwa wraca po odpuszczeniu. Plane testowy
// (fixtures): onsetG=4, toleranceGS=6, recoveryRatePerS=0.35, greyoutReserve=0.6,
// nMaxG=8 → równowaga sufitu = onsetG + recovery·toleranceGS = 4 + 2.1 = 6.1 G.

const plane = createTestPlane();
const DT = 1 / 60;

describe('GLoadMachine — tolerancja przeciążenia pilota', () => {
  it('świeży pilot: pełny sufit nMaxG, zero zaciemnienia, n bez zmian poniżej progu', () => {
    const m = new GLoadMachine();
    const fx = createGLoadEffects();
    m.update(1, plane, DT, fx); // lot poziomy, 1 G
    expect(fx.gLimitG).toBeCloseTo(plane.nMaxG, 5);
    expect(fx.nLimitedG).toBe(1);
    expect(fx.blackoutFactor).toBe(0);
    expect(fx.reserve).toBe(1); // poniżej onsetG: brak ubytku (regeneracja capowana do 1)
  });

  it('chwilowe szarpnięcie: pierwszy tick daje ~nMaxG (zakręt instantaneous zachowany)', () => {
    const m = new GLoadMachine();
    const fx = createGLoadEffects();
    m.update(plane.nMaxG, plane, DT, fx);
    // sufit liczony z rezerwy SPRZED zużycia (=1) → pełne nMaxG w tym ticku
    expect(fx.nLimitedG).toBeCloseTo(plane.nMaxG, 5);
  });

  it('utrzymywane max G: sufit opada poniżej nMaxG i ustala się powyżej onsetG', () => {
    const m = new GLoadMachine();
    const fx = createGLoadEffects();
    for (let i = 0; i < 8 * 60; i++) m.update(plane.nMaxG, plane, DT, fx); // 8 s pełnego ciągnięcia
    expect(fx.nLimitedG).toBeLessThan(plane.nMaxG - 1.5); // wyraźnie obcięte
    expect(fx.nLimitedG).toBeGreaterThan(plane.gTolerance.onsetG); // ale nie poniżej progu
    // równowaga ≈ onsetG + recovery·toleranceGS
    const eq = plane.gTolerance.onsetG + plane.gTolerance.recoveryRatePerS * plane.gTolerance.toleranceGS;
    expect(fx.nLimitedG).toBeCloseTo(eq, 1);
    expect(fx.blackoutFactor).toBeGreaterThan(0); // greyout zaangażowany
    expect(fx.reserve).toBeGreaterThan(0); // model zawsze-regenerujący: nie zeruje rezerwy
  });

  it('zaciemnienie narasta z malejącą rezerwą i jest zero powyżej greyoutReserve', () => {
    const m = new GLoadMachine();
    const fx = createGLoadEffects();
    m.update(plane.nMaxG, plane, DT, fx);
    expect(fx.reserve).toBeGreaterThan(plane.gTolerance.greyoutReserve);
    expect(fx.blackoutFactor).toBe(0); // tuż po szarpnięciu rezerwa jeszcze wysoka
    for (let i = 0; i < 5 * 60; i++) m.update(plane.nMaxG, plane, DT, fx);
    expect(fx.reserve).toBeLessThan(plane.gTolerance.greyoutReserve);
    expect(fx.blackoutFactor).toBeGreaterThan(0);
    expect(fx.blackoutFactor).toBeLessThanOrEqual(1);
  });

  it('odpuszczenie drążka: rezerwa i sufit wracają ku pełnym', () => {
    const m = new GLoadMachine();
    const fx = createGLoadEffects();
    for (let i = 0; i < 6 * 60; i++) m.update(plane.nMaxG, plane, DT, fx);
    const depleted = fx.reserve;
    for (let i = 0; i < 6 * 60; i++) m.update(1, plane, DT, fx); // 6 s lotu 1 G
    expect(fx.reserve).toBeGreaterThan(depleted);
    expect(fx.reserve).toBeCloseTo(1, 2);
    expect(fx.gLimitG).toBeCloseTo(plane.nMaxG, 1);
    expect(fx.blackoutFactor).toBe(0);
  });

  it('ujemne G (pchanie) nie jest limitowane — redout poza zakresem MVP', () => {
    const m = new GLoadMachine();
    const fx = createGLoadEffects();
    m.update(plane.nMinG, plane, DT, fx); // pełne pchnięcie
    expect(fx.nLimitedG).toBe(plane.nMinG); // bez obcięcia
    expect(fx.reserve).toBe(1); // ujemne nie zżera rezerwy (excess < 0 → regeneracja)
  });

  it('reset() przywraca świeżego pilota', () => {
    const m = new GLoadMachine();
    const fx = createGLoadEffects();
    for (let i = 0; i < 6 * 60; i++) m.update(plane.nMaxG, plane, DT, fx);
    expect(fx.reserve).toBeLessThan(0.6);
    m.reset();
    m.update(1, plane, DT, fx);
    expect(fx.reserve).toBe(1);
    expect(fx.gLimitG).toBeCloseTo(plane.nMaxG, 5);
  });
});
