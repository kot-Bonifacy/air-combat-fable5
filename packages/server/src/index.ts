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

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    log.info({ signal }, 'zamykanie serwera');
    void server.close().then(() => process.exit(0));
  });
}
