import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { NetError } from '../errors';
import { createPlaneState, type PlaneState } from '../physics/state';
import {
  INPUT_BYTES,
  MSG_EVENT,
  MSG_INPUT,
  MSG_SNAPSHOT,
  PROTOCOL_VERSION,
  VELOCITY_QUANT_RANGE_MS,
  decodeEvents,
  decodeInput,
  decodeSnapshot,
  encodeEvents,
  encodeInputToBytes,
  encodeSnapshot,
  eventsByteLength,
  isValidRoomCode,
  sanitizeChat,
  sanitizeNick,
  MAX_CHAT_LENGTH,
  MAX_NICK_LENGTH,
  lifePhaseFromCode,
  lifePhaseToCode,
  parseControlMessage,
  snapshotByteLength,
  validateInputFrame,
  type GameEvent,
  type InputFrame,
  type SnapshotEntitySource,
} from './protocol';
import type { PlaneType } from '../planes/plane-type';

function makeInput(over: Partial<InputFrame> = {}): InputFrame {
  return {
    sequence: 12345,
    ackServerTick: 6789,
    throttle: 0.5,
    pitchUp: 0.25,
    rollRight: -0.75,
    yawRight: 0.1,
    fire: true,
    aimX: 0,
    aimY: 0,
    aimZ: 1,
    ...over,
  };
}

function roundTripInput(frame: InputFrame): InputFrame {
  const bytes = encodeInputToBytes(frame);
  return decodeInput(new DataView(bytes.buffer));
}

describe('protokół INPUT round-trip', () => {
  it('zachowuje pola w granicach kwantyzacji', () => {
    const out = roundTripInput(makeInput());
    expect(out.sequence).toBe(12345);
    expect(out.ackServerTick).toBe(6789);
    expect(out.fire).toBe(true);
    expect(out.throttle).toBeCloseTo(0.5, 4);
    expect(out.pitchUp).toBeCloseTo(0.25, 3);
    expect(out.rollRight).toBeCloseTo(-0.75, 3);
    expect(out.yawRight).toBeCloseTo(0.1, 3);
    expect(out.aimZ).toBeCloseTo(1, 3);
  });

  it('wartości brzegowe: throttle 0/1, wychylenia ±1, aim ±1', () => {
    const lo = roundTripInput(makeInput({ throttle: 0, pitchUp: -1, rollRight: -1, yawRight: -1, aimX: -1, aimY: 0, aimZ: 0, fire: false }));
    expect(lo.throttle).toBe(0);
    expect(lo.pitchUp).toBeCloseTo(-1, 4);
    expect(lo.rollRight).toBeCloseTo(-1, 4);
    expect(lo.aimX).toBeCloseTo(-1, 4);
    expect(lo.fire).toBe(false);

    const hi = roundTripInput(makeInput({ throttle: 1, pitchUp: 1, rollRight: 1, yawRight: 1 }));
    expect(hi.throttle).toBe(1);
    expect(hi.pitchUp).toBeCloseTo(1, 4);
    expect(hi.yawRight).toBeCloseTo(1, 4);
  });

  it('clampuje wartości spoza zakresu zamiast przepełniać int16', () => {
    const out = roundTripInput(makeInput({ throttle: 2, pitchUp: 5, rollRight: -3 }));
    expect(out.throttle).toBe(1);
    expect(out.pitchUp).toBeCloseTo(1, 4);
    expect(out.rollRight).toBeCloseTo(-1, 4);
  });

  it('sequence u32 zawija się poprawnie (duże numery)', () => {
    const out = roundTripInput(makeInput({ sequence: 4_000_000_000 }));
    expect(out.sequence).toBe(4_000_000_000);
  });

  it('ramka ma stały zadeklarowany rozmiar i tag MSG_INPUT', () => {
    const bytes = encodeInputToBytes(makeInput());
    expect(bytes.byteLength).toBe(INPUT_BYTES);
    expect(bytes[0]).toBe(MSG_INPUT);
  });

  it('odrzuca ramkę o złym rozmiarze', () => {
    const bytes = new Uint8Array(INPUT_BYTES - 1);
    bytes[0] = MSG_INPUT;
    expect(() => decodeInput(new DataView(bytes.buffer))).toThrow(NetError);
  });

  it('odrzuca ramkę o złym tagu typu', () => {
    const bytes = encodeInputToBytes(makeInput());
    bytes[0] = 99;
    expect(() => decodeInput(new DataView(bytes.buffer))).toThrow(NetError);
  });
});

