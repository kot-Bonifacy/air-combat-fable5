import type { RawData, WebSocket } from 'ws';
import {
  DIFFICULTY_LEVELS,
  INPUT_BYTES,
  INPUT_HZ,
  PHYSICS_HZ,
  PROTOCOL_VERSION,
  SNAPSHOT_HZ,
  clampMatchMode,
  clampPlaneType,
  decodeInput,
  parseControlMessage,
  sanitizeChat,
  sanitizeNick,
  validateInputFrame,
  type ControlMessage,
  type DifficultyLevel,
  type ErrorMessage,
  type RoomJoinedMessage,
  type WelcomeMessage,
} from '@air-combat/shared';
import { MAX_BOTS_PER_ROOM } from './bot-manager';
import type { GameRoom, RoomMember } from './game-room';
import type { Lobby } from './lobby';

/** Domyślny poziom trudności botów, gdy host nie poda (lub poda nieznany). */
const DEFAULT_BOT_DIFFICULTY: DifficultyLevel = 'normalny';

/** Klampuje liczbę botów żądaną przez hosta do [0, MAX_BOTS_PER_ROOM] (niezmiennik nr 11). */
function clampBotCount(raw: unknown): number {
  const n = typeof raw === 'number' && Number.isFinite(raw) ? Math.floor(raw) : 0;
  return Math.max(0, Math.min(MAX_BOTS_PER_ROOM, n));
}

/** Przyjmuje poziom trudności tylko z listy znanych — inaczej domyślny (brak zaufania do klienta). */
function validDifficulty(raw: unknown): DifficultyLevel {
  return DIFFICULTY_LEVELS.includes(raw as DifficultyLevel) ? (raw as DifficultyLevel) : DEFAULT_BOT_DIFFICULTY;
}

// Jedno połączenie WS. Maszyna stanów: handshaking → lobby → inRoom → closed (faza 10).
// Handshake JSON niesie wersję protokołu, nick i opcjonalny token reconnectu. Po przyjęciu
// gracz jest w LOBBY (jeszcze nie lata) i steruje pokojami wiadomościami kontrolnymi (JSON).
// Ramki binarne INPUT przyjmowane dopiero w pokoju w stanie 'playing'. Niezmiennik nr 11
// (brak zaufania do klienta): każdy pakiet walidowany — rozmiar, tag, zakresy, rate limit.
// Connection implementuje RoomMember — pokój rozsyła przez nie JSON i snapshoty.

/** Minimalny interfejs loggera (pino spełnia go strukturalnie). */
export interface Logger {
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

/** Sufit liczby ramek INPUT na sekundę zanim zaczniemy je odrzucać (2× INPUT_HZ = zapas na jitter). */
const MAX_INPUTS_PER_SEC = INPUT_HZ * 2;
/** Sufit wiadomości kontrolnych (lobby) na sekundę — tani antyspam (poza hot pathem). */
const MAX_CONTROL_PER_SEC = 20;
/** Po tylu odrzuconych pakietach z rzędu rozłączamy uparcie złośliwego klienta. */
const MAX_VIOLATIONS = 240;

type ConnState = 'handshaking' | 'lobby' | 'inRoom' | 'closed';

export class Connection implements RoomMember {
  private state: ConnState = 'handshaking';
  private room: GameRoom | null = null;
  private playerId: number | null = null;
  private token = '';
  private nick = '';
  private violations = 0;
  // okno rate-limitu ramek INPUT
  private inputWindowStartMs = 0;
  private inputWindowCount = 0;
  // okno rate-limitu wiadomości kontrolnych
  private ctrlWindowStartMs = 0;
  private ctrlWindowCount = 0;

