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

/** Odległość do granicy areny, od której HUD ostrzega o nadchodzącym przeniesieniu (torus) [m]. */
export const ARENA_WARNING_DISTANCE_M = 1_000;

/** Seed heightmapy świata — identyczna mapa po obu stronach sieci (serwer od fazy 8). */
export const TERRAIN_SEED = 1940;

/** Poziom morza [m] — ocean jest płaszczyzną kolizji tam, gdzie teren jest niżej. */
export const SEA_LEVEL_M = 0;

/** Margines kolizji kadłuba z powierzchnią [m] (simcade: punkt + margines, bez hull mesh). */
export const CRASH_MARGIN_M = 2;

/** Czas od rozbicia do gotowości respawnu [s]. */
export const RESPAWN_DELAY_S = 3;

// --- walka (faza 5) ---

/**
 * Pojemność puli pocisków (zero alokacji w pętli — niezmiennik nr 6 ducha:
 * hot path bez GC). Spitfire: 8 luf × 1150 rpm ≈ 153 poc./s × 3 s życia ≈ 460
 * aktywnych w szczycie; 768 daje zapas także na pierwsze obce samoloty (faza 8+).
 */
export const BULLET_POOL_CAPACITY = 768;

/** Konwersja milliradianów (rozrzut w JSON) → radiany. */
export const MRAD_TO_RAD = 1e-3;

// --- mecz offline (faza 6) ---

/** Liczba zestrzeleń kończąca pojedynek 1v1 (punkty do N, z respawnami). */
export const MATCH_SCORE_TO_WIN = 3;

// --- tryby multi (faza 7: FFA i drużynowy) ---

/**
 * Liczba żyć (samolotów) na uczestnika w trybach eliminacyjnych. Frakcja odpada,
 * gdy wszyscy jej uczestnicy wyczerpią życia; ostatnia frakcja wygrywa. Jedno =
 * jedna śmierć eliminuje uczestnika (brak respawnów w meczu).
 */
export const MATCH_LIVES = 1;

/** Maksymalna liczba botów obok gracza w trybach multi (budżet wydajności/HUD). */
export const MAX_BOTS = 5;

// --- kontrola strefy (faza 7: główny cel — „przeciąganie liny" nad górą) ---

/**
 * Środek strefy kontroli = szczyt góry w centrum wyspy. Teren ma radialną maskę
 * wokół (0,0) (terrain.ts), więc rdzeń góry leży dokładnie w origin — strefa jest
 * z nim współśrodkowa, bez osobnego „landmarku" do utrzymania w synchronizacji.
 */
export const ZONE_CENTER_X_M = 0;
export const ZONE_CENTER_Z_M = 0;

/** Promień strefy kontroli [m] — POZIOMY walec bez limitu wysokości (liczy się nad górą). */
export const ZONE_RADIUS_M = 2_000;

/**
 * Sekundy WYŁĄCZNEJ kontroli (jedna frakcja sama w strefie) potrzebne do przejęcia
 * strefy = zwycięstwo. 180 s = 3 min (decyzja briefingu). Model KotH bez cofania:
 * sporna/pusta strefa pauzuje liczniki, nic nie zanika (patrz world/zone.ts).
 */
export const ZONE_CAPTURE_SECONDS = 180;

/**
 * Pułap krążenia botów nad strefą [m] — bezpiecznie nad szczytem (rdzeń ~1010 m
 * + szum do ~400 m), z zapasem ponad margines unikania ziemi bota. To waypoint
 * „patrolu" botów: bez pilnego celu ciążą ku temu punktowi (kontestują strefę).
 */
export const ZONE_LOITER_ALT_M = 2_000;
