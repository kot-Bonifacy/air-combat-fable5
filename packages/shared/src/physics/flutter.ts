import { MS_TO_KMH } from '../constants';
import type { PlaneConfig } from '../planes/loader';

// Flutter / Vne (fizyka v2 R2, §6.2). Powyżej prędkości nieprzekraczalnej Vne (IAS) narasta drżenie
// strukturalne, które NISZCZY SKRZYDŁA proporcjonalnie do WZGLĘDNEGO przekroczenia (max(0, IAS/Vne − 1)):
// lekkie przekroczenie → powolne uszkodzenie (odwracalne po zwolnieniu, bo obrażenia stref są trwałe, ale
// dopóki skrzydło nie padnie, zwolnienie zatrzymuje dalszy ubytek), duże → szybkie wyrwanie skrzydeł
// (rozpad konstrukcji = śmierć, kill cause 'structure'). Kanoniczna słabość A6M2 (Vne 630) vs mocne
// Spitfire/Bf 109 (720/750). Obrażenia aplikuje SERWER autorytatywnie (jak przegrzanie: self-inflicted,
// bez kredytu) do stref wingL/wingR; skutki jadą jako poziomy w snapshocie v8 → klient predykuje spójnie.
// Ostrzeżenie HUD (poziom Vne) jest czysto kliencke (wzorzec aileronWarning).

/** Poziom ostrzeżenia Vne dla HUD: 0 = poniżej progu, 1 = zbliżanie (≥ flutterWarnFrac·Vne),
 *  2 = przekroczenie (≥ Vne — skrzydła biorą obrażenia flutteru). */
export function vneWarnLevel(iasMs: number, plane: PlaneConfig): 0 | 1 | 2 {
  const iasKmh = iasMs * MS_TO_KMH;
  if (iasKmh >= plane.vneKmh) return 2;
  if (iasKmh >= plane.vneKmh * plane.flutterWarnFrac) return 1;
  return 0;
}

/**
 * Obrażenia flutteru do JEDNEGO skrzydła w tym ticku [HP] — proporcjonalne do względnego przekroczenia
 * Vne (max(0, IAS/Vne − 1)). 0 poniżej Vne. Serwer (autorytatywnie) aplikuje wynik do stref wingL i wingR
 * przez applyZoneHit; klient tego NIE liczy (skutek dostaje jako poziom stref w snapshocie). Czyste.
 */
export function flutterWingDamageHp(iasMs: number, plane: PlaneConfig, dtS: number): number {
  const iasKmh = iasMs * MS_TO_KMH;
  const overFrac = iasKmh / plane.vneKmh - 1;
  if (overFrac <= 0) return 0;
  return plane.flutterDamagePerS * overFrac * dtS;
}
