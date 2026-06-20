import { describe, expect, it } from 'vitest';
import { FIXED_DT_S, type PlaneType } from '@air-combat/shared';
import { GameRoom } from './game-room';

// Sesja balansowa 1v1 (faza 19b). Harness pełnej walki SERWERA: dwa boty „trudny", po jednym na typ,
// FFA eliminacyjne (1 życie). Pojedynki są DETERMINISTYCZNE (boty seedowane id), więc test NIE jest
// flaky. Rola TESTU = gwarant odporności mieszanej walki dwóch typów (różne grupy broni, promienie
// trafień/kolizji, koperty osiągów): każdy pojedynek MUSI się rozstrzygnąć bez NaN/zawieszenia (step
// rzuciłby wyjątek). Wynik balansowy (rozkład zwycięstw) tylko LOGUJEMY — nie asercjonujemy „oba
// wygrywają", bo deterministyczne AI energetyczne nie turn-fightuje i faworyzuje Bf 109; prawdziwy
// balans zależy od stylu gry człowieka (playtest user-side). Szczegóły: memory faza19b. Każde ziarno
// gramy w obu ustawieniach slotów (kto jest id 0), by zdjąć bias pozycji.

/** Maks. długość pojedynku [ticki] — strefa KotH przejmuje się wcześniej, więc to bezpiecznik. */
const MAX_TICKS = Math.round(200 / FIXED_DT_S);

interface DuelResult {
  /** Typ zwycięzcy albo 'remis' (obustronna eliminacja) / 'brak' (nie rozstrzygnięto w limicie). */
  winner: PlaneType | 'remis' | 'brak';
  ticks: number;
}

function runDuel(seed: number, types: readonly [PlaneType, PlaneType]): DuelResult {
  const room = new GameRoom(`DUEL`, seed);
  const idA = room.addBot('trudny', types[0]);
  const idB = room.addBot('trudny', types[1]);
  room.start();
  let ticks = 0;
  for (; ticks < MAX_TICKS; ticks++) {
    room.step(FIXED_DT_S);
    if (room.state !== 'playing') break;
  }
  if (room.state === 'playing') return { winner: 'brak', ticks };
  const w = room.winnerId;
  if (w === null) return { winner: 'remis', ticks };
  return { winner: w === idA ? types[0] : w === idB ? types[1] : 'remis', ticks };
}

describe('sesja balansowa 1v1 (Spitfire ↔ Bf 109)', () => {
  it('mieszana walka dwóch typów rozstrzyga się czysto (odporność); loguje rozkład', () => {
    const seeds = [1, 2, 3, 4, 5, 6, 7, 8];
    const wins: Record<string, number> = { spitfire: 0, bf109: 0, remis: 0, brak: 0 };
    for (const seed of seeds) {
      for (const order of [
        ['spitfire', 'bf109'],
        ['bf109', 'spitfire'],
      ] as const) {
        const r = runDuel(seed, order);
        wins[r.winner] = (wins[r.winner] ?? 0) + 1;
      }
    }
    // rozkład do notatki balansowej (memory) — czyta go człowiek przy strojeniu danych
    console.info(
      `[balans 1v1] Spitfire ${String(wins.spitfire)} / Bf 109 ${String(wins.bf109)} / ` +
        `remis ${String(wins.remis)} / nierozstrzygnięte ${String(wins.brak)}`,
    );

    // GWARANT ODPORNOŚCI: każdy pojedynek mieszanych typów rozstrzyga się w limicie, bez NaN ani
    // zawieszenia (step rzuciłby wyjątek). Asercji „oba wygrywają" świadomie NIE ma — patrz nagłówek.
    expect(wins.brak).toBe(0);
    const resolved = (wins.spitfire ?? 0) + (wins.bf109 ?? 0) + (wins.remis ?? 0);
    expect(resolved).toBe(seeds.length * 2);
  }, 60_000);
});
