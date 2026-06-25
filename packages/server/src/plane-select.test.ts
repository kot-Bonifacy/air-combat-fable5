import { describe, expect, it } from 'vitest';
import { BF109_E, SPITFIRE_MK2, totalAmmo, type ControlMessage } from '@air-combat/shared';
import { GameRoom } from './game-room';

// Per-player plane (faza 19b): serwer trzyma konfigurację samolotu NA GRACZA (nie na pokój).
// W OBU trybach gracz wybiera typ płatowca (selectPlane). Od 2026-06-25 DRUŻYNA i SAMOLOT są
// ROZDZIELONE: w trybie drużynowym gracz wybiera drużynę osobno (selectTeam), niezależnie od
// samolotu (dowolny samolot w dowolnej drużynie). HP/amunicja/typ w snapshocie idą za samolotem encji.

const SPIT_AMMO = totalAmmo(SPITFIRE_MK2.armament);
const BF109_AMMO = totalAmmo(BF109_E.armament);

function member(): { sendControl(m: ControlMessage): void; sendSnapshotBytes(): void } {
  return { sendControl() {}, sendSnapshotBytes() {} };
}

let tokenSeq = 0;
function add(room: GameRoom, nick = 'pilot'): number {
  return room.addPlayer(nick, `tok-${String(tokenSeq++)}`, member());
}

function planeTypeInSnapshot(room: GameRoom, id: number): string | undefined {
  return room.snapshotEntities().find((e) => e.id === id)?.planeType;
}
function ammoMaxInSnapshot(room: GameRoom, id: number): number | undefined {
  return room.snapshotEntities().find((e) => e.id === id)?.ammoMax;
}

describe('FFA — wybór samolotu per gracz', () => {
  it('domyślnie Spitfire; HP/amunicja/typ snapshotu za Spitfire', () => {
    const room = new GameRoom('FFA1');
    const id = add(room);
    room.start();
    expect(room.healthOf(id)).toBe(SPITFIRE_MK2.hpPool);
    expect(room.ammoOf(id)).toBe(SPIT_AMMO);
    expect(planeTypeInSnapshot(room, id)).toBe('spitfire');
    expect(ammoMaxInSnapshot(room, id)).toBe(SPIT_AMMO);
  });

  it('po selectPlane(bf109) gracz lata Bf 109 — HP/amunicja/typ za Bf 109', () => {
    const room = new GameRoom('FFA2');
    const id = add(room);
    room.selectPlane(id, 'bf109');
    // poczekalnia: roster pokazuje już efektywny typ
    expect(room.roomPlayers().find((p) => p.id === id)?.planeType).toBe('bf109');
    room.start();
    expect(room.healthOf(id)).toBe(BF109_E.hpPool);
    expect(room.ammoOf(id)).toBe(BF109_AMMO);
    expect(planeTypeInSnapshot(room, id)).toBe('bf109');
    expect(ammoMaxInSnapshot(room, id)).toBe(BF109_AMMO);
    // amunicja różni się między typami (sanity, że to nie ten sam płatowiec)
    expect(BF109_AMMO).not.toBe(SPIT_AMMO);
  });

  it('mieszany pokój: jeden Spitfire, jeden Bf 109 — każdy ze swoim HP', () => {
    const room = new GameRoom('FFA3');
    const a = add(room, 'spit');
    const b = add(room, 'kurt');
    room.selectPlane(b, 'bf109');
    room.start();
    expect(room.healthOf(a)).toBe(SPITFIRE_MK2.hpPool);
    expect(room.healthOf(b)).toBe(BF109_E.hpPool);
    expect(planeTypeInSnapshot(room, a)).toBe('spitfire');
    expect(planeTypeInSnapshot(room, b)).toBe('bf109');
  });
});

