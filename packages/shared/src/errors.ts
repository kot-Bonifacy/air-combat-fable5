/** Błąd symulacji fizyki (NaN w stanie, niefizyczne wartości itd.). */
export class PhysicsError extends Error {
  override name = 'PhysicsError';
}

/** Błąd walidacji konfiguracji samolotu (shared/src/planes/*.json). */
export class PlaneConfigError extends Error {
  override name = 'PlaneConfigError';
}

/** Błąd walidacji konfiguracji AI / trudności botów (shared/src/ai/*.json). */
export class AiConfigError extends Error {
  override name = 'AiConfigError';
}
