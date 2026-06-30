import { describe, expect, it } from 'vitest';
import { FIXED_DT_S, OVERHEAT_FAILURE_TIME_S, type InputFrame } from '@air-combat/shared';
import { GameRoom } from './game-room';

// Przegrzanie silnika po stronie serwera (autorytatywnie): temperatura ponad czerwoną linią aplikuje
// obrażenia STREFY 'silnik' (utrata mocy, aż po unieruchomienie) — NIE zabija samo z siebie. Testy
// jadą realną pętlą room.step; temperaturę zasiewamy przez referencję stanu z snapshotEntities (jak
// zone-damage.test seeduje HP), bo dojście do czerwonej linii lotem zajęłoby minuty.

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
    aimX: 0,
    aimY: 0,
    aimZ: 1,
    ...over,
  };
}

/** „Przykleja" żywą encję w miejscu (pozycja, nos +Z, prędkość/IAS 0 → chłodzenie opływem minimalne). */
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

/** Ustawia temperaturę silnika encji wprost (referencja stanu w snapshotEntities). */
function seedHeat(room: GameRoom, id: number, heat: number): void {
  const s = room.snapshotEntities().find((e) => e.id === id)?.state;
  if (s) s.engineHeatFrac = heat;
}

const safe: [number, number, number] = [0, 5000, 7000]; // z dala od AA i strefy

describe('przegrzanie silnika — obrażenia strefy silnika', () => {
  it('temperatura ponad czerwoną linią degraduje strefę silnik (utrata mocy), bez śmierci', () => {
    const room = new GameRoom('ABCD');
    const t = add(room, 'T');
    room.start();
    const engine0 = room.zoneHpOf(t, 'engine');
    seedHeat(room, t, 1.7); // głęboko w czerwieni
    room.applyInput(t, input({ throttle: 1 }));
    for (let i = 0; i < 600; i++) {
      // 10 s
      repose(room, t, safe);
      room.applyInput(t, input({ throttle: 1 }));
      room.step(FIXED_DT_S);
    }
    expect(room.engineHeatOf(t)).toBeGreaterThan(1); // wciąż przegrzany (pełny gaz, brak opływu)
    expect(room.zoneHpOf(t, 'engine')).toBeLessThan(engine0); // silnik oberwał
    expect(room.zoneLevelOf(t, 'engine')).toBeGreaterThanOrEqual(1); // realna utrata mocy
    expect(room.livesOf(t)).toBe(1); // przegrzanie samo nie zabija
    expect(room.deathsOf(t)).toBe(0);
  });

  it('silnik w normie (gaz mocy ciągłej) nie bierze obrażeń', () => {
    const room = new GameRoom('ABCD');
    const t = add(room, 'T');
    room.start();
    const engine0 = room.zoneHpOf(t, 'engine');
    for (let i = 0; i < 600; i++) {
      // 10 s na umiarkowanym gazie z chłodnym startem (heat=0) — equilibrium poniżej czerwonej linii
      repose(room, t, safe);
      room.applyInput(t, input({ throttle: 0.5 }));
      room.step(FIXED_DT_S);
    }
    expect(room.engineHeatOf(t)).toBeLessThan(1);
    expect(room.zoneHpOf(t, 'engine')).toBe(engine0); // brak obrażeń
  });

  it('(re)spawn zeruje temperaturę silnika', () => {
    const room = new GameRoom('ABCD');
    const t = add(room, 'T');
    room.start();
    seedHeat(room, t, 1.6);
    repose(room, t, safe);
    room.step(FIXED_DT_S);
    expect(room.engineHeatOf(t)).toBeGreaterThan(1);
    room.abortMatch();
    room.start();
    expect(room.engineHeatOf(t)).toBe(0); // zimny silnik na nowym życiu
    expect(room.zoneLevelOf(t, 'engine')).toBe(0);
    expect(room.overheatAccumOf(t)).toBe(0); // licznik przegrzania też wyzerowany
  });
});

describe('przegrzanie silnika — awaria po łącznym limicie czasu (licznik 60 s)', () => {
  /** Symuluje N sekund lotu człowieka na 100% gazu bez opływu (temperatura trzyma się ponad progiem). */
  function flyOverheated(room: GameRoom, id: number, seconds: number): void {
    seedHeat(room, id, 1.7);
    const steps = Math.round((seconds / FIXED_DT_S) | 0);
    for (let i = 0; i < steps; i++) {
      repose(room, id, safe);
      room.applyInput(id, input({ throttle: 1 }));
      room.step(FIXED_DT_S);
    }
  }

  it('po OVERHEAT_FAILURE_TIME_S łącznego lotu przegrzanym → pożar silnika i silnik staje', () => {
    const room = new GameRoom('ABCD');
    const t = add(room, 'T');
    room.start();
    flyOverheated(room, t, OVERHEAT_FAILURE_TIME_S + 1);
    expect(room.overheatAccumOf(t)).toBeGreaterThanOrEqual(OVERHEAT_FAILURE_TIME_S);
    expect(room.isOnFire(t)).toBe(true); // wybuchł pożar z przegrzania
    expect(room.zoneLevelOf(t, 'engine')).toBe(3); // silnik się zatrzymał (poziom 3 → brak ciągu)
  });

  it('przed limitem (krótki przegrzany lot) — jeszcze bez pożaru z przegrzania', () => {
    const room = new GameRoom('ABCD');
    const t = add(room, 'T');
    room.start();
    flyOverheated(room, t, OVERHEAT_FAILURE_TIME_S - 20);
    expect(room.isOnFire(t)).toBe(false); // licznik nie domknął limitu
  });

  it('boty: lot z przegrzanym silnikiem NIE daje poważnych uszkodzeń (życzenie usera)', () => {
    const room = new GameRoom('ABCD');
    const bot = room.addBot('trudny');
    room.start();
    const engine0 = room.zoneHpOf(bot, 'engine');
    for (let i = 0; i < (OVERHEAT_FAILURE_TIME_S + 5) * 60; i++) {
      seedHeat(room, bot, 1.8); // wymuś przegrzanie co tick (AI bota mogłoby zdjąć gaz)
      repose(room, bot, safe);
      room.step(FIXED_DT_S);
    }
    expect(room.zoneHpOf(bot, 'engine')).toBe(engine0); // silnik bota nietknięty mimo przegrzania
    expect(room.isOnFire(bot)).toBe(false); // brak pożaru z przegrzania
    expect(room.overheatAccumOf(bot)).toBe(0); // licznik nie biegnie dla botów
    expect(room.deathsOf(bot)).toBe(0); // przegrzanie nie zabija bota
  });
});