describe('validateInputFrame', () => {
  it('przepuszcza poprawną ramkę', () => {
    expect(validateInputFrame(makeInput())).toBeNull();
  });

  it('odrzuca zdegenerowany (zerowy) wektor celu', () => {
    expect(validateInputFrame(makeInput({ aimX: 0, aimY: 0, aimZ: 0 }))).not.toBeNull();
  });

  it('odrzuca NaN / Infinity', () => {
    expect(validateInputFrame(makeInput({ pitchUp: Number.NaN }))).not.toBeNull();
    expect(validateInputFrame(makeInput({ throttle: Number.POSITIVE_INFINITY }))).not.toBeNull();
  });
});

function makeEntity(
  id: number,
  over: Partial<PlaneState> = {},
  health = { hp: 120, maxHp: 120 },
  fire = { ammoRemaining: 2400 },
  ammoMax = 2400,
  planeType: PlaneType = 'spitfire',
  fireSecondary: { ammoRemaining: number } | null = null,
  ammoSecondaryMax = 0,
): SnapshotEntitySource {
  const state = createPlaneState();
  state.position.set(1234.5, 678.25, -9000.75);
  state.orientation.set(0.1, 0.2, 0.3, 0.9).normalize();
  state.velocity.set(120, -5, 30);
  state.throttle = 0.8;
  return { id, state: Object.assign(state, over), health, fire, ammoMax, fireSecondary, ammoSecondaryMax, planeType };
}

