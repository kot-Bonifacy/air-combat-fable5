import { describe, expect, it } from 'vitest';
import { FIXED_DT_S, SPITFIRE_MK2, type InputFrame } from '@air-combat/shared';
import { GameRoom } from './game-room';

// Modułowe uszkodzenia po stronie serwera (faza 22, Część 2): hit detection po STREFACH +
// maszyna stanów (pożar, skutki krytyczne). Testy jadą realną pętlą room.step (ogień → pocisk →
// rewind → trafienie → strefa + integralność → skutki). Stan encji sterujemy przez referencje
// z snapshotEntities() (state/health), pożar wymuszamy igniteForTest (zapłon jest probabilistyczny).

const dummyMember = { sendControl() {}, sendSnapshotBytes() {} };
let tokenSeq = 0;
function add(room: GameRoom, nick = 'pilot'): number {
  return room.addPlayer(nick, `tok-${String(tokenSeq++)}`, dummyMember);
}

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

/** „Przykleja" pozę ŻYWEJ encji (pozycja, nos ±Z, prędkość 0) — walka deterministyczna. */
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

/** Ustawia HP integralności encji wprost (referencja Health w snapshotEntities). */
function setHealth(room: GameRoom, id: number, hp: number): void {
  const h = room.snapshotEntities().find((e) => e.id === id)?.health;
  if (h) h.hp = hp;
}

describe('faza 22 — hit detection po strefach', () => {
  it('trafienie z TYŁU degraduje strefy (skrzydła/ogon) i integralność; przód (silnik) nietknięty', () => {
    const room = new GameRoom('ABCD');
    const shooter = add(room, 'A');
    const target = add(room, 'B');
    room.start();
    const engine0 = room.zoneHpOf(target, 'engine');
    const wingL0 = room.zoneHpOf(target, 'wingL');
    const wingR0 = room.zoneHpOf(target, 'wingR');
    const tail0 = room.zoneHpOf(target, 'tail');

    // strzelec tuż za celem (15 m), oba nosem +Z; ochronę respawnu (3 s) przeczekujemy stepami
    const sPos: [number, number, number] = [0, 5000, 235];
    const tPos: [number, number, number] = [0, 5000, 250];
    room.applyInput(shooter, input({ fire: true }));
    // zatrzymaj po PIERWSZYM uszkodzeniu integralności (krótkie okno → cel nie ginie krytykiem)
    let ticks = 0;
    while (room.healthOf(target) === SPITFIRE_MK2.hpPool && ticks < 400) {
      repose(room, shooter, sPos);
      repose(room, target, tPos);
      room.step(FIXED_DT_S);
      ticks++;
    }
    // jeszcze chwila ognia, by strefy pewnie oberwały, ale wciąż bez dobicia
    for (let i = 0; i < 4; i++) {
      repose(room, shooter, sPos);
      repose(room, target, tPos);
      room.step(FIXED_DT_S);
    }

    expect(room.healthOf(target)).toBeLessThan(SPITFIRE_MK2.hpPool); // integralność spadła
    expect(room.healthOf(target)).toBeGreaterThan(0); // ale cel żyje (nie dobity)
    // z tyłu obrywają skrzydła/ogon (pociski wpadają od −Z); silnik z przodu jest nieosiągalny
    const rearDamaged =
      room.zoneHpOf(target, 'wingL') < wingL0 ||
      room.zoneHpOf(target, 'wingR') < wingR0 ||
      room.zoneHpOf(target, 'tail') < tail0;
    expect(rearDamaged).toBe(true);
    expect(room.zoneHpOf(target, 'engine')).toBe(engine0); // przód nietknięty
  });

  it('utrata skrzydła (krytyk) zabija mimo dodatniej integralności i przyznaje kredyt strzelcowi', () => {
    const room = new GameRoom('ABCD');
    const shooter = add(room, 'A');
    const victim = add(room, 'B');
    room.start();
    // zwarcie czołowe z 12 m: ogień skrzydłowy Spitfire'a sieje po SKRZYDŁACH ofiary → skrzydło
    // odpada, zanim integralność zejdzie do 0. Ofiara NIE strzela (jednostronnie).
    const sPos: [number, number, number] = [0, 5000, 0];
    const vPos: [number, number, number] = [0, 5000, 12];
    room.applyInput(shooter, input({ fire: true }));
    room.applyInput(victim, input({ fire: false }));
    let ticks = 0;
    while (room.livesOf(victim) > 0 && ticks < 500) {
      repose(room, shooter, sPos, false);
      repose(room, victim, vPos, true);
      room.step(FIXED_DT_S);
      ticks++;
    }
    expect(room.livesOf(victim)).toBe(0); // ofiara martwa
    expect(room.deathsOf(victim)).toBe(1);
    expect(room.killsOf(shooter)).toBe(1); // kredyt mimo że to nie dobicie integralności
    expect(room.healthOf(victim)).toBeGreaterThan(0); // śmierć z krytyka, nie z health→0
    const wingDestroyed = room.zoneLevelOf(victim, 'wingL') === 3 || room.zoneLevelOf(victim, 'wingR') === 3;
    expect(wingDestroyed).toBe(true);
    expect(room.damageActiveOf(victim)).toBe(true); // fizyka leciała uszkodzona (sim.damageLevels≠null)
  });
});

