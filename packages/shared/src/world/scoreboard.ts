import { ASSIST_POINTS, KILL_POINTS, ZONE_POINTS_PER_SECOND } from '../constants';

// Tabela wyników meczu (faza 7). CZYSTA logika (bez Three, bez DOM) — jak match.ts
// i zone.ts: ranking per pilot + agregat per drużyna da się przetestować tablicą
// wejść. Renderowanie nakładki żyje po stronie klienta (menu.ts).
//
// Model punktów:
//   • pilot:   zestrzelenia · KILL_POINTS + asysty · ASSIST_POINTS + sekundy strefy FRAKCJI · ZONE_POINTS_PER_SECOND
//   • drużyna: Σ zestrzeleń drużyny · KILL_POINTS + Σ asyst drużyny · ASSIST_POINTS + sekundy strefy frakcji · ZONE_POINTS_PER_SECOND
// Strefa jest własnością FRAKCJI (wspólna dla skrzydłowych). Świadoma decyzja:
// w punktach pilota doliczamy ją KAŻDEMU członkowi drużyny (wspólny cel wpływa na
// ranking pilotów), a w wyniku drużyny liczymy ją RAZ — więc suma punktów pilotów
// drużyny ≠ punkty drużyny. To celowe (dwa różne widoki), nie błąd zaokrąglenia.

/** Minimum stanu uczestnika do zbudowania tabeli (Combatant po stronie klienta to spełnia). */
export interface ScoreInput {
  /** Stabilny identyfikator (gracz = 0) — rozstrzyga remisy deterministycznie. */
  id: number;
  name: string;
  faction: number;
  isPlayer: boolean;
  /** Zestrzelenia WROGÓW (teamkill/samobójstwo już tu nie wchodzą). */
  kills: number;
  /** Asysty: trafienia WROGÓW, którzy zginęli później (bez dobitych przez siebie). */
  assists: number;
}

/** Wiersz pilota w tabeli (posortowany malejąco po punktach). */
export interface PilotScore {
  id: number;
  name: string;
  faction: number;
  isPlayer: boolean;
  kills: number;
  assists: number;
  /** Sekundy wyłącznej kontroli strefy frakcji pilota (wspólne dla drużyny). */
  zoneSeconds: number;
  points: number;
  /** Pozycja w rankingu, 1 = najlepszy. */
  rank: number;
}

/** Zagregowany wynik drużyny/frakcji (strefa liczona RAZ). */
export interface TeamScore {
  faction: number;
  kills: number;
  assists: number;
  zoneSeconds: number;
  points: number;
  rank: number;
  isPlayerTeam: boolean;
}

export interface Scoreboard {
  pilots: PilotScore[];
  teams: TeamScore[];
}

/** Punkty = zestrzelenia · KILL_POINTS + asysty · ASSIST_POINTS + sekundy strefy · ZONE_POINTS_PER_SECOND. */
export function scorePoints(kills: number, assists: number, zoneSeconds: number): number {
  return kills * KILL_POINTS + assists * ASSIST_POINTS + zoneSeconds * ZONE_POINTS_PER_SECOND;
}

/** Malejąco po punktach; remis → więcej zestrzeleń → asyst → strefy → gracz wyżej → niższy id. */
function comparePilots(a: PilotScore, b: PilotScore): number {
  return (
    b.points - a.points ||
    b.kills - a.kills ||
    b.assists - a.assists ||
    b.zoneSeconds - a.zoneSeconds ||
    (a.isPlayer === b.isPlayer ? a.id - b.id : a.isPlayer ? -1 : 1)
  );
}

/** Malejąco po punktach; remis → więcej zestrzeleń → asyst → drużyna gracza wyżej → niższa frakcja. */
function compareTeams(a: TeamScore, b: TeamScore): number {
  return (
    b.points - a.points ||
    b.kills - a.kills ||
    b.assists - a.assists ||
    (a.isPlayerTeam === b.isPlayerTeam ? a.faction - b.faction : a.isPlayerTeam ? -1 : 1)
  );
}

/**
 * Buduje tabelę wyników: ranking pilotów (per samolot) + agregat drużyn (per frakcja).
 * `zoneSecondsByFaction` to bezpośrednio `ZoneControl.secondsByFaction`.
 */
export function buildScoreboard(
  inputs: readonly ScoreInput[],
  zoneSecondsByFaction: ReadonlyMap<number, number>,
): Scoreboard {
  const playerFaction = inputs.find((p) => p.isPlayer)?.faction ?? null;

  const pilots: PilotScore[] = inputs.map((p) => {
    const zoneSeconds = zoneSecondsByFaction.get(p.faction) ?? 0;
    return {
      id: p.id,
      name: p.name,
      faction: p.faction,
      isPlayer: p.isPlayer,
      kills: p.kills,
      assists: p.assists,
      zoneSeconds,
      points: scorePoints(p.kills, p.assists, zoneSeconds),
      rank: 0,
    };
  });
  pilots.sort(comparePilots);
  pilots.forEach((p, i) => (p.rank = i + 1));

  // Agregat drużyn: sumujemy zestrzelenia frakcji, strefę bierzemy RAZ na frakcję.
  const byFaction = new Map<number, TeamScore>();
  for (const p of pilots) {
    let team = byFaction.get(p.faction);
    if (!team) {
      team = {
        faction: p.faction,
        kills: 0,
        assists: 0,
        zoneSeconds: zoneSecondsByFaction.get(p.faction) ?? 0,
        points: 0,
        rank: 0,
        isPlayerTeam: p.faction === playerFaction,
      };
      byFaction.set(p.faction, team);
    }
    team.kills += p.kills;
    team.assists += p.assists;
  }
  const teams = [...byFaction.values()];
  for (const t of teams) t.points = scorePoints(t.kills, t.assists, t.zoneSeconds);
  teams.sort(compareTeams);
  teams.forEach((t, i) => (t.rank = i + 1));

  return { pilots, teams };
}
