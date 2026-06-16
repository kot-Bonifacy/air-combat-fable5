import { afterEach, describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { WebSocket } from 'ws';
import {
  INPUT_BYTES,
  PROTOCOL_VERSION,
  decodeSnapshot,
  encodeInput,
  parseControlMessage,
  type ControlMessage,
  type EntitySnapshot,
  type InputFrame,
  type RoomJoinedMessage,
  type Snapshot,
  type WelcomeMessage,
} from '@air-combat/shared';
import { createGameServer, type GameServer } from './server';
import type { Logger } from './connection';

// Test integracyjny faz 8–10: serwer w procesie testowym + realny klient `ws`.
// Pełny przepływ lobby (hello → welcome → createRoom → startMatch → gra), że samolot
// symulowany na serwerze reaguje na input, oraz że spreparowane pakiety są odrzucane
// bez wywracania serwera. Reconnect i sprzątanie pokoi sprawdzają testy jednostkowe lobby.

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

/** Klient testowy: bufor wiadomości kontrolnych + najnowszy snapshot. */
class TestClient {
  readonly ws: WebSocket;
  private readonly control: ControlMessage[] = [];
  latestSnapshot: Snapshot | undefined;

  constructor(port: number) {
    this.ws = new WebSocket(`ws://localhost:${port}`);
    this.ws.binaryType = 'arraybuffer';
    clients.push(this.ws);
    this.ws.on('message', (data, isBinary) => {
      if (isBinary) {
        this.latestSnapshot = decodeSnapshot(new DataView(data as ArrayBuffer));
        return;
      }
      const msg = parseControlMessage(data.toString());
      if (msg) this.control.push(msg);
    });
  }

  open(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws.once('open', () => resolve());
      this.ws.once('error', reject);
    });
  }

  send(msg: Record<string, unknown>): void {
    this.ws.send(JSON.stringify(msg));
  }

  sendInput(frame: InputFrame): void {
    const buf = new Uint8Array(INPUT_BYTES);
    encodeInput(new DataView(buf.buffer), frame);
    this.ws.send(buf);
  }

  /** Czeka na pierwszą wiadomość kontrolną danego typu (od początku bufora). */
  async waitControl<T extends ControlMessage['t']>(t: T): Promise<Extract<ControlMessage, { t: T }>> {
    for (let i = 0; i < 200; i++) {
      const hit = this.control.find((m) => m.t === t);
      if (hit) return hit as Extract<ControlMessage, { t: T }>;
      await sleep(10);
    }
    throw new Error(`brak wiadomości '${t}' w czasie`);
  }

  /** Pełna sekwencja do gry: hello → welcome → createRoom → roomJoined → startMatch → matchStarted. */
  async hostMatch(nick = 'tester'): Promise<{ welcome: WelcomeMessage; joined: RoomJoinedMessage }> {
    this.send({ t: 'hello', v: PROTOCOL_VERSION, nick });
    const welcome = await this.waitControl('welcome');
    this.send({ t: 'createRoom' });
    const joined = await this.waitControl('roomJoined');
    this.send({ t: 'startMatch' });
    await this.waitControl('matchStarted');
    return { welcome, joined };
  }
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

function localEntity(snap: Snapshot | undefined): EntitySnapshot | undefined {
  return snap?.entities.find((e) => e.isLocal);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

describe('integracja klient↔serwer (faza 10: lobby + gra)', () => {
  it('handshake: poprawna wersja → welcome z tokenem sesji', async () => {
    const port = await startServer();
    const client = new TestClient(port);
    await client.open();
    client.send({ t: 'hello', v: PROTOCOL_VERSION, nick: 'tester' });
    const msg = await client.waitControl('welcome');
    expect(msg.t).toBe('welcome');
    expect(typeof msg.sessionToken).toBe('string');
    expect(msg.sessionToken.length).toBeGreaterThan(0);
    expect(msg.protocolVersion).toBe(PROTOCOL_VERSION);
  });

  it('niezgodna wersja → error i zamknięcie połączenia', async () => {
    const port = await startServer();
    const client = new TestClient(port);
    await client.open();
    client.send({ t: 'hello', v: PROTOCOL_VERSION + 99 });
    const msg = await client.waitControl('error');
    expect(msg.code).toBe('version');
  });

  it('createRoom → roomJoined z kodem i youId; host startuje mecz', async () => {
    const port = await startServer();
    const client = new TestClient(port);
    await client.open();
    const { joined } = await client.hostMatch();
    expect(joined.code).toHaveLength(4);
    expect(joined.youId).toBe(0);
    expect(joined.hostId).toBe(0);
  });

  it('klient lata samolotem symulowanym na serwerze (reaguje na input)', async () => {
    const port = await startServer();
    const client = new TestClient(port);
    await client.open();
    await client.hostMatch();

    // ~1 s pełnego ciągnięcia steru w górę, 60 ramek/s
    for (let seq = 1; seq <= 60; seq++) {
      client.sendInput(makeInput({ sequence: seq, pitchUp: 1, throttle: 1 }));
      await sleep(16);
    }
    await sleep(60); // domknij ostatnie snapshoty

    const me = localEntity(client.latestSnapshot);
    expect(me).toBeDefined();
    expect(client.latestSnapshot!.ackSeq).toBeGreaterThan(0); // serwer potwierdza inputy
    // pull-up: nos zadarty → składowa „w górę" wektora czołowego dodatnia
    const fwd = new Vector3(0, 0, 1).applyQuaternion(me!.orientation);
    expect(fwd.y).toBeGreaterThan(0.1);
  });

  it('spreparowane pakiety (zły rozmiar) odrzucone, serwer żyje i nadal symuluje', async () => {
    const port = await startServer();
    const client = new TestClient(port);
    await client.open();
    await client.hostMatch();

    // śmieci: za krótka ramka, potem zerowy wektor celu (zdegenerowany), potem poprawne inputy
    client.ws.send(new Uint8Array(5));
    client.ws.send(new Uint8Array(INPUT_BYTES)); // tag/typ = 0, aim = 0 → odrzucony przez walidację
    for (let seq = 1; seq <= 40; seq++) {
      client.sendInput(makeInput({ sequence: seq, pitchUp: 1 }));
      await sleep(16);
    }
    await sleep(60);

    const me = localEntity(client.latestSnapshot);
    expect(me).toBeDefined(); // serwer żyje i dalej śle snapshoty
    expect(client.latestSnapshot!.ackSeq).toBeGreaterThan(0); // poprawne inputy po śmieciach przeszły
  });

  it('rozłączenie klienta trzyma slot na reconnect, ale lobby nie wycieka', async () => {
    const port = await startServer();
    const client = new TestClient(port);
    await client.open();
    await client.hostMatch();
    await sleep(30);
    expect(server!.lobby.roomCount).toBe(1);

    client.ws.close();
    // slot trzymany na reconnect (okno 60 s) — pokój NIE znika natychmiast
    await sleep(50);
    expect(server!.lobby.roomCount).toBe(1);
  });
});
