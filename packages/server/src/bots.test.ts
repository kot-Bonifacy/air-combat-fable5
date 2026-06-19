import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import {
  FIXED_DT_S,
  MSG_EVENT,
  RESPAWN_DELAY_S,
  SPITFIRE_MK2,
  decodeEvents,
  snapshotByteLength,
  type GameEvent,
  type InputFrame,
} from '@air-combat/shared';
import { GameRoom, type RoomMember } from './game-room';
import { MAX_BOTS_PER_ROOM } from './bot-manager';

// Boty na serwerze (faza-12.md). Bot jest pełnoprawną encją pokoju: lata, walczy, ginie,
// respawnuje i nalicza kredyt DOKŁADNIE tymi samymi ścieżkami co gracz (kryterium fazy:
// protokołowo nieodróżnialny). Testy ustawiają geometrię bezpośrednio (referencje ze
// snapshotEntities) i puszczają pełną pętlę room.step.

const dummyMember: RoomMember = { sendControl() {}, sendSnapshotBytes() {} };

let tokenSeq = 0;
function addHuman(room: GameRoom, nick = 'gracz'): number {
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

/** „Przykleja" pozę ŻYWEJ encji co tick (deterministyczna walka — jak w combat.test). */
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

function lifeOf(room: GameRoom, id: number): string {
  const s = room.snapshotEntities().find((e) => e.id === id)?.state;
  return s?.life ?? 'brak';
}

describe('serwer — boty jako encje pokoju (faza 12)', () => {
  it('boty mają nick [BOT], są w snapshocie i latają po starcie; nigdy nie są hostem', () => {
    const room = new GameRoom('ABCD');
    const human = addHuman(room);
    const bots = [room.addBot('normalny'), room.addBot('normalny'), room.addBot('trudny')];

    expect(room.botCount).toBe(3);
    expect(room.humanCount).toBe(1);
    expect(room.hostId).toBe(human); // host = człowiek, nie bot
    // każdy bot widoczny na liście poczekalni z prefiksem [BOT]
    const players = room.roomPlayers();
    expect(players).toHaveLength(4);
    for (const id of bots) {
      expect(players.find((p) => p.id === id)?.nick).toMatch(/^\[BOT\] /);
    }
    // snapshot zawiera 4 encje (bot nieodróżnialny strukturalnie — ma stan i HP)
    expect(room.snapshotEntities()).toHaveLength(4);

    room.start();
    const before = new Map(
      bots.map((id) => [id, room.snapshotEntities().find((e) => e.id === id)!.state.position.clone()]),
    );
    for (let i = 0; i < 120; i++) room.step(FIXED_DT_S);
    for (const id of bots) {
      const now = room.snapshotEntities().find((e) => e.id === id)!.state.position;
      expect(now.distanceTo(before.get(id)!)).toBeGreaterThan(50); // bot faktycznie się poruszył
    }
  });

  it('bot zestrzeliwuje gracza → kredyt dla bota + event KILL z poprawnymi id', () => {
    const events: GameEvent[] = [];
    const recorder: RoomMember = {
      sendControl() {},
      sendSnapshotBytes(bytes) {
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        if (bytes.byteLength > 0 && view.getUint8(0) === MSG_EVENT) {
          for (const e of decodeEvents(view)) events.push(e);
        }
      },
    };
    const room = new GameRoom('ABCD');
    const victim = room.addPlayer('ofiara', 'tok-v', recorder);
    const bot = room.addBot('trudny');
    // bystander daleko: po śmierci ofiary wciąż żyją 2 frakcje (bot + widz) → mecz nie kończy się
    // eliminacją (P1) i event KILL zdąży się rozesłać przed końcem
    const bystander = room.addPlayer('widz', 'tok-w', dummyMember);
    room.start();
    const scratch = new Uint8Array(snapshotByteLength(8));

    // bot tuż za ogonem gracza (250 m, w stożku i zasięgu ognia); obaj przyklejeni co tick
    let ticks = 0;
    while (room.healthOf(victim) > 0 && ticks < 900) {
      repose(room, bot, [0, 5000, 0], false);
      repose(room, victim, [0, 5000, 250], false);
      repose(room, bystander, [9000, 5000, 0], false);
      room.step(FIXED_DT_S);
      room.sendSnapshots(scratch); // flush eventów do recordera (kanał kill feed)
      ticks++;
    }
    expect(room.healthOf(victim)).toBe(0);
    expect(room.killsOf(bot)).toBe(1);
    const kill = events.find((e) => e.kind === 'kill');
    if (kill?.kind !== 'kill') throw new Error('brak eventu KILL');
    expect(kill.killerId).toBe(bot);
    expect(kill.victimId).toBe(victim);
    expect(kill.cause).toBe('air');
  });

  it('gracz zestrzeliwuje bota → kredyt gracza, a bot NIE respawnuje (1 życie jak SP)', () => {
    const room = new GameRoom('ABCD');
    const shooter = addHuman(room, 'as');
    const bot = room.addBot('latwy');
    // bystander daleko: po śmierci bota wciąż żyją 2 frakcje → mecz trwa (brak eliminacji),
    // więc da się zaobserwować, że bot NIE wraca do gry (P1: eliminacja w obu trybach)
    const bystander = addHuman(room, 'widz');
    room.start();
    room.applyInput(shooter, input({ fire: true }));

    // engagement z dala od strefy (x=6 km), widz po drugiej stronie areny
    const sPos: [number, number, number] = [6000, 5000, 0];
    const botPos: [number, number, number] = [6000, 5000, 250];
    const wPos: [number, number, number] = [-9000, 5000, 0];
    let ticks = 0;
    while (room.healthOf(bot) > 0 && ticks < 900) {
      repose(room, shooter, sPos, false);
      repose(room, bot, botPos, false);
      repose(room, bystander, wPos, false);
      room.step(FIXED_DT_S);
      ticks++;
    }
    expect(room.healthOf(bot)).toBe(0);
    expect(room.killsOf(shooter)).toBe(1);
    expect(lifeOf(room, bot)).toBe('dying'); // zestrzelony w powietrzu → spadający wrak (faza 15)
    expect(room.livesOf(bot)).toBe(0); // zużył jedyne życie (P1)

    // przyspiesz opadanie wraku do ziemi → 'dead'; mecz trwa (shooter + widz żyją)
    const wreck = room.snapshotEntities().find((e) => e.id === bot)!.state;
    wreck.position.set(0, 40, 0);
    wreck.velocity.set(0, -30, 0);
    let fall = 0;
    while (lifeOf(room, bot) === 'dying' && fall < 200) {
      repose(room, shooter, sPos, false);
      repose(room, bystander, wPos, false);
      room.step(FIXED_DT_S);
      fall++;
    }
    expect(lifeOf(room, bot)).toBe('dead'); // wrak uderzył w ziemię

    // odczekaj PONAD okno respawnu — bot NIE wraca do gry (brak żyć, parytet z SP). Po RESPAWN_DELAY_S
    // cykl życia przechodzi dead→'respawning', ale spawn() jest zbramkowany canRespawn → utknie tam
    // (jak SP/drużynowy dla wyeliminowanych); kluczowe: nigdy nie wraca do 'alive'.
    const respawnTicks = Math.ceil(RESPAWN_DELAY_S / FIXED_DT_S) + 30;
    for (let i = 0; i < respawnTicks; i++) {
      repose(room, shooter, sPos, false);
      repose(room, bystander, wPos, false);
      room.step(FIXED_DT_S);
    }
    expect(lifeOf(room, bot)).not.toBe('alive'); // brak respawnu — nigdy nie wraca do gry
    expect(room.livesOf(bot)).toBe(0);
    expect(SPITFIRE_MK2.hpPool).toBeGreaterThan(0); // sanity (import wciąż używany)
  });

  it('boty walczą ZE SOBĄ: w pojedynku czołowym pada kredyt zestrzelenia botowi', () => {
    const room = new GameRoom('ABCD');
    addHuman(room); // host-człowiek (pokój wymaga człowieka, bot nie lata sam z lobby)
    const a = room.addBot('trudny');
    const b = room.addBot('trudny');
    room.start();

    // pojedynek czołowy 200 m: A nosem +Z ku B, B nosem −Z ku A (oba w zasięgu/stożku ognia)
    let ticks = 0;
    while (room.healthOf(a) > 0 && room.healthOf(b) > 0 && ticks < 1200) {
      repose(room, a, [0, 5000, 0], false);
      repose(room, b, [0, 5000, 200], true);
      room.step(FIXED_DT_S);
      ticks++;
    }
    // przynajmniej jeden bot zestrzelił drugiego (zwykle remis → obaj po 1)
    expect(room.killsOf(a) + room.killsOf(b)).toBeGreaterThanOrEqual(1);
    expect(Math.min(room.healthOf(a), room.healthOf(b))).toBe(0);
  });
});

describe('serwer — wydajność botów (faza-12.md: 1 gracz + 7 botów < 50% budżetu ticku)', () => {
  it('1 gracz + 7 botów: 10 s symulacji mieści się w budżecie czasu ticku', () => {
    const room = new GameRoom('ABCD');
    const human = addHuman(room, 'gracz');
    expect(MAX_BOTS_PER_ROOM).toBe(7);
    for (let i = 0; i < MAX_BOTS_PER_ROOM; i++) room.addBot('trudny');
    room.start();
    room.applyInput(human, input({ fire: true }));

    // ciasny klaster 600 m na 5 km: wszyscy od razu w zasięgu wykrycia → boty myślą, manewrują
    // i strzelają (najgorszy realny przypadek: pełen potok AI + pula pocisków + hit detection)
    const entities = room.snapshotEntities();
    const fwdZ = new Vector3(0, 0, 1);
    entities.forEach((e, k) => {
      const angle = (k / entities.length) * Math.PI * 2;
      e.state.position.set(Math.cos(angle) * 600, 5000, Math.sin(angle) * 600);
      e.state.velocity.set(-Math.cos(angle) * 150, 0, -Math.sin(angle) * 150); // nosem do środka
      e.state.orientation.setFromUnitVectors(fwdZ, e.state.velocity.clone().normalize());
      e.state.iasMs = 150;
    });

    const TICKS = 600; // 10 s @ 60 Hz
    const t0 = performance.now();
    for (let i = 0; i < TICKS; i++) room.step(FIXED_DT_S);
    const msPerTick = (performance.now() - t0) / TICKS;

    // budżet 60 Hz = 16,7 ms/tick; kryterium fazy: < 50% = 8,3 ms. Próg testu luźny (CI bywa
    // wolne), realny pomiar dev grubo poniżej — patrz memory fazy 12.
    console.info(`[faza12] 1 gracz + 7 botów: ${msPerTick.toFixed(3)} ms/tick`);
    expect(msPerTick).toBeLessThan(5);
    expect(room.botCount).toBe(7);
  });
});
