import { MS_TO_KMH } from '../constants';
import type { PlaneConfig } from '../planes/loader';
import type { PlaneState } from './state';

// Szczątkowe efekty śmigła (fizyka v2 R3, §6.5): moment reakcyjny + P-factor + strumień zaśmigłowy na
// sterze, ODCZUWALNE tylko przy małej prędkości i dużym gazie. Model:
//
//   factor = throttle · max(0, 1 − IAS/fadeKmh)²
//   biasYaw  = propEffect.yawBiasMaxRadS · factor      (znak = kierunek historyczny obrotu śmigła)
//   biasRoll = propEffect.rollBiasMaxRadS · factor
//
// Zanik KWADRATOWY do zera powyżej fadeKmh → w locie poziomym / na prędkości bojowej efekt = 0 (odstępstwo
// §3 pkt 1: brak ciągłego trymowania). Na szczycie pętli / w wiszeniu na śmigle nos „ożywa" jak w WT RB —
// instruktor tego NIE kontruje (gracz musi sterem kierunku/lotkami). Boty mają efekt WYŁĄCZONY (kompensacja
// w pipeline aim — inaczej psułoby im się strzelanie w pętli). Czyste (zależy tylko od throttle/IAS/konfig),
// więc klient i serwer liczą identycznie dla gracza (reconcile-safe).

export interface PropRates {
  /** Bias yaw [rad/s], + = nos w prawo. */
  yaw: number;
  /** Bias roll [rad/s], + = przechył w prawo. */
  roll: number;
}

/** Bias śmigła [rad/s] dla bieżącego stanu (mutuje i zwraca `out`). Zero powyżej fadeKmh. */
export function propEffectRates(state: PlaneState, plane: PlaneConfig, out: PropRates): PropRates {
  const p = plane.propEffect;
  const speedFrac = Math.max(0, 1 - (state.iasMs * MS_TO_KMH) / p.fadeKmh);
  const factor = state.throttle * speedFrac * speedFrac;
  out.yaw = p.yawBiasMaxRadS * factor;
  out.roll = p.rollBiasMaxRadS * factor;
  return out;
}
