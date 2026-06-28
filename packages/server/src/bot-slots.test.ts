import { describe, expect, it } from 'vitest';
import { MAX_PLAYERS_PER_ROOM, PLANE_TYPES, type ControlMessage } from '@air-combat/shared';
import { GameRoom } from './game-room';
import { MAX_BOTS_PER_ROOM } from './bot-manager';

// Lobby slotowe RTS (2026-06-26): host steruje botami PER DRUŻYNA — dodaje/usuwa/przenosi je i ustawia
// poziom per bot. Dzięki temu możliwe są DOWOLNE składy (np. „2 ludzi vs 6 botów"), czego stary auto-balans
// (boty zawsze wyrównywane) nie pozwalał. assignFactions honoruje jawne teamPref botów jak wybór człowieka.

function member(): { sendControl(m: ControlMessage): void; sendSnapshotBytes(): void } {
  return { sendControl() {}, sendSnapshotBytes() {} };
}

let tokenSeq = 0;
function add(room: GameRoom, nick = 'pilot'): number {
  return room.addPlayer(nick, `tok-${String(tokenSeq++)}`, member());
}

/** Id pierwszego bota w roster (hostAddBot zwraca void — id czytamy z roster). */
function firstBotId(room: GameRoom): number {
  const bot = room.roomPlayers().find((p) => p.isBot);
  if (!bot) throw new Error('brak bota w roster');
  return bot.id;
}

