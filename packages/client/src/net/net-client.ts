import {
  INPUT_BYTES,
  PROTOCOL_VERSION,
  decodeSnapshot,
  encodeInput,
  parseControlMessage,
  type InputFrame,
  type Snapshot,
} from '@air-combat/shared';
import { defaultNetConditions, rollDelayMs, type NetConditionsConfig } from './net-conditions';

// Klient sieciowy trybu online. Handshake JSON + binarny INPUT/SNAPSHOT (faza 8) PLUS
// (faza 9) wbudowany symulator warunków sieci: opóźnia/odrzuca wychodzące INPUT
// i przychodzące SNAPSHOT wg `conditions`. RTT mierzymy od MOMENTU WYWOŁANIA sendInput
// (przed sztucznym opóźnieniem) do przetworzenia acka — dzięki temu ping w overlay
// odzwierciedla symulowany lag. Zdekodowane snapshoty trafiają do `onSnapshot`
// (predykcja + interpolacja); `latestSnapshot` trzyma najnowszy po serverTick (HUD).

export type NetStatus = 'connecting' | 'handshaking' | 'online' | 'error' | 'closed';

export class NetClient {
  status: NetStatus = 'connecting';
  /** Czytelny komunikat dla statusu 'error'/'closed' (np. niezgodna wersja). */
  statusMessage = '';
  localPlayerId: number | null = null;
  rttMs = 0;
  latestSnapshot: Snapshot | undefined;
  /** Symulator warunków sieci (dev) — mutowany przez panel; domyślnie wyłączony. */
  readonly conditions: NetConditionsConfig = defaultNetConditions();
  /** Wywoływane dla KAŻDEGO zdekodowanego snapshotu (po symulowanym opóźnieniu). */
  onSnapshot: ((snap: Snapshot) => void) | undefined;

  private readonly ws: WebSocket;
  private readonly inputBuf = new Uint8Array(INPUT_BYTES);
  private readonly inputView = new DataView(this.inputBuf.buffer);
  /** seq → moment wysłania [performance.now ms] — do pomiaru RTT po acku. */
  private readonly sentTimes = new Map<number, number>();

  constructor(
    url: string,
    private readonly nick = 'pilot',
  ) {
    this.ws = new WebSocket(url);
    this.ws.binaryType = 'arraybuffer';

    this.ws.addEventListener('open', () => {
      this.status = 'handshaking';
      this.ws.send(JSON.stringify({ t: 'hello', v: PROTOCOL_VERSION, nick: this.nick }));
    });
    this.ws.addEventListener('message', (event: MessageEvent) => this.onMessage(event));
    this.ws.addEventListener('error', () => {
      if (this.status !== 'error') {
        this.status = 'error';
        this.statusMessage = 'błąd połączenia z serwerem';
      }
    });
    this.ws.addEventListener('close', () => {
      // 'error' (np. odrzucona wersja) ma pierwszeństwo nad zwykłym 'closed'
      if (this.status !== 'error') {
        this.status = 'closed';
        if (!this.statusMessage) this.statusMessage = 'połączenie zamknięte';
      }
    });
  }

  private onMessage(event: MessageEvent): void {
    const data: unknown = event.data;
    if (typeof data === 'string') {
      this.onControl(data);
      return;
    }
    if (data instanceof ArrayBuffer) {
      // symulator RX: opóźnij/odrzuć przychodzący snapshot (każda ramka to świeży
      // ArrayBuffer z ws — można go bezpiecznie przetrzymać do dekodowania po delayu)
      const delay = rollDelayMs(this.conditions);
      if (delay === null) return; // zgubiony snapshot (symulacja) — gap złapie metryka
      if (delay <= 0) this.handleSnapshot(data);
      else setTimeout(() => this.handleSnapshot(data), delay);
    }
  }

  private onControl(text: string): void {
    const msg = parseControlMessage(text);
    if (!msg) return;
    if (msg.t === 'welcome') {
      this.localPlayerId = msg.playerId;
      this.status = 'online';
    } else if (msg.t === 'error') {
      this.status = 'error';
      this.statusMessage = msg.message;
    }
  }

  private handleSnapshot(buffer: ArrayBuffer): void {
    let snap: Snapshot;
    try {
      snap = decodeSnapshot(new DataView(buffer));
    } catch {
      return; // uszkodzony snapshot — pomiń klatkę
    }
    // RTT z acka liczony zawsze (nawet dla snapshotu, który po reorderingu jest starszy)
    const sentAt = this.sentTimes.get(snap.ackSeq);
    if (sentAt !== undefined) {
      this.rttMs = Math.round(performance.now() - sentAt);
      for (const seq of this.sentTimes.keys()) {
        if (seq <= snap.ackSeq) this.sentTimes.delete(seq);
      }
    }
    // predykcja/interpolacja dostają KAŻDY snapshot (interpolator sam sortuje po ticku)
    this.onSnapshot?.(snap);
    // latestSnapshot = najnowszy po serverTick (jitter może dostarczyć starszy później)
    if (!this.latestSnapshot || tickNewer(snap.serverTick, this.latestSnapshot.serverTick)) {
      this.latestSnapshot = snap;
    }
  }

  /** Wysyła ramkę INPUT (symulator TX: opóźnia/odrzuca). No-op poza 'online'. */
  sendInput(frame: InputFrame): void {
    if (this.status !== 'online' || this.ws.readyState !== WebSocket.OPEN) return;
    // znacznik czasu wysyłki PRZED symulowanym opóźnieniem → RTT obejmuje lag TX i RX
    this.sentTimes.set(frame.sequence, performance.now());
    const delay = rollDelayMs(this.conditions);
    if (delay === null) return; // zgubiony input (symulacja) — serwer go nie potwierdzi
    if (delay <= 0) {
      encodeInput(this.inputView, frame);
      this.ws.send(this.inputBuf);
      return;
    }
    // opóźnienie: kopiujemy bajty (współdzielony bufor zostałby nadpisany przed wysłaniem)
    const copy = new Uint8Array(INPUT_BYTES);
    encodeInput(new DataView(copy.buffer), frame);
    setTimeout(() => {
      if (this.ws.readyState === WebSocket.OPEN) this.ws.send(copy);
    }, delay);
  }

  close(): void {
    this.ws.close();
  }
}

/** Czy tick `a` jest nowszy od `b` przy zawijaniu u32 (różnica w połówce zakresu). */
function tickNewer(a: number, b: number): boolean {
  return ((a - b) >>> 0) < 0x80000000 && a !== b;
}

/** Domyślny URL serwera gry: ten sam host co strona, port WS serwera (dev). */
export function defaultServerUrl(port: number): string {
  const override = new URLSearchParams(location.search).get('server');
  if (override) return override;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.hostname}:${String(port)}`;
}
