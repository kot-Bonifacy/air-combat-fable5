import { describe, expect, it } from 'vitest';
import { MAX_PLAYERS_PER_ROOM, type ControlMessage } from '@air-combat/shared';
import { GameRoom, type RoomMember } from './game-room';

// Poczekalnia (2026-06-21): czat pokoju + zmiana ustawień (tryb/boty/poziom) przez HOSTA na żywo.
// Testujemy GameRoom wprost (connection tylko routuje i klampuje wejście). RoomMember-rejestrator
// łapie wiadomości kontrolne wysłane do gracza.

function recorder(): { msgs: ControlMessage[]; member: RoomMember } {
  const msgs: ControlMessage[] = [];
  return { msgs, member: { sendControl: (m) => msgs.push(m), sendSnapshotBytes() {} } };
}

describe('poczekalnia — ustawienia pokoju (host)', () => {
  it('zmiana trybu na drużynowy: ustawia mode, przydziela frakcje 0/1, rozsyła roomUpdate + komunikat systemowy', () => {
    const room = new GameRoom('TEST');
    const host = recorder();
    const aId = room.addPlayer('Anna', 'ta', host.member);
    const second = recorder();
    const bId = room.addPlayer('Bob', 'tb', second.member);
    host.msgs.length = 0;
    second.msgs.length = 0;

    room.applyRoomSettings({ mode: 'team' });

    expect(room.mode).toBe('team');
    // auto-balans: pierwszy gracz → 0, drugi → 1 (podgląd sprzętu wg strony już w poczekalni)
    expect(new Set([room.factionOf(aId), room.factionOf(bId)])).toEqual(new Set([0, 1]));
    expect(host.msgs.some((m) => m.t === 'roomUpdate' && m.mode === 'team')).toBe(true);
    const sys = host.msgs.find((m) => m.t === 'chat');
    expect(sys && sys.t === 'chat' && sys.id).toBeNull(); // komunikat systemowy (id=null) na czacie
    expect(second.msgs.some((m) => m.t === 'chat')).toBe(true); // dociera do wszystkich członków
  });

  it('zmiana liczby botów przebudowuje roster; boty oznaczone isBot', () => {
    const room = new GameRoom('TEST');
    const host = recorder();
    room.addPlayer('host', 'tok', host.member);

    room.applyRoomSettings({ bots: 3, difficulty: 'trudny' });
    expect(room.botCount).toBe(3);
    expect(room.roomPlayers().filter((p) => p.isBot)).toHaveLength(3);

    room.applyRoomSettings({ bots: 0 });
    expect(room.botCount).toBe(0);
  });

  it('liczba botów jest klampowana do wolnych slotów (MAX_PLAYERS_PER_ROOM − ludzie)', () => {
    const room = new GameRoom('TEST');
    room.addPlayer('host', 'tok', recorder().member);
    for (let i = 0; i < 5; i++) room.addPlayer(`p${String(i)}`, `t${String(i)}`, recorder().member); // 6 ludzi

    room.applyRoomSettings({ bots: MAX_PLAYERS_PER_ROOM }); // żądanie 8 botów
    expect(room.botCount).toBe(MAX_PLAYERS_PER_ROOM - 6); // tylko 2 wolne sloty
  });

  it('ustawienia ignorowane poza stanem waiting (np. w trakcie meczu)', () => {
    const room = new GameRoom('TEST');
    room.addPlayer('host', 'tok', recorder().member);
    room.start(); // waiting → playing

    room.applyRoomSettings({ mode: 'team', bots: 4 });

    expect(room.mode).toBe('ffa');
    expect(room.botCount).toBe(0);
  });
});

describe('poczekalnia — czat pokoju', () => {
  it('broadcastChat rozsyła do wszystkich członków i dopisuje do historii', () => {
    const room = new GameRoom('TEST');
    const a = recorder();
    const b = recorder();
    const aId = room.addPlayer('Anna', 'ta', a.member);
    room.addPlayer('Bob', 'tb', b.member);
    a.msgs.length = 0;
    b.msgs.length = 0;

    room.broadcastChat(aId, 'lecimy?');

    const chatB = b.msgs.find((m) => m.t === 'chat');
    expect(chatB && chatB.t === 'chat' && chatB.text).toBe('lecimy?');
    expect(chatB && chatB.t === 'chat' && chatB.nick).toBe('Anna');
    expect(chatB && chatB.t === 'chat' && chatB.id).toBe(aId);
    expect(room.recentChat()).toHaveLength(1);
  });

  it('historia czatu jest ograniczona (nowy gracz nie dostaje całej wieczności)', () => {
    const room = new GameRoom('TEST');
    const aId = room.addPlayer('Anna', 'ta', recorder().member);
    for (let i = 0; i < 50; i++) room.broadcastChat(aId, `m${String(i)}`);
    expect(room.recentChat().length).toBeLessThanOrEqual(30);
    // zachowane są NAJNOWSZE wiadomości
    expect(room.recentChat().at(-1)?.text).toBe('m49');
  });

  it('nieznany nadawca lub pusta treść → no-op', () => {
    const room = new GameRoom('TEST');
    const aId = room.addPlayer('Anna', 'ta', recorder().member);
    room.broadcastChat(999, 'duch'); // nie ma takiego gracza
    room.broadcastChat(aId, ''); // pusto (connection sanityzuje wcześniej)
    expect(room.recentChat()).toHaveLength(0);
  });
});
