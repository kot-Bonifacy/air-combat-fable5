import {
  INPUT_BYTES,
  PROTOCOL_VERSION,
  decodeSnapshot,
  encodeInput,
  parseControlMessage,
  type InputFrame,
  type Snapshot,
} from '@air-combat/shared';

// Klient sieciowy trybu online (faza 8): handshake JSON + binarny INPUT/SNAPSHOT.
// CELOWO bez predykcji i interpolacji — renderujemy najświeższy snapshot „surowo",
// input ma widoczne opóźnienie (to naprawia faza 9). RTT mierzymy z acka: serwer
// odsyła ostatnią przetworzoną sekwencję, a my znamy moment jej wysłania.

export type NetStatus = 'connecting' | 'handshaking' | 'online' | 'error' | 'closed';

export class NetClient {
  status: NetStatus = 'connecting';
  /** Czytelny komunikat dla statusu 'error'/'closed' (np. niezgodna wersja). */
  statusMessage = '';
  localPlayerId: number | null = null;
  rttMs = 0;
  latestSnapshot: Snapshot | undefined;

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
      this.onSnapshot(data);
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

  private onSnapshot(buffer: ArrayBuffer): void {
    let snap: Snapshot;
    try {
      snap = decodeSnapshot(new DataView(buffer));
    } catch {
      return; // uszkodzony snapshot — pomiń klatkę
    }
    this.latestSnapshot = snap;
    const sentAt = this.sentTimes.get(snap.ackSeq);
    if (sentAt !== undefined) {
      this.rttMs = Math.round(performance.now() - sentAt);
      // sprzątnij potwierdzone (i starsze) wpisy — mapa nie rośnie bez końca
      for (const seq of this.sentTimes.keys()) {
        if (seq <= snap.ackSeq) this.sentTimes.delete(seq);
      }
    }
  }

  /** Wysyła ramkę INPUT (zero alokacji — współdzielony bufor). No-op poza 'online'. */
  sendInput(frame: InputFrame): void {
    if (this.status !== 'online' || this.ws.readyState !== WebSocket.OPEN) return;
    encodeInput(this.inputView, frame);
    this.ws.send(this.inputBuf);
    this.sentTimes.set(frame.sequence, performance.now());
  }

  close(): void {
    this.ws.close();
  }
}

/** Domyślny URL serwera gry: ten sam host co strona, port WS serwera (dev). */
export function defaultServerUrl(port: number): string {
  const override = new URLSearchParams(location.search).get('server');
  if (override) return override;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.hostname}:${String(port)}`;
}
