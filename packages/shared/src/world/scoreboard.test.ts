import { describe, expect, it } from 'vitest';
import { ASSIST_POINTS, KILL_POINTS, ZONE_POINTS_PER_SECOND } from '../constants';
import { buildScoreboard, scorePoints, type ScoreInput } from './scoreboard';

const player = (kills: number, assists = 0): ScoreInput => ({
  id: 0,
  name: 'Ty',
  faction: 0,
  isPlayer: true,
  kills,
  assists,
});
const bot = (id: number, faction: number, kills: number, assists = 0): ScoreInput => ({
  id,
  name: `Bot ${id}`,
  faction,
  isPlayer: false,
  kills,
  assists,
});

describe('scorePoints', () => {
  it('łączy zestrzelenia, asysty i sekundy strefy wg stałych', () => {
    expect(scorePoints(2, 3, 60)).toBe(
      2 * KILL_POINTS + 3 * ASSIST_POINTS + 60 * ZONE_POINTS_PER_SECOND,
    );
  });
});

describe('buildScoreboard — asysty', () => {
  it('dolicza ASSIST_POINTS za każdą asystę pilota', () => {
    const inputs = [player(1, 2), bot(1, 1, 0, 0)];
    const { pilots } = buildScoreboard(inputs, new Map());
    const me = pilots.find((p) => p.isPlayer);
    expect(me).toMatchObject({ kills: 1, assists: 2, points: KILL_POINTS + 2 * ASSIST_POINTS });
  });

  it('sumuje asysty drużyny do jej punktów', () => {
    // drużyna gracza (0): gracz 1 zestrz. + 1 asysta, skrzydłowy 0 zestrz. + 2 asysty
    const inputs = [player(1, 1), bot(1, 0, 0, 2), bot(2, 1, 0, 0)];
    const { teams } = buildScoreboard(inputs, new Map());
    const mine = teams.find((t) => t.isPlayerTeam);
    expect(mine).toMatchObject({ kills: 1, assists: 3, points: KILL_POINTS + 3 * ASSIST_POINTS });
  });
});

describe('buildScoreboard — piloci', () => {
  it('sortuje malejąco po punktach i nadaje rangi 1..n', () => {
    const inputs = [player(1), bot(1, 1, 3), bot(2, 2, 0)];
    // strefa: frakcja gracza (0) trzyma 90 s → +90 pkt
    const zone = new Map<number, number>([[0, 90]]);
    const { pilots } = buildScoreboard(inputs, zone);

    // Bot 1: 3·100 = 300 > Ty: 1·100 + 90 strefy = 190 > Bot 2: 0
    expect(pilots.map((p) => p.name)).toEqual(['Bot 1', 'Ty', 'Bot 2']);
    expect(pilots[0]).toMatchObject({ name: 'Bot 1', points: 3 * KILL_POINTS, rank: 1 });
    expect(pilots[1]).toMatchObject({ name: 'Ty', points: 1 * KILL_POINTS + 90, rank: 2 });
    expect(pilots[2]).toMatchObject({ name: 'Bot 2', points: 0, rank: 3 });
  });

  it('doczepia sekundy strefy KAŻDEMU pilotowi jego frakcji', () => {
    const inputs = [player(0), bot(1, 0, 0)]; // obaj we frakcji 0
    const zone = new Map<number, number>([[0, 120]]);
    const { pilots } = buildScoreboard(inputs, zone);
    expect(pilots.every((p) => p.zoneSeconds === 120)).toBe(true);
    expect(pilots.every((p) => p.points === 120 * ZONE_POINTS_PER_SECOND)).toBe(true);
  });

  it('remis punktowy: gracz przed botem przy tej samej liczbie punktów', () => {
    const inputs = [bot(1, 1, 1), player(1)]; // obaj 100 pkt, brak strefy
    const { pilots } = buildScoreboard(inputs, new Map());
    expect(pilots[0]?.isPlayer).toBe(true);
  });
});

describe('buildScoreboard — drużyny', () => {
  it('sumuje zestrzelenia frakcji, ale strefę liczy RAZ', () => {
    // drużyna gracza (0): gracz 2 + skrzydłowy 1 = 3 zestrzelenia, strefa 60 s
    // drużyna wroga (1): dwóch wrogów po 1 = 2 zestrzelenia, brak strefy
    const inputs = [player(2), bot(1, 0, 1), bot(2, 1, 1), bot(3, 1, 1)];
    const zone = new Map<number, number>([[0, 60]]);
    const { teams } = buildScoreboard(inputs, zone);

    expect(teams).toHaveLength(2);
    const mine = teams.find((t) => t.isPlayerTeam);
    const foe = teams.find((t) => !t.isPlayerTeam);
    expect(mine).toMatchObject({ kills: 3, zoneSeconds: 60, points: 3 * KILL_POINTS + 60 });
    expect(foe).toMatchObject({ kills: 2, zoneSeconds: 0, points: 2 * KILL_POINTS });
    // drużyna gracza ma więcej punktów → rank 1
    expect(teams[0]?.isPlayerTeam).toBe(true);
  });

  it('FFA: każda frakcja to jeden pilot → drużyna == pilot', () => {
    const inputs = [player(0), bot(1, 1, 2), bot(2, 2, 0)];
    const { teams } = buildScoreboard(inputs, new Map());
    expect(teams).toHaveLength(3);
    expect(teams[0]).toMatchObject({ faction: 1, kills: 2 });
  });
});