describe('drużynowy — drużyna i samolot rozdzielone (2026-06-25)', () => {
  it('bez wyboru: auto-balans frakcji; samolot domyślnie Spitfire po obu stronach', () => {
    const room = new GameRoom('TEAM');
    room.mode = 'team';
    const a = add(room, 'alfa');
    const b = add(room, 'bravo');
    expect(room.factionOf(a)).toBe(0);
    expect(room.factionOf(b)).toBe(1);
    // samolot NIE wynika już z drużyny — domyślnie Spitfire dla obu (to wybór gracza, nie narodowość)
    expect(room.roomPlayers().find((p) => p.id === a)?.planeType).toBe('spitfire');
    expect(room.roomPlayers().find((p) => p.id === b)?.planeType).toBe('spitfire');
    room.start();
    expect(planeTypeInSnapshot(room, a)).toBe('spitfire');
    expect(planeTypeInSnapshot(room, b)).toBe('spitfire');
  });

  it('selectTeam zmienia drużynę, nie rusza samolotu', () => {
    const room = new GameRoom('TEM2');
    room.mode = 'team';
    const a = add(room, 'alfa'); // auto-balans → drużyna 0
    expect(room.factionOf(a)).toBe(0);
    room.selectPlane(a, 'bf109'); // samolot
    room.selectTeam(a, 1); // drużyna — niezależnie od samolotu
    expect(room.factionOf(a)).toBe(1);
    expect(room.roomPlayers().find((p) => p.id === a)?.planeType).toBe('bf109');
    room.start(); // wybór drużyny przeżywa start (assignFactions utrwala teamPref)
    expect(room.factionOf(a)).toBe(1);
    expect(planeTypeInSnapshot(room, a)).toBe('bf109');
    expect(room.healthOf(a)).toBe(BF109_E.hpPool);
  });

  it('selectPlane NIE zmienia drużyny (rozdzielenie)', () => {
    const room = new GameRoom('TEM3');
    room.mode = 'team';
    const a = add(room, 'alfa'); // auto-balans → drużyna 0
    room.selectPlane(a, 'bf109');
    expect(room.factionOf(a)).toBe(0); // Bf 109, ale wciąż drużyna 0
    expect(room.roomPlayers().find((p) => p.id === a)?.planeType).toBe('bf109');
  });

  it('wolny wybór: dwóch graczy może wybrać TĘ SAMĄ drużynę (cel: znajomi razem)', () => {
    const room = new GameRoom('TEM4');
    room.mode = 'team';
    const a = add(room, 'alfa');
    const b = add(room, 'bravo');
    room.selectTeam(a, 0);
    room.selectTeam(b, 0);
    room.start();
    // wybór przeżywa start — obaj po tej samej stronie (nie wymuszamy balansu między ludźmi)
    expect(room.factionOf(a)).toBe(0);
    expect(room.factionOf(b)).toBe(0);
  });

  it('boty wyrównują wokół wyborów ludzi (2 ludzi na drużynie 0 + 2 boty → boty na 1)', () => {
    const room = new GameRoom('TEM5');
    room.mode = 'team';
    const a = add(room, 'alfa');
    const b = add(room, 'bravo');
    const bots = [room.addBot('normalny'), room.addBot('normalny')];
    room.selectTeam(a, 0);
    room.selectTeam(b, 0);
    room.start();
    expect(room.factionOf(a)).toBe(0);
    expect(room.factionOf(b)).toBe(0);
    for (const bot of bots) expect(room.factionOf(bot)).toBe(1);
  });

  it('selectTeam ignorowany w FFA (frakcja = id)', () => {
    const room = new GameRoom('FFAT');
    const a = add(room, 'alfa');
    room.selectTeam(a, 1); // brak trybu drużynowego → no-op
    room.start();
    expect(room.factionOf(a)).toBe(a);
  });
});

describe('boty', () => {
  it('addBot z wymuszonym typem lata tym samolotem', () => {
    const room = new GameRoom('BOTS');
    const botId = room.addBot('normalny', 'bf109');
    room.start();
    expect(planeTypeInSnapshot(room, botId)).toBe('bf109');
    expect(room.healthOf(botId)).toBe(BF109_E.hpPool);
    expect(room.ammoOf(botId)).toBe(BF109_AMMO);
  });
});
