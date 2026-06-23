import {
  INPUT_BYTES,
  MSG_EVENT,
  PROTOCOL_VERSION,
  decodeEvents,
  decodeSnapshot,
  encodeInput,
  parseControlMessage,
  type ChatMessage,
  type ControlMessage,
  type DifficultyLevel,
  type GameEvent,
  type InputFrame,
  type MatchMode,
  type PlaneType,
  type MatchEndedMessage,
  type RoomJoinedMessage,
  type RoomListMessage,
  type RoomUpdateMessage,
  type ServerShutdownMessage,
  type Snapshot,
  type StandingsMessage,
  type WelcomeMessage,
} from '@air-combat/shared';
import { defaultNetConditions, rollDelayMs, type NetConditionsConfig } from './net-conditions';

// Klient sieciowy trybu online. Transport: handshake JSON + lobby JSON (faza 10) +
// binarny INPUT/SNAPSHOT (faza 8) PLUS wbudowany symulator warunków sieci (faza 9):
// opóźnia/odrzuca wychodzące INPUT i przychodzące SNAPSHOT wg `conditions`. Wiadomości
// lobby (welcome/roomList/roomJoined/roomUpdate/matchStarted/error) rozdzielane przez
// callbacki — wyższa warstwa (online-main) trzyma stan ekranu. RTT mierzymy od momentu
// wywołania sendInput (przed sztucznym opóźnieniem) do przetworzenia acka.

export type NetStatus = 'connecting' | 'handshaking' | 'connected' | 'error' | 'closed';

export class NetClient {
  status: NetStatus = 'connecting';
  /** Czytelny komunikat dla statusu 'error'/'closed'. */
  statusMessage = '';
  /** Id TEGO gracza w bieżącym pokoju (z roomJoined.youId); null poza pokojem. */
  localPlayerId: number | null = null;
  /** Token sesji z welcome — wyższa warstwa zapisuje go w localStorage (reconnect). */
  sessionToken: string | null = null;
  rttMs = 0;
  latestSnapshot: Snapshot | undefined;
  /** Symulator warunków sieci (dev) — mutowany przez panel; domyślnie wyłączony. */
  readonly conditions: NetConditionsConfig = defaultNetConditions();

  /** Wywoływane dla KAŻDEGO zdekodowanego snapshotu (po symulowanym opóźnieniu). */
  onSnapshot: ((snap: Snapshot) => void) | undefined;
  /** Wywoływane dla każdej paczki zdarzeń walki (MUZZLE/HIT/KILL) — po symulowanym opóźnieniu. */
  onEvents: ((events: GameEvent[]) => void) | undefined;
  onWelcome: ((msg: WelcomeMessage) => void) | undefined;
  onRoomList: ((msg: RoomListMessage) => void) | undefined;
  onRoomJoined: ((msg: RoomJoinedMessage) => void) | undefined;
  onRoomUpdate: ((msg: RoomUpdateMessage) => void) | undefined;
  /** Wiadomość czatu pokoju (poczekalnia) — broadcast od serwera; historia przy wejściu. */
  onChat: ((msg: ChatMessage) => void) | undefined;
  onMatchStarted: (() => void) | undefined;
  /** Tabela wyników (faza 13) — rozsyłana ~STANDINGS_BROADCAST_HZ w trakcie meczu. */
  onStandings: ((msg: StandingsMessage) => void) | undefined;
  /** Koniec meczu (faza 13) — zwycięzca + finalna tabela (ekran wyników). */
  onMatchEnded: ((msg: MatchEndedMessage) => void) | undefined;
  /** Serwer się zamyka (faza 13) — klient pokazuje komunikat zamiast wiecznego spinnera. */
  onServerShutdown: ((msg: ServerShutdownMessage) => void) | undefined;
  /** Błąd lobby (badCode/full/notHost/…) — NIE zamyka połączenia, klient zostaje w lobby. */
  onLobbyError: ((code: string, message: string) => void) | undefined;

  private readonly ws: WebSocket;
  private readonly inputBuf = new Uint8Array(INPUT_BYTES);
  private readonly inputView = new DataView(this.inputBuf.buffer);
  /** seq → moment wysłania [performance.now ms] — do pomiaru RTT po acku. */
  private readonly sentTimes = new Map<number, number>();

