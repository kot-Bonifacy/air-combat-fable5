import type { BotTuning } from './difficulty';

// Maszyna stanów bota (faza-06.md krok 3). CZYSTA logika przejść — bez wektorów
// i fizyki, żeby każde przejście dało się przetestować tablicą warunków.
// Sterowanie (jak realizować dany stan) żyje w bot.ts; tu tylko KIEDY zmienić stan.
//
// Stany:
//   patrol — krążenie, brak wykrytego przeciwnika w zasięgu,
//   engage — pościg z atakiem,
//   evade  — przeciwnik na ogonie, zrywanie pozycji,
//   extend — odbudowa energii (mała prędkość, brak bezpośredniego zagrożenia).
//
// Override unikania ziemi/areny NIE jest stanem — to nadrzędna warstwa w bot.ts.

export type BotStateName = 'patrol' | 'engage' | 'evade' | 'extend';

/** Skalary, na których FSM podejmuje decyzję (z geometry + stanu samolotu). */
export interface BotPerception {
  hasTarget: boolean;
  rangeM: number;
  /** Off-boresight napastnika [rad] — mały = celuję w cel. */
  attackerOffBoresightRad: number;
  /** Off-boresight celu [rad] — mały = cel celuje we mnie. */
  targetOffBoresightRad: number;
  /** Aspekt [rad] — mały = jestem za ogonem celu. */
  aspectRad: number;
  /** Moja prędkość wskazywana [m/s] — proxy energii. */
  iasMs: number;
  /** Krytyczne uszkodzenia (faza 22 cz.3): bot przerywa walkę i ucieka (silnik/ogień/skrzydło).
   *  Liczone przez serwer ze stanu uszkodzeń (boty są serwerowe — bez predykcji klienta). */
  criticalDamage: boolean;
}

/** Czy cel jest na moim ogonie (zagrożenie wymuszające evade). */
export function isThreatened(p: BotPerception, t: BotTuning): boolean {
  return (
    p.hasTarget &&
    p.targetOffBoresightRad < t.threatConeRad &&
    p.attackerOffBoresightRad > t.threatBehindRad &&
    p.rangeM < t.threatRangeM
  );
}

/** Czy jestem w pozycji ofensywnej (warto trzymać engage mimo małej energii). */
export function isOffensive(p: BotPerception, t: BotTuning): boolean {
  return p.attackerOffBoresightRad < t.offensiveConeRad && p.rangeM < t.offensiveRangeM;
}

/**
 * Następny stan FSM. Priorytety: brak celu → patrol; zagrożenie → evade
 * (nadrzędne nad engage/extend); krytyczne uszkodzenia → extend (ucieczka, faza 22 cz.3);
 * reszta wg bieżącego stanu z histerezą.
 */
export function nextBotState(
  current: BotStateName,
  p: BotPerception,
  t: BotTuning,
): BotStateName {
  if (!p.hasTarget) return 'patrol';
  if (isThreatened(p, t)) return 'evade';
  // krytyczne uszkodzenia (faza 22 cz.3): przerwij walkę i uciekaj — oddal się od wroga i zniżaj
  // (extend), zamiast dalej atakować. Po evade (gdy ktoś siedzi na ogonie), bo ostry break ratuje
  // skuteczniej; gdy nikt nie zagraża — extend wyprowadza z walki. Nadrzędne nad histerezą stanów
  // (zwrot tutaj pomija switch), więc raz uszkodzony bot nie wraca do engage przy odbudowie energii.
  if (p.criticalDamage) return 'extend';

  const lowEnergy = p.iasMs < t.lowEnergyIasMs;
  const recovered = p.iasMs > t.recoveredEnergyIasMs;

  switch (current) {
    case 'patrol':
      return p.rangeM < t.detectRangeM ? 'engage' : 'patrol';
    case 'engage':
      // mała energia i NIE w pozycji do strzału → oderwij się i odbuduj energię;
      // w pozycji ofensywnej dokończ atak mimo niskiej prędkości
      if (lowEnergy && !isOffensive(p, t)) return 'extend';
      if (p.rangeM > t.disengageRangeM) return 'patrol';
      return 'engage';
    case 'evade':
      // tu już !isThreatened (sprawdzone wyżej) — zagrożenie minęło
      if (lowEnergy) return 'extend';
      return p.rangeM < t.detectRangeM ? 'engage' : 'patrol';
    case 'extend':
      if (p.rangeM > t.disengageRangeM) return 'patrol';
      if (recovered) return 'engage';
      return 'extend';
  }
}
