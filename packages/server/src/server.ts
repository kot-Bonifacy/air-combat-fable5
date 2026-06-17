import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocketServer } from 'ws';
import {
  FIXED_DT_S,
  FixedStepLoop,
  MAX_PLAYERS_PER_ROOM,
  PHYSICS_HZ,
  SNAPSHOT_HZ,
  STANDINGS_BROADCAST_HZ,
  snapshotByteLength,
  type ServerShutdownMessage,
} from '@air-combat/shared';
import { Connection, type Logger } from './connection';
import { Lobby } from './lobby';

// Złożenie serwera: serwer HTTP (healthcheck /health) z zamontowanym WebSocketServer +
// lobby (rejestr pokoi) + pętla czasu. Pętla 60 Hz kroczy fizyką KAŻDEGO pokoju w stanie
// 'playing' (stały krok przez FixedStepLoop — setInterval na 60 Hz dryfuje, pułapka
// faza-08.md), wysyłka snapshotów 30 Hz per pokój, tabela wyników STANDINGS_BROADCAST_HZ.
// Faza 13: HTTP /health dla healthchecku kontenera (deploy), graceful shutdown
// (notifyShutdown: powiadom graczy + zapis logu meczu do konsoli przed zamknięciem).
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
  /** Graceful shutdown: powiadom graczy i zapisz log meczu (konsola) PRZED zamknięciem. */
  notifyShutdown(): void;
  close(): Promise<void>;
}

const SNAPSHOT_INTERVAL_S = 1 / SNAPSHOT_HZ;
const STANDINGS_INTERVAL_S = 1 / STANDINGS_BROADCAST_HZ;
/** Bufor snapshotu mieści maksymalny pokój (zero alokacji per tick). */
const SNAPSHOT_CAPACITY = MAX_PLAYERS_PER_ROOM;

const SHUTDOWN_MESSAGE = 'Serwer jest restartowany — odśwież stronę za chwilę.';

const consoleLogger: Logger = {
  info: (...a) => console.info(...a),
  warn: (...a) => console.warn(...a),
  error: (...a) => console.error(...a),
};

export function createGameServer(port: number, options: GameServerOptions = {}): GameServer {
  const log = options.log ?? consoleLogger;
  const lobby = new Lobby(
    options.seed,
    (msg) => log.error({ ctx: 'room' }, msg),
    (msg) => log.info({ ctx: 'room' }, msg),
  );

  // HTTP tylko dla healthchecku; cała gra leci po WebSocket zamontowanym na tym serwerze.
  const httpServer = createServer(handleHttp);
  const wss = new WebSocketServer({ server: httpServer });

  // rejestr żywych połączeń — potrzebny do rozgłoszenia komunikatu o zamknięciu (faza 13)
  const connections = new Set<Connection>();

  wss.on('connection', (socket, request) => {
    const remote = request.socket.remoteAddress ?? '?';
    const conn = new Connection(socket, lobby, log, remote);
    connections.add(conn);
    socket.on('close', () => connections.delete(conn));
  });

  const snapshotScratch = new Uint8Array(snapshotByteLength(SNAPSHOT_CAPACITY));
  const loop = new FixedStepLoop(FIXED_DT_S, (dtS) => {
    for (const room of lobby.allRooms()) room.step(dtS);
  });
  let lastMs = performance.now();
  let snapshotAccumS = 0;
  let standingsAccumS = 0;

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

    standingsAccumS += frameDtS;
    if (standingsAccumS >= STANDINGS_INTERVAL_S) {
      standingsAccumS %= STANDINGS_INTERVAL_S;
      for (const room of lobby.allRooms()) room.broadcastStandings();
    }
  }, 1000 / PHYSICS_HZ);
  // pętla czasu serwera nie powinna trzymać procesu przy życiu sama z siebie (test cleanup)
  timer.unref?.();

  const ready = new Promise<number>((resolve, reject) => {
    httpServer.on('listening', () => resolve((httpServer.address() as AddressInfo).port));
    httpServer.on('error', reject);
    httpServer.listen(port);
  });

  function notifyShutdown(): void {
    // log meczu z każdego pokoju w grze/po meczu (brak DB — log do konsoli, faza-13.md)
    for (const room of lobby.allRooms()) {
      if (room.state === 'playing' || room.state === 'ended') {
        const standings = room.buildStandings().map((r) => ({ nick: r.nick, kills: r.kills, deaths: r.deaths }));
        log.info({ code: room.code, standings }, 'log meczu przy zamknięciu serwera');
      }
    }
    const msg: ServerShutdownMessage = { t: 'serverShutdown', message: SHUTDOWN_MESSAGE };
    for (const conn of connections) conn.sendControl(msg);
  }

  return {
    wss,
    lobby,
    ready,
    notifyShutdown,
    close: () =>
      new Promise<void>((resolve) => {
        clearInterval(timer);
        for (const client of wss.clients) client.terminate();
        wss.close(() => httpServer.close(() => resolve()));
      }),
  };
}

/** Obsługa zwykłych żądań HTTP: tylko healthcheck /health (reszta 404). */
function handleHttp(req: IncomingMessage, res: ServerResponse): void {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('ok');
    return;
  }
  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('not found');
}
