import { describe, expect, it } from 'vitest';
import {
  FIXED_DT_S,
  PHYSICS_HZ,
  ZONE_CAPTURE_SECONDS,
  ZONE_CENTER_X_M,
  ZONE_CENTER_Z_M,
  type ControlMessage,
  type StandingsMessage,
} from '@air-combat/shared';
import { GameRoom } from './game-room';

// Kontrola strefy KotH na serwerze (faza 17): autorytatywny ZoneControl jako DODATKOWY warunek
// zwycięstwa obok limitu zestrzeleń/czasu. FFA: każdy gracz osobną frakcją (frakcja = id).
// Testy puszczają realną pętlę room.step i przyklejają encję do pozy w środku strefy (jak
// match-loop.test), żeby kontrola była deterministyczna mimo fizyki lotu.

/** Połączenie-atrapa zapamiętujące wiadomości kontrolne (standings). */
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

/** Przykleja żywą encję do stałej pozy (jak match-loop.test) — deterministyczna okupacja strefy. */
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

/** Ostatnia tabela wyników z atrapy (po broadcastStandings). */
function lastStandings(member: ReturnType<typeof recordingMember>): StandingsMessage | undefined {
  for (let i = member.controls.length - 1; i >= 0; i--) {
    const m = member.controls[i]!;
    if (m.t === 'standings') return m;
  }
  return undefined;
}

const CENTER: [number, number, number] = [ZONE_CENTER_X_M, 5000, ZONE_CENTER_Z_M];

describe('KotH na serwerze — przejęcie strefy', () => {
  it('wyłączna kontrola przez ZONE_CAPTURE_SECONDS kończy mecz (reason zone, zwycięzca = okupant)', () => {
    const room = new GameRoom('ABCD');
    const member = recordingMember();
    const holder = add(room, member, 'Holder');
    room.start();

    // pojedynczy okupant trzymany w środku strefy — kontrola wyłączna, licznik rośnie
    const capTicks = Math.ceil(ZONE_CAPTURE_SECONDS * PHYSICS_HZ);
    let ticks = 0;
    while (room.state === 'playing' && ticks < capTicks + 120) {
      repose(room, holder, CENTER);
      room.step(FIXED_DT_S);
      ticks++;
    }

    expect(room.state).toBe('ended');
    expect(room.lastEndReason).toBe('zone');
    expect(room.winnerId).toBe(holder);
    // koniec nastąpił mniej więcej przy progu (nie przez limit czasu meczu = 15 min)
    expect(ticks).toBeGreaterThanOrEqual(capTicks);
    expect(ticks).toBeLessThan(capTicks + 60);

    const ended = member.controls.find((m) => m.t === 'matchEnded');
    expect(ended).toBeDefined();
    if (ended && ended.t === 'matchEnded') {
      expect(ended.reason).toBe('zone');
      expect(ended.winnerId).toBe(holder);
    }

    // rewanż (start z 'ended') → świeża strefa: liczniki i przejęcie wyzerowane
    room.start();
    expect(room.state).toBe('playing');
    room.broadcastStandings();
    const after = lastStandings(member);
    expect(after?.rows.find((r) => r.id === holder)?.zoneSeconds).toBe(0);
    expect(after?.zone).toEqual({ controlling: null, occupied: false });
  });
});

describe('KotH na serwerze — strefa sporna i standings', () => {
  it('dwie różne frakcje w strefie → sporna: liczniki nie rosną, mecz nie kończy się przez strefę', () => {
    const room = new GameRoom('ABCD');
    room.scoreLimit = 99; // nie kończ meczu przez zestrzelenia w trakcie testu
    const aMember = recordingMember();
    const a = add(room, aMember, 'A');
    const b = add(room, recordingMember(), 'B');
    room.start();

    // obaj w strefie, ale 500 m od siebie (bez kolizji samolot↔samolot) → sporna pauza
    for (let i = 0; i < 300; i++) {
      repose(room, a, [ZONE_CENTER_X_M, 5000, ZONE_CENTER_Z_M]);
      repose(room, b, [ZONE_CENTER_X_M, 5000, ZONE_CENTER_Z_M + 500]);
      room.step(FIXED_DT_S);
    }

    expect(room.state).toBe('playing'); // strefa sporna nikogo nie wyłania
    room.broadcastStandings();
    const msg = lastStandings(aMember);
    expect(msg?.zone).toEqual({ controlling: null, occupied: true }); // sporna = pauza, ale obsadzona
    expect(msg?.rows.find((r) => r.id === a)?.zoneSeconds).toBe(0);
    expect(msg?.rows.find((r) => r.id === b)?.zoneSeconds).toBe(0);
  });

  it('standings niosą sekundy kontroli i status strefy dla wyłącznego okupanta', () => {
    const room = new GameRoom('ABCD');
    const member = recordingMember();
    const holder = add(room, member, 'Holder');
    add(room, recordingMember(), 'Away'); // drugi gracz poza strefą (zostaje na slocie spawnu)
    room.start();

    for (let i = 0; i < PHYSICS_HZ; i++) {
      repose(room, holder, CENTER);
      room.step(FIXED_DT_S);
    }
    room.broadcastStandings();
    const msg = lastStandings(member);
    expect(msg?.zone.controlling).toBe(holder);
    expect(msg?.zone.occupied).toBe(true);
    expect(msg?.rows.find((r) => r.id === holder)?.zoneSeconds).toBeGreaterThan(0);
  });
});
