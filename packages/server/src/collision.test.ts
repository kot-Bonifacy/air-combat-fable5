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
    const am = eventMember();
    const a = add(room, am, 'A');
    const b = add(room, eventMember(), 'B');
    // bystanderzy daleko (osobne frakcje = osobne id): po zderzeniu A/B wciąż żyją ≥2 frakcje,
    // więc mecz NIE kończy się eliminacją (P1) i event KILL zdąży się rozesłać przed końcem
    const c = add(room, eventMember(), 'C');
    const d = add(room, eventMember(), 'D');
    room.start();
    const scratch = new Uint8Array(room.snapshotCapacityBytes);
    const parkBystanders = (): void => {
      repose(room, c, [9000, 5000, 0]);
      repose(room, d, [-9000, 5000, 0]);
    };

    // odczekaj ochronę respawnu (SPAWN_PROTECTION_S = 3 s), trzymając maszyny daleko od siebie
    for (let i = 0; i < 200; i++) {
      repose(room, a, [0, 5000, 0]);
      repose(room, b, [0, 5000, 300]);
      parkBystanders();
      room.step(FIXED_DT_S);
    }
    // zwarcie: oba w jednym punkcie (sfery kolizji 2×3 m = 6 m się przenikają → zderzenie)
    repose(room, a, [0, 5000, 0]);
    repose(room, b, [0, 5000, 2]);
    parkBystanders();
    room.step(FIXED_DT_S);
    room.sendSnapshots(scratch); // flush eventów do membera (mecz wciąż 'playing' — C,D żyją)

    expect(stateOf(room, a).life).toBe('dying');
    expect(stateOf(room, b).life).toBe('dying');
    expect(room.deathsOf(a)).toBe(1);
    expect(room.deathsOf(b)).toBe(1);
    expect(room.killsOf(a)).toBe(0); // kolizja nie daje zestrzelenia
    expect(room.killsOf(b)).toBe(0);
    expect(room.state).toBe('playing'); // C i D wciąż żyją → brak eliminacji

    const kills = killsIn(am.events);
    expect(kills.length).toBe(2);
    expect(kills.every((k) => k.cause === 'collision')).toBe(true);
  });

  it('maszyny daleko od siebie nie zderzają się (brak fałszywych kolizji)', () => {
    const room = new GameRoom('ABCD');
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

describe('serwer — rozrzut spawnów na starcie meczu (anty-zderzenie)', () => {
  // Sticky player.slot jest przydzielany jako nextSlot++ % SPAWN_RING_SLOTS, a nextSlot nigdy się
  // nie zeruje i churnuje przy przebudowie botów (zmiana ustawień w poczekalni: setBots kasuje i
  // tworzy boty od nowa). Po zawinięciu modulo dwie żywe encje dostawały TEN SAM slot → spawn w
  // identycznym punkcie → zderzenie tuż po wygaśnięciu ochrony. start() musi rozrzucić wszystkich
  // po RÓŻNYCH slotach.
  it('po przebudowie botów (churn slotów) wszyscy startują w różnych, oddzielonych punktach', () => {
    const room = new GameRoom('ABCD');
    add(room, eventMember(), 'host'); // slot 0
    room.applyRoomSettings({ bots: 5 }); // sloty 1..5, nextSlot → 6
    room.applyRoomSettings({ bots: 5, difficulty: 'trudny' }); // rebuild → churn (sloty 6,7,0,1,2)
    room.start();

    const positions = room.snapshotEntities().map((e) => e.state.position.clone());
    expect(positions.length).toBe(6); // host + 5 botów
    for (let i = 0; i < positions.length; i++) {
      for (let j = i + 1; j < positions.length; j++) {
        // sfery kolizji to kilka metrów; każda para musi być wyraźnie rozdzielona
        expect(positions[i]!.distanceTo(positions[j]!)).toBeGreaterThan(1000);
      }
    }
  });

  it('start nie powoduje zderzeń w pierwszych sekundach (FFA z botami po zmianie ustawień)', () => {
    const room = new GameRoom('ABCD');
    add(room, eventMember(), 'host');
    room.applyRoomSettings({ bots: 5 });
    room.applyRoomSettings({ bots: 5, difficulty: 'trudny' });
    room.start();
    // 5 s realnej symulacji (ochrona 3 s + 2 s lotu ku centrum) — nikt nie ginie w zderzeniu startowym
    for (let i = 0; i < Math.round(5 / FIXED_DT_S); i++) room.step(FIXED_DT_S);
    for (const e of room.snapshotEntities()) {
      expect(e.state.life).toBe('alive');
    }
  });
});

describe('serwer — model spadającego wraku (faza 15)', () => {
  it('zestrzelenie w powietrzu → ofiara to spadający wrak (dying), nie od razu martwa; event KILL cause air', () => {
    const room = new GameRoom('ABCD');
    const sm = eventMember();
    const shooter = add(room, sm, 'A');
    const target = add(room, eventMember(), 'B');
    // bystander daleko: po śmierci B wciąż żyją 2 frakcje (shooter + C) → mecz nie kończy się
    // eliminacją (P1) i event KILL 'air' zdąży się rozesłać
    const bystander = add(room, eventMember(), 'C');
    room.start();
    const scratch = new Uint8Array(room.snapshotCapacityBytes);
    const sPos: [number, number, number] = [0, 5000, 0];
    const tPos: [number, number, number] = [0, 5000, 200]; // dystans zbieżności luf
    const parkBystander = (): void => repose(room, bystander, [9000, 5000, 0]);

    room.applyInput(target, input({ fire: false }));
    // odczekaj ochronę respawnu (190 ticków), trzymając pozy
    for (let i = 0; i < 190; i++) {
      repose(room, shooter, sPos);
      repose(room, target, tPos);
      parkBystander();
      room.step(FIXED_DT_S);
    }
    // ostrzał aż cel padnie
    room.applyInput(shooter, input({ fire: true }));
    let ticks = 0;
    while (stateOf(room, target).life === 'alive' && ticks < 600) {
      repose(room, shooter, sPos);
      repose(room, target, tPos);
      parkBystander();
      room.step(FIXED_DT_S);
      ticks++;
    }
    room.sendSnapshots(scratch); // mecz wciąż 'playing' (C żyje) → event się rozsyła

    expect(stateOf(room, target).life).toBe('dying'); // spadający wrak, NIE 'dead'
    expect(room.deathsOf(target)).toBe(1);
    expect(room.killsOf(shooter)).toBe(1);
    expect(ticks).toBeLessThan(600);
    const kill = killsIn(sm.events).find((k) => k.victimId === target);
    expect(kill?.cause).toBe('air');
  });

  it('wrak spada, po uderzeniu w ziemię staje się martwy, a po RESPAWN_DELAY_S respawnuje', () => {
    const room = new GameRoom('ABCD');
    const id = add(room, eventMember(), 'A'); // solo: 1 frakcja → brak eliminacji (respawn z late-join/żyć)
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
