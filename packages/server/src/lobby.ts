import { randomUUID } from 'node:crypto';
import {
  RECONNECT_WINDOW_MS,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  isValidRoomCode,
  type RoomSummary,
} from '@air-combat/shared';
import { GameRoom, type RoomMember } from './game-room';

// Rejestr pokoi (faza 10). Trzyma żywe pokoje po kodzie, generuje kody (alfabet bez
// mylących znaków) i tokeny sesji, kojarzy token→pokój dla reconnectu. Sprzątanie:
// po wyjściu ostatniego gracza (i wygaśnięciu okien reconnectu) pokój znika — żadnych
// wycieków (kryterium fazy 10: brak narastania pokoi po 100 cyklach). Logika lobby
// jest tu autorytatywna; Connection tylko routuje wiadomości i implementuje RoomMember.

/** Wynik wejścia do pokoju: sukces (pokój + przydzielone id) albo błąd dla klienta. */
export type JoinResult =
  | { ok: true; room: GameRoom; playerId: number }
  | { ok: false; code: 'badCode' | 'full'; message: string };

export interface ReconnectResult {
  room: GameRoom;
  playerId: number;
}

export class Lobby {
  private readonly rooms = new Map<string, GameRoom>();
  /** token sesji → kod pokoju, w którym ten gracz ma slot (do routingu reconnectu). */
  private readonly sessions = new Map<string, string>();

  constructor(
    private readonly seed?: number,
    private readonly onRoomError?: (msg: string) => void,
  ) {}

  /** Świeży token sesji dla nowego połączenia (klient zapisze go w localStorage). */
  newSessionToken(): string {
    return randomUUID();
  }

  /** Wszystkie żywe pokoje — pętla serwera kroczy po nich i rozsyła snapshoty. */
  allRooms(): IterableIterator<GameRoom> {
    return this.rooms.values();
  }

  /** Lista pokoi z wolnym miejscem (lobby pokazuje, gdzie można wejść). */
  list(): RoomSummary[] {
    const out: RoomSummary[] = [];
    for (const room of this.rooms.values()) {
      if (room.hasFreeSlot) out.push(room.summary());
    }
    return out;
  }

  /**
   * Reconnect po tokenie: jeśli token wskazuje na pokój z trzymanym (rozłączonym)
   * slotem tego gracza, podpina nowe połączenie do istniejącej encji. Zwraca null,
   * gdy sesja wygasła/nieznana — wtedy klient idzie zwykłą ścieżką lobby.
   */
  tryReconnect(token: string, member: RoomMember): ReconnectResult | null {
    const code = this.sessions.get(token);
    if (!code) return null;
    const room = this.rooms.get(code);
    if (!room) {
      this.sessions.delete(token);
      return null;
    }
    const player = room.reconnectByToken(token, member);
    if (!player) return null;
    return { room, playerId: player.id };
  }

  /** Tworzy nowy pokój i wprowadza gracza jako hosta. */
  createRoom(nick: string, token: string, member: RoomMember): { room: GameRoom; playerId: number } {
    const room = new GameRoom(this.uniqueCode(), this.seed, this.onRoomError);
    this.rooms.set(room.code, room);
    const playerId = room.addPlayer(nick, token, member);
    this.sessions.set(token, room.code);
    return { room, playerId };
  }

  /** Dołącza do pokoju o kodzie (zły kod / pełny → błąd dla klienta). */
  joinRoom(code: string, nick: string, token: string, member: RoomMember): JoinResult {
    if (!isValidRoomCode(code)) {
      return { ok: false, code: 'badCode', message: `nieprawidłowy kod pokoju: ${code}` };
    }
    const room = this.rooms.get(code);
    if (!room) {
      return { ok: false, code: 'badCode', message: `pokój ${code} nie istnieje` };
    }
    if (!room.hasFreeSlot) {
      return { ok: false, code: 'full', message: `pokój ${code} jest pełny` };
    }
    const playerId = room.addPlayer(nick, token, member);
    this.sessions.set(token, room.code);
    return { ok: true, room, playerId };
  }

  /** Szybka gra: dołącz do dowolnego pokoju z wolnym miejscem (preferuj trwający mecz), inaczej utwórz. */
  quickPlay(nick: string, token: string, member: RoomMember): { room: GameRoom; playerId: number } {
    let target: GameRoom | undefined;
    for (const room of this.rooms.values()) {
      if (room.state === 'ended' || !room.hasFreeSlot) continue;
      // preferuj trwający mecz (gracz od razu lata) nad poczekalnią
      if (!target || (room.state === 'playing' && target.state !== 'playing')) target = room;
    }
    if (target) {
      const playerId = target.addPlayer(nick, token, member);
      this.sessions.set(token, target.code);
      return { room: target, playerId };
    }
    return this.createRoom(nick, token, member);
  }

  /** Trwale usuwa gracza z jego pokoju (wyjście) i czyści sesję. Pusty pokój znika. */
  leave(token: string, playerId: number): void {
    const code = this.sessions.get(token);
    this.sessions.delete(token);
    if (!code) return;
    const room = this.rooms.get(code);
    if (!room) return;
    room.removePlayer(playerId);
    if (room.playerCount === 0) this.rooms.delete(code);
  }

  /**
   * Konserwacja wołana co tick przez pętlę serwera: zwalnia wygasłe okna reconnectu
   * i usuwa pokoje bez graczy. To tu domyka się brak wycieku pokoi (kryterium fazy 10).
   */
  maintain(nowMs: number): void {
    for (const [code, room] of this.rooms) {
      if (room.connectedCount === 0) {
        room.pruneExpiredReconnects(nowMs, RECONNECT_WINDOW_MS);
      }
      if (room.playerCount === 0) {
        this.rooms.delete(code);
        for (const [token, c] of this.sessions) if (c === code) this.sessions.delete(token);
      }
    }
  }

  get roomCount(): number {
    return this.rooms.size;
  }

  private uniqueCode(): string {
    for (let attempt = 0; attempt < 1000; attempt++) {
      let code = '';
      for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
        code += ROOM_CODE_ALPHABET[Math.floor(Math.random() * ROOM_CODE_ALPHABET.length)];
      }
      if (!this.rooms.has(code)) return code;
    }
    // praktycznie nieosiągalne (32^4 ≈ 1e6 kombinacji) — ostatnia deska ratunku
    throw new Error('nie udało się wygenerować unikalnego kodu pokoju');
  }
}
