// Stan meczu eliminacyjnego (faza 7: tryby multi — FFA i drużynowy). CZYSTA
// logika decyzji o końcu meczu: bez Three i bez stanu klienta, żeby każdą regułę
// dało się przetestować tablicą uczestników. Orkiestracja (respawny, kamera,
// HUD) żyje po stronie klienta — tu tylko KIEDY mecz się kończy i kto wygrał.
//
// Model: każdy uczestnik należy do FRAKCJI (drużyny) i ma pulę żyć (samolotów).
// Frakcja jest „w grze", dopóki ma choć jeden samolot (życie). Mecz kończy się,
// gdy zostaje jedna frakcja (zwycięstwo tej frakcji) — a z punktu widzenia gracza
// dodatkowo, gdy jego własna frakcja straci wszystkie samoloty (porażka), nawet
// jeśli w FFA inne frakcje walczą jeszcze między sobą.

/** Minimum stanu uczestnika do rozstrzygnięcia meczu. */
export interface MatchMember {
  /** Identyfikator frakcji/drużyny (w FFA każdy uczestnik ma własny). */
  faction: number;
  /** Pozostała liczba samolotów (żyć); > 0 = frakcja wciąż może latać. */
  livesLeft: number;
}

/** Wynik meczu z perspektywy frakcji gracza. */
export type MatchOutcome = 'ongoing' | 'won' | 'lost';

/** Zbiór frakcji, które mają jeszcze choć jeden samolot (życie). */
export function factionsInPlay(members: readonly MatchMember[]): Set<number> {
  const set = new Set<number>();
  for (const m of members) if (m.livesLeft > 0) set.add(m.faction);
  return set;
}

/**
 * Rozstrzygnięcie meczu eliminacyjnego widziane oczami frakcji gracza:
 * - 'lost'    — frakcja gracza nie ma już żadnego samolotu,
 * - 'won'     — w grze została wyłącznie frakcja gracza,
 * - 'ongoing' — walczą co najmniej dwie frakcje (w tym gracza).
 * Kolejność sprawdzeń ma znaczenie: utrata frakcji gracza to porażka nawet wtedy,
 * gdy obie strony „padły" w tym samym ticku (np. wzajemne zestrzelenie ostatnich).
 */
export function matchOutcome(
  playerFaction: number,
  members: readonly MatchMember[],
): MatchOutcome {
  const inPlay = factionsInPlay(members);
  if (!inPlay.has(playerFaction)) return 'lost';
  return inPlay.size <= 1 ? 'won' : 'ongoing';
}
