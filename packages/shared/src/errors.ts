/** Błąd symulacji fizyki (NaN w stanie, niefizyczne wartości itd.). */
export class PhysicsError extends Error {
  override name = 'PhysicsError';
}
