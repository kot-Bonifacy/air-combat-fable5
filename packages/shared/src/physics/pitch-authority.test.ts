import { describe, expect, it } from 'vitest';
import { MS_TO_KMH } from '../constants';
import { createPilotDemands } from '../instructor/instructor';
import { A6M2_ZERO, BF109_E, SPITFIRE_MK2, type PlaneConfig } from '../planes/loader';
import { createTestPlane } from '../testing/fixtures';
import { clampLoadFactorG, pitchAuthorityFrac } from './envelope';
import { airDensityKgM3, dynamicPressurePa } from './atmosphere';
import { createSimPlane, pilotStep, type PilotTickResult } from './pilot-step';

// Autorytet steru wysokości vs IAS (fizyka v2 R1, §6.2) przez PEŁNY pipeline pilota —
// lekcja „punktu pracy Zero": mierzymy to, co dostaje gracz, nie sam helper krzywej.
// Kryterium etapu R1: „wyrwanie @ 650 km/h ograniczone autorytetem" + historyczna
// asymetria (Spitfire ster lekki > Bf 109 ciężki > Zero beton).

/** Jeden tick pełnego pipeline'u w locie poziomym @ zadanej IAS na poziomie morza (IAS=TAS). */
function tickAtIas(plane: PlaneConfig, iasKmh: number, nDemandG: number): PilotTickResult {
  const iasMs = iasKmh / MS_TO_KMH;
  const sim = createSimPlane(41);
  sim.state.position.set(0, 0, 0);
  sim.state.velocity.set(0, 0, iasMs); // y=0 → ρ=ρ0 → IAS = TAS
  sim.state.iasMs = iasMs;
  sim.state.throttle = 1;
  const demands = createPilotDemands();
  demands.nDemandG = nDemandG;
  return pilotStep(sim, plane, demands, 1 / 60);
}

describe('autorytet pitch (R1 §6.2) — pełny pipeline', () => {
  it('wyrwanie @ 650 km/h ograniczone POD nMaxG: Spit ~5,3 G, Bf ~3,8 G, Zero ~2,1 G', () => {
    // pierwsze ticki (pełna rezerwa G-LOC, nAvail @ 650 ≫ nMaxG) → wiąże wyłącznie autorytet
    const spit = tickAtIas(SPITFIRE_MK2, 650, SPITFIRE_MK2.nMaxG).nClampedG;
    const bf = tickAtIas(BF109_E, 650, BF109_E.nMaxG).nClampedG;
    const zero = tickAtIas(A6M2_ZERO, 650, A6M2_ZERO.nMaxG).nClampedG;
    expect(spit).toBeCloseTo(8 * (1 - ((650 - 450) / (720 - 450)) * 0.45), 2); // ≈5,33
    expect(bf).toBeCloseTo(8 * (0.65 + ((650 - 550) / (750 - 550)) * (0.3 - 0.65)), 2); // =3,8
    expect(zero).toBeCloseTo(7 * 0.3, 2); // 650 > końca krzywej (630) → wartość brzegowa 0,3
    // historyczna asymetria sztywnienia — porządek bez tolerancji
    expect(spit).toBeGreaterThan(bf);
    expect(bf).toBeGreaterThan(zero);
    for (const [n, plane] of [
      [spit, SPITFIRE_MK2],
      [bf, BF109_E],
      [zero, A6M2_ZERO],
    ] as const) {
      expect(n, `${plane.name}: cap < nMaxG`).toBeLessThan(plane.nMaxG);
    }
  });

  it('poniżej startu krzywej (300 km/h) autorytet jest przezroczysty — wiąże koperta', () => {
    for (const plane of [SPITFIRE_MK2, BF109_E, A6M2_ZERO]) {
      expect(pitchAuthorityFrac(300 / MS_TO_KMH, plane)).toBe(1);
      const qPa = dynamicPressurePa(airDensityKgM3(0), 300 / MS_TO_KMH);
      const envelopeOnly = clampLoadFactorG(plane.nMaxG, qPa, plane);
      expect(tickAtIas(plane, 300, plane.nMaxG).nClampedG, plane.name).toBeCloseTo(
        envelopeOnly,
        6,
      );
    }
  });

  it('cap ujemny skaluje nMinG, ale nigdy powyżej −1 G (pchanie @ 650 ograniczone)', () => {
    // Spitfire @ 650: frac ≈ 0,667 → cap dolny = nMinG·frac ≈ −2,67 (zamiast pełnych −4)
    const r = tickAtIas(SPITFIRE_MK2, 650, SPITFIRE_MK2.nMinG);
    expect(r.nClampedG).toBeCloseTo(-4 * (1 - ((650 - 450) / (720 - 450)) * 0.45), 2);
    expect(r.nClampedG).toBeGreaterThan(SPITFIRE_MK2.nMinG);
  });

  it('strażniki gwarantują lot poziomy normalny (≥1 G) i odwrócony (≤−1 G) przy skrajnym sztywnieniu', () => {
    // fikstura z autorytetem 5% — bez strażników cap wynosiłby 0,4 G / −0,2 G
    const stiff = createTestPlane({
      pitchAuthorityCurve: [
        [100, 0.05],
        [200, 0.05],
      ],
    });
    expect(tickAtIas(stiff, 400, 3).nClampedG).toBeCloseTo(1, 6);
    expect(tickAtIas(stiff, 400, -3).nClampedG).toBeCloseTo(-1, 6);
  });

  it('over-pull @ 650 km/h nie sięga buffetu — ster fizycznie nie da rady (maszyna przeciągnięcia spokojna)', () => {
    const r = tickAtIas(A6M2_ZERO, 650, A6M2_ZERO.nMaxG);
    expect(r.stall.phase).toBe('normal');
  });
});
