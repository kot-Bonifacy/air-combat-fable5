import type { AddressInfo } from 'node:net';
import { WebSocketServer } from 'ws';
import {
  FIXED_DT_S,
  FixedStepLoop,
  MAX_PLAYERS_PER_ROOM,
  PHYSICS_HZ,
  SNAPSHOT_HZ,
  snapshotByteLength,
} from '@air-combat/shared';
import { Connection, type Logger } from './connection';
import { Lobby } from './lobby';

// Złożenie serwera: WebSocketServer + lobby (rejestr pokoi) + pętla czasu. Pętla 60 Hz
// kroczy fizyką KAŻDEGO pokoju w stanie 'playing' (stały krok przez FixedStepLoop —
// setInterval na 60 Hz dryfuje, pułapka faza-08.md), wysyłka snapshotów 30 Hz per pokój.
// Operacje lobby (join/leave/start) idą osobną, tekstową ścieżką w Connection i NIE
// blokują pętli fizyki (pułapka faza-10.md).

export interface GameServerOptions {
  log?: Logger;
  seed?: number;
}

export interface GameServer {
  readonly wss: WebSocketServer;
  readonly lobby: Lobby;
  /** Rozwiązuje się rzeczywistym portem nasłuchu (przydatne przy port=0 w testach). */
  readonly ready: Promise<number>;
  close(): Promise<void>;
}

const SNAPSHOT_INTERVAL_S = 1 / SNAPSHOT_HZ;
/** Bufor snapshotu mieści maksymalny pokój (zero alokacji per tick). */
const SNAPSHOT_CAPACITY = MAX_PLAYERS_PER_ROOM;

const consoleLogger: Logger = {
  info: (...a) => console.info(...a),
  warn: (...a) => console.warn(...a),
  error: (...a) => console.error(...a),
};

export function createGameServer(port: number, options: GameServerOptions = {}): GameServer {
  const log = options.log ?? consoleLogger;
  const lobby = new Lobby(options.seed, (msg) => log.error({ ctx: 'room' }, msg));
  const wss = new WebSocketServer({ port });

  wss.on('connection', (socket, request) => {
    const remote = request.socket.remoteAddress ?? '?';
    new Connection(socket, lobby, log, remote);
  });

  const snapshotScratch = new Uint8Array(snapshotByteLength(SNAPSHOT_CAPACITY));
  const loop = new FixedStepLoop(FIXED_DT_S, (dtS) => {
    for (const room of lobby.allRooms()) room.step(dtS);
  });
  let lastMs = performance.now();
  let snapshotAccumS = 0;

  // timer celuje w krok fizyki; FixedStepLoop dogania/wyrównuje realnym czasem
  const timer = setInterval(() => {
    const now = performance.now();
    const frameDtS = (now - lastMs) / 1000;
    lastMs = now;

    loop.advance(frameDtS);
    lobby.maintain(Date.now());

    snapshotAccumS += frameDtS;
    if (snapshotAccumS >= SNAPSHOT_INTERVAL_S) {
      // nie kumuluj zaległości snapshotów (po przestoju wyślij jeden, nie serię)
      snapshotAccumS %= SNAPSHOT_INTERVAL_S;
      for (const room of lobby.allRooms()) room.sendSnapshots(snapshotScratch);
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
    lobby,
    ready,
    close: () =>
      new Promise<void>((resolve) => {
        clearInterval(timer);
        for (const client of wss.clients) client.terminate();
        wss.close(() => resolve());
      }),
  };
}
