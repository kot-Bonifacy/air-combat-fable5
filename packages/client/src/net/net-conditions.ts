// Symulator warunków sieciowych (TYLKO dev — faza-09.md krok 1). Na localhost RTT ≈ 0,
// więc bez sztucznego opóźnienia/jitteru/strat nie da się UCZCIWIE testować predykcji
// i interpolacji. Logika jest czysta (bez DOM, bez setTimeout) i deterministyczna przy
// wstrzykniętym RNG — NetClient dokleja do niej harmonogram (setTimeout) i transport.

export interface NetConditionsConfig {
  /** Wyłączony → pakiety idą natychmiast (zachowanie produkcyjne). */
  enabled: boolean;
  /** Bazowe opóźnienie JEDNOKIERUNKOWE [ms]; RTT ≈ 2× + jitter. */
  latencyMs: number;
  /** Losowy rozrzut opóźnienia ± [ms] (źródło zmiany kolejności pakietów). */
  jitterMs: number;
  /** Prawdopodobieństwo utraty pojedynczego pakietu [0..1]. */
  loss: number;
}

export function defaultNetConditions(): NetConditionsConfig {
  // wartości startowe = scenariusz z kryterium fazy 9 (100 ms RTT, 20 ms jitter, 2% loss),
  // ale wyłączone — włącza je dopiero panel dev (gra produkcyjna nie symuluje lagu)
  return { enabled: false, latencyMs: 50, jitterMs: 20, loss: 0.02 };
}

/** Gotowe presety do szybkiego przełączania w panelu dev. */
export const NET_CONDITION_PRESETS: Readonly<Record<string, NetConditionsConfig>> = {
  'LAN (0)': { enabled: true, latencyMs: 0, jitterMs: 0, loss: 0 },
  'Dobre (40 ms)': { enabled: true, latencyMs: 20, jitterMs: 5, loss: 0 },
  'Kryterium (100/20/2%)': { enabled: true, latencyMs: 50, jitterMs: 20, loss: 0.02 },
  'Słabe (200/50/5%)': { enabled: true, latencyMs: 100, jitterMs: 50, loss: 0.05 },
};

/**
 * Opóźnienie jednokierunkowe [ms] dla jednego pakietu albo `null` = pakiet zgubiony.
 * `rand` ∈ [0,1) wstrzykiwany w testach (domyślnie Math.random). Wyłączony symulator
 * = 0 ms i zero strat. Wynik nigdy nie jest ujemny (jitter clampowany do zera).
 */
export function rollDelayMs(
  cfg: NetConditionsConfig,
  rand: () => number = Math.random,
): number | null {
  if (!cfg.enabled) return 0;
  if (cfg.loss > 0 && rand() < cfg.loss) return null;
  const jitter = (rand() * 2 - 1) * cfg.jitterMs;
  const delay = cfg.latencyMs + jitter;
  return delay > 0 ? delay : 0;
}