  constructor(
    private readonly socket: WebSocket,
    private readonly lobby: Lobby,
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

  // --- RoomMember: rozsyłka z pokoju ---

  sendControl(msg: ControlMessage): void {
    if (this.socket.readyState === this.socket.OPEN) this.socket.send(JSON.stringify(msg));
  }

  sendSnapshotBytes(bytes: Uint8Array): void {
    if (this.socket.readyState === this.socket.OPEN) this.socket.send(bytes);
  }

  // --- tekst: handshake + wiadomości lobby ---

  private onText(data: RawData): void {
    const text = data.toString();
    // legacy keepalive wskaźnika net-status w kliencie (dev) — dozwolony zawsze
    if (text === 'ping') {
      this.socket.send('pong');
      return;
    }
    const msg = parseControlMessage(text);
    if (!msg) {
      this.log.warn({ remote: this.remote }, 'nieznana ramka tekstowa — odrzucono');
      this.flagViolation();
      return;
    }
    if (this.state === 'handshaking') {
      if (msg.t !== 'hello') {
        this.log.warn({ remote: this.remote }, 'oczekiwano hello — odrzucono');
        this.flagViolation();
        return;
      }
      this.handleHello(msg.v, msg.nick, msg.token);
      return;
    }
    if (!this.allowControlByRate()) {
      this.log.warn({ remote: this.remote }, 'przekroczony rate limit wiadomości lobby');
      this.flagViolation();
      return;
    }
    this.handleLobby(msg);
  }

  private handleHello(version: number, rawNick: unknown, token: unknown): void {
    if (version !== PROTOCOL_VERSION) {
      const err: ErrorMessage = {
        t: 'error',
        code: 'version',
        message: `niezgodna wersja protokołu: serwer ${String(PROTOCOL_VERSION)}, klient ${String(version)}`,
      };
      this.log.warn({ remote: this.remote, clientV: version }, 'odrzucono — niezgodna wersja protokołu');
      this.socket.send(JSON.stringify(err));
      this.socket.close();
      return;
    }
    this.nick = sanitizeNick(rawNick);

    // próba reconnectu po istniejącym tokenie (ten sam slot w pokoju, okno 60 s)
    if (typeof token === 'string' && token.length > 0) {
      const resumed = this.lobby.tryReconnect(token, this);
      if (resumed) {
        this.token = token;
        this.room = resumed.room;
        this.playerId = resumed.playerId;
        this.nick = resumed.room.nick(resumed.playerId) ?? this.nick;
        this.state = 'inRoom';
        this.sendWelcome();
        this.sendRoomJoined(resumed.room, resumed.playerId);
        this.log.info({ remote: this.remote, code: resumed.room.code, playerId: resumed.playerId }, 'reconnect gracza');
        return;
      }
    }

    this.token = this.lobby.newSessionToken();
    this.state = 'lobby';
    this.sendWelcome();
    this.log.info({ remote: this.remote, nick: this.nick }, 'gracz w lobby');
  }

  private handleLobby(msg: ControlMessage): void {
    switch (msg.t) {
      case 'hello':
        return; // powtórny hello — ignoruj
      case 'listRooms':
        this.sendControl({ t: 'roomList', rooms: this.lobby.list() });
        return;
      case 'createRoom': {
        if (this.state === 'inRoom') return;
        const bots = clampBotCount(msg.bots);
        const difficulty = validDifficulty(msg.difficulty);
        // mode klampuje connection (clampMatchMode) — surowa wartość bezpieczna (faza 18;
        // niezmiennik nr 11: brak zaufania do klienta)
        const { room, playerId } = this.lobby.createRoom(
          this.nick,
          this.token,
          this,
          bots,
          difficulty,
          clampMatchMode(msg.mode),
        );
        this.enterRoom(room, playerId);
        return;
      }
      case 'quickPlay': {
        if (this.state === 'inRoom') return;
        const { room, playerId } = this.lobby.quickPlay(this.nick, this.token, this);
        this.enterRoom(room, playerId);
        return;
      }
      case 'joinRoom': {
        if (this.state === 'inRoom') return;
        const result = this.lobby.joinRoom(msg.code, this.nick, this.token, this);
        if (!result.ok) {
          this.sendControl({ t: 'error', code: result.code, message: result.message });
          return;
        }
        this.enterRoom(result.room, result.playerId);
        return;
      }
      case 'selectPlane': {
        // wybór samolotu w poczekalni (faza 19b); clampPlaneType broni przed wartością z sieci
        // (niezmiennik nr 11). Poza pokojem ignorowany.
        if (this.state !== 'inRoom' || !this.room || this.playerId === null) return;
        this.room.selectPlane(this.playerId, clampPlaneType(msg.plane));
        return;
      }
      case 'updateRoom': {
        // host zmienia ustawienia pokoju w poczekalni (tryb/boty/poziom). Tylko host; serwer
        // klampuje wartości (niezm. nr 11), a GameRoom egzekwuje stan 'waiting'. Pola opcjonalne:
        // klampujemy tylko te obecne, by „brak pola" nie wymuszał 0 botów / domyślnego poziomu.
        if (this.state !== 'inRoom' || !this.room || this.playerId === null) return;
        if (this.room.hostId !== this.playerId) {
          this.sendControl({ t: 'error', code: 'notHost', message: 'tylko host może zmienić ustawienia pokoju' });
          return;
        }
        this.room.applyRoomSettings({
          mode: msg.mode !== undefined ? clampMatchMode(msg.mode) : undefined,
          bots: typeof msg.bots === 'number' ? clampBotCount(msg.bots) : undefined,
          difficulty: msg.difficulty !== undefined ? validDifficulty(msg.difficulty) : undefined,
        });
        return;
      }
      case 'chatSend': {
        // czat poczekalni: sanityzacja serwerowa (sanitizeChat) + rate limit (allowControlByRate
        // wyżej). Pusta po sanityzacji → cicho pomijamy. Poza pokojem ignorowany.
        if (this.state !== 'inRoom' || !this.room || this.playerId === null) return;
        const text = sanitizeChat(msg.text);
        if (text.length > 0) this.room.broadcastChat(this.playerId, text);
        return;
      }
      case 'startMatch': {
        if (this.state !== 'inRoom' || !this.room || this.playerId === null) return;
        if (this.room.hostId !== this.playerId) {
          this.sendControl({ t: 'error', code: 'notHost', message: 'tylko host może wystartować mecz' });
          return;
        }
        this.room.start();
        return;
      }
      case 'leaveRoom':
        this.leaveRoom();
        return;
      default:
        return; // wiadomości serwer→klient nie powinny tu trafiać
    }
  }

  private enterRoom(room: GameRoom, playerId: number): void {
    this.room = room;
    this.playerId = playerId;
    this.state = 'inRoom';
    this.sendRoomJoined(room, playerId);
    room.broadcastRoomUpdate();
    this.log.info({ remote: this.remote, code: room.code, playerId }, 'gracz wszedł do pokoju');
  }

  private leaveRoom(): void {
    if (this.playerId === null) return;
    const code = this.room?.code;
    this.lobby.leave(this.token, this.playerId);
    this.room = null;
    this.playerId = null;
    this.state = 'lobby';
    // nowy token: stara sesja zamknięta, klient już do niej nie wróci
    this.token = this.lobby.newSessionToken();
    this.sendWelcome();
    this.log.info({ remote: this.remote, code }, 'gracz wyszedł z pokoju do lobby');
  }

  private sendWelcome(): void {
    const welcome: WelcomeMessage = {
      t: 'welcome',
      protocolVersion: PROTOCOL_VERSION,
      physicsHz: PHYSICS_HZ,
      snapshotHz: SNAPSHOT_HZ,
      sessionToken: this.token,
    };
    this.socket.send(JSON.stringify(welcome));
  }

  private sendRoomJoined(room: GameRoom, playerId: number): void {
    const msg: RoomJoinedMessage = {
      t: 'roomJoined',
      code: room.code,
      youId: playerId,
      hostId: room.hostId ?? playerId,
      state: room.state,
      mode: room.mode, // klient: render trybu + sens selektora samolotu (drużynowy = wybór strony)
      difficulty: room.difficulty, // poczekalnia: selektor poziomu botów (host)
      players: room.roomPlayers(),
    };
    this.sendControl(msg);
    // kontekst rozmowy dla nowego gracza: ostatnie wiadomości czatu jako zwykłe ChatMessage
    for (const chat of room.recentChat()) this.sendControl(chat);
  }

  // --- ramki binarne (INPUT) ---

  private onBinary(data: RawData): void {
    if (this.state !== 'inRoom' || !this.room || this.playerId === null) {
      this.log.warn({ remote: this.remote }, 'ramka binarna poza pokojem — odrzucono');
      this.flagViolation();
      return;
    }
    if (this.room.state !== 'playing') {
      // input przed startem meczu — cicho ignoruj (klient mógł wyprzedzić matchStarted)
      return;
    }
    if (!this.allowInputByRate()) {
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

  /** Token okienkowy: ≤ MAX_INPUTS_PER_SEC ramek INPUT na sekundę. */
  private allowInputByRate(): boolean {
    const now = Date.now();
    if (now - this.inputWindowStartMs >= 1000) {
      this.inputWindowStartMs = now;
      this.inputWindowCount = 0;
    }
    this.inputWindowCount++;
    return this.inputWindowCount <= MAX_INPUTS_PER_SEC;
  }

  private allowControlByRate(): boolean {
    const now = Date.now();
    if (now - this.ctrlWindowStartMs >= 1000) {
      this.ctrlWindowStartMs = now;
      this.ctrlWindowCount = 0;
    }
    this.ctrlWindowCount++;
    return this.ctrlWindowCount <= MAX_CONTROL_PER_SEC;
  }

  private flagViolation(): void {
    if (++this.violations >= MAX_VIOLATIONS) {
      this.log.warn({ remote: this.remote }, 'zbyt wiele nadużyć — rozłączam');
      this.socket.close();
    }
  }

  private cleanup(): void {
    if (this.state === 'closed') return;
    this.state = 'closed';
    // NIE usuwamy gracza od razu — trzymamy slot na reconnect (okno 60 s, lobby.maintain
    // posprząta po wygaśnięciu). Połączenie znika z pokoju jako RoomMember.
    if (this.room && this.playerId !== null) {
      this.room.detachMember(this.playerId, Date.now());
      this.log.info({ remote: this.remote, code: this.room.code, playerId: this.playerId }, 'gracz rozłączony (slot trzymany na reconnect)');
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
