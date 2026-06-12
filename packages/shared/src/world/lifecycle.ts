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
