import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { FIXED_DT_S, getForward, getUp, validatePlaneState, type InputFrame } from '@air-combat/shared';
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

describe('GameRoom — samolot bez pilota (okno reconnectu)', () => {
  it('rozłączony samolot auto-stabilizuje skrzydła i przeżywa 10 s bez pilota', () => {
    const room = new GameRoom('ABCD');
    const id = add(room);
    room.start();
    // wprowadź maszynę w przechył: trzymany input lotek (nextInput podtrzymuje ostatni input)
    room.applyInput(id, input({ rollRight: 1, throttle: 0.9 }));
    for (let i = 0; i < 60; i++) room.step(FIXED_DT_S); // ~1 s rolowania → wyraźny przechył
    const up = new Vector3();
    getUp(room.snapshotEntities()[0]!.state.orientation, up);
    expect(up.y).toBeLessThan(0.8); // faktycznie przechylony

    // utrata pilota: slot trzymany na reconnect, samolot leci dalej (auto-stabilizacja zamiast trzymania inputu)
    room.detachMember(id, Date.now());
    for (let i = 0; i < 600; i++) room.step(FIXED_DT_S); // 10 s bez pilota

    const state = room.snapshotEntities()[0]!.state;
    getUp(state.orientation, up);
    expect(up.y).toBeGreaterThan(0.9); // skrzydła wyrównane (mini-autopilot)
    expect(state.life).toBe('alive'); // nie rozbił się przed powrotem gracza
    validatePlaneState(state, 'autopilot');
  });

  it('rozłączony samolot nie strzela, nawet gdy spust był wciśnięty w chwili zerwania', () => {
    const room = new GameRoom('ABCD');
    const id = add(room);
    room.start();
    const ammoFull = room.ammoOf(id);
    room.applyInput(id, input({ fire: true, throttle: 0.9 }));
    for (let i = 0; i < 30; i++) room.step(FIXED_DT_S); // strzela podłączony (spust trzymany)
    const ammoConnected = room.ammoOf(id);
    expect(ammoConnected).toBeLessThan(ammoFull); // faktycznie oddał strzały

    room.detachMember(id, Date.now());
    for (let i = 0; i < 120; i++) room.step(FIXED_DT_S); // 2 s bez pilota
    expect(room.ammoOf(id)).toBe(ammoConnected); // zero dalszego ognia bez pilota
  });
});

describe('GameRoom — kolejka inputów (jeden input = jeden krok)', () => {
  it('konsumuje kolejne sekwencje po kolei: ack rośnie o 1 na tick (żaden input pominięty ani powtórzony)', () => {
    const room = new GameRoom('ABCD');
    const id = add(room);
    room.start();
    for (let seq = 1; seq <= 6; seq++) {
      room.applyInput(id, input({ sequence: seq }));
      room.step(FIXED_DT_S);
      expect(room.lastProcessedSeq(id)).toBe(seq);
    }
  });

  it('burst po przestoju klienta: kolejka drenuje do bufora docelowego (ogranicza opóźnienie, trzyma najświeższe)', () => {
    const room = new GameRoom('ABCD');
    const id = add(room);
    room.start();
    // 5 ramek naraz, bez stepów pomiędzy (klient nadrobił przestój). Bufor docelowy = 3.
    for (let seq = 1; seq <= 5; seq++) room.applyInput(id, input({ sequence: seq }));
    room.step(FIXED_DT_S);
    expect(room.lastProcessedSeq(id)).toBe(3); // najstarsze (1,2) odrzucone — opóźnienie inputu nie narasta
    room.step(FIXED_DT_S);
    room.step(FIXED_DT_S);
    expect(room.lastProcessedSeq(id)).toBe(5); // w kilka ticków dogoniliśmy najświeższy zamiar gracza
  });

  it('nierówne (jitterowe) dostarczanie inputów daje TEN SAM stan co 1 input/tick — koniec rozjazdu korekty', () => {
    // Sedno poprawki drżenia: stary model „latest wins" gubił input przy paczce 2 ramek na tick →
    // serwer rozjeżdżał się z predykcją klienta o ~1 tick co snapshot. Kolejka FIFO konsumuje KAŻDY
    // input dokładnie raz, w tej samej kolejności — więc jitterowe dostarczanie = idealny strumień.
    const steady = new GameRoom('ABCD');
    const jittery = new GameRoom('WXYZ');
    const a = add(steady);
    const b = add(jittery);
    steady.start();
    jittery.start();

    // input MYSZY (pitch/roll/yaw = 0 → instruktor aktywny), aim zmienny co tick → trajektoria zależna od kolejności
    const frame = (i: number): InputFrame =>
      input({
        sequence: i + 1,
        throttle: 1,
        aimX: 0.3 * Math.sin(i * 0.15),
        aimY: 0.2 * Math.cos(i * 0.1),
        aimZ: 1,
      });

    const N = 150;
    // steady: dokładnie 1 input na tick (idealnie zsynchronizowane zegary)
    for (let i = 0; i < N; i++) {
      steady.applyInput(a, frame(i));
      steady.step(FIXED_DT_S);
    }
    // jittery: te same ramki, ale po 2 co drugi tick i 0 w pozostałych (głębokość ≤ bufor docelowy)
    let next = 0;
    for (let tick = 0; tick < N; tick++) {
      if (tick % 2 === 0 && next < N) {
        jittery.applyInput(b, frame(next++));
        if (next < N) jittery.applyInput(b, frame(next++));
      }
      jittery.step(FIXED_DT_S);
    }

    const sa = steady.snapshotEntities()[0]!.state;
    const sb = jittery.snapshotEntities()[0]!.state;
    expect(sb.position.distanceTo(sa.position)).toBeLessThan(1e-6); // identyczny tor mimo jittera
    const fa = new Vector3();
    const fb = new Vector3();
    getForward(sa.orientation, fa);
    getForward(sb.orientation, fb);
    expect(fb.angleTo(fa)).toBeLessThan(1e-6);
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
