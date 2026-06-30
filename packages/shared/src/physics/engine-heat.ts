import {
  ENGINE_HEAT_MAX,
  ENGINE_HEAT_REDLINE,
  ENGINE_SPEED_COOL_MAX,
  ENGINE_SPEED_COOL_MIN,
  MS_TO_KMH,
} from '../constants';
import type { PlaneConfig } from '../planes/loader';
import type { PlaneState } from './state';

// Przegrzewanie silnika (limit czasu na wysokim gazie). Model: temperatura `engineHeatFrac`
// (0 = zimny, 1 = czerwona linia) relaksuje pierwszym rzędem do TEMPERATURY RÓWNOWAGI zależnej od
// gazu i opływu chłodnicy:
//
//   heatEq = fullThrottleEqHeat · gaz² / chłodzenie(IAS)
//   dH/dt  = (heatEq − H) / τ            (τ inne dla grzania i chłodzenia)
//
// Moc/odrzut ciepła rośnie ~kwadratowo z gazem (∝ gaz²), więc gaz „mocy ciągłej" (poniżej
// 1/√fullThrottleEqHeat) osiada poniżej czerwonej linii — można nim lecieć bez końca — a 100% gazu
// wypełza ponad nią i po `overheatTimeFullS` sięga przegrzania. Chłodzenie rośnie z prędkością (więcej
// powietrza przez chłodnicę): wolny, stromy wznos grzeje szybciej, nurkowanie/szybki lot chłodzi.
//
// Stan jest PREDYKOWANY identycznie po obu stronach (ta sama funkcja w pilotStep) — NIE jedzie w
// snapshocie (jak `stalled`/G-LOC). Realną konsekwencję (utratę mocy) aplikuje serwer przez obrażenia
// strefy 'silnik' (overheatDamageHp), a te jadą już jako poziomy w snapshocie v8 → klient predykuje
// uszkodzony lot spójnie. Sam wskaźnik HUD czyta lokalną predykcję (samokorygujący się filtr gazu —
// po reconnekcie dociąga do serwera w ~τ; rozjazd dotyczy tylko igły wskaźnika, nie fizyki lotu).

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
 * sieci. Czyste poza odczytem `state.throttle`/`state.iasMs` (bieżący tick) — wynik zależy tylko od nich,
 * dt i konfiguracji, więc klient i serwer liczą identycznie. Wrak (throttle=0) tylko stygnie.
 */
export function stepEngineHeat(state: PlaneState, plane: PlaneConfig, dtS: number): void {
  const t = plane.engineThermal;
  const heatEq = (t.fullThrottleEqHeat * state.throttle * state.throttle) / speedCoolFactor(state.iasMs, t);
  // τ grzania wyprowadzona z nagłówkowego overheatTimeFullS: czas 0→1 przy 100% gazu i prędkości
  // referencyjnej (heatEq = fullThrottleEqHeat) to τ·ln(fullEq/(fullEq−1)) — odwracamy to.
  const tauUp = t.overheatTimeFullS / Math.log(t.fullThrottleEqHeat / (t.fullThrottleEqHeat - 1));
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
