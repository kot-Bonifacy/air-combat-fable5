import {
  ENGINE_HEAT_MAX,
  ENGINE_HEAT_REDLINE,
  ENGINE_SPEED_COOL_MAX,
  ENGINE_SPEED_COOL_MIN,
  MS_TO_KMH,
} from '../constants';
import type { PlaneConfig } from '../planes/loader';
import type { PlaneState } from './state';

// Przegrzewanie silnika (fizyka v2 R2, §6.3). Model: temperatura `engineHeatFrac` (0 = zimny,
// 1 = czerwona linia) relaksuje pierwszym rzędem do TEMPERATURY RÓWNOWAGI zależnej od gazu, WEP
// i opływu chłodnicy:
//
//   heatEq = militaryEqHeat · (WEP ? wepHeatMul : 1) · gaz² / chłodzenie(IAS)
//   dH/dt  = (heatEq − H) / τ            (τ inne dla grzania i chłodzenia)
//
// R2 zmienia sens vs poprzedni model: przy 100% gazu MOCY BOJOWEJ (bez WEP) equilibrium = militaryEqHeat
// < 1 (czerwona linia) → lot na maksie bez limitu (moc ciągła). Dopiero WEP (mnożnik wepHeatMul) wypycha
// equilibrium ponad czerwoną linię i po `wepTimeToRedlineS` (licząc od ustalonej temperatury bojowej)
// sięga przegrzania — Spitfire ~5 min (+12 lb), Bf 109 ~1 min (Notleistung). Chłodzenie rośnie z prędkością
// (więcej powietrza przez chłodnicę): wolny, stromy wznos grzeje szybciej, nurkowanie/szybki lot chłodzi.
//
// Stan jest PREDYKOWANY identycznie po obu stronach (ta sama funkcja w pilotStep; WEP to per-tick echo
// inputu przez state.wepActive) — NIE jedzie w snapshocie (jak `stalled`/G-LOC). Realną konsekwencję
// (utratę mocy) aplikuje serwer przez obrażenia strefy 'silnik' (overheatDamageHp), a te jadą już jako
// poziomy w snapshocie v8 → klient predykuje uszkodzony lot spójnie. Sam wskaźnik HUD czyta lokalną
// predykcję (rozjazd po reconnekcie dotyczy tylko igły wskaźnika, nie fizyki lotu).

/** ln(1/0.05) ≈ 3 stałe czasowe = chłodzenie od czerwonej linii do ~5% (umowne „zimno") dla coolTimeS. */
const COOL_SPAN_LN = Math.log(20);

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

/**
 * Mnożnik chłodzenia chłodnicą od opływu: 1.0 przy prędkości referencyjnej, >1 szybciej (lepsze
 * chłodzenie), <1 wolniej. Clampowany, by przy IAS→0 nie dzielić temperatury równowagi przez ~0.
 */
function speedCoolFactor(iasMs: number, t: PlaneConfig['engineThermal']): number {
  const iasKmh = iasMs * MS_TO_KMH;
  return clamp(1 + t.speedCoolingK * (iasKmh / t.speedCoolingRefKmh - 1), ENGINE_SPEED_COOL_MIN, ENGINE_SPEED_COOL_MAX);
}

/**
 * Krok modelu termicznego silnika (mutuje `state.engineHeatFrac`). Wołany w `pilotStep` po obu stronach
 * sieci. Czyste poza odczytem `state.throttle`/`state.iasMs`/`state.wepActive` (bieżący tick) — wynik zależy
 * tylko od nich, dt i konfiguracji, więc klient i serwer liczą identycznie. Wrak (throttle=0) tylko stygnie.
 */
export function stepEngineHeat(state: PlaneState, plane: PlaneConfig, dtS: number): void {
  const t = plane.engineThermal;
  const wepMul = state.wepActive ? t.wepHeatMul : 1;
  const heatEq =
    (t.militaryEqHeat * wepMul * state.throttle * state.throttle) / speedCoolFactor(state.iasMs, t);
  // τ grzania wyprowadzona z nagłówkowego wepTimeToRedlineS: czas przejścia od ustalonej temperatury
  // BOJOWEJ (militaryEqHeat) do czerwonej linii (1) na WEP przy 100% gazu i prędkości referencyjnej.
  // eqWep = militaryEqHeat·wepHeatMul (equilibrium WEP); H(t)=eqWep+(mil−eqWep)e^(−t/τ)=1 → odwracamy.
  // Loader gwarantuje eqWep>1>militaryEqHeat, więc log>0 (NaN-safe bez maskowania — niezmiennik nr 7).
  const eqWep = t.militaryEqHeat * t.wepHeatMul;
  const tauUp = t.wepTimeToRedlineS / Math.log((eqWep - t.militaryEqHeat) / (eqWep - 1));
  const tauDown = t.coolTimeS / COOL_SPAN_LN;
  const tau = heatEq > state.engineHeatFrac ? tauUp : tauDown;
  // dokładna relaksacja dyskretna (stabilna dla dowolnego dt, bez przeskoku ponad equilibrium)
  const next = state.engineHeatFrac + (heatEq - state.engineHeatFrac) * (1 - Math.exp(-dtS / tau));
  state.engineHeatFrac = clamp(next, 0, ENGINE_HEAT_MAX);
}

/**
 * Temperatura silnika w °C do wskaźnika HUD (per samolot): liniowa interpolacja między `coldTempC`
 * (engineHeatFrac 0 = zimny) a `redlineTempC` (engineHeatFrac 1 = czerwona linia), ekstrapolowana
 * powyżej czerwonej linii (silnik głęboko przegrzany rośnie dalej). Czysta — klient liczy ją z lokalnie
 * predykowanego `engineHeatFrac`, więc tylko obrót igły, nie fizyka. Progi „gorąco"/„przegrzanie"
 * (kolor wiersza HUD) idą nadal po bezwymiarowym `engineHeatFrac` (wspólne ENGINE_HEAT_WARN/REDLINE).
 */
export function engineDisplayTempC(engineHeatFrac: number, t: PlaneConfig['engineThermal']): number {
  return t.coldTempC + engineHeatFrac * (t.redlineTempC - t.coldTempC);
}

/**
 * Obrażenia do strefy 'silnik' [HP] w tym ticku z przegrzania — proporcjonalne do przekroczenia
 * czerwonej linii (ledwo ponad próg → znikome, głęboka czerwień → szybkie). 0 poniżej progu. Serwer
 * (autorytatywnie) aplikuje wynik przez applyZoneHit do strefy silnika; klient tego NIE liczy (skutek
 * dostaje jako poziom w snapshocie). Czyste.
 */
export function overheatDamageHp(engineHeatFrac: number, plane: PlaneConfig, dtS: number): number {
  if (engineHeatFrac <= ENGINE_HEAT_REDLINE) return 0;
  return plane.engineThermal.overheatDamagePerS * (engineHeatFrac - ENGINE_HEAT_REDLINE) * dtS;
}
