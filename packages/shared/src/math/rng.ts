/**
 * Mulberry32 — deterministyczny PRNG z 32-bitowym seedem.
 * Używany wszędzie, gdzie "losowość" musi być odtwarzalna po obu stronach
 * sieci i w testach (np. wing drop w przeciągnięciu). Nigdy Math.random()
 * w logice symulacji.
 */
export function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
