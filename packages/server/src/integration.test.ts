import { afterEach, describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { WebSocket } from 'ws';
import {
  INPUT_BYTES,
  PROTOCOL_VERSION,
  decodeSnapshot,
  encodeInput,
  parseControlMessage,
  type EntitySnapshot,
  type InputFrame,
  type Snapshot,
  type WelcomeMessage,
} from '@air-combat/shared';
import { createGameServer, type GameServer } from './server';
import type { Logger } from './connection';

// Test integracyjny fazy 8: serwer w procesie testowym + realny klient `ws`.
// Sprawdza handshake, że samolot symulowany na serwerze reaguje na input,
// oraz że spreparowane pakiety są odrzucane bez wywracania serwera.

const silentLog: Logger = { info: () => {}, warn: () => {}, error: () => {} };

let server: GameServer | undefined;
const clients: WebSocket[] = [];

afterEach(async () => {
  for (const c of clients) c.close();
  clients.length = 0;
  await server?.close();
  server = undefined;
});

async function startServer(): Promise<number> {
  server = createGameServer(0, { log: silentLog });
  return server.ready;
}

function openClient(port: number): WebSocket {
  const ws = new WebSocket(`ws://localhost:${port}`);
  ws.binaryType = 'arraybuffer';
  clients.push(ws);
  return ws;
}

function waitOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });
}

/** Czeka na pierwszą wiadomość tekstową (handshake). */
function waitText(ws: WebSocket): Promise<string> {
  return new Promise((resolve) => {
    ws.on('message', function onMsg(data, isBinary) {
      if (isBinary) return;
      ws.off('message', onMsg);
      resolve(data.toString());
    });
  });
}

function makeInput(over: Partial<InputFrame>): InputFrame {
  return {
    sequence: 1,
    clientTimeMs: Date.now() >>> 0,
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

function sendInput(ws: WebSocket, frame: InputFrame): void {
  const buf = new Uint8Array(INPUT_BYTES);
  encodeInput(new DataView(buf.buffer), frame);
  ws.send(buf);
}

/** Zbiera dekodowane snapshoty do tablicy; zwraca getter najnowszego. */
function collectSnapshots(ws: WebSocket): { latest(): Snapshot | undefined } {
  let latest: Snapshot | undefined;
  ws.on('message', (data, isBinary) => {
    if (!isBinary) return;
    const ab = data as ArrayBuffer;
    latest = decodeSnapshot(new DataView(ab));
  });
  return { latest: () => latest };
}

function localEntity(snap: Snapshot | undefined): EntitySnapshot | undefined {
  return snap?.entities.find((e) => e.isLocal);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

describe('integracja klient↔serwer (faza 8)', () => {
  it('handshake: poprawna wersja → welcome z przydzielonym id', async () => {
    const port = await startServer();
    const ws = openClient(port);
    await waitOpen(ws);
    const reply = waitText(ws);
    ws.send(JSON.stringify({ t: 'hello', v: PROTOCOL_VERSION, nick: 'tester' }));
    const msg = parseControlMessage(await reply) as WelcomeMessage;
    expect(msg.t).toBe('welcome');
    expect(msg.playerId).toBe(0);
    expect(msg.protocolVersion).toBe(PROTOCOL_VERSION);
  });

  it('niezgodna wersja → error i zamknięcie połączenia', async () => {
    const port = await startServer();
    const ws = openClient(port);
    await waitOpen(ws);
    const reply = waitText(ws);
    ws.send(JSON.stringify({ t: 'hello', v: PROTOCOL_VERSION + 99 }));
    const msg = parseControlMessage(await reply);
    expect(msg?.t).toBe('error');
    expect(msg && 'code' in msg ? msg.code : null).toBe('version');
  });

  it('klient lata samolotem symulowanym na serwerze (reaguje na input)', async () => {
    const port = await startServer();
    const ws = openClient(port);
    await waitOpen(ws);
    const reply = waitText(ws);
    ws.send(JSON.stringify({ t: 'hello', v: PROTOCOL_VERSION }));
    await reply;

    const snaps = collectSnapshots(ws);
    // ~1 s pełnego ciągnięcia steru w górę, 60 ramek/s
    for (let seq = 1; seq <= 60; seq++) {
      sendInput(ws, makeInput({ sequence: seq, pitchUp: 1, throttle: 1 }));
      await sleep(16);
    }
    await sleep(60); // domknij ostatnie snapshoty

    const snap = snaps.latest();
    const me = localEntity(snap);
    expect(me).toBeDefined();
    expect(snap!.ackSeq).toBeGreaterThan(0); // serwer potwierdza przetworzone inputy
    // pull-up: nos zadarty → składowa „w górę" wektora czołowego (orientacja * +Z) dodatnia
    const fwd = new Vector3(0, 0, 1).applyQuaternion(me!.orientation);
    expect(fwd.y).toBeGreaterThan(0.1);
  });

  it('spreparowane pakiety (zły rozmiar) odrzucone, serwer żyje i nadal symuluje', async () => {
    const port = await startServer();
    const ws = openClient(port);
    await waitOpen(ws);
    const reply = waitText(ws);
    ws.send(JSON.stringify({ t: 'hello', v: PROTOCOL_VERSION }));
    await reply;

    const snaps = collectSnapshots(ws);
    // śmieci: za krótka ramka, potem zerowy wektor celu (zdegenerowany), potem poprawne inputy
    ws.send(new Uint8Array(5));
    ws.send(new Uint8Array(INPUT_BYTES)); // tag/typ = 0, aim = 0 → odrzucony przez walidację
    for (let seq = 1; seq <= 40; seq++) {
      sendInput(ws, makeInput({ sequence: seq, pitchUp: 1 }));
      await sleep(16);
    }
    await sleep(60);

    const me = localEntity(snaps.latest());
    expect(me).toBeDefined(); // serwer żyje i dalej śle snapshoty
    expect(snaps.latest()!.ackSeq).toBeGreaterThan(0); // poprawne inputy po śmieciach przeszły
  });

  it('rozłączenie klienta sprząta gracza na serwerze', async () => {
    const port = await startServer();
    const ws = openClient(port);
    await waitOpen(ws);
    const reply = waitText(ws);
    ws.send(JSON.stringify({ t: 'hello', v: PROTOCOL_VERSION }));
    await reply;
    await sleep(30);
    expect(server!.room.playerCount).toBe(1);

    ws.close();
    // poczekaj aż serwer obsłuży 'close'
    for (let i = 0; i < 50 && server!.room.playerCount > 0; i++) await sleep(10);
    expect(server!.room.playerCount).toBe(0);
  });
});