describe('protokół SNAPSHOT round-trip', () => {
  it('zachowuje nagłówek i pola encji w granicach kwantyzacji', () => {
    const entities = [makeEntity(0), makeEntity(3, { life: 'dying', stalled: true })];
    const buf = new Uint8Array(snapshotByteLength(entities.length));
    const written = encodeSnapshot(new DataView(buf.buffer), 777, 555, 0, entities);
    expect(written).toBe(snapshotByteLength(entities.length));
    expect(buf[0]).toBe(MSG_SNAPSHOT);

    const snap = decodeSnapshot(new DataView(buf.buffer));
    expect(snap.serverTick).toBe(777);
    expect(snap.ackSeq).toBe(555);
    expect(snap.entities).toHaveLength(2);

    const [a, b] = snap.entities;
    expect(a?.id).toBe(0);
    expect(a?.isLocal).toBe(true);
    expect(a?.life).toBe('alive');
    expect(a?.position.x).toBeCloseTo(1234.5, 2);
    expect(a?.position.y).toBeCloseTo(678.25, 2);
    expect(a?.position.z).toBeCloseTo(-9000.75, 2);
    expect(a?.velocity.x).toBeCloseTo(120, 1);
    expect(a?.velocity.z).toBeCloseTo(30, 1);
    expect(a?.throttle).toBeCloseTo(0.8, 2);
    // kwaternion znormalizowany po dekodowaniu: ten sam obrót w granicach kwantyzacji
    const ref = new Quaternion(0.1, 0.2, 0.3, 0.9).normalize();
    expect(a?.orientation.angleTo(ref)).toBeLessThan(1e-3);

    expect(b?.id).toBe(3);
    expect(b?.isLocal).toBe(false);
    expect(b?.life).toBe('dying');
    expect(b?.stalled).toBe(true);
  });

  it('koduje ułamek HP encji (połowa zdrowia ≈ 0.5)', () => {
    const half = makeEntity(2, {}, { hp: 60, maxHp: 120 });
    const buf = new Uint8Array(snapshotByteLength(1));
    encodeSnapshot(new DataView(buf.buffer), 0, 0, 0, [half]);
    const snap = decodeSnapshot(new DataView(buf.buffer));
    expect(snap.entities[0]?.healthFrac).toBeCloseTo(0.5, 2);
  });

  it('koduje ułamek amunicji encji (ćwierć zapasu ≈ 0.25)', () => {
    const quarter = makeEntity(2, {}, { hp: 120, maxHp: 120 }, { ammoRemaining: 600 }, 2400);
    const buf = new Uint8Array(snapshotByteLength(1));
    encodeSnapshot(new DataView(buf.buffer), 0, 0, 0, [quarter]);
    const snap = decodeSnapshot(new DataView(buf.buffer));
    expect(snap.entities[0]?.ammoFrac).toBeCloseTo(0.25, 2);
  });

  it('koduje ułamek amunicji grupy wtórnej — działko 20 mm (protokół v5)', () => {
    // Bf 109: 120 szt. 20 mm, połowa zużyta → ammoSecondaryFrac ≈ 0.5; Spitfire (brak grupy) → 0
    const bf = makeEntity(1, {}, { hp: 110, maxHp: 110 }, { ammoRemaining: 2120 }, 2120, 'bf109', { ammoRemaining: 60 }, 120);
    const spit = makeEntity(0);
    const buf = new Uint8Array(snapshotByteLength(2));
    encodeSnapshot(new DataView(buf.buffer), 0, 0, 0, [bf, spit]);
    const snap = decodeSnapshot(new DataView(buf.buffer));
    expect(snap.entities[0]?.ammoSecondaryFrac).toBeCloseTo(0.5, 2);
    expect(snap.entities[1]?.ammoSecondaryFrac).toBe(0); // Spitfire: brak grupy wtórnej
  });

  it('zachowuje typ samolotu każdej encji (protokół v4)', () => {
    const entities = [
      makeEntity(0, {}, { hp: 120, maxHp: 120 }, { ammoRemaining: 2400 }, 2400, 'spitfire'),
      makeEntity(1, {}, { hp: 110, maxHp: 110 }, { ammoRemaining: 2120 }, 2120, 'bf109'),
    ];
    const buf = new Uint8Array(snapshotByteLength(entities.length));
    encodeSnapshot(new DataView(buf.buffer), 0, 0, 0, entities);
    const snap = decodeSnapshot(new DataView(buf.buffer));
    expect(snap.entities[0]?.planeType).toBe('spitfire');
    expect(snap.entities[1]?.planeType).toBe('bf109');
  });

  it('clampuje prędkość na granicy zakresu kwantyzacji', () => {
    const fast = makeEntity(1, { velocity: new Vector3(VELOCITY_QUANT_RANGE_MS + 200, 0, 0) });
    const buf = new Uint8Array(snapshotByteLength(1));
    encodeSnapshot(new DataView(buf.buffer), 0, 0, 9, [fast]);
    const snap = decodeSnapshot(new DataView(buf.buffer));
    expect(snap.entities[0]?.velocity.x).toBeCloseTo(VELOCITY_QUANT_RANGE_MS, 0);
  });

  it('snapshot dla 8 encji mieści się w budżecie pasma (< 350 B)', () => {
    expect(snapshotByteLength(8)).toBeLessThan(350);
  });

  it('odrzuca snapshot zbyt krótki dla zadeklarowanej liczby encji', () => {
    const buf = new Uint8Array(snapshotByteLength(2));
    encodeSnapshot(new DataView(buf.buffer), 0, 0, 0, [makeEntity(0), makeEntity(1)]);
    // podmień licznik encji na 5 — bufor już go nie pomieści
    new DataView(buf.buffer).setUint8(9, 5);
    expect(() => decodeSnapshot(new DataView(buf.buffer))).toThrow(NetError);
  });
});