describe('faza 22 — maszyna stanów pożaru', () => {
  it('DoT pożaru obniża integralność i pożar samoczynnie gaśnie (bez dobicia przy pełnym HP)', () => {
    const room = new GameRoom('ABCD');
    const t = add(room, 'T');
    room.start();
    room.igniteForTest(t, t); // starter bez znaczenia — przy pełnym HP pożar nie dobije
    const hp0 = room.healthOf(t);
    // 12 s pożaru (fireSelfExtinguishS) z dala od AA (cel przyklejony daleko od środka mapy)
    const safe: [number, number, number] = [0, 5000, 7000];
    for (let i = 0; i < 720; i++) {
      repose(room, t, safe);
      room.step(FIXED_DT_S);
    }
    expect(room.isOnFire(t)).toBe(false); // wygasł sam po fireSelfExtinguishS
    expect(room.livesOf(t)).toBe(1); // przeżył (DoT < pełne HP)
    // spadek ≈ fireDotPerS × fireSelfExtinguishS = 4 × 12 = 48 HP
    expect(hp0 - room.healthOf(t)).toBeGreaterThan(40);
    expect(hp0 - room.healthOf(t)).toBeLessThan(56);
  });

  it('pożar DOBIJA uszkodzony samolot — kredyt dla podpalacza', () => {
    const room = new GameRoom('ABCD');
    const igniter = add(room, 'G');
    const t = add(room, 'T');
    room.start();
    setHealth(room, t, 10); // już mocno uszkodzony (np. po wcześniejszym ostrzale)
    room.igniteForTest(t, igniter); // to ogień podpalacza dobije
    const safe: [number, number, number] = [0, 5000, 7000];
    let ticks = 0;
    while (room.livesOf(t) > 0 && ticks < 400) {
      repose(room, t, safe);
      room.step(FIXED_DT_S);
      ticks++;
    }
    expect(room.deathsOf(t)).toBe(1);
    expect(room.killsOf(igniter)).toBe(1); // dobicie ogniem kredytowane podpalaczowi
  });

  it('pożar wzniecony flakiem dobija BEZ kredytu gracza', () => {
    const room = new GameRoom('ABCD');
    const other = add(room, 'X');
    const t = add(room, 'T');
    room.start();
    setHealth(room, t, 8);
    room.igniteForTest(t, -1, true); // fromAa: ogień z ziemi
    const safe: [number, number, number] = [0, 5000, 7000];
    let ticks = 0;
    while (room.livesOf(t) > 0 && ticks < 400) {
      repose(room, t, safe);
      room.step(FIXED_DT_S);
      ticks++;
    }
    expect(room.deathsOf(t)).toBe(1);
    expect(room.killsOf(other)).toBe(0); // nikt nie zdobywa zestrzelenia za flak
  });
});

describe('faza 22 — reset stanu uszkodzeń przy (re)spawnie', () => {
  it('nowy mecz przywraca pełne strefy i gasi pożar', () => {
    const room = new GameRoom('ABCD');
    const shooter = add(room, 'A');
    const target = add(room, 'B');
    room.start();
    const wingL0 = room.zoneHpOf(target, 'wingL');
    const wingR0 = room.zoneHpOf(target, 'wingR');

    // uszkodź skrzydło ostrzałem z tyłu (zatrzymaj na PIERWSZYM uszkodzeniu skrzydła — cel żyje)
    const sPos: [number, number, number] = [0, 5000, 235];
    const tPos: [number, number, number] = [0, 5000, 250];
    room.applyInput(shooter, input({ fire: true }));
    let ticks = 0;
    while (
      room.zoneHpOf(target, 'wingL') === wingL0 &&
      room.zoneHpOf(target, 'wingR') === wingR0 &&
      ticks < 400
    ) {
      repose(room, shooter, sPos);
      repose(room, target, tPos);
      room.step(FIXED_DT_S);
      ticks++;
    }
    room.applyInput(shooter, input({ fire: false }));
    room.igniteForTest(target, shooter);
    // warunek wstępny: coś uszkodzone + pali się
    const wingDamaged = room.zoneHpOf(target, 'wingL') < wingL0 || room.zoneHpOf(target, 'wingR') < wingR0;
    expect(wingDamaged).toBe(true);
    expect(room.isOnFire(target)).toBe(true);

    // rewanż: przerwij i wystartuj od nowa → spawn resetuje uszkodzenia
    room.abortMatch();
    room.start();
    expect(room.zoneHpOf(target, 'wingL')).toBe(wingL0);
    expect(room.zoneHpOf(target, 'wingR')).toBe(wingR0);
    expect(room.isOnFire(target)).toBe(false);
    expect(room.damageActiveOf(target)).toBe(false); // fizyka znów tożsama (sim.damageLevels=null)
  });
});
