import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { FIXED_DT_S, getForward, validatePlaneState, type InputFrame } from '@air-combat/shared';
import { GameRoom } from './game-room';

function input(over: Partial<InputFrame> = {}): InputFrame {
  return {
    sequence: 1,
    ackServerTick: 0,
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

let tokenSeq = 0;
const dummyMember = { sendControl() {}, sendSnapshotBytes() {} };
function add(room: GameRoom, nick = 'pilot'): number {
  return room.addPlayer(nick, `tok-${String(tokenSeq++)}`, dummyMember);
}

describe('GameRoom — autorytatywna symulacja', () => {
  it('przydziela kolejne id i osobne sloty startowe', () => {
    const room = new GameRoom('ABCD');
    const a = add(room);
    const b = add(room);
    expect(a).toBe(0);
    expect(b).toBe(1);
    expect(room.playerCount).toBe(2);
    const entities = room.snapshotEntities();
    expect(entities).toHaveLength(2);
    const pa = entities[0]?.state.position;
    const pb = entities[1]?.state.position;
    expect(pa && pb && pa.distanceTo(pb)).toBeGreaterThan(100);
  });

  it('samolot reaguje na input steru wysokości (nos w górę) i potwierdza sekwencję', () => {
    const room = new GameRoom('ABCD');
    const id = add(room);
    room.start();
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

  it('w stanie waiting krok jest no-op (nikt nie lata przed startem)', () => {
    const room = new GameRoom('ABCD');
    const id = add(room);
    room.applyInput(id, input({ pitchUp: 1, throttle: 1 }));
    const before = room.snapshotEntities()[0]!.state.position.clone();
    for (let i = 0; i < 60; i++) room.step(FIXED_DT_S);
    const after = room.snapshotEntities()[0]!.state.position;
    expect(after.distanceTo(before)).toBe(0); // bez ruchu w poczekalni
    expect(room.tick).toBe(0);
  });

  it('lot bez inputu i z inputem nie produkuje NaN po długiej symulacji', () => {
    const room = new GameRoom('ABCD');
    const id = add(room);
    room.start();
    for (let i = 0; i < 120; i++) room.step(FIXED_DT_S); // bez inputu
    room.applyInput(id, input({ pitchUp: 0.5, rollRight: 0.3 }));
    for (let i = 0; i < 600; i++) room.step(FIXED_DT_S); // 10 s z inputem
    validatePlaneState(room.snapshotEntities()[0]!.state, 'test długi');
  });

  it('usunięcie gracza znika ze snapshotu', () => {
    const room = new GameRoom('ABCD');
    const id = add(room);
    add(room);
    room.removePlayer(id);
    expect(room.playerCount).toBe(1);
    expect(room.snapshotEntities()).toHaveLength(1);
  });
});

describe('GameRoom — maszyna stanów lobby', () => {
  it('pierwszy gracz zostaje hostem, kolejni nie', () => {
    const room = new GameRoom('ABCD');
    const a = add(room);
    const b = add(room);
    expect(room.hostId).toBe(a);
    expect(b).not.toBe(a);
  });

  it('host migruje po wyjściu hosta', () => {
    const room = new GameRoom('ABCD');
    const a = add(room);
    const b = add(room);
    room.removePlayer(a);
    expect(room.hostId).toBe(b);
  });

  it('start: waiting → playing i wszyscy są alive', () => {
    const room = new GameRoom('ABCD');
    add(room);
    expect(room.state).toBe('waiting');
    room.start();
    expect(room.state).toBe('playing');
    expect(room.snapshotEntities()[0]!.state.life).toBe('alive');
  });

  it('late join podczas playing: spawn po RESPAWN_DELAY_S (start jako dead)', () => {
    const room = new GameRoom('ABCD');
    add(room);
    room.start();
    const lateId = add(room);
    const late = room.snapshotEntities().find((e) => e.id === lateId)!;
    expect(late.state.life).toBe('dead'); // czeka na spawn
    for (let i = 0; i < 60 * 4; i++) room.step(FIXED_DT_S); // > 3 s
    expect(late.state.life).toBe('alive'); // wszedł do gry
  });

  it('reconnect po tokenie podpina to samo id, błędny token zwraca null', () => {
    const room = new GameRoom('ABCD');
    const id = room.addPlayer('as', 'tok-x', null);
    room.detachMember(id, 1000);
    const member = { sendControl() {}, sendSnapshotBytes() {} };
    expect(room.reconnectByToken('tok-x', member)?.id).toBe(id);
    expect(room.reconnectByToken('inny', member)).toBeNull();
  });

  it('pruneExpiredReconnects zwalnia slot po wygaśnięciu okna', () => {
    const room = new GameRoom('ABCD');
    const id = room.addPlayer('as', 'tok-x', null);
    room.detachMember(id, 1000);
    expect(room.pruneExpiredReconnects(1000 + 59_000, 60_000)).toBe(0); // jeszcze w oknie
    expect(room.playerCount).toBe(1);
    expect(room.pruneExpiredReconnects(1000 + 61_000, 60_000)).toBe(1); // okno minęło
    expect(room.playerCount).toBe(0);
  });
});
