import { describe, expect, it } from 'vitest';
import { FIXED_DT_S, type InputFrame } from '@air-combat/shared';
import { GameRoom } from './game-room';

// Flutter / Vne po stronie serwera (autorytatywnie, fizyka v2 R2 §6.2): powyżej prędkości nieprzekraczalnej
// (IAS ≥ Vne) drżenie strukturalne niszczy STREFY SKRZYDEŁ; oba skrzydła w 0 HP → rozpad konstrukcji (wrak,
// cause 'structure', bez kredytu). Tylko LUDZIE (jak przegrzanie — boty konsekwencji nie odczuwają). Testy
// jadą realną pętlą room.step; nadprędkość wymuszamy przez referencję stanu (jak overheat.test seeduje heat),
// bo dolot do IAS > Vne lotem trwałby długo i mógłby wpaść w kompresję sterów.

const dummyMember = { sendControl() {}, sendSnapshotBytes() {} };
let tokenSeq = 0;
function add(room: GameRoom, nick = 'pilot'): number {
  return room.addPlayer(nick, `tok-${String(tokenSeq++)}`, dummyMember);
}

function input(over: Partial<InputFrame> = {}): InputFrame {
  return {
    sequence: 1,
    ackServerTick: 0,
    throttle: 1,
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

const high: [number, number, number] = [0, 5000, 7000]; // wysoko, z dala od AA i strefy

describe('flutter / Vne — obrażenia skrzydeł po stronie serwera', () => {
  it('nurkowanie ponad Vne niszczy skrzydła → rozpad konstrukcji (śmierć bez kredytu)', () => {
    const room = new GameRoom('ABCD');
    const t = add(room, 'T');
    room.start();
    const wing0 = room.zoneHpOf(t, 'wingL');
    expect(wing0).toBeGreaterThan(0);
    // ~360 m/s TAS @ 5000 m → IAS ~1000 km/h, głęboko ponad Vne Spitfire (720)
    for (let i = 0; i < 900; i++) {
      reposeAtSpeed(room, t, high, 360);
      room.applyInput(t, input());
      room.step(FIXED_DT_S);
      if (room.zoneHpOf(t, 'wingL') <= 0) break; // skrzydło padło → dalej encja jest wrakiem
    }
    expect(room.zoneHpOf(t, 'wingL')).toBe(0); // lewe skrzydło urwane
    expect(room.zoneHpOf(t, 'wingR')).toBe(0); // prawe też (flutter symetryczny)
    expect(room.deathsOf(t)).toBe(1); // rozpad konstrukcji = śmierć
    expect(room.livesOf(t)).toBe(0); // zużyte życie (bez respawnu — eliminacja)
  });

  it('lot poniżej Vne NIE powoduje obrażeń skrzydeł (kontrola)', () => {
    const room = new GameRoom('ABCD');
    const t = add(room, 'T');
    room.start();
    const wing0 = room.zoneHpOf(t, 'wingL');
    // ~150 m/s TAS @ 5000 m → IAS ~420 km/h, daleko poniżej Vne 720
    for (let i = 0; i < 600; i++) {
      reposeAtSpeed(room, t, high, 150);
      room.applyInput(t, input({ throttle: 0.7 }));
      room.step(FIXED_DT_S);
    }
    expect(room.zoneHpOf(t, 'wingL')).toBe(wing0); // skrzydła nietknięte
    expect(room.zoneHpOf(t, 'wingR')).toBe(wing0);
    expect(room.deathsOf(t)).toBe(0);
  });

  it('boty: nadprędkość ponad Vne NIE urywa im skrzydeł (życzenie usera — jak przy przegrzaniu)', () => {
    const room = new GameRoom('ABCD');
    const bot = room.addBot('trudny');
    room.start();
    const wing0 = room.zoneHpOf(bot, 'wingL');
    for (let i = 0; i < 900; i++) {
      reposeAtSpeed(room, bot, high, 360); // ta sama nadprędkość co u człowieka wyżej
      room.step(FIXED_DT_S);
    }
    expect(room.zoneHpOf(bot, 'wingL')).toBe(wing0); // bot odporny na flutter
    expect(room.deathsOf(bot)).toBe(0);
  });
});
