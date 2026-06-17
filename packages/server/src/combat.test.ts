import { describe, expect, it } from 'vitest';
import { FIXED_DT_S, SPITFIRE_MK2, type InputFrame } from '@air-combat/shared';
import { GameRoom } from './game-room';

// Walka sieciowa (faza-11.md): hit detection, HP, kadencja i kredyt zestrzeleń —
// wszystko autorytatywnie na serwerze. Testy sterują stanem encji bezpośrednio
// (referencje z snapshotEntities()) i puszczają pełną pętlę room.step, więc przechodzą
// realną ścieżką ognia → pocisk → rewind → trafienie → HP → śmierć → kredyt.

const arm = SPITFIRE_MK2.armament;
const TOTAL_AMMO = arm.ammoPerGun * arm.muzzles.length;
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

/** Ustawia stan encji: pozycja, prędkość, nos +Z (orientacja identyczności), żywa. */
function place(
  room: GameRoom,
  id: number,
  pos: [number, number, number],
  vel: [number, number, number],
): void {
  const src = room.snapshotEntities().find((e) => e.id === id);
  if (!src) throw new Error(`brak encji ${String(id)}`);
  const s = src.state;
  s.position.set(...pos);
  s.velocity.set(...vel);
  s.orientation.identity(); // nos w +Z (kierunek lufy)
  s.angularRates.pitch = 0;
  s.angularRates.roll = 0;
  s.angularRates.yaw = 0;
  s.iasMs = Math.hypot(...vel);
  s.loadFactor = 1;
  s.stalled = false;
  s.life = 'alive';
  s.lifeTimerS = 0;
}

/**
 * „Przykleja" pozę ŻYWEJ encji do stałych wartości (pozycja, nos ±Z, prędkość 0) — bez
 * dotykania life/health. Wołane co tick czyni walkę deterministyczną (zero dryfu/przeciągnięcia):
 * ogień zawsze z tego samego punktu, więc trafienia są powtarzalne. Po śmierci encji
 * (life≠'alive') przestaje na nią działać, by jej nie wskrzeszać.
 */
function repose(room: GameRoom, id: number, pos: [number, number, number], noseNegZ = false): void {
  const s = room.snapshotEntities().find((e) => e.id === id)?.state;
  if (!s || s.life !== 'alive') return;
  s.position.set(...pos);
  if (noseNegZ) s.orientation.set(0, 1, 0, 0); // 180° wokół Y → nos w −Z
  else s.orientation.identity();
  s.velocity.set(0, 0, 0);
  s.angularRates.pitch = 0;
  s.angularRates.roll = 0;
  s.angularRates.yaw = 0;
  s.iasMs = 0;
}

describe('serwer — kadencja ognia (anty-grief, niezmiennik nr 11)', () => {
  it('częstość ramek spustu NIE przyspiesza ognia; kadencja ≈ z konfiguracji', () => {
    function run(spamPerTick: number): number {
      const room = new GameRoom('ABCD');
      const id = add(room);
      room.start();
      for (let i = 0; i < 60; i++) {
        // klient „spamuje" spust spamPerTick razy na tick — serwer i tak strzela raz/tick wg cooldownu
        for (let k = 0; k < spamPerTick; k++) room.applyInput(id, input({ fire: true }));
        room.step(FIXED_DT_S);
      }
      return TOTAL_AMMO - room.ammoOf(id);
    }
    const once = run(1);
    const spam = run(10);
    expect(spam).toBe(once); // 10× szybszy spust = ten sam wynik
    // 1150 rpm/lufa × 8 luf / 60 ≈ 153 pocisków/s — pasmo 1 s
    expect(once).toBeGreaterThanOrEqual(144);
    expect(once).toBeLessThanOrEqual(168);
    // brak zaufania do klienta: NIE strzela co tick (60 salw × 8 = 480)
    expect(once).toBeLessThan(480);
  });

  it('amunicja jest skończona i liczona serwerowo (po wystrzelaniu spust nic nie robi)', () => {
    const room = new GameRoom('ABCD');
    const id = add(room);
    room.start();
    room.applyInput(id, input({ fire: true }));
    // 8 luf × 300 = 2400 pocisków; przy ~153/s wystrzela się w ~16 s — symulujemy z zapasem
    for (let i = 0; i < 60 * 20; i++) room.step(FIXED_DT_S);
    expect(room.ammoOf(id)).toBe(0);
  });
});

