import { PORT } from '@air-combat/shared';

const PING_INTERVAL_MS = 1000;
const RECONNECT_DELAY_MS = 2000;

/** Pętla ping/pong z serwerem + licznik RTT w przekazanym elemencie. */
export function connectNetStatus(statusEl: HTMLElement): void {
  function connect(): void {
    const ws = new WebSocket(`ws://localhost:${PORT}`);
    let pingSentAt = 0;
    let pingTimer: ReturnType<typeof setInterval> | undefined;

    ws.addEventListener('open', () => {
      statusEl.textContent = 'połączono, czekam na pong…';
      const sendPing = (): void => {
        pingSentAt = performance.now();
        ws.send('ping');
      };
      sendPing();
      pingTimer = setInterval(sendPing, PING_INTERVAL_MS);
    });

    ws.addEventListener('message', (event) => {
      if (event.data === 'pong') {
        const rtt = Math.round(performance.now() - pingSentAt);
        statusEl.textContent = `pong (${rtt} ms)`;
      }
    });

    ws.addEventListener('close', () => {
      clearInterval(pingTimer);
      statusEl.textContent = 'rozłączono — ponawiam…';
      setTimeout(connect, RECONNECT_DELAY_MS);
    });

    ws.addEventListener('error', () => {
      ws.close();
    });
  }
  connect();
}
