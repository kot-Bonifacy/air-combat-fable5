import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { FIXED_DT_S, getForward, validatePlaneState, type InputFrame } from '@air-combat/shared';
import { GameRoom } from './game-room';

function input(over: Partial<InputFrame> = {}): InputFrame {
  return {
    sequence: 1,
    clientTimeMs: 0,
    throttle: 0.9,
    pitchUp: 0,
    rollRight: 0,
    yawRight: 0,
    fire: false,
    aimX: 0,
    aimY: 0,
    aimZ: 1,
    ...over,
  };
}

describe('GameRoom — autorytatywna symulacja', () => {
  it('przydziela kolejne id i osobne sloty startowe', () => {
    const room = new GameRoom();
    const a = room.addPlayer();
    const b = room.addPlayer();
    expect(a).toBe(0);
    expect(b).toBe(1);
    expect(room.playerCount).toBe(2);
    const entities = room.snapshotEntities();
    expect(entities).toHaveLength(2);
    // różne pozycje spawnu (różne sloty pierścienia)
    const pa = entities[0]?.state.position;
    const pb = entities[1]?.state.position;
    expect(pa && pb && pa.distanceTo(pb)).toBeGreaterThan(100);
  });

  it('samolot reaguje na input steru wysokości (nos w górę) i potwierdza sekwencję', () => {
    const room = new GameRoom();
    const id = room.addPlayer();
    room.applyInput(id, input({ sequence: 42, pitchUp: 1, throttle: 1 }));

    const noseBefore = new Vector3();
    getForward(room.snapshotEntities()[0]!.state.orientation, noseBefore);
    expect(noseBefore.y).toBeCloseTo(0, 2); // spawn: nos poziomo

    for (let i = 0; i < 48; i++) room.step(FIXED_DT_S);

    const state = room.snapshotEntities()[0]!.state;
    const noseAfter = new Vector3();
    getForward(state.orientation, noseAfter);
    expect(noseAfter.y).toBeGreaterThan(0.1); // pull-up zadarł nos
    expect(room.lastProcessedSeq(id)).toBe(42); // ack ostatniego inputu
    validatePlaneState(state, 'test');
  });

  it('lot bez inputu i z inputem nie produkuje NaN po długiej symulacji', () => {
    const room = new GameRoom();
    const id = room.addPlayer();
    for (let i = 0; i < 120; i++) room.step(FIXED_DT_S); // bez inputu
    room.applyInput(id, input({ pitchUp: 0.5, rollRight: 0.3 }));
    for (let i = 0; i < 600; i++) room.step(FIXED_DT_S); // 10 s z inputem
    validatePlaneState(room.snapshotEntities()[0]!.state, 'test długi');
  });

  it('usunięcie gracza znika ze snapshotu', () => {
    const room = new GameRoom();
    const id = room.addPlayer();
    room.addPlayer();
    room.removePlayer(id);
    expect(room.playerCount).toBe(1);
    expect(room.snapshotEntities()).toHaveLength(1);
  });
});
