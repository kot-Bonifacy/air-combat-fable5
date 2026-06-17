import { describe, expect, it } from 'vitest';
import {
  FIXED_DT_S,
  MATCH_DEFAULT_SCORE_LIMIT,
  MIN_SPAWN_CLEARANCE_M,
  SPITFIRE_MK2,
  type ControlMessage,
  type InputFrame,
} from '@air-combat/shared';
import { GameRoom } from './game-room';

// Pętla meczu FFA (faza-13.md): zegar + wynik + koniec meczu, respawn z ochroną i wyborem
// miejsca, tabela wyników (standings), rewanż. Testy puszczają realną pętlę room.step i
// sterują stanem encji bezpośrednio (referencje z snapshotEntities()), jak combat.test.

const arm = SPITFIRE_MK2.armament;
const TOTAL_AMMO = arm.ammoPerGun * arm.muzzles.length;

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

/** Połączenie-atrapa, które zapamiętuje wiadomości kontrolne (standings/matchEnded). */
function recordingMember(): { controls: ControlMessage[]; sendControl(m: ControlMessage): void; sendSnapshotBytes(): void } {
  const controls: ControlMessage[] = [];
  return {
    controls,
    sendControl(m: ControlMessage) {
      controls.push(m);
    },
    sendSnapshotBytes() {
      /* binarne pomijamy */
    },
  };
}

let tokenSeq = 0;
function add(room: GameRoom, member: ReturnType<typeof recordingMember>, nick = 'pilot'): number {
  return room.addPlayer(nick, `tok-${String(tokenSeq++)}`, member);
}

/** Przykleja żywą encję do stałej pozy (jak w combat.test) — deterministyczny ogień/trafienia. */
function repose(room: GameRoom, id: number, pos: [number, number, number], noseNegZ = false): void {
  const s = room.snapshotEntities().find((e) => e.id === id)?.state;
  if (!s || s.life !== 'alive') return;
  s.position.set(...pos);
  if (noseNegZ) s.orientation.set(0, 1, 0, 0);
  else s.orientation.identity();
  s.velocity.set(0, 0, 0);
  s.angularRates.pitch = 0;
  s.angularRates.roll = 0;
  s.angularRates.yaw = 0;
  s.iasMs = 0;
}

describe('FFA — śmierci i koniec meczu', () => {
  it('zlicza śmierć ofiary i zestrzelenie zabójcy; po limicie kończy mecz', () => {
    const room = new GameRoom('ABCD');
    room.scoreLimit = 1; // mecz do jednego zestrzelenia (szybki test końca)
    const aMember = recordingMember();
    const a = add(room, aMember, 'A');
    const b = add(room, recordingMember(), 'B');
    room.start();

    // odczekaj ochronę respawnu, trzymając pozy z bliska (czołówka 12 m)
    const aPos: [number, number, number] = [0, 5000, 0];
    const bPos: [number, number, number] = [0, 5000, 12];
    room.applyInput(a, input({ fire: true, aimZ: 1 }));
    room.applyInput(b, input({ fire: false }));

    let ticks = 0;
    while (room.state === 'playing' && ticks < 600) {
      repose(room, a, aPos, false);
      repose(room, b, bPos, true);
      room.step(FIXED_DT_S);
      ticks++;
    }

    expect(room.killsOf(a)).toBe(1);
    expect(room.deathsOf(b)).toBe(1);
    expect(room.state).toBe('ended');
    expect(room.winnerId).toBe(a);

    const ended = aMember.controls.find((m) => m.t === 'matchEnded');
    expect(ended).toBeDefined();
    if (ended && ended.t === 'matchEnded') {
      expect(ended.reason).toBe('score');
      expect(ended.winnerId).toBe(a);
      expect(ended.rows[0]?.id).toBe(a); // lider pierwszy
    }
  });

  it('zegar meczu maleje i jest autorytetem serwera (timeLeftS)', () => {
    const room = new GameRoom('ABCD');
    add(room, recordingMember(), 'A');
    room.start();
    const before = room.timeLeftS;
    for (let i = 0; i < 120; i++) room.step(FIXED_DT_S); // 2 s
    const after = room.timeLeftS;
    expect(after).toBeLessThan(before);
    expect(before - after).toBeCloseTo(2, 0);
  });

  it('rewanż (start z ended) zeruje wynik i wraca do gry', () => {
    const room = new GameRoom('ABCD');
    room.scoreLimit = 1;
    const a = add(room, recordingMember(), 'A');
    const b = add(room, recordingMember(), 'B');
    room.start();
    // szybki koniec: ustaw kill ręcznie przez bezpośrednie zestrzelenie (czołówka)
    const aPos: [number, number, number] = [0, 5000, 0];
    const bPos: [number, number, number] = [0, 5000, 12];
    room.applyInput(a, input({ fire: true, aimZ: 1 }));
    let ticks = 0;
    while (room.state === 'playing' && ticks < 600) {
      repose(room, a, aPos, false);
      repose(room, b, bPos, true);
      room.step(FIXED_DT_S);
      ticks++;
    }
    expect(room.state).toBe('ended');
    expect(room.killsOf(a)).toBe(1);

    room.start(); // rewanż
    expect(room.state).toBe('playing');
    expect(room.killsOf(a)).toBe(0);
    expect(room.deathsOf(b)).toBe(0);
    expect(room.winnerId).toBeNull();
  });
});