describe('serwer — hit detection, HP i kredyt zestrzeleń', () => {
  it('seria niszczy cel przed nosem i przyznaje zestrzelenie strzelcowi', () => {
    const room = new GameRoom('ABCD');
    const shooter = add(room, 'A');
    const target = add(room, 'B');
    room.start();
    // oba lecą +Z na 5 km (bez ryzyka rozbicia o teren); cel 250 m przed strzelcem
    place(room, shooter, [0, 5000, 0], [0, 0, 150]);
    place(room, target, [0, 5000, 250], [0, 0, 150]);
    room.applyInput(shooter, input({ fire: true }));
    room.applyInput(target, input({ fire: false }));

    let ticks = 0;
    while (room.healthOf(target) > 0 && ticks < 600) {
      room.step(FIXED_DT_S);
      ticks++;
    }
    expect(room.healthOf(target)).toBe(0);
    expect(room.killsOf(shooter)).toBe(1);
    expect(ticks).toBeLessThan(600); // padł w rozsądnym czasie (< 10 s)
  });

  it('remis: dwaj gracze zestrzeliwają się — obaj dostają zestrzelenie (kredyt mimo śmierci)', () => {
    const room = new GameRoom('ABCD');
    const a = add(room, 'A');
    const b = add(room, 'B');
    room.start();
    // symetryczny pojedynek czołowy z bliska (12 m): a nosem +Z ku b, b nosem −Z ku a.
    // pozy „przyklejone" co tick → ogień idealnie symetryczny, obaj giną ~w tym samym ticku;
    // gdyby jeden padł o tick wcześniej, pociski drugiego „już lecące" i tak dobijają (kredyt zostaje).
    const aPos: [number, number, number] = [0, 5000, 0];
    const bPos: [number, number, number] = [0, 5000, 12];
    room.applyInput(a, input({ fire: true, aimX: 0, aimY: 0, aimZ: 1 }));
    room.applyInput(b, input({ fire: true, aimX: 0, aimY: 0, aimZ: -1 }));

    let ticks = 0;
    while ((room.healthOf(a) > 0 || room.healthOf(b) > 0) && ticks < 300) {
      repose(room, a, aPos, false);
      repose(room, b, bPos, true);
      room.step(FIXED_DT_S);
      ticks++;
    }
    expect(room.healthOf(a)).toBe(0);
    expect(room.healthOf(b)).toBe(0);
    expect(room.killsOf(a)).toBe(1);
    expect(room.killsOf(b)).toBe(1);
  });

  it('asysta: kto trafił wcześniej, a nie dobił, dostaje asystę (dobijający — zestrzelenie)', () => {
    const room = new GameRoom('ABCD');
    const a = add(room, 'A'); // napastnik (asysta)
    const victim = add(room, 'V');
    const c = add(room, 'C'); // dobijający (zestrzelenie)
    room.start();
    // ofiara w środku; A ostrzeliwuje ją z tyłu (+Z), C z przodu (−Z) — strzelcy 30 m od siebie,
    // więc nawzajem się nie kładą; pozy „przyklejone" co tick (deterministyczne trafienia).
    const aPos: [number, number, number] = [0, 5000, 235];
    const vPos: [number, number, number] = [0, 5000, 250];
    const cPos: [number, number, number] = [0, 5000, 265];
    room.applyInput(victim, input({ fire: false }));
    room.applyInput(c, input({ fire: false }));

    // faza 0: odczekaj ochronę respawnu (SPAWN_PROTECTION_S, faza 13) — w realnej grze
    // zwarcie następuje długo po jej wygaśnięciu; bez tego pierwsze salwy A nie zadają obrażeń
    for (let i = 0; i < 190; i++) {
      repose(room, a, aPos, false);
      repose(room, victim, vPos, false);
      repose(room, c, cPos, true);
      room.step(FIXED_DT_S);
    }

    // faza 1: tylko A strzela krótko, potem przestaje; kilka ticków na dolot jego pocisków
    room.applyInput(a, input({ fire: true }));
    for (let i = 0; i < 16; i++) {
      repose(room, a, aPos, false);
      repose(room, victim, vPos, false);
      repose(room, c, cPos, true);
      room.step(FIXED_DT_S);
      if (i === 6) room.applyInput(a, input({ fire: false })); // A przestaje po ~2 salwach
    }
    expect(room.healthOf(victim)).toBeLessThan(SPITFIRE_MK2.hpPool); // A trafił
    expect(room.healthOf(victim)).toBeGreaterThan(0); // ale nie dobił

    // faza 2: C dobija
    room.applyInput(c, input({ fire: true }));
    let ticks = 0;
    while (room.healthOf(victim) > 0 && ticks < 600) {
      repose(room, a, aPos, false);
      repose(room, victim, vPos, false);
      repose(room, c, cPos, true);
      room.step(FIXED_DT_S);
      ticks++;
    }
    expect(room.killsOf(c)).toBe(1);
    expect(room.assistsOf(a)).toBe(1);
    expect(room.killsOf(a)).toBe(0);
    expect(room.assistsOf(c)).toBe(0);
  });
});

describe('serwer — wydajność walki (faza-11.md: 8 graczy + pociski < 20% rdzenia)', () => {
  it('8 graczy strzelających 10 s mieści się w budżecie czasu ticku', () => {
    const room = new GameRoom('ABCD');
    const ids: number[] = [];
    for (let i = 0; i < 8; i++) ids.push(add(room, `P${String(i)}`));
    room.start();
    // rozstaw na okręgu, każdy trzyma spust (maksymalne obciążenie puli pocisków)
    for (const id of ids) room.applyInput(id, input({ fire: true }));

    const TICKS = 600; // 10 s @ 60 Hz
    const t0 = performance.now();
    for (let i = 0; i < TICKS; i++) room.step(FIXED_DT_S);
    const msPerTick = (performance.now() - t0) / TICKS;

    // budżet 60 Hz: 1000/60 ≈ 16.7 ms/tick; 20% rdzenia ≈ 3.3 ms/tick.
    // próg testu luźny (CI bywa wolne), realny pomiar < 1 ms — patrz memory fazy 11.
    console.info(`[faza11] 8 graczy ognia: ${msPerTick.toFixed(3)} ms/tick`);
    expect(msPerTick).toBeLessThan(5);
    expect(room.activeBulletCount).toBeGreaterThan(0); // pociski faktycznie latały
  });
});