describe('protokół EVENT round-trip', () => {
  const events: GameEvent[] = [
    { kind: 'muzzle', ownerId: 3, seed: 0xdeadbeef, shots: 8 },
    { kind: 'hit', shooterId: 3, victimId: 5 },
    { kind: 'kill', killerId: 3, victimId: 5, cause: 'air' },
    { kind: 'kill', killerId: 0, victimId: 7, cause: 'ground' },
    { kind: 'kill', killerId: 0, victimId: 2, cause: 'collision' },
  ];

  it('koduje i dekoduje paczkę zdarzeń bez straty', () => {
    const buf = new Uint8Array(eventsByteLength(events));
    const written = encodeEvents(new DataView(buf.buffer), events);
    expect(written).toBe(eventsByteLength(events));
    expect(buf[0]).toBe(MSG_EVENT);
    expect(decodeEvents(new DataView(buf.buffer))).toEqual(events);
  });

  it('seed u32 zachowuje pełny zakres', () => {
    const buf = new Uint8Array(eventsByteLength([events[0]!]));
    encodeEvents(new DataView(buf.buffer), [events[0]!]);
    const [m] = decodeEvents(new DataView(buf.buffer));
    expect(m?.kind === 'muzzle' && m.seed).toBe(0xdeadbeef);
  });

  it('pusta paczka = sam nagłówek (2 B), dekoduje się do []', () => {
    const buf = new Uint8Array(eventsByteLength([]));
    expect(buf.byteLength).toBe(2);
    encodeEvents(new DataView(buf.buffer), []);
    expect(decodeEvents(new DataView(buf.buffer))).toEqual([]);
  });

  it('odrzuca ramkę o złym tagu typu', () => {
    const buf = new Uint8Array(eventsByteLength(events));
    encodeEvents(new DataView(buf.buffer), events);
    buf[0] = 99;
    expect(() => decodeEvents(new DataView(buf.buffer))).toThrow(NetError);
  });
});

describe('protokół EVENT — stanowiska naziemne (AA, v6)', () => {
  it('round-trip AA_FIRE: indeks/seed/shots zachowane, kierunek w granicach kwantyzacji', () => {
    const dir = new Vector3(0.2, 0.8, -0.5).normalize();
    const ev: GameEvent = { kind: 'aaFire', index: 2, seed: 0xabad1dea, shots: 4, dir: dir.clone() };
    const buf = new Uint8Array(eventsByteLength([ev]));
    encodeEvents(new DataView(buf.buffer), [ev]);
    const [out] = decodeEvents(new DataView(buf.buffer));
    expect(out?.kind).toBe('aaFire');
    if (out?.kind === 'aaFire') {
      expect(out.index).toBe(2);
      expect(out.seed).toBe(0xabad1dea);
      expect(out.shots).toBe(4);
      expect(out.dir.angleTo(dir)).toBeLessThan(1e-3);
    }
  });

  it('round-trip AA_DESTROYED i KILL cause flak (zestrzelenie z ziemi)', () => {
    const evs: GameEvent[] = [
      { kind: 'aaDestroyed', index: 1, killerId: 4 },
      { kind: 'kill', killerId: 0, victimId: 6, cause: 'flak' },
    ];
    const buf = new Uint8Array(eventsByteLength(evs));
    encodeEvents(new DataView(buf.buffer), evs);
    expect(decodeEvents(new DataView(buf.buffer))).toEqual(evs);
  });
});

describe('kody fazy życia', () => {
  it('round-trip wszystkich faz', () => {
    for (const phase of ['alive', 'dying', 'dead', 'respawning'] as const) {
      expect(lifePhaseFromCode(lifePhaseToCode(phase))).toBe(phase);
    }
  });
});

describe('wiadomości kontrolne (JSON)', () => {
  it('parsuje hello/welcome/error oraz wiadomości lobby', () => {
    expect(parseControlMessage(JSON.stringify({ t: 'hello', v: PROTOCOL_VERSION }))?.t).toBe('hello');
    expect(parseControlMessage(JSON.stringify({ t: 'welcome', playerId: 2 }))?.t).toBe('welcome');
    expect(parseControlMessage(JSON.stringify({ t: 'error', code: 'version' }))?.t).toBe('error');
    expect(parseControlMessage(JSON.stringify({ t: 'createRoom' }))?.t).toBe('createRoom');
    expect(parseControlMessage(JSON.stringify({ t: 'joinRoom', code: 'ABCD' }))?.t).toBe('joinRoom');
    expect(parseControlMessage(JSON.stringify({ t: 'roomJoined', code: 'ABCD' }))?.t).toBe('roomJoined');
    expect(parseControlMessage(JSON.stringify({ t: 'matchStarted' }))?.t).toBe('matchStarted');
  });

  it('parsuje zakończenie misji: endMatch (host, same boty) i leaveMatch (powrót do poczekalni)', () => {
    expect(parseControlMessage(JSON.stringify({ t: 'endMatch' }))?.t).toBe('endMatch');
    expect(parseControlMessage(JSON.stringify({ t: 'leaveMatch' }))?.t).toBe('leaveMatch');
  });

  it('parsuje wiadomości poczekalni: updateRoom, chatSend i chat', () => {
    expect(parseControlMessage(JSON.stringify({ t: 'updateRoom', mode: 'team', bots: 3 }))?.t).toBe('updateRoom');
    expect(parseControlMessage(JSON.stringify({ t: 'chatSend', text: 'cześć' }))?.t).toBe('chatSend');
    expect(parseControlMessage(JSON.stringify({ t: 'chat', id: 1, nick: 'As', text: 'hej' }))?.t).toBe('chat');
  });

  it('zwraca null dla nie-JSON i nieznanego typu', () => {
    expect(parseControlMessage('ping')).toBeNull();
    expect(parseControlMessage(JSON.stringify({ t: 'cokolwiek' }))).toBeNull();
  });
});

