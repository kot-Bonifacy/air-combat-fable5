/**
 * Odcinkowa krzywa strojeniowa: punkty [x, y] o rosnącym x (walidację monotoniczności
 * robi loader konfiguracji). Wspólny format dla rollRateCurve, pitchAuthorityCurve
 * i powerCurve (fizyka v2, etap R1) — jedna semantyka próbkowania w całym projekcie.
 */
export type CurvePoints = readonly (readonly [x: number, y: number])[];

/**
 * Próbkowanie krzywej: interpolacja liniowa między punktami, poza zakresem wartości
 * brzegowe (bez ekstrapolacji). Semantyka identyczna z historycznym maxRollRateRadS
 * (envelope.ts, rozdz. 6.2) — refaktor R1 nie ma prawa ruszyć złotych testów rolla.
 * Pusta krzywa → 0 (nieosiągalne przy configach z loadera — wymaga ≥2 punktów).
 */
export function sampleCurve(curve: CurvePoints, x: number): number {
  let prev = curve[0];
  if (prev === undefined) return 0;
  if (x <= prev[0]) return prev[1];
  for (let i = 1; i < curve.length; i++) {
    const point = curve[i];
    if (point === undefined) break;
    if (x <= point[0]) {
      const t = (x - prev[0]) / (point[0] - prev[0]);
      return prev[1] + t * (point[1] - prev[1]);
    }
    prev = point;
  }
  return prev[1]; // poza prawym końcem krzywej — wartość brzegowa
}
