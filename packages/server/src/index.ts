import { pino } from 'pino';
import { PORT } from '@air-combat/shared';
import { createGameServer } from './server';

// Punkt wejścia serwera gry (faza 8): autorytatywna symulacja + protokół binarny.
// Cienki wrapper — całość logiki w server.ts/game-room.ts/connection.ts.

const log = pino({ level: process.env.LOG_LEVEL ?? 'info' });

const server = createGameServer(PORT, { log });

void server.ready.then((port) => {
  log.info({ port }, 'serwer gry nasłuchuje (protokół binarny fazy 8)');
});

// Graceful shutdown (faza 13): powiadom graczy (komunikat zamiast wiecznego spinnera) i
// zapisz log meczu do konsoli, daj chwilę na wysłanie ramek, dopiero zamknij gniazda.
const SHUTDOWN_GRACE_MS = 300;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    log.info({ signal }, 'zamykanie serwera — powiadamiam graczy');
    server.notifyShutdown();
    setTimeout(() => {
      void server.close().then(() => process.exit(0));
    }, SHUTDOWN_GRACE_MS);
  });
}
