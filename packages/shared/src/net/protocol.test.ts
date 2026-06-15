import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { NetError } from '../errors';
import { createPlaneState, type PlaneState } from '../physics/state';
import {
  INPUT_BYTES,
  MSG_INPUT,
  MSG_SNAPSHOT,
  PROTOCOL_VERSION,
  VELOCITY_QUANT_RANGE_MS,
  decodeInput,
  decodeSnapshot,
  encodeInputToBytes,
  encodeSnapshot,
  lifePhaseFromCode,
  lifePhaseToCode,
  parseControlMessage,
  snapshotByteLength,
  validateInputFrame,
  type InputFrame,
  type SnapshotEntitySource,
} from './protocol';

function makeInput(over: Partial<InputFrame> = {}): InputFrame {
  return {
    sequence: 12345,
    clientTimeMs: 6789,
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
    expect(out.clientTimeMs).toBe(6789);
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

function makeEntity(id: number, over: Partial<PlaneState> = {}): SnapshotEntitySource {
  const state = createPlaneState();
  state.position.set(1234.5, 678.25, -9000.75);
  state.orientation.set(0.1, 0.2, 0.3, 0.9).normalize();
  state.velocity.set(120, -5, 30);
  state.throttle = 0.8;
  return { id, state: Object.assign(state, over) };
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

describe('kody fazy życia', () => {
  it('round-trip wszystkich faz', () => {
    for (const phase of ['alive', 'dying', 'dead', 'respawning'] as const) {
      expect(lifePhaseFromCode(lifePhaseToCode(phase))).toBe(phase);
    }
  });
});

describe('wiadomości kontrolne (JSON)', () => {
  it('parsuje hello/welcome/error/event', () => {
    expect(parseControlMessage(JSON.stringify({ t: 'hello', v: PROTOCOL_VERSION }))?.t).toBe('hello');
    expect(parseControlMessage(JSON.stringify({ t: 'welcome', playerId: 2 }))?.t).toBe('welcome');
    expect(parseControlMessage(JSON.stringify({ t: 'error', code: 'version' }))?.t).toBe('error');
  });

  it('zwraca null dla nie-JSON i nieznanego typu', () => {
    expect(parseControlMessage('ping')).toBeNull();
    expect(parseControlMessage(JSON.stringify({ t: 'cokolwiek' }))).toBeNull();
  });
});
