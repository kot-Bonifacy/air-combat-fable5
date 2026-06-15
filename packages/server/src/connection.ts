import type { RawData, WebSocket } from 'ws';
import {
  INPUT_BYTES,
  INPUT_HZ,
  PROTOCOL_VERSION,
  SNAPSHOT_HZ,
  PHYSICS_HZ,
  decodeInput,
  encodeSnapshot,
  parseControlMessage,
  validateInputFrame,
  type ErrorMessage,
  type WelcomeMessage,
} from '@air-combat/shared';
import type { GameRoom } from './game-room';

// Jedno połączenie WS (faza 8). Maszyna stanów: handshaking → playing → closed.
// Handshake JSON niesie bajt wersji protokołu; ramki binarne (INPUT) przyjmowane
// dopiero po przyjęciu. Niezmiennik nr 11 (brak zaufania do klienta): każdy pakiet
// walidowany — rozmiar, tag, zakresy wartości, rate limit. Spreparowany pakiet jest
// odrzucany z logiem, połączenie i serwer żyją dalej.

/** Minimalny interfejs loggera (pino spełnia go strukturalnie). */
export interface Logger {
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

/** Sufit liczby ramek INPUT na sekundę zanim zaczniemy je odrzucać (2× INPUT_HZ = zapas na jitter). */
const MAX_INPUTS_PER_SEC = INPUT_HZ * 2;
/** Po tylu odrzuconych pakietach z rzędu rozłączamy uparcie złośliwego klienta. */
const MAX_VIOLATIONS = 240;

type ConnState = 'handshaking' | 'playing' | 'closed';

export class Connection {
  private state: ConnState = 'handshaking';
  private playerId: number | null = null;
  private violations = 0;
  // okno rate-limitu: liczba ramek w bieżącej sekundzie
  private windowStartMs = 0;
  private windowCount = 0;

  constructor(
    private readonly socket: WebSocket,
    private readonly room: GameRoom,
    private readonly log: Logger,
    private readonly remote: string,
  ) {
    socket.on('message', (data: RawData, isBinary: boolean) => {
      try {
        if (isBinary) this.onBinary(data);
        else this.onText(data);
      } catch (err) {
        // żaden pojedynczy pakiet nie może wywrócić obsługi połączenia
        this.log.warn({ remote: this.remote, err: errMsg(err) }, 'błąd obsługi pakietu');
        this.flagViolation();
      }
    });
    socket.on('close', () => this.cleanup());
    socket.on('error', (err: Error) => {
      this.log.warn({ remote: this.remote, err: err.message }, 'błąd socketu');
    });
  }

  get isPlaying(): boolean {
    return this.state === 'playing';
  }

  // --- handshake / tekst ---

  private onText(data: RawData): void {
    const text = data.toString();
    // legacy keepalive wskaźnika net-status w kliencie offline (dev) — dozwolony zawsze
    if (text === 'ping') {
      this.socket.send('pong');
      return;
    }
    const msg = parseControlMessage(text);
    if (!msg || msg.t !== 'hello') {
      this.log.warn({ remote: this.remote }, 'oczekiwano hello, odrzucono ramkę tekstową');
      this.flagViolation();
      return;
    }
    if (this.state !== 'handshaking') return; // powtórny hello — ignoruj
    if (msg.v !== PROTOCOL_VERSION) {
      const err: ErrorMessage = {
        t: 'error',
        code: 'version',
        message: `niezgodna wersja protokołu: serwer ${String(PROTOCOL_VERSION)}, klient ${String(msg.v)}`,
      };
      this.log.warn({ remote: this.remote, clientV: msg.v }, 'odrzucono — niezgodna wersja protokołu');
      this.socket.send(JSON.stringify(err));
      this.socket.close();
      return;
    }
    this.playerId = this.room.addPlayer();
    this.state = 'playing';
    const welcome: WelcomeMessage = {
      t: 'welcome',
      playerId: this.playerId,
      protocolVersion: PROTOCOL_VERSION,
      physicsHz: PHYSICS_HZ,
      snapshotHz: SNAPSHOT_HZ,
    };
    this.socket.send(JSON.stringify(welcome));
    this.log.info({ remote: this.remote, playerId: this.playerId }, 'gracz dołączył');
  }

  // --- ramki binarne (INPUT) ---

  private onBinary(data: RawData): void {
    if (this.state !== 'playing' || this.playerId === null) {
      this.log.warn({ remote: this.remote }, 'ramka binarna przed handshake — odrzucono');
      this.flagViolation();
      return;
    }
    if (!this.allowByRate()) {
      this.log.warn({ remote: this.remote }, 'przekroczony rate limit INPUT — pakiet odrzucony');
      this.flagViolation();
      return;
    }
    const view = toDataView(data);
    if (!view || view.byteLength !== INPUT_BYTES) {
      this.log.warn({ remote: this.remote, bytes: view?.byteLength ?? -1 }, 'INPUT: zły rozmiar — odrzucono');
      this.flagViolation();
      return;
    }
    let frame;
    try {
      frame = decodeInput(view);
    } catch (err) {
      this.log.warn({ remote: this.remote, err: errMsg(err) }, 'INPUT: błąd dekodowania — odrzucono');
      this.flagViolation();
      return;
    }
    const problem = validateInputFrame(frame);
    if (problem) {
      this.log.warn({ remote: this.remote, problem }, 'INPUT: wartości poza zakresem — odrzucono');
      this.flagViolation();
      return;
    }
    this.violations = 0; // poprawny pakiet zeruje licznik nadużyć
    this.room.applyInput(this.playerId, frame);
  }

  /** Token okienkowy: ≤ MAX_INPUTS_PER_SEC ramek na sekundę. */
  private allowByRate(): boolean {
    const now = Date.now();
    if (now - this.windowStartMs >= 1000) {
      this.windowStartMs = now;
      this.windowCount = 0;
    }
    this.windowCount++;
    return this.windowCount <= MAX_INPUTS_PER_SEC;
  }

  private flagViolation(): void {
    if (++this.violations >= MAX_VIOLATIONS) {
      this.log.warn({ remote: this.remote }, 'zbyt wiele nadużyć — rozłączam');
      this.socket.close();
    }
  }

  /**
   * Koduje i wysyła snapshot dla TEGO klienta (ack i flaga „własny" są per-gracz).
   * `scratch` to współdzielony bufor serwera — wysyłamy świeżą kopię (ws może
   * buforować), więc nadpisanie scratcha przez kolejne połączenie jest bezpieczne.
   */
  sendSnapshot(scratch: Uint8Array): void {
    if (this.state !== 'playing' || this.playerId === null) return;
    const len = encodeSnapshot(
      new DataView(scratch.buffer),
      this.room.tick,
      this.room.lastProcessedSeq(this.playerId),
      this.playerId,
      this.room.snapshotEntities(),
    );
    this.socket.send(scratch.slice(0, len));
  }

  private cleanup(): void {
    if (this.state === 'closed') return;
    this.state = 'closed';
    if (this.playerId !== null) {
      this.room.removePlayer(this.playerId);
      this.log.info({ remote: this.remote, playerId: this.playerId }, 'gracz rozłączony');
    }
  }
}

function toDataView(data: RawData): DataView | null {
  if (data instanceof ArrayBuffer) return new DataView(data);
  if (ArrayBuffer.isView(data)) return new DataView(data.buffer, data.byteOffset, data.byteLength);
  return null; // Buffer[] (fragmenty) — nie używamy w protokole binarnym
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
