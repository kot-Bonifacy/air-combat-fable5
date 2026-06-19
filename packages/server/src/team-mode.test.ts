import { describe, expect, it } from 'vitest';
import { FIXED_DT_S, MATCH_LIVES, type InputFrame, type PlaneState } from '@air-combat/shared';
import { GameRoom } from './game-room';

// Tryb drużynowy na serwerze (faza-18.md): auto-balans frakcji, friendly fire bez kredytu,
// eliminacja jak SP (MATCH_LIVES żyć/samolot, brak respawnu, ostatnia drużyna wygrywa), bez
// limitu czasu. Testy puszczają realną pętlę room.step (jak collision.test): pozy trzymane
// repose() co tick, śmierć przez prawdziwy ostrzał (updateFire + resolveHits autorytatywnie).

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

function silentMember(): { sendControl(): void; sendSnapshotBytes(): void } {
  return { sendControl() {}, sendSnapshotBytes() {} };
}

let tokenSeq = 0;
function add(room: GameRoom, nick: string): number {
  return room.addPlayer(nick, `tok-${String(tokenSeq++)}`, silentMember());
}

function stateOf(room: GameRoom, id: number): PlaneState {
  const s = room.snapshotEntities().find((e) => e.id === id)?.state;
  if (!s) throw new Error(`brak encji ${String(id)}`);
  return s;
}

/** Ustawia ŻYWĄ encję w stałej pozie (nos +Z) — deterministyczna geometria co tick. */
function repose(room: GameRoom, id: number, pos: readonly [number, number, number]): void {
  const s = room.snapshotEntities().find((e) => e.id === id)?.state;
  if (!s || s.life !== 'alive') return;
  s.position.set(pos[0], pos[1], pos[2]);
  s.orientation.identity();
  s.velocity.set(0, 0, 0);
  s.angularRates.pitch = 0;
  s.angularRates.roll = 0;
  s.angularRates.yaw = 0;
  s.iasMs = 0;
}

type Pose = readonly [number, number, number];

/** Tworzy drużynowy pokój z N graczami i startuje mecz; zwraca ich id (0..N−1). */
function teamRoom(n: number): { room: GameRoom; ids: number[] } {
  const room = new GameRoom('ABCD');
  room.mode = 'team'; // PRZED addPlayer — enterWorld przydziela frakcję wg trybu (auto-balans)
  const ids: number[] = [];
  for (let i = 0; i < n; i++) ids.push(add(room, `P${String(i)}`));
  room.start();
  return { room, ids };
}

/** Trzyma pozy przez `ticks` ticków (np. odczekanie ochrony respawnu SPAWN_PROTECTION_S). */
function hold(room: GameRoom, poses: ReadonlyMap<number, Pose>, ticks: number): void {
  for (let i = 0; i < ticks; i++) {
    for (const [id, pos] of poses) repose(room, id, pos);
    room.step(FIXED_DT_S);
  }
}

/** Strzela `shooterId` w `targetId`, trzymając pozy, aż cel przestanie być 'alive'. Zwraca liczbę ticków. */
function fireUntilDown(room: GameRoom, shooterId: number, targetId: number, poses: ReadonlyMap<number, Pose>): number {
  room.applyInput(shooterId, input({ fire: true }));
  let ticks = 0;
  while (stateOf(room, targetId).life === 'alive' && room.state === 'playing' && ticks < 900) {
    for (const [id, pos] of poses) repose(room, id, pos);
    room.step(FIXED_DT_S);
    ticks++;
  }
  return ticks;
}

describe('serwer — tryb drużynowy: auto-balans frakcji (faza 18)', () => {
  it('drużynowy: 4 uczestników → zbalansowane drużyny 0/1 na zmianę (2v2)', () => {
    const { room, ids } = teamRoom(4);
    const [a, b, c, d] = ids as [number, number, number, number];
    expect(room.factionOf(a)).toBe(0);
    expect(room.factionOf(b)).toBe(1);
    expect(room.factionOf(c)).toBe(0);
    expect(room.factionOf(d)).toBe(1);
    // każdy zaczyna z pełną pulą żyć (eliminacja jak SP)
    for (const id of ids) expect(room.livesOf(id)).toBe(MATCH_LIVES);
  });

  it('drużynowy: boty też wchodzą do balansu (1 gracz + 3 boty → 2v2)', () => {
    const room = new GameRoom('ABCD');
    room.mode = 'team';
    const human = add(room, 'human');
    const bots = [room.addBot('normalny'), room.addBot('normalny'), room.addBot('normalny')];
    room.start();
    const factions = [human, ...bots].map((id) => room.factionOf(id));
    const team0 = factions.filter((f) => f === 0).length;
    const team1 = factions.filter((f) => f === 1).length;
    expect(team0).toBe(2);
    expect(team1).toBe(2);
  });

  it('FFA (domyślnie): frakcja = id (każdy osobno)', () => {
    const room = new GameRoom('ABCD');
    const a = add(room, 'A');
    const b = add(room, 'B');
    room.start();
    expect(room.factionOf(a)).toBe(a);
    expect(room.factionOf(b)).toBe(b);
  });
});