describe('sanitizeNick', () => {
  it('przepuszcza litery, cyfry i bezpieczne znaki, w tym diakrytyki', () => {
    expect(sanitizeNick('Błękitny_1')).toBe('Błękitny_1');
    expect(sanitizeNick('  Ace  Pilot ')).toBe('Ace Pilot');
  });

  it('usuwa HTML/znaki spoza whitelisty (ochrona przed XSS)', () => {
    expect(sanitizeNick('<b>Ace</b>')).toBe('bAceb');
    expect(sanitizeNick('a<b>c&d')).toBe('abcd');
    expect(sanitizeNick('"><img>')).toBe('img');
  });

  it('przycina do MAX_NICK_LENGTH i daje fallback dla pustego', () => {
    expect(sanitizeNick('x'.repeat(40))).toHaveLength(MAX_NICK_LENGTH);
    expect(sanitizeNick('')).toBe('Pilot');
    expect(sanitizeNick('<<<>>>')).toBe('Pilot');
    expect(sanitizeNick(42)).toBe('Pilot');
  });
});

describe('sanitizeChat', () => {
  it('przepuszcza zwykły tekst, interpunkcję i diakrytyki; zwija białe znaki', () => {
    expect(sanitizeChat('Cześć! Lecimy? :)')).toBe('Cześć! Lecimy? :)');
    expect(sanitizeChat('  dużo   spacji  ')).toBe('dużo spacji');
  });

  it('wycina znaki sterujące i nowe linie (bez wstrzykiwania wielu linii)', () => {
    expect(sanitizeChat('a\nb\tc')).toBe('abc');
    expect(sanitizeChat('x y')).toBe('xy'); // ↑ znak między x a y to znak sterujący (usuwany)
  });

  it('NIE jest źródłem ochrony XSS (znaki HTML zostają — render robi textContent)', () => {
    // celowo: whitelist nie wycina <>&, bo bezpieczeństwo zapewnia textContent po stronie UI
    expect(sanitizeChat('<b>hej</b>')).toBe('<b>hej</b>');
  });

  it('przycina do MAX_CHAT_LENGTH i daje pusty łańcuch dla śmieci', () => {
    expect(sanitizeChat('x'.repeat(500)).length).toBeLessThanOrEqual(MAX_CHAT_LENGTH);
    expect(sanitizeChat('   ')).toBe('');
    expect(sanitizeChat(42)).toBe('');
    expect(sanitizeChat(null)).toBe('');
  });
});

describe('isValidRoomCode', () => {
  it('akceptuje kody z alfabetu o właściwej długości', () => {
    expect(isValidRoomCode('ABCD')).toBe(true);
    expect(isValidRoomCode('Z239')).toBe(true);
  });

  it('odrzuca złą długość, małe litery i znaki spoza alfabetu (O/0/I/1)', () => {
    expect(isValidRoomCode('ABC')).toBe(false);
    expect(isValidRoomCode('abcd')).toBe(false);
    expect(isValidRoomCode('AO0I')).toBe(false);
    expect(isValidRoomCode('AB1D')).toBe(false);
    expect(isValidRoomCode(null)).toBe(false);
  });
});