  constructor(
    url: string,
    private readonly nick = 'pilot',
    private readonly resumeToken: string | null = null,
  ) {
    this.ws = new WebSocket(url);
    this.ws.binaryType = 'arraybuffer';

    this.ws.addEventListener('open', () => {
      this.status = 'handshaking';
      const hello: Record<string, unknown> = { t: 'hello', v: PROTOCOL_VERSION, nick: this.nick };
      if (this.resumeToken) hello.token = this.resumeToken;
      this.ws.send(JSON.stringify(hello));
    });
    this.ws.addEventListener('message', (event: MessageEvent) => this.onMessage(event));
    this.ws.addEventListener('error', () => {
      if (this.status !== 'error') {
        this.status = 'error';
        this.statusMessage = 'błąd połączenia z serwerem';
      }
    });
    this.ws.addEventListener('close', () => {
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
      // symulator RX: opóźnij/odrzuć przychodzącą ramkę (każda to świeży ArrayBuffer)
      const delay = rollDelayMs(this.conditions);
      if (delay === null) return; // zgubiona ramka (symulacja) — gap złapie metryka
      if (delay <= 0) this.handleBinary(data);
      else setTimeout(() => this.handleBinary(data), delay);
    }
  }

  /** Ramka binarna: snapshot albo paczka EVENT — rozróżniamy po pierwszym bajcie (faza 11). */
  private handleBinary(buffer: ArrayBuffer): void {
    if (buffer.byteLength === 0) return;
    if (new DataView(buffer).getUint8(0) === MSG_EVENT) this.handleEvents(buffer);
    else this.handleSnapshot(buffer);
  }

  private handleEvents(buffer: ArrayBuffer): void {
    let events: GameEvent[];
    try {
      events = decodeEvents(new DataView(buffer));
    } catch {
      return; // uszkodzona paczka — pomiń
    }
    this.onEvents?.(events);
  }

  private onControl(text: string): void {
    const msg = parseControlMessage(text);
    if (!msg) return;
    switch (msg.t) {
      case 'welcome':
        this.sessionToken = msg.sessionToken;
        this.status = 'connected';
        this.onWelcome?.(msg);
        break;
      case 'roomList':
        this.onRoomList?.(msg);
        break;
      case 'roomJoined':
        this.localPlayerId = msg.youId;
        this.onRoomJoined?.(msg);
        break;
      case 'roomUpdate':
        this.onRoomUpdate?.(msg);
        break;
      case 'chat':
        this.onChat?.(msg);
        break;
      case 'matchStarted':
        this.onMatchStarted?.();
        break;
      case 'standings':
        this.onStandings?.(msg);
        break;
      case 'matchEnded':
        this.onMatchEnded?.(msg);
        break;
      case 'serverShutdown':
        // pokaż komunikat (nie spinner): status 'error' utrzyma się mimo następującego close
        this.status = 'error';
        this.statusMessage = msg.message;
        this.onServerShutdown?.(msg);
        break;
      case 'error':
        if (msg.code === 'version') {
          this.status = 'error';
          this.statusMessage = msg.message;
        } else {
          this.onLobbyError?.(msg.code, msg.message);
        }
        break;
      default:
        break;
    }
  }

  private handleSnapshot(buffer: ArrayBuffer): void {
    let snap: Snapshot;
    try {
      snap = decodeSnapshot(new DataView(buffer));
    } catch {
      return; // uszkodzony snapshot — pomiń klatkę
    }
    const sentAt = this.sentTimes.get(snap.ackSeq);
    if (sentAt !== undefined) {
      this.rttMs = Math.round(performance.now() - sentAt);
      for (const seq of this.sentTimes.keys()) {
        if (seq <= snap.ackSeq) this.sentTimes.delete(seq);
      }
    }
    this.onSnapshot?.(snap);
    if (!this.latestSnapshot || tickNewer(snap.serverTick, this.latestSnapshot.serverTick)) {
      this.latestSnapshot = snap;
    }
  }

  // --- akcje lobby (JSON, poza hot pathem) ---

  private sendControl(msg: ControlMessage): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  requestRoomList(): void {
    this.sendControl({ t: 'listRooms' });
  }

  createRoom(bots = 0, difficulty?: DifficultyLevel, mode?: MatchMode): void {
    this.sendControl({ t: 'createRoom', bots, difficulty, mode });
  }

  joinRoom(code: string): void {
    this.sendControl({ t: 'joinRoom', code });
  }

  /** Wybór typu samolotu w poczekalni (faza 19b; serwer klampuje i stosuje przy spawnie). */
  selectPlane(plane: PlaneType): void {
    this.sendControl({ t: 'selectPlane', plane });
  }

  /** Host zmienia ustawienia pokoju w poczekalni (tryb/boty/poziom). Serwer egzekwuje host+waiting. */
  updateRoom(opts: { mode?: MatchMode; bots?: number; difficulty?: DifficultyLevel }): void {
    this.sendControl({ t: 'updateRoom', ...opts });
  }

  /** Wyślij wiadomość na czat pokoju (poczekalnia). Serwer sanityzuje i rozsyła. */
  sendChat(text: string): void {
    this.sendControl({ t: 'chatSend', text });
  }

  quickPlay(): void {
    this.sendControl({ t: 'quickPlay' });
  }

  startMatch(): void {
    this.sendControl({ t: 'startMatch' });
  }

  leaveRoom(): void {
    this.sendControl({ t: 'leaveRoom' });
    this.localPlayerId = null;
    this.latestSnapshot = undefined;
  }

  /** Zakończ CAŁY mecz i wróć do poczekalni (gra z samymi botami — host). Serwer egzekwuje warunki. */
  endMatch(): void {
    this.sendControl({ t: 'endMatch' });
  }

  /** Wycofaj się z trwającego meczu, zostając w pokoju (powrót do poczekalni; reszta gra dalej). */
  leaveMatch(): void {
    this.sendControl({ t: 'leaveMatch' });
  }

  /** Wysyła ramkę INPUT (symulator TX: opóźnia/odrzuca). No-op poza połączeniem. */
  sendInput(frame: InputFrame): void {
    if (this.status !== 'connected' || this.ws.readyState !== WebSocket.OPEN) return;
    this.sentTimes.set(frame.sequence, performance.now());
    const delay = rollDelayMs(this.conditions);
    if (delay === null) return; // zgubiony input (symulacja) — serwer go nie potwierdzi
    if (delay <= 0) {
      encodeInput(this.inputView, frame);
      this.ws.send(this.inputBuf);
      return;
    }
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

/**
 * Domyślny URL serwera gry. Na PRODUKCJI (https) backend stoi za reverse proxy nginx pod
 * ścieżką `/ws` — bez osobnego publicznego portu i wyłącznie wss:// (niezmiennik nr 10).
 * W DEV (http) łączymy się wprost do portu serwera WS na tym samym hoście. `?server=` w URL
 * nadpisuje oba (debug / wskazanie zdalnego serwera).
 */
export function defaultServerUrl(port: number): string {
  const override = new URLSearchParams(location.search).get('server');
  if (override) return override;
  if (location.protocol === 'https:') return `wss://${location.host}/ws`;
  return `ws://${location.hostname}:${String(port)}`;
}