describe('serwer — tryb drużynowy: friendly fire bez kredytu (faza 18)', () => {
  // 2v2: A,C = drużyna 0; B,D = drużyna 1. Parkujemy nieuczestniczących daleko od toru pocisków.
  const park: ReadonlyMap<number, Pose> = new Map([
    [1, [9000, 5000, 0]],
    [3, [-9000, 5000, 0]],
  ]);

  it('trafienie SOJUSZNIKA: cel ginie (friendly fire ON), ale strzelec NIE dostaje zestrzelenia', () => {
    const { room, ids } = teamRoom(4);
    const [a, , c] = ids as [number, number, number, number]; // a, c = drużyna 0
    const poses = new Map<number, Pose>([
      [a, [0, 5000, 0]],
      [c, [0, 5000, 200]],
      ...park,
    ]);
    hold(room, poses, 200); // odczekaj ochronę respawnu
    const ticks = fireUntilDown(room, a, c, poses);
    expect(ticks).toBeLessThan(900);
    expect(stateOf(room, c).life).toBe('dying'); // friendly fire zadziałał (cel padł)
    expect(room.deathsOf(c)).toBe(1);
    expect(room.livesOf(c)).toBe(0); // sojusznik stracił życie
    expect(room.killsOf(a)).toBe(0); // teamkill bez punktu (parytet z SP)
    expect(room.state).toBe('playing'); // drużyna 0 wciąż ma A, drużyna 1 żyje → mecz trwa
  });

  it('trafienie WROGA: strzelec dostaje zestrzelenie', () => {
    const { room, ids } = teamRoom(4);
    const [a, b] = ids as [number, number, number, number]; // a=druż.0, b=druż.1
    const poses = new Map<number, Pose>([
      [a, [0, 5000, 0]],
      [b, [0, 5000, 200]],
      [2, [9000, 5000, 0]],
      [3, [-9000, 5000, 0]],
    ]);
    hold(room, poses, 200);
    const ticks = fireUntilDown(room, a, b, poses);
    expect(ticks).toBeLessThan(900);
    expect(room.killsOf(a)).toBe(1); // zestrzelenie wroga liczy się
    expect(room.deathsOf(b)).toBe(1);
  });
});

describe('serwer — tryb drużynowy: eliminacja kończy mecz (faza 18)', () => {
  it('1v1: zestrzelenie ostatniego wroga → koniec meczu, zwycięska drużyna = drużyna 0', () => {
    const { room, ids } = teamRoom(2);
    const [a, b] = ids as [number, number]; // a=druż.0, b=druż.1
    const poses = new Map<number, Pose>([
      [a, [0, 5000, 0]],
      [b, [0, 5000, 200]],
    ]);
    hold(room, poses, 200);
    fireUntilDown(room, a, b, poses);
    expect(room.state).toBe('ended');
    expect(room.winningFaction).toBe(0); // ostatnia drużyna z samolotami
    expect(room.winnerId).toBe(a); // najlepszy gracz zwycięskiej drużyny
    expect(room.lastEndReason).toBe('score');
  });

  it('zestrzelony w drużynowym NIE respawnuje (1 życie jak SP), choć mecz trwa', () => {
    const { room, ids } = teamRoom(4);
    const [a, , , d] = ids as [number, number, number, number]; // a=druż.0, d=druż.1
    const poses = new Map<number, Pose>([
      [a, [0, 5000, 0]],
      [d, [0, 5000, 200]],
      [1, [9000, 5000, 0]], // B (druż.1) żyje → mecz nie kończy się po śmierci D
      [2, [-9000, 5000, 0]], // C (druż.0)
    ]);
    hold(room, poses, 200);
    fireUntilDown(room, a, d, poses);
    expect(room.state).toBe('playing'); // drużyna 1 wciąż ma B
    expect(room.livesOf(d)).toBe(0);

    // dobij wrak D do ziemi (przyspiesz opad), trzymając resztę żywą
    const ds = stateOf(room, d);
    ds.position.set(0, 40, 0);
    ds.velocity.set(0, -30, 0);
    ds.iasMs = 30;
    const alive = new Map<number, Pose>([
      [a, [0, 5000, 0]],
      [1, [9000, 5000, 0]],
      [2, [-9000, 5000, 0]],
    ]);
    // odczekaj długo PONAD próg respawnu FFA — w drużynowym D nie wróci do gry
    let respawned = false;
    for (let i = 0; i < 500; i++) {
      for (const [id, pos] of alive) repose(room, id, pos);
      room.step(FIXED_DT_S);
      if (stateOf(room, d).life === 'alive') respawned = true;
    }
    expect(respawned).toBe(false);
    expect(stateOf(room, d).life).not.toBe('alive');
    expect(room.livesOf(d)).toBe(0);
  });
});

describe('serwer — tryb drużynowy: brak limitu czasu (faza 18)', () => {
  it('mecz drużynowy trwa mimo upływu czasu (parytet z SP — kończy eliminacja/strefa, nie zegar)', () => {
    const { room, ids } = teamRoom(2);
    const [a, b] = ids as [number, number];
    // oba >3 km od środka (strefa pusta → brak przejęcia) i 16 km od siebie (brak ognia/kolizji)
    const poses = new Map<number, Pose>([
      [a, [8000, 5000, 0]],
      [b, [-8000, 5000, 0]],
    ]);
    // > MATCH_TIME_LIMIT_S (15 min = 54000 ticków). Krok bez ognia, obaj żywi.
    hold(room, poses, 54_100);
    expect(room.state).toBe('playing'); // brak limitu czasu w drużynowym
    expect(stateOf(room, a).life).toBe('alive');
    expect(stateOf(room, b).life).toBe('alive');
  });
});
