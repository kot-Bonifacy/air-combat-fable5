import type { AddressInfo } from 'node:net';
import { WebSocketServer } from 'ws';
import {
  FIXED_DT_S,
  FixedStepLoop,
  PHYSICS_HZ,
  SNAPSHOT_HZ,
  snapshotByteLength,
} from '@air-combat/shared';
import { Connection, type Logger } from './connection';
import { GameRoom } from './game-room';

// Złożenie serwera fazy 8: WebSocketServer + autorytatywny pokój + pętla czasu.
// Pętla 60 Hz (fizyka, stały krok) i wysyłka snapshotów 30 Hz. setInterval na 60 Hz
// dryfuje (pułapka faza-08.md) — krok liczony z RZECZYWISTEGO czasu przez akumulator
// FixedStepLoop (ten sam co w kliencie), a nie z założonego interwału timera.

export interface GameServerOptions {
  log?: Logger;
  seed?: number;
}

export interface GameServer {
  readonly wss: WebSocketServer;
  readonly room: GameRoom;
  /** Rozwiązuje się rzeczywistym portem nasłuchu (przydatne przy port=0 w testach). */
  readonly ready: Promise<number>;
  close(): Promise<void>;
}

const SNAPSHOT_INTERVAL_S = 1 / SNAPSHOT_HZ;
/** Co ile sekund logować rozmiar snapshotu (benchmark pasma — kryterium fazy 8). */
const SNAPSHOT_LOG_INTERVAL_S = 5;
/** Zapas encji w buforze snapshotu (8 graczy fazy 8 + margines). */
const SNAPSHOT_CAPACITY = 32;

const consoleLogger: Logger = {
  info: (...a) => console.info(...a),
  warn: (...a) => console.warn(...a),
  error: (...a) => console.error(...a),
};

export function createGameServer(port: number, options: GameServerOptions = {}): GameServer {
  const log = options.log ?? consoleLogger;
  const room = new GameRoom(options.seed, (msg) => log.error({ ctx: 'room' }, msg));
  const wss = new WebSocketServer({ port });
  const connections = new Set<Connection>();

  wss.on('connection', (socket, request) => {
    const remote = request.socket.remoteAddress ?? '?';
    const conn = new Connection(socket, room, log, remote);
    connections.add(conn);
    socket.on('close', () => connections.delete(conn));
  });

  const snapshotScratch = new Uint8Array(snapshotByteLength(SNAPSHOT_CAPACITY));
  const loop = new FixedStepLoop(FIXED_DT_S, (dtS) => room.step(dtS));
  let lastMs = performance.now();
  let snapshotAccumS = 0;
  let logAccumS = 0;

  // timer celuje w krok fizyki; FixedStepLoop dogania/wyrównuje realnym czasem
  const timer = setInterval(() => {
    const now = performance.now();
    const frameDtS = (now - lastMs) / 1000;
    lastMs = now;

    loop.advance(frameDtS);

    snapshotAccumS += frameDtS;
    if (snapshotAccumS >= SNAPSHOT_INTERVAL_S) {
      // nie kumuluj zaległości snapshotów (po przestoju wyślij jeden, nie serię)
      snapshotAccumS %= SNAPSHOT_INTERVAL_S;
      for (const conn of connections) conn.sendSnapshot(snapshotScratch);

      logAccumS += SNAPSHOT_INTERVAL_S;
      if (logAccumS >= SNAPSHOT_LOG_INTERVAL_S && room.playerCount > 0) {
        logAccumS = 0;
        const count = room.snapshotEntities().length;
        const bytes = snapshotByteLength(count);
        log.info(
          { entities: count, bytes, bytesPerSec: bytes * SNAPSHOT_HZ },
          'rozmiar snapshotu (benchmark pasma)',
        );
      }
    }
  }, 1000 / PHYSICS_HZ);
  // pętla czasu serwera nie powinna trzymać procesu przy życiu sama z siebie (test cleanup)
  timer.unref?.();

  const ready = new Promise<number>((resolve, reject) => {
    wss.on('listening', () => resolve((wss.address() as AddressInfo).port));
    wss.on('error', reject);
  });

  return {
    wss,
    room,
    ready,
    close: () =>
      new Promise<void>((resolve) => {
        clearInterval(timer);
        for (const client of wss.clients) client.terminate();
        wss.close(() => resolve());
      }),
  };
}