describe('FFA — respawn z ochroną i wyborem miejsca', () => {
  it('cel pod ochroną respawnu jest nietykalny (anty-spawn-kill)', () => {
    const room = new GameRoom('ABCD');
    const shooter = add(room, recordingMember(), 'A');
    const target = add(room, recordingMember(), 'B');
    room.start(); // świeży spawn → ochrona SPAWN_PROTECTION_S = 3 s

    const sPos: [number, number, number] = [0, 5000, 0];
    const tPos: [number, number, number] = [0, 5000, 12];
    room.applyInput(target, input({ fire: false }));
    // strzelec wali z bliska przez 1 s (60 ticków) — wciąż w oknie ochrony celu
    room.applyInput(shooter, input({ fire: true, aimZ: 1 }));
    for (let i = 0; i < 60; i++) {
      repose(room, shooter, sPos, false);
      repose(room, target, tPos, true);
      room.step(FIXED_DT_S);
    }
    expect(room.healthOf(target)).toBe(SPITFIRE_MK2.hpPool); // ochrona = brak obrażeń

    // po wygaśnięciu ochrony (łącznie > 3 s) cel zaczyna obrywać
    for (let i = 0; i < 180; i++) {
      repose(room, shooter, sPos, false);
      repose(room, target, tPos, true);
      room.step(FIXED_DT_S);
    }
    expect(room.healthOf(target)).toBeLessThan(SPITFIRE_MK2.hpPool);
    expect(TOTAL_AMMO).toBeGreaterThan(0); // amunicja istnieje (sanity)
  });

  it('respawn po śmierci wybiera miejsce z dala od żywego wroga', () => {
    const room = new GameRoom('ABCD');
    const enemy = add(room, recordingMember(), 'E');
    const victim = add(room, recordingMember(), 'V');
    room.scoreLimit = 99; // nie kończ meczu w trakcie testu
    room.start();

    // wróg zaklejony w rogu areny (blisko slotu #0); ofiara ginie i respawnuje
    const enemyPos: [number, number, number] = [8000, 800, 0];
    const vState = room.snapshotEntities().find((e) => e.id === victim)?.state;
    if (!vState) throw new Error('brak ofiary');
    vState.life = 'dead';
    vState.lifeTimerS = 0;

    // step przez okno respawnu (RESPAWN_DELAY_S = 3 s) + zapas, trzymając wroga w rogu
    for (let i = 0; i < 260; i++) {
      repose(room, enemy, enemyPos, false);
      room.step(FIXED_DT_S);
      if (room.snapshotEntities().find((e) => e.id === victim)?.state.life === 'alive') break;
    }
    const respawned = room.snapshotEntities().find((e) => e.id === victim)?.state;
    expect(respawned?.life).toBe('alive');
    const dist = respawned!.position.distanceTo(
      room.snapshotEntities().find((e) => e.id === enemy)!.state.position,
    );
    expect(dist).toBeGreaterThanOrEqual(MIN_SPAWN_CLEARANCE_M);
  });
});

describe('FFA — tabela wyników (standings)', () => {
  it('broadcastStandings wysyła posortowaną tabelę z wynikiem i limitem', () => {
    const room = new GameRoom('ABCD');
    room.scoreLimit = MATCH_DEFAULT_SCORE_LIMIT;
    const member = recordingMember();
    const a = add(room, member, 'A');
    add(room, recordingMember(), 'B');
    room.start();
    room.step(FIXED_DT_S);

    room.broadcastStandings();
    const msg = member.controls.find((m) => m.t === 'standings');
    expect(msg).toBeDefined();
    if (msg && msg.t === 'standings') {
      expect(msg.scoreLimit).toBe(MATCH_DEFAULT_SCORE_LIMIT);
      expect(msg.rows).toHaveLength(2);
      expect(msg.rows.some((r) => r.id === a)).toBe(true);
      expect(msg.timeLeftS).toBeGreaterThan(0);
    }
  });
});
