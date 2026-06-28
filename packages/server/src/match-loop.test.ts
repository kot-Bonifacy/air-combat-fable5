import { describe, expect, it } from 'vitest';
import {
  FIXED_DT_S,
  MIN_SPAWN_CLEARANCE_M,
  SPITFIRE_MK2,
  totalAmmo,
  type ControlMessage,
  type InputFrame,
} from '@air-combat/shared';
import { GameRoom } from './game-room';

// Pętla meczu (faza-13.md). P1 (2026-06-19): FFA jest ELIMINACYJNE jak SP — 1 życie/samolot,
// brak respawnu i brak limitu zestrzeleń/czasu; mecz kończy się, gdy zostaje 1 frakcja
// (last-man-standing) albo ktoś przejmie strefę. Testy puszczają realną pętlę room.step i
// sterują stanem encji bezpośrednio (referencje z snapshotEntities()), jak combat.test.

const TOTAL_AMMO = totalAmmo(SPITFIRE_MK2.armament);

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

function lifeOf(room: GameRoom, id: number): string | undefined {
  return room.snapshotEntities().find((e) => e.id === id)?.state.life;
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

describe('FFA — eliminacja (P1: last-man-standing jak SP)', () => {
  it('zlicza śmierć ofiary i zestrzelenie zabójcy; po wyeliminowaniu reszty kończy mecz', () => {
    const room = new GameRoom('ABCD');
    const aMember = recordingMember();
    const a = add(room, aMember, 'A');
    const b = add(room, recordingMember(), 'B');
    room.start();

    // czołówka 12 m: A dobija B; brak limitu zestrzeleń — koniec dopiero, gdy B zostaje wyeliminowany
    const aPos: [number, number, number] = [0, 5000, 0];
    const bPos: [number, number, number] = [0, 5000, 12];
    room.applyInput(a, input({ fire: true, aimZ: 1 }));
    room.applyInput(b, input({ fire: false }));

    let ticks = 0;
    while (room.state === 'playing' && ticks < 1000) {
      repose(room, a, aPos, false);
      repose(room, b, bPos, true);
      room.step(FIXED_DT_S);
      ticks++;
    }

    expect(room.killsOf(a)).toBe(1);
    expect(room.deathsOf(b)).toBe(1);
    expect(room.livesOf(b)).toBe(0); // FFA też zużywa życie (P1: eliminacja)
    expect(room.state).toBe('ended');
    expect(room.winnerId).toBe(a); // ostatni ocalały

    const ended = aMember.controls.find((m) => m.t === 'matchEnded');
    expect(ended).toBeDefined();
    if (ended && ended.t === 'matchEnded') {
      expect(ended.reason).toBe('score'); // eliminacja (klient rozróżnia po mode='ffa')
      expect(ended.mode).toBe('ffa');
      expect(ended.winningFaction).toBeNull(); // FFA — brak drużyn
      expect(ended.winnerId).toBe(a);
      expect(ended.rows[0]?.id).toBe(a); // lider pierwszy
    }
  });

  it('zestrzelony w FFA NIE respawnuje (1 życie jak SP), choć mecz trwa (≥2 frakcje żyją)', () => {
    const room = new GameRoom('ABCD');
    const a = add(room, recordingMember(), 'A');
    const victim = add(room, recordingMember(), 'V');
    const c = add(room, recordingMember(), 'C'); // 3. gracz daleko — mecz nie kończy się od razu
    room.start();

    // engagement z dala od strefy (x=6 km), C zaparkowany po drugiej stronie
    const aPos: [number, number, number] = [6000, 5000, 0];
    const vPos: [number, number, number] = [6000, 5000, 12];
    const cPos: [number, number, number] = [-9000, 5000, 0];
    room.applyInput(a, input({ fire: true, aimZ: 1 }));
    room.applyInput(victim, input({ fire: false }));

    let ticks = 0;
    while (room.deathsOf(victim) === 0 && ticks < 600) {
      repose(room, a, aPos, false);
      repose(room, victim, vPos, true);
      repose(room, c, cPos, false);
      room.step(FIXED_DT_S);
      ticks++;
    }
    expect(room.deathsOf(victim)).toBe(1);
    expect(room.livesOf(victim)).toBe(0);
    expect(room.state).toBe('playing'); // A i C wciąż żyją → eliminacja nie rozstrzyga

    // dobij wrak do ziemi i odczekaj PONAD próg respawnu — V nie wraca do gry (brak żyć)
    let respawned = false;
    for (let i = 0; i < 500; i++) {
      repose(room, a, aPos, false);
      repose(room, c, cPos, false);
      room.step(FIXED_DT_S);
      if (lifeOf(room, victim) === 'alive') respawned = true;
    }
    expect(respawned).toBe(false);
    expect(lifeOf(room, victim)).not.toBe('alive');
    expect(room.livesOf(victim)).toBe(0);
  });

  it('rewanż (start z ended) zeruje wynik i życia, wraca do gry', () => {
    const room = new GameRoom('ABCD');
    const a = add(room, recordingMember(), 'A');
    const b = add(room, recordingMember(), 'B');
    room.start();
    const aPos: [number, number, number] = [0, 5000, 0];
    const bPos: [number, number, number] = [0, 5000, 12];
    room.applyInput(a, input({ fire: true, aimZ: 1 }));
    let ticks = 0;
    while (room.state === 'playing' && ticks < 1000) {
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
    expect(room.livesOf(b)).toBe(1); // pełna pula żyć po rewanżu
    expect(room.winnerId).toBeNull();
  });

  // 2026-06-27: tabela wyników NIE znika sama — pokój NIE wraca do 'waiting' po czasie. Powrót robi
  // dopiero gracz (returnToWaiting), gdy zamknie tabelę. Każdy zamyka ją niezależnie.
  it('po końcu meczu pokój wisi w ended (brak auto-powrotu); returnToWaiting wraca do waiting', () => {
    const room = new GameRoom('ABCD');
    const aMember = recordingMember();
    const a = add(room, aMember, 'A');
    const b = add(room, recordingMember(), 'B');
    room.start();
    const aPos: [number, number, number] = [0, 5000, 0];
    const bPos: [number, number, number] = [0, 5000, 12];
    room.applyInput(a, input({ fire: true, aimZ: 1 }));
    let ticks = 0;
    while (room.state === 'playing' && ticks < 1000) {
      repose(room, a, aPos, false);
      repose(room, b, bPos, true);
      room.step(FIXED_DT_S);
      ticks++;
    }
    expect(room.state).toBe('ended');

    // odczekaj DUŻO ponad dawny próg 15 s (60 Hz × 30 s = 1800 ticków) — pokój NIE wraca sam
    for (let i = 0; i < 1800; i++) room.step(FIXED_DT_S);
    expect(room.state).toBe('ended');

    // gracz zamyka tabelę → powrót do poczekalni + broadcast roomUpdate('waiting')
    aMember.controls.length = 0;
    room.returnToWaiting();
    expect(room.state).toBe('waiting');
    const upd = aMember.controls.find((m) => m.t === 'roomUpdate');
    expect(upd).toBeDefined();
    if (upd && upd.t === 'roomUpdate') expect(upd.state).toBe('waiting');

    // idempotentne / bezpieczne poza 'ended' (np. w trakcie meczu) — no-op
    room.start();
    expect(room.state).toBe('playing');
    room.returnToWaiting();
    expect(room.state).toBe('playing');
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

    // po wygaśnięciu ochrony (łącznie > 3 s) cel zaczyna obrywać (i ostatecznie pada → koniec meczu)
    for (let i = 0; i < 180; i++) {
      repose(room, shooter, sPos, false);
      repose(room, target, tPos, true);
      room.step(FIXED_DT_S);
    }
    expect(room.healthOf(target)).toBeLessThan(SPITFIRE_MK2.hpPool);
    expect(TOTAL_AMMO).toBeGreaterThan(0); // amunicja istnieje (sanity)
  });

  it('respawn (lives>0: late-join / NaN-guard) wybiera miejsce z dala od żywego wroga', () => {
    const room = new GameRoom('ABCD');
    const enemy = add(room, recordingMember(), 'E');
    const victim = add(room, recordingMember(), 'V');
    room.start();

    // wróg zaklejony w rogu areny (blisko slotu #0); ofiara „martwa" z ZACHOWANYM życiem
    // (jak late-join: life='dead' bez zużycia życia) → canRespawn=true → respawnuje
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

describe('zakończenie misji (Esc) — abortMatch / withdrawToLobby (2026-06-23)', () => {
  it('abortMatch: playing → waiting BEZ ekranu wyników, rozsyła roomUpdate state=waiting', () => {
    const room = new GameRoom('ABCD');
    const member = recordingMember();
    add(room, member, 'A');
    add(room, recordingMember(), 'B');
    room.start();
    expect(room.state).toBe('playing');
    member.controls.length = 0;

    room.abortMatch();

    expect(room.state).toBe('waiting');
    expect(member.controls.some((m) => m.t === 'matchEnded')).toBe(false); // bez ekranu wyników
    expect(member.controls.some((m) => m.t === 'roomUpdate' && m.state === 'waiting')).toBe(true);
  });

  it('withdrawToLobby: samolot wypada z walki (martwy, 0 żyć, bez respawnu); start() przywraca', () => {
    const room = new GameRoom('ABCD');
    const a = add(room, recordingMember(), 'A');
    add(room, recordingMember(), 'B');
    add(room, recordingMember(), 'C'); // ≥2 frakcje wciąż grają po wycofaniu A → mecz trwa
    room.start();

    room.withdrawToLobby(a);
    expect(room.livesOf(a)).toBe(0);
    expect(lifeOf(room, a)).toBe('dead');

    // ponad próg respawnu — wycofany NIE wraca do gry, mecz wciąż trwa (B i C żyją)
    for (let i = 0; i < 300; i++) room.step(FIXED_DT_S);
    expect(lifeOf(room, a)).not.toBe('alive');
    expect(room.state).toBe('playing');

    // mecz kończy się (tu: przerwany) → poczekalnia → kolejny start zeruje wycofanie i życia → A znów lata
    room.abortMatch();
    room.start();
    expect(lifeOf(room, a)).toBe('alive');
    expect(room.livesOf(a)).toBe(1);
  });

  it('abortMatch i withdrawToLobby są no-op poza stanem playing (poczekalnia)', () => {
    const room = new GameRoom('ABCD');
    const a = add(room, recordingMember(), 'A');
    room.abortMatch();
    expect(room.state).toBe('waiting');
    room.withdrawToLobby(a); // poza meczem — nie zeruje życia
    expect(room.livesOf(a)).toBe(1);
  });
});

describe('FFA — tabela wyników (standings)', () => {
  it('broadcastStandings wysyła posortowaną tabelę i status strefy', () => {
    const room = new GameRoom('ABCD');
    const member = recordingMember();
    const a = add(room, member, 'A');
    add(room, recordingMember(), 'B');
    room.start();
    room.step(FIXED_DT_S);

    room.broadcastStandings();
    const msg = member.controls.find((m) => m.t === 'standings');
    expect(msg).toBeDefined();
    if (msg && msg.t === 'standings') {
      expect(msg.mode).toBe('ffa');
      expect(msg.rows).toHaveLength(2);
      expect(msg.rows.some((r) => r.id === a)).toBe(true);
      expect(msg.zone).toEqual({ controlling: null, occupied: false }); // start: strefa pusta
    }
  });
});