describe('lobby slotowe RTS — dowolne składy drużyn', () => {
  it('„2 ludzi vs 6 botów": obaj ludzie na drużynie 0, wszystkie 6 botów na drużynie 1 (przeżywa start)', () => {
    const room = new GameRoom('SLOT');
    room.mode = 'team';
    const a = add(room, 'alfa');
    const b = add(room, 'bravo');
    room.selectTeam(a, 0);
    room.selectTeam(b, 0);
    for (let i = 0; i < 6; i++) room.hostAddBot(1, 'normalny'); // 6 botów po stronie wroga
    expect(room.botCount).toBe(6);

    room.start();
    expect(room.factionOf(a)).toBe(0);
    expect(room.factionOf(b)).toBe(0);
    const team0 = room.roomPlayers().filter((p) => p.faction === 0);
    const team1 = room.roomPlayers().filter((p) => p.faction === 1);
    expect(team0.filter((p) => !p.isBot)).toHaveLength(2); // sami ludzie
    expect(team0.filter((p) => p.isBot)).toHaveLength(0);
    expect(team1).toHaveLength(6); // wszystkie boty po jednej stronie (NIE auto-balans)
    expect(team1.every((p) => p.isBot)).toBe(true);
  });

  it('bot dodany do drużyny dostaje jej frakcję natychmiast w poczekalni (WYSIWYG)', () => {
    const room = new GameRoom('WYS');
    room.mode = 'team';
    room.hostAddBot(1, 'normalny');
    const bot = room.roomPlayers().find((p) => p.isBot);
    expect(bot?.faction).toBe(1);
  });

  it('pojemność: liczba botów klampowana do MAX_BOTS_PER_ROOM i wolnych slotów', () => {
    const room = new GameRoom('CAP');
    room.mode = 'team';
    add(room, 'host'); // 1 człowiek
    for (let i = 0; i < MAX_BOTS_PER_ROOM + 3; i++) room.hostAddBot(0, 'normalny');
    expect(room.botCount).toBe(MAX_PLAYERS_PER_ROOM - 1); // 1 człowiek → 7 wolnych slotów
    expect(room.playerCount).toBe(MAX_PLAYERS_PER_ROOM); // pokój pełny, dalsze dodania = no-op
  });

  it('hostRemoveBot usuwa konkretnego bota', () => {
    const room = new GameRoom('RM');
    room.mode = 'team';
    room.hostAddBot(0, 'normalny');
    room.hostAddBot(1, 'normalny');
    expect(room.botCount).toBe(2);
    const botId = firstBotId(room);
    room.hostRemoveBot(botId);
    expect(room.botCount).toBe(1);
    expect(room.roomPlayers().some((p) => p.id === botId)).toBe(false);
  });

  it('hostEditBot przenosi bota do drugiej drużyny i zmienia jego poziom', () => {
    const room = new GameRoom('ED');
    room.mode = 'team';
    room.hostAddBot(0, 'latwy');
    const bot = room.roomPlayers().find((p) => p.isBot);
    expect(bot?.faction).toBe(0);
    expect(bot?.botDifficulty).toBe('latwy');
    room.hostEditBot(bot!.id, 1, 'trudny');
    expect(room.factionOf(bot!.id)).toBe(1);
    expect(room.botDifficultyOf(bot!.id)).toBe('trudny');
    // przeniesienie przeżywa start (jawne teamPref honorowane przez assignFactions)
    room.start();
    expect(room.factionOf(bot!.id)).toBe(1);
  });

  it('poziom jest PER bot (różne boty, różne poziomy)', () => {
    const room = new GameRoom('PB');
    room.mode = 'team';
    room.hostAddBot(0, 'latwy');
    room.hostAddBot(1, 'trudny');
    const bots = room.roomPlayers().filter((p) => p.isBot);
    expect(bots.map((b) => b.botDifficulty).sort()).toEqual(['latwy', 'trudny']);
  });

  it('hostAddBot wymusza model samolotu nowego bota (host wybiera typ przy „+ dodaj bota")', () => {
    const room = new GameRoom('PLANE');
    room.mode = 'team';
    room.hostAddBot(0, 'normalny', 'bf109');
    room.hostAddBot(1, 'trudny', 'spitfire');
    const bots = room.roomPlayers().filter((p) => p.isBot);
    const types = new Set(bots.map((b) => b.planeType));
    expect(types.has('bf109')).toBe(true);
    expect(types.has('spitfire')).toBe(true);
  });

  it('hostAddBot bez modelu (Losowy) → bot dostaje prawidłowy typ z puli (serwer losuje)', () => {
    const room = new GameRoom('RND');
    room.mode = 'team';
    room.hostAddBot(0, 'normalny'); // brak modelu = „Losowy"
    const bot = room.roomPlayers().find((p) => p.isBot);
    expect(bot).toBeDefined();
    expect(PLANE_TYPES).toContain(bot!.planeType);
  });

  it('roster: botDifficulty obecne TYLKO dla botów (ludzie bez pola)', () => {
    const room = new GameRoom('RD');
    room.mode = 'team';
    const a = add(room, 'human');
    room.hostAddBot(0, 'normalny');
    const human = room.roomPlayers().find((p) => p.id === a);
    const bot = room.roomPlayers().find((p) => p.isBot);
    expect(human?.botDifficulty).toBeUndefined();
    expect(bot?.botDifficulty).toBe('normalny');
  });

  it('boty-wypełniacze (addBot bez drużyny) NADAL auto-balansują się wokół jawnych slotów', () => {
    const room = new GameRoom('MIX');
    room.mode = 'team';
    room.hostAddBot(0, 'normalny'); // jawnie na 0
    room.hostAddBot(0, 'normalny'); // jawnie na 0
    const filler = [room.addBot('normalny'), room.addBot('normalny')]; // bez drużyny → wypełniacze
    room.start();
    // wypełniacze równoważą: 2 jawne na 0 → oba wypełniacze lecą na 1
    for (const id of filler) expect(room.factionOf(id)).toBe(1);
  });

  it('operacje na botach ignorowane poza stanem waiting (np. w trakcie meczu)', () => {
    const room = new GameRoom('WT');
    room.mode = 'team';
    add(room, 'host');
    room.hostAddBot(0, 'normalny');
    room.start(); // waiting → playing
    const before = room.botCount;
    room.hostAddBot(1, 'normalny');
    room.hostRemoveBot(firstBotId(room));
    expect(room.botCount).toBe(before); // bez zmian w trakcie meczu
  });

  it('FFA: addBot bez drużyny — frakcja = id (sloty drużynowe nie dotyczą FFA)', () => {
    const room = new GameRoom('FFA');
    const a = add(room, 'a');
    room.hostAddBot(null, 'normalny');
    room.start();
    const bot = room.roomPlayers().find((p) => p.isBot);
    expect(room.factionOf(a)).toBe(a);
    expect(bot && room.factionOf(bot.id)).toBe(bot?.id); // FFA: frakcja = id
  });
});
