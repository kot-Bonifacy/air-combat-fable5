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
