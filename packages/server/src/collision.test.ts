import { describe, expect, it } from 'vitest';
import {
  FIXED_DT_S,
  MSG_EVENT,
  decodeEvents,
  type GameEvent,
  type InputFrame,
  type KillEvent,
  type PlaneState,
} from '@air-combat/shared';
import { GameRoom } from './game-room';

// Model śmierci na serwerze (faza-15.md): kolizje samolot↔samolot (test zamiatany prevPos→pozycja)
// oraz spadający wrak ('dying' → stepWreck → wreckImpact → 'dead'). Testy sterują stanem encji
// bezpośrednio (referencje ze snapshotEntities) i puszczają realną pętlę room.step, jak combat.test.

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

/** Member dekodujący binarne ramki EVENT (KILL/HIT/MUZZLE) z hot pathu — reszta pomijana. */
function eventMember(): {
  events: GameEvent[];
  sendControl(): void;
  sendSnapshotBytes(bytes: Uint8Array): void;
} {
  const events: GameEvent[] = [];
  return {
    events,
    sendControl() {
      /* lobby JSON nieistotny dla tych testów */
    },
    sendSnapshotBytes(bytes: Uint8Array) {
      if (bytes[0] !== MSG_EVENT) return; // snapshoty (MSG_SNAPSHOT) pomijamy
      for (const ev of decodeEvents(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength))) {
        events.push(ev);
      }
    },
  };
}

let tokenSeq = 0;
function add(room: GameRoom, member: ReturnType<typeof eventMember>, nick = 'pilot'): number {
  return room.addPlayer(nick, `tok-${String(tokenSeq++)}`, member);
}

function stateOf(room: GameRoom, id: number): PlaneState {
  const s = room.snapshotEntities().find((e) => e.id === id)?.state;
  if (!s) throw new Error(`brak encji ${String(id)}`);
  return s;
}

/** Ustawia ŻYWĄ encję w stałej pozie (nos +Z, prędkość 0) — deterministyczna geometria co tick. */
function repose(room: GameRoom, id: number, pos: [number, number, number]): void {
  const s = room.snapshotEntities().find((e) => e.id === id)?.state;
  if (!s || s.life !== 'alive') return;
  s.position.set(...pos);
  s.orientation.identity();
  s.velocity.set(0, 0, 0);
  s.angularRates.pitch = 0;
  s.angularRates.roll = 0;
  s.angularRates.yaw = 0;
  s.iasMs = 0;
}

const killsIn = (events: GameEvent[]): KillEvent[] =>
  events.filter((e): e is KillEvent => e.kind === 'kill');

describe('serwer — kolizje samolot↔samolot (faza 15)', () => {
  it('zwarcie dwóch płatowców: oba stają się spadającymi wrakami (cause collision, bez kredytu)', () => {
    const room = new GameRoom('ABCD');
    room.scoreLimit = 99; // nie kończ meczu w trakcie testu
    const am = eventMember();
    const a = add(room, am, 'A');
    const b = add(room, eventMember(), 'B');
    room.start();
    const scratch = new Uint8Array(room.snapshotCapacityBytes);

    // odczekaj ochronę respawnu (SPAWN_PROTECTION_S = 3 s), trzymając maszyny daleko od siebie
    for (let i = 0; i < 200; i++) {
      repose(room, a, [0, 5000, 0]);
      repose(room, b, [0, 5000, 300]);
      room.step(FIXED_DT_S);
    }
    // zwarcie: oba w jednym punkcie (sfery kolizji 2×3 m = 6 m się przenikają → zderzenie)
    repose(room, a, [0, 5000, 0]);
    repose(room, b, [0, 5000, 2]);
    room.step(FIXED_DT_S);
    room.sendSnapshots(scratch); // flush eventów do membera

    expect(stateOf(room, a).life).toBe('dying');
    expect(stateOf(room, b).life).toBe('dying');
    expect(room.deathsOf(a)).toBe(1);
    expect(room.deathsOf(b)).toBe(1);
    expect(room.killsOf(a)).toBe(0); // kolizja nie daje zestrzelenia
    expect(room.killsOf(b)).toBe(0);

    const kills = killsIn(am.events);
    expect(kills.length).toBe(2);
    expect(kills.every((k) => k.cause === 'collision')).toBe(true);
  });

  it('maszyny daleko od siebie nie zderzają się (brak fałszywych kolizji)', () => {
    const room = new GameRoom('ABCD');
    room.scoreLimit = 99;
    const a = add(room, eventMember(), 'A');
    const b = add(room, eventMember(), 'B');
    room.start();
    for (let i = 0; i < 200; i++) {
      repose(room, a, [0, 5000, 0]);
      repose(room, b, [0, 5000, 600]);
      room.step(FIXED_DT_S);
    }
    expect(stateOf(room, a).life).toBe('alive');
    expect(stateOf(room, b).life).toBe('alive');
    expect(room.deathsOf(a)).toBe(0);
    expect(room.deathsOf(b)).toBe(0);
  });

  it('nietykalni po respawnie nie zderzają się (ochrona obejmuje też kolizje, anty-spawn-kill)', () => {
    const room = new GameRoom('ABCD');
    const a = add(room, eventMember(), 'A');
    const b = add(room, eventMember(), 'B');
    room.start(); // świeży spawn → ochrona 3 s
    // nakładamy maszyny na siebie OD RAZU, w oknie ochrony (pierwsze ~180 ticków)
    for (let i = 0; i < 120; i++) {
      repose(room, a, [0, 5000, 0]);
      repose(room, b, [0, 5000, 2]);
      room.step(FIXED_DT_S);
    }
    expect(stateOf(room, a).life).toBe('alive');
    expect(stateOf(room, b).life).toBe('alive');
    expect(room.deathsOf(a)).toBe(0);
    expect(room.deathsOf(b)).toBe(0);
  });
});

