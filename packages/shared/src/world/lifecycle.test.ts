import { describe, expect, it } from 'vitest';
import { CRASH_MARGIN_M, FIXED_DT_S, RESPAWN_DELAY_S } from '../constants';
import { createPlaneState } from '../physics/state';
import { createTerrain, SEABED_M } from './terrain';
import { surfaceHeightM, updateLifecycle } from './lifecycle';

const terrain = createTerrain();

describe('cykl życia: kolizja → dead → respawnReady (faza 4)', () => {
  it('surfaceHeightM: nad wyspą teren, nad oceanem poziom morza (nie dno)', () => {
    expect(surfaceHeightM(terrain, 0, 0)).toBe(terrain.heightAt(0, 0));
    expect(terrain.heightAt(8000, 8000)).toBe(SEABED_M);
    expect(surfaceHeightM(terrain, 8000, 8000)).toBe(0);
  });

  it('lot nad terenem → none, stan bez zmian', () => {
    const state = createPlaneState();
    state.position.set(0, terrain.heightAt(0, 0) + 200, 0);
    expect(updateLifecycle(state, terrain, FIXED_DT_S)).toBe('none');
    expect(state.life).toBe('alive');
  });

  it('lot w wodę → crashed (ocean zabija na poziomie morza, nie na dnie)', () => {
    const state = createPlaneState();
    state.position.set(8000, CRASH_MARGIN_M - 0.5, 8000);
    expect(updateLifecycle(state, terrain, FIXED_DT_S)).toBe('crashed');
    expect(state.life).toBe('dead');
    expect(state.lifeTimerS).toBe(0);
  });

  it('lot w górę → crashed poniżej wysokości zbocza', () => {
    const state = createPlaneState();
    const slopeM = terrain.heightAt(500, 500);
    expect(slopeM).toBeGreaterThan(100); // to ma być zbocze góry, nie plaża
    state.position.set(500, slopeM - 10, 500);
    expect(updateLifecycle(state, terrain, FIXED_DT_S)).toBe('crashed');
    expect(state.life).toBe('dead');
  });

  it('po RESPAWN_DELAY_S w dead → respawnReady i czeka w respawning', () => {
    const state = createPlaneState();
    state.position.set(8000, 0, 8000);
    expect(updateLifecycle(state, terrain, FIXED_DT_S)).toBe('crashed');

    let respawnAtS: number | undefined;
    // 0.5 s zapasu na kumulację błędu FP w sumowaniu dt
    const maxTicks = Math.ceil((RESPAWN_DELAY_S + 0.5) / FIXED_DT_S);
    for (let i = 1; i <= maxTicks && respawnAtS === undefined; i++) {
      if (updateLifecycle(state, terrain, FIXED_DT_S) === 'respawnReady') {
        respawnAtS = i * FIXED_DT_S;
      }
    }
    expect(respawnAtS).toBeDefined();
    expect(respawnAtS).toBeGreaterThanOrEqual(RESPAWN_DELAY_S - FIXED_DT_S);
    expect(respawnAtS).toBeLessThanOrEqual(RESPAWN_DELAY_S + 2 * FIXED_DT_S);
    expect(state.life).toBe('respawning');

    // maszyna NIE respawnuje sama — to robi właściciel stanu (klient/serwer)
    expect(updateLifecycle(state, terrain, FIXED_DT_S)).toBe('none');
    expect(state.life).toBe('respawning');
  });

  it('respawn przez właściciela: life=alive wznawia detekcję kolizji', () => {
    const state = createPlaneState();
    state.position.set(8000, 0, 8000);
    updateLifecycle(state, terrain, FIXED_DT_S);
    state.life = 'alive';
    state.lifeTimerS = 0;
    state.position.set(0, 2000, -7000);
    expect(updateLifecycle(state, terrain, FIXED_DT_S)).toBe('none');
    expect(state.life).toBe('alive');
  });
});
