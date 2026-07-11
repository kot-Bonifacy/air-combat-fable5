import { describe, expect, it } from 'vitest';
import { FIXED_DT_S, type InputFrame } from '@air-combat/shared';
import { GameRoom } from './game-room';

// Urwanie klap po stronie serwera (autorytatywnie, fizyka v2 R3 §6.4): wysunięte klapy powyżej ich
// ripIas biorą obrażenia STREF SKRZYDEŁ (jak flutter), ale gdy skrzydło osiągnie poziom wyłączenia,
// klapy chowają się (effIndex→0) i obrażenia USTAJĄ — mechanizm sam się ogranicza (skrzydło nie ginie).
// Tylko LUDZIE (boty konsekwencji nie odczuwają). Realna pętla room.step; nadprędkość przez referencję.

const dummyMember = { sendControl() {}, sendSnapshotBytes() {} };
let tokenSeq = 0;
function add(room: GameRoom, nick = 'pilot'): number {
  return room.addPlayer(nick, `tok-${String(tokenSeq++)}`, dummyMember);
}

function input(over: Partial<InputFrame> = {}): InputFrame {
  return {
    sequence: 1,
    ackServerTick: 0,
    throttle: 0.7,
    pitchUp: 0,
    rollRight: 0,
    yawRight: 0,
    fire: false,
    wep: false,
    flaps: 0,
    aimX: 0,
    aimY: 0,
    aimZ: 1,
    ...over,
  };
}

/** Wymusza lot poziomy z zadaną TAS [m/s] (nos +Z) — po step() pilotStep przelicza z tego IAS. */
function reposeAtSpeed(room: GameRoom, id: number, pos: [number, number, number], tasMs: number): void {
  const s = room.snapshotEntities().find((e) => e.id === id)?.state;
  if (!s || s.life !== 'alive') return;
  s.position.set(...pos);
  s.orientation.identity();
  s.velocity.set(0, 0, tasMs);
  s.angularRates.pitch = 0;
  s.angularRates.roll = 0;
  s.angularRates.yaw = 0;
}

// wysoko, z dala od AA i strefy; TAS 130 m/s @ 3000 m → IAS ~400 km/h (> ripIas 260, << Vne 720)
const fast: [number, number, number] = [0, 3000, 7000];

describe('klapy — urwanie po stronie serwera (R3 §6.4)', () => {
  it('nadprędkość z wysuniętymi klapami niszczy skrzydła, ale SAMO się ogranicza (skrzydło nie ginie)', () => {
    const room = new GameRoom('ABCD');
    const t = add(room, 'T');
    room.start();
    const wing0 = room.zoneHpOf(t, 'wingL');
    expect(wing0).toBeGreaterThan(0);
    for (let i = 0; i < 900; i++) {
      reposeAtSpeed(room, t, fast, 130);
      room.applyInput(t, input({ flaps: 1 })); // pełne klapy powyżej ripIas
      room.step(FIXED_DT_S);
    }
    const wing1 = room.zoneHpOf(t, 'wingL');
    expect(wing1).toBeLessThan(wing0); // klapy nadwerężyły skrzydło
    expect(wing1).toBeGreaterThan(0); // ale urwały się (effIndex→0) zanim skrzydło padło
    expect(room.deathsOf(t)).toBe(0); // same klapy nie zabijają
    // po urwaniu klap prawe skrzydło ucierpiało symetrycznie (oba brały obrażenia)
    expect(room.zoneHpOf(t, 'wingR')).toBeLessThan(wing0);
    expect(room.zoneHpOf(t, 'wingR')).toBeGreaterThan(0);
  });

  it('wysunięte klapy PONIŻEJ ripIas nie niszczą skrzydeł (kontrola)', () => {
    const room = new GameRoom('ABCD');
    const t = add(room, 'T');
    room.start();
    const wing0 = room.zoneHpOf(t, 'wingL');
    // TAS 70 m/s @ 3000 m → IAS ~215 km/h < ripIas 260
    for (let i = 0; i < 600; i++) {
      reposeAtSpeed(room, t, fast, 70);
      room.applyInput(t, input({ flaps: 1 }));
      room.step(FIXED_DT_S);
    }
    expect(room.zoneHpOf(t, 'wingL')).toBe(wing0);
    expect(room.zoneHpOf(t, 'wingR')).toBe(wing0);
  });

  it('nadprędkość ze SCHOWANYMI klapami nie niszczy skrzydeł (kontrola — to nie flutter)', () => {
    const room = new GameRoom('ABCD');
    const t = add(room, 'T');
    room.start();
    const wing0 = room.zoneHpOf(t, 'wingL');
    for (let i = 0; i < 600; i++) {
      reposeAtSpeed(room, t, fast, 130); // ta sama nadprędkość, ale klapy schowane
      room.applyInput(t, input({ flaps: 0 }));
      room.step(FIXED_DT_S);
    }
    expect(room.zoneHpOf(t, 'wingL')).toBe(wing0);
    expect(room.deathsOf(t)).toBe(0);
  });

  it('boty: klapy nie istnieją (flapIndex zawsze 0) → nadprędkość nie urywa im skrzydeł', () => {
    const room = new GameRoom('ABCD');
    const bot = room.addBot('trudny');
    room.start();
    const wing0 = room.zoneHpOf(bot, 'wingL');
    for (let i = 0; i < 600; i++) {
      reposeAtSpeed(room, bot, fast, 130);
      room.step(FIXED_DT_S);
    }
    expect(room.zoneHpOf(bot, 'wingL')).toBe(wing0);
    expect(room.deathsOf(bot)).toBe(0);
  });
});
