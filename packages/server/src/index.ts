import { WebSocketServer } from 'ws';
import { pino } from 'pino';
import { PORT } from '@air-combat/shared';

const log = pino({ level: process.env.LOG_LEVEL ?? 'info' });

const wss = new WebSocketServer({ port: PORT });

wss.on('listening', () => {
  log.info({ port: PORT }, 'serwer WS nasłuchuje');
});

wss.on('connection', (socket, request) => {
  const remote = request.socket.remoteAddress;
  log.info({ remote }, 'klient połączony');

  socket.on('message', (data, isBinary) => {
    if (isBinary) {
      log.warn({ remote }, 'odrzucono ramkę binarną (protokół binarny od fazy 8)');
      return;
    }
    const text = data.toString();
    if (text === 'ping') {
      socket.send('pong');
    } else {
      log.warn({ remote, text: text.slice(0, 64) }, 'nieznana wiadomość');
    }
  });

  socket.on('close', () => {
    log.info({ remote }, 'klient rozłączony');
  });

  socket.on('error', (err) => {
    log.error({ remote, err }, 'błąd socketu');
  });
});
