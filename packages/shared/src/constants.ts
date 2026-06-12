/** Częstotliwość symulacji fizyki (stały krok). Zmiana = decyzja w PLAN.md. */
export const PHYSICS_HZ = 60;

/** Częstotliwość snapshotów serwer → klient. */
export const SNAPSHOT_HZ = 30;

/** Częstotliwość ramek input klient → serwer. */
export const INPUT_HZ = 60;

/** Port WebSocket serwera gry (dev; na produkcji za reverse proxy). */
export const PORT = 3001;

/** Przyspieszenie ziemskie [m/s²]. */
export const GRAVITY_MS2 = 9.81;

/** Stały krok fizyki [s] — pochodna PHYSICS_HZ. */
export const FIXED_DT_S = 1 / PHYSICS_HZ;

/** Gęstość powietrza na poziomie morza wg ISA [kg/m³]. */
export const SEA_LEVEL_AIR_DENSITY_KGM3 = 1.225;

/** Współczynnik liniowy modelu gęstości ISA w troposferze [1/m] (fizyka-lotu.md rozdz. 4). */
export const ISA_DENSITY_LAPSE_PER_M = 2.2558e-5;

/** Wykładnik modelu gęstości ISA w troposferze. */
export const ISA_DENSITY_EXPONENT = 4.2559;

/**
 * Dolny próg prędkości w mianowniku T = η·P/V [m/s].
 * Razem z clampem ciągu statycznego usuwa osobliwość przy V→0 (fizyka-lotu.md rozdz. 5.3).
 */
export const THRUST_V_EPS_MS = 1;

/** Konwersja m/s → km/h (HUD i cele osiągów podawane w km/h). */
export const MS_TO_KMH = 3.6;

// --- świat (faza 4) ---

/** Bok kwadratowej areny [m] (PLAN.md: 20×20 km, bez streamingu mapy). */
export const ARENA_SIZE_M = 20_000;

/** Odległość do granicy areny, od której HUD ostrzega [m]. */
export const ARENA_WARNING_DISTANCE_M = 1_000;

/** Autopilot zawracający oddaje stery dopiero tyle metrów W GŁĄB areny (histereza). */
export const ARENA_RELEASE_DISTANCE_M = 500;

/** Seed heightmapy świata — identyczna mapa po obu stronach sieci (serwer od fazy 8). */
export const TERRAIN_SEED = 1940;

/** Poziom morza [m] — ocean jest płaszczyzną kolizji tam, gdzie teren jest niżej. */
export const SEA_LEVEL_M = 0;

/** Margines kolizji kadłuba z powierzchnią [m] (simcade: punkt + margines, bez hull mesh). */
export const CRASH_MARGIN_M = 2;

/** Czas od rozbicia do gotowości respawnu [s]. */
export const RESPAWN_DELAY_S = 3;
