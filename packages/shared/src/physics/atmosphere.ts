import {
  ISA_DENSITY_EXPONENT,
  ISA_DENSITY_LAPSE_PER_M,
  SEA_LEVEL_AIR_DENSITY_KGM3,
} from '../constants';

/**
 * Gęstość powietrza wg ISA (troposfera): ρ(h) = ρ0 · (1 − λ·h)^κ
 * (docs/fizyka-lotu.md rozdz. 4). Podstawa potęgi obcięta do 0 — powyżej
 * ~44 km wyszłaby ujemna i pow() zwróciłby NaN.
 */
export function airDensityKgM3(altitudeM: number): number {
  const base = Math.max(0, 1 - ISA_DENSITY_LAPSE_PER_M * altitudeM);
  return SEA_LEVEL_AIR_DENSITY_KGM3 * Math.pow(base, ISA_DENSITY_EXPONENT);
}

/** Ciśnienie dynamiczne q = ½·ρ·V² [Pa]. */
export function dynamicPressurePa(rhoKgM3: number, tasMs: number): number {
  return 0.5 * rhoKgM3 * tasMs * tasMs;
}

/** IAS = TAS · sqrt(ρ/ρ0) — prędkość „czuta" przez płatowiec i pilota. */
export function tasToIasMs(tasMs: number, rhoKgM3: number): number {
  return tasMs * Math.sqrt(rhoKgM3 / SEA_LEVEL_AIR_DENSITY_KGM3);
}
