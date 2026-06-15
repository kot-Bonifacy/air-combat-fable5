import { describe, expect, it } from 'vitest';
import { FIXED_DT_S } from '../constants';
import { createRng } from '../math/rng';
import { SPITFIRE_MK2 } from '../planes/loader';
import { StallMachine, createStallEffects } from './stall';

const plane = SPITFIRE_MK2;

function machineAt(seed = 42): { machine: StallMachine; effects: ReturnType<typeof createStallEffects> } {
  return { machine: new StallMachine(seed), effects: createStallEffects() };
}

describe('RNG mulberry32', () => {
  it('ten sam seed → identyczna sekwencja; inny seed → inna', () => {
    const a = createRng(123);
    const b = createRng(123);
    const c = createRng(124);
    const seqA = [a(), a(), a()];
    const seqB = [b(), b(), b()];
    const seqC = [c(), c(), c()];
    expect(seqA).toEqual(seqB);
    expect(seqA).not.toEqual(seqC);
  });

  it('wartości w [0, 1)', () => {
    const rng = createRng(7);
    for (let i = 0; i < 1000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('maszyna stanów przeciągnięcia (6.5)', () => {
  it('normal poniżej progu buffetu — zero efektów', () => {
    const { machine, effects } = machineAt();
    machine.update(0.5, plane, FIXED_DT_S, effects);
    expect(effects.phase).toBe('normal');
    expect(effects.buffetIntensity).toBe(0);
    expect(effects.aileronFactor).toBe(1);
    expect(effects.rollRateOffsetRadS).toBe(0);
  });

  it('buffet ostrzega PRZED przeciągnięciem, intensywność narasta do 1', () => {
    const { machine, effects } = machineAt();
    const onset = plane.stall.buffetOnsetRatio;
    machine.update(onset + 0.001, plane, FIXED_DT_S, effects);
    expect(effects.phase).toBe('buffet');
    expect(effects.buffetIntensity).toBeGreaterThan(0);
    expect(effects.buffetIntensity).toBeLessThan(0.1);
    expect(effects.aileronFactor).toBe(1); // lotki pełne aż do faktycznego przeciągnięcia

    machine.update(0.999, plane, FIXED_DT_S, effects);
    expect(effects.phase).toBe('buffet');
    expect(effects.buffetIntensity).toBeGreaterThan(0.9);
  });

  it('przekroczenie clMax → stalled: lotki ~30%, pełny buffet, brak wymuszania nosa', () => {
    const { machine, effects } = machineAt();
    machine.update(1.1, plane, FIXED_DT_S, effects);
    expect(effects.phase).toBe('stalled');
    expect(effects.buffetIntensity).toBe(1);
    expect(effects.aileronFactor).toBe(plane.stall.aileronEffectiveness);
    // przed wingDropDelayS żaden "twardy" obrót nie jest wymuszany (nos opada
    // naturalnie za torem, nie skryptem)
    expect(effects.rollRateOffsetRadS).toBe(0);
  });

  it('wing drop dopiero po wingDropDelayS trzymania przeciągnięcia', () => {
    const { machine, effects } = machineAt();
    // margines 2 ticków z obu stron progu — akumulacja dt jest zmiennoprzecinkowa
    const ticksToDelay = Math.ceil(plane.stall.wingDropDelayS / FIXED_DT_S);
    for (let i = 0; i < ticksToDelay - 2; i++) {
      machine.update(1.2, plane, FIXED_DT_S, effects);
    }
    expect(effects.rollRateOffsetRadS).toBe(0); // tuż przed progiem — jeszcze nie
    for (let i = 0; i < 4; i++) machine.update(1.2, plane, FIXED_DT_S, effects);
    expect(Math.abs(effects.rollRateOffsetRadS)).toBeGreaterThan(0);
    // skala 0.75–1.25 × wingDropRateDegS
    const magDegS = (Math.abs(effects.rollRateOffsetRadS) * 180) / Math.PI;
    expect(magDegS).toBeGreaterThanOrEqual(plane.stall.wingDropRateDegS * 0.75);
    expect(magDegS).toBeLessThanOrEqual(plane.stall.wingDropRateDegS * 1.25);
  });

  it('wing drop deterministyczny dla seeda; różne seedy dają oba kierunki', () => {
    const run = (seed: number): number => {
      const { machine, effects } = machineAt(seed);
      const ticks = Math.ceil(plane.stall.wingDropDelayS / FIXED_DT_S) + 5;
      for (let i = 0; i < ticks; i++) machine.update(1.2, plane, FIXED_DT_S, effects);
      return effects.rollRateOffsetRadS;
    };
    expect(run(42)).toBe(run(42));
    const signs = new Set([1, 2, 3, 4, 5, 6, 7, 8].map((s) => Math.sign(run(s))));
    expect(signs).toEqual(new Set([-1, 1]));
  });

  it('procedura "oddać drążek": spadek żądania → wyjście z przeciągnięcia i reset timera', () => {
    const { machine, effects } = machineAt();
    for (let i = 0; i < 30; i++) machine.update(1.3, plane, FIXED_DT_S, effects);
    machine.update(0.7, plane, FIXED_DT_S, effects);
    expect(effects.phase).toBe('normal');
    expect(effects.aileronFactor).toBe(1);
    expect(effects.rollRateOffsetRadS).toBe(0);

    // ponowne wejście: timer wing dropu liczy od zera
    for (let i = 0; i < 30; i++) machine.update(1.3, plane, FIXED_DT_S, effects);
    expect(effects.rollRateOffsetRadS).toBe(0);
  });

  it('przeciągnięcie na ujemnym Cl (pchanie): pełne skutki symetrycznie (|clRatio|)', () => {
    const { machine, effects } = machineAt();
    machine.update(-1.1, plane, FIXED_DT_S, effects);
    expect(effects.phase).toBe('stalled');
    expect(effects.buffetIntensity).toBe(1);
    expect(effects.aileronFactor).toBe(plane.stall.aileronEffectiveness);
  });

  it('buffet działa też na ujemnym Cl (progi na |clRatio|)', () => {
    const { machine, effects } = machineAt();
    machine.update(-(plane.stall.buffetOnsetRatio + 0.001), plane, FIXED_DT_S, effects);
    expect(effects.phase).toBe('buffet');
    expect(effects.buffetIntensity).toBeGreaterThan(0);
    expect(effects.aileronFactor).toBe(1);
  });

  it('q→0 (zawiśnięcie na śmigle): clRatio=∞ → stalled bez NaN', () => {
    const { machine, effects } = machineAt();
    machine.update(Infinity, plane, FIXED_DT_S, effects);
    expect(effects.phase).toBe('stalled');
    expect(Number.isFinite(effects.rollRateOffsetRadS)).toBe(true);
  });
});
