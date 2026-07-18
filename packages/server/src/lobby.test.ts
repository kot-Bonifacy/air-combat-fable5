import { describe, expect, it } from 'vitest';
import {
  MAX_PLAYERS_PER_ROOM,
  RECONNECT_WINDOW_MS,
  isValidRoomCode,
} from '@air-combat/shared';
import { Lobby } from './lobby';
import type { RoomMember } from './game-room';

const member = (): RoomMember => ({ sendControl() {}, sendSnapshotBytes() {} });

describe('Lobby — rejestr pokoi', () => {
  it('createRoom nadaje poprawny kod i wprowadza hosta', () => {
    const lobby = new Lobby();
    const { room, playerId } = lobby.createRoom('as', 'tok-1', member());
    expect(isValidRoomCode(room.code)).toBe(true);
    expect(playerId).toBe(0);
    expect(room.hostId).toBe(0);
    expect(lobby.roomCount).toBe(1);
  });

  it('joinRoom: zły kod → badCode, nieistniejący → badCode, pełny → full', () => {
    const lobby = new Lobby();
    expect(lobby.joinRoom('zzz', 'a', 't', member())).toMatchObject({ ok: false, code: 'badCode' });
    expect(lobby.joinRoom('ABCD', 'a', 't', member())).toMatchObject({ ok: false, code: 'badCode' });

    const { room } = lobby.createRoom('host', 'tok-h', member());
    for (let i = 0; i < MAX_PLAYERS_PER_ROOM - 1; i++) {
      expect(lobby.joinRoom(room.code, `p${String(i)}`, `tok-${String(i)}`, member()).ok).toBe(true);
    }
    expect(lobby.joinRoom(room.code, 'overflow', 'tok-of', member())).toMatchObject({ ok: false, code: 'full' });
  });

  it('quickPlay dołącza do istniejącego pokoju z miejscem, inaczej tworzy', () => {
    const lobby = new Lobby();
    const a = lobby.quickPlay('a', 'tok-a', member());
    const b = lobby.quickPlay('b', 'tok-b', member());
    expect(b.room.code).toBe(a.room.code); // ten sam pokój
    expect(lobby.roomCount).toBe(1);
  });

  it('reconnect po tokenie wraca do tego samego pokoju i id', () => {
    const lobby = new Lobby();
    const { room, playerId } = lobby.createRoom('as', 'tok-r', member());
    room.detachMember(playerId, Date.now());
    const resumed = lobby.tryReconnect('tok-r', member());
    expect(resumed?.room.code).toBe(room.code);
    expect(resumed?.playerId).toBe(playerId);
    expect(lobby.tryReconnect('nieznany', member())).toBeNull();
  });

  it('pokój znika po wyjściu ostatniego gracza (leave)', () => {
    const lobby = new Lobby();
    const { playerId } = lobby.createRoom('as', 'tok-1', member());
    lobby.leave('tok-1', playerId);
    expect(lobby.roomCount).toBe(0);
  });

  it('maintain sprząta wygasły slot także w pokoju z POŁĄCZONYM graczem (fix „ducha gracza")', () => {
    const lobby = new Lobby();
    let now = 1000;
    const { room, playerId: hostId } = lobby.createRoom('host', 'tok-host', member());
    const join = lobby.joinRoom(room.code, 'leaver', 'tok-leaver', member());
    if (!join.ok) throw new Error('join nie powiódł się');
    room.detachMember(join.playerId, now); // leaver się rozłącza (slot trzymany na reconnect)
    lobby.maintain(now); // wciąż w oknie — slot zostaje, mimo że host jest połączony
    expect(room.playerCount).toBe(2);
    now += RECONNECT_WINDOW_MS + 1;
    lobby.maintain(now); // okno minęło → duch znika, CHOĆ host wciąż połączony (wcześniej blokował prune)
    expect(room.playerCount).toBe(1);
    expect(lobby.roomCount).toBe(1); // pokój żyje dalej (host)
    expect(room.hostId).toBe(hostId);
    expect(lobby.tryReconnect('tok-leaver', member())).toBeNull(); // sesja ducha sprzątnięta — token nie wskrzesza slotu
  });

  it('brak wycieku pokoi: 100 cykli utwórz→rozłącz→wygaśnięcie', () => {
    const lobby = new Lobby();
    let now = 1000;
    for (let i = 0; i < 100; i++) {
      const { room, playerId } = lobby.createRoom('as', `tok-${String(i)}`, member());
      room.detachMember(playerId, now); // rozłączenie (slot trzymany na reconnect)
      lobby.maintain(now); // jeszcze w oknie — pokój zostaje
      now += RECONNECT_WINDOW_MS + 1;
      lobby.maintain(now); // okno minęło — pokój sprzątnięty
    }
    expect(lobby.roomCount).toBe(0);
  });
});