describe('serwer — model spadającego wraku (faza 15)', () => {
  it('zestrzelenie w powietrzu → ofiara to spadający wrak (dying), nie od razu martwa; event KILL cause air', () => {
    const room = new GameRoom('ABCD');
    room.scoreLimit = 99;
    const sm = eventMember();
    const shooter = add(room, sm, 'A');
    const target = add(room, eventMember(), 'B');
    room.start();
    const scratch = new Uint8Array(room.snapshotCapacityBytes);
    const sPos: [number, number, number] = [0, 5000, 0];
    const tPos: [number, number, number] = [0, 5000, 200]; // dystans zbieżności luf

    room.applyInput(target, input({ fire: false }));
    // odczekaj ochronę respawnu (190 ticków), trzymając pozy
    for (let i = 0; i < 190; i++) {
      repose(room, shooter, sPos);
      repose(room, target, tPos);
      room.step(FIXED_DT_S);
    }
    // ostrzał aż cel padnie
    room.applyInput(shooter, input({ fire: true }));
    let ticks = 0;
    while (stateOf(room, target).life === 'alive' && ticks < 600) {
      repose(room, shooter, sPos);
      repose(room, target, tPos);
      room.step(FIXED_DT_S);
      ticks++;
    }
    room.sendSnapshots(scratch);

    expect(stateOf(room, target).life).toBe('dying'); // spadający wrak, NIE 'dead'
    expect(room.deathsOf(target)).toBe(1);
    expect(room.killsOf(shooter)).toBe(1);
    expect(ticks).toBeLessThan(600);
    const kill = killsIn(sm.events).find((k) => k.victimId === target);
    expect(kill?.cause).toBe('air');
  });

  it('wrak spada, po uderzeniu w ziemię staje się martwy, a po RESPAWN_DELAY_S respawnuje', () => {
    const room = new GameRoom('ABCD');
    room.scoreLimit = 99;
    const id = add(room, eventMember(), 'A');
    room.start();
    // ręcznie: nisko nad ziemią, lecący w dół → szybkie uderzenie
    const s = stateOf(room, id);
    s.life = 'dying';
    s.lifeTimerS = 0;
    s.position.set(0, 60, 0);
    s.velocity.set(0, -25, 0);
    s.iasMs = 25;
    s.orientation.identity();

    let ticks = 0;
    while (stateOf(room, id).life === 'dying' && ticks < 600) {
      room.step(FIXED_DT_S);
      ticks++;
    }
    expect(stateOf(room, id).life).toBe('dead'); // wrak uderzył w ziemię
    expect(ticks).toBeLessThan(600);

    // po uderzeniu rusza odliczanie respawnu (buchalteria była już przy zestrzeleniu)
    let more = 0;
    while (stateOf(room, id).life !== 'alive' && more < 400) {
      room.step(FIXED_DT_S);
      more++;
    }
    expect(stateOf(room, id).life).toBe('alive');
  });

  it('wrak GRACZA może strzelać (parytet z SP): amunicja maleje i leci event MUZZLE', () => {
    const room = new GameRoom('ABCD');
    room.scoreLimit = 99;
    const m = eventMember();
    const id = add(room, m, 'A');
    room.start();
    const scratch = new Uint8Array(room.snapshotCapacityBytes);
    const s = stateOf(room, id);
    s.life = 'dying';
    s.lifeTimerS = 0;
    s.position.set(0, 5000, 0); // wysoko — nie zdąży uderzyć w ziemię w 0,5 s testu
    s.velocity.set(0, 0, 120);
    s.iasMs = 120;
    s.orientation.identity();

    const ammoBefore = room.ammoOf(id);
    room.applyInput(id, input({ fire: true }));
    for (let i = 0; i < 30; i++) {
      room.step(FIXED_DT_S);
      room.sendSnapshots(scratch);
    }
    expect(room.ammoOf(id)).toBeLessThan(ammoBefore); // wrak wystrzelał część amunicji
    expect(m.events.some((e) => e.kind === 'muzzle')).toBe(true);
    expect(stateOf(room, id).life).toBe('dying'); // wciąż spada (na 5000 m nie zdążył uderzyć)
  });

  it('wrak BOTA nie strzela (jak w SP — tylko gracz pruje z wraku)', () => {
    const room = new GameRoom('ABCD');
    room.scoreLimit = 99;
    const botId = room.addBot('normalny');
    room.start();
    const s = stateOf(room, botId);
    s.life = 'dying';
    s.lifeTimerS = 0;
    s.position.set(0, 5000, 0);
    s.velocity.set(0, 0, 120);
    s.iasMs = 120;
    s.orientation.identity();

    const ammoBefore = room.ammoOf(botId);
    for (let i = 0; i < 30; i++) room.step(FIXED_DT_S);
    expect(room.ammoOf(botId)).toBe(ammoBefore); // bot-wrak nie wystrzelił ani jednego pocisku
  });
});
