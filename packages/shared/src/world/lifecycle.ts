import { CRASH_MARGIN_M, RESPAWN_DELAY_S, SEA_LEVEL_M } from '../constants';
import type { PlaneState } from '../physics/state';
import type { Terrain } from './terrain';

// Cykl życia samolotu (faza 4): alive → (kolizja) dead → (po RESPAWN_DELAY_S)
// respawning → właściciel stanu (teraz klient, od fazy 8 serwer) ustawia punkt
// startu i life='alive'. Maszyna tylko sygnalizuje — NIE teleportuje samolotu,
// bo o miejscu respawnu decyduje autorytet.

export type LifeEvent = 'none' | 'crashed' | 'respawnReady';

/** Wysokość powierzchni pod punktem (x,z) [m]: teren albo poziom morza. */
export function surfaceHeightM(terrain: Terrain, xM: number, zM: number): number {
  return Math.max(terrain.heightAt(xM, zM), SEA_LEVEL_M);
}

/**
 * Najwyższa powierzchnia pod punktem i przed nim wzdłuż kierunku (dirX,dirZ)
 * na zadanych dystansach [m]. Używane przez unikanie ziemi botów (faza 6): pilot
 * omija GRAŃ z przodu, nie tylko ziemię pod sobą. `dir` nie musi być jednostkowy
 * (normalizowany tu); zerowy → tylko punkt pod spodem.
 */
export function lookaheadSurfaceM(
  terrain: Terrain,
  xM: number,
  zM: number,
  dirX: number,
  dirZ: number,
  distancesM: readonly number[],
): number {
  let maxH = surfaceHeightM(terrain, xM, zM);
  const len = Math.hypot(dirX, dirZ);
  if (len < 1e-6) return maxH;
  const ux = dirX / len;
  const uz = dirZ / len;
  for (const d of distancesM) {
    const h = surfaceHeightM(terrain, xM + ux * d, zM + uz * d);
    if (h > maxH) maxH = h;
  }
  return maxH;
}

/**
 * Jeden tick cyklu życia. Wołać po fizyce (alive: detekcja kolizji)
 * lub zamiast niej (dead/respawning: fizyka stoi, liczy się timer).
 */
export function updateLifecycle(state: PlaneState, terrain: Terrain, dtS: number): LifeEvent {
  if (state.life === 'alive') {
    const { x, y, z } = state.position;
    if (y <= surfaceHeightM(terrain, x, z) + CRASH_MARGIN_M) {
      state.life = 'dead';
      state.lifeTimerS = 0;
      return 'crashed';
    }
    return 'none';
  }
  if (state.life === 'dead') {
    state.lifeTimerS += dtS;
    if (state.lifeTimerS >= RESPAWN_DELAY_S) {
      state.life = 'respawning';
      return 'respawnReady';
    }
  }
  return 'none';
}
