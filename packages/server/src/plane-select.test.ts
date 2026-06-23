import { describe, expect, it } from 'vitest';
import { BF109_E, SPITFIRE_MK2, totalAmmo, type ControlMessage } from '@air-combat/shared';
import { GameRoom } from './game-room';

// Per-player plane (faza 19b): serwer trzyma konfigurację samolotu NA GRACZA (nie na pokój).
// FFA — gracz wybiera typ (selectPlane); drużynowy — klimat Alianci/Spitfire ↔ Oś/Bf 109, a
// wybór samolotu = wybór STRONY (2026-06-23): selectPlane przenosi gracza na stronę płatowca.
// HP/amunicja/typ w snapshocie muszą iść za faktycznym samolotem encji.

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

describe('drużynowy — klimat stron + wybór strony przez samolot', () => {
  it('bez wyboru: auto-balans → drużyna 0 = Spitfire, drużyna 1 = Bf 109 (klimat)', () => {
    const room = new GameRoom('TEAM');
    room.mode = 'team';
    const a = add(room, 'alfa');
    const b = add(room, 'bravo');
    expect(room.factionOf(a)).toBe(0);
    expect(room.factionOf(b)).toBe(1);
    // efektywny typ widoczny już w poczekalni (roster) — sprzęt wg strony
    expect(room.roomPlayers().find((p) => p.id === a)?.planeType).toBe('spitfire');
    expect(room.roomPlayers().find((p) => p.id === b)?.planeType).toBe('bf109');
    room.start();
    expect(planeTypeInSnapshot(room, a)).toBe('spitfire');
    expect(planeTypeInSnapshot(room, b)).toBe('bf109');
    expect(room.healthOf(a)).toBe(SPITFIRE_MK2.hpPool);
    expect(room.healthOf(b)).toBe(BF109_E.hpPool);
  });

  it('wybór samolotu = wybór strony (gracz przechodzi na stronę swojego płatowca)', () => {
    const room = new GameRoom('TEM2');
    room.mode = 'team';
    const a = add(room, 'alfa'); // auto-balans → drużyna 0 (Spitfire/Alianci)
    const b = add(room, 'bravo'); // auto-balans → drużyna 1 (Bf 109/Oś)
    expect(room.factionOf(a)).toBe(0);
    room.selectPlane(a, 'bf109'); // wybór Bf 109 = przejście na stronę Osi (drużyna 1)
    expect(room.factionOf(a)).toBe(1);
    expect(room.roomPlayers().find((p) => p.id === a)?.planeType).toBe('bf109');
    room.start(); // wybór strony przeżywa start (assignFactions utrwala preferencję gracza)
    expect(room.factionOf(a)).toBe(1);
    expect(planeTypeInSnapshot(room, a)).toBe('bf109');
    expect(room.healthOf(a)).toBe(BF109_E.hpPool);
    // b nie wybierał → auto-balans wokół wyboru a (trafia na pustą stronę 0/Alianci)
    expect(room.factionOf(b)).toBe(0);
    expect(planeTypeInSnapshot(room, b)).toBe('spitfire');
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
