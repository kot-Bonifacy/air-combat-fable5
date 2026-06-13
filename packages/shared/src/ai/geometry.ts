import { Vector3 } from 'three';

// Geometria walki powietrznej (faza-06.md krok 1): skalary opisujące wzajemne
// położenie dwóch samolotów, na których FSM bota podejmuje decyzje. Wszystkie
// kąty w radianach. Konwencja zgodna z resztą projektu — body +Z = nos.
//
// Definicje (napastnik = "self", przeciwnik = "target"):
// - off-boresight napastnika: kąt nos_self ↔ LOS self→target (0 = cel na wprost),
// - off-boresight celu:       kąt nos_target ↔ LOS target→self (0 = my na wprost jego nosa),
// - aspekt:                    kąt nos_target ↔ LOS self→target (0 = jesteśmy za ogonem
//   celu / "na szóstej", π = czołowo). Zachodzi tożsamość aspect = π − targetOffBoresight.

const scratchCross = new Vector3();

/** Kąt między wektorami [rad] — atan2(|a×b|, a·b), stabilny też przy kątach ~0 i ~π. */
export function angleBetweenRad(a: Vector3, b: Vector3): number {
  return Math.atan2(scratchCross.crossVectors(a, b).length(), a.dot(b));
}

export interface AirCombatGeometry {
  /** Dystans między samolotami [m]. */
  rangeM: number;
  /** Off-boresight napastnika [rad]: nos self ↔ LOS self→target (0 = cel na wprost). */
  attackerOffBoresightRad: number;
  /** Off-boresight celu [rad]: nos target ↔ LOS target→self (0 = napastnik na wprost nosa celu). */
  targetOffBoresightRad: number;
  /** Aspekt [rad]: 0 = self za ogonem celu, π = czołowo (= π − targetOffBoresight). */
  aspectRad: number;
  /** Prędkość zbliżania [m/s], + = dystans maleje. */
  closureMs: number;
}

export function createGeometry(): AirCombatGeometry {
  return {
    rangeM: 0,
    attackerOffBoresightRad: 0,
    targetOffBoresightRad: Math.PI,
    aspectRad: Math.PI,
    closureMs: 0,
  };
}

const scratchLos = new Vector3();
const scratchRelVel = new Vector3();

/**
 * Liczy geometrię self↔target i zapisuje do `out`. `selfFwd`/`targetFwd` to
 * kierunki nosów (jednostkowe). Bez alokacji — używa buforów modułu, więc
 * wołać sekwencyjnie (jeden samolot na raz, co i tak robi pętla gry).
 */
export function computeGeometry(
  selfPos: Vector3,
  selfFwd: Vector3,
  selfVel: Vector3,
  targetPos: Vector3,
  targetFwd: Vector3,
  targetVel: Vector3,
  out: AirCombatGeometry,
): AirCombatGeometry {
  scratchLos.subVectors(targetPos, selfPos);
  const range = scratchLos.length();
  out.rangeM = range;
  if (range < 1e-6) {
    // dwa samoloty w tym samym punkcie — geometria zdegenerowana, zwróć "czołowo"
    out.attackerOffBoresightRad = 0;
    out.targetOffBoresightRad = Math.PI;
    out.aspectRad = Math.PI;
    out.closureMs = 0;
    return out;
  }
  scratchLos.divideScalar(range); // LOS self→target, jednostkowy

  out.attackerOffBoresightRad = angleBetweenRad(selfFwd, scratchLos);
  out.aspectRad = angleBetweenRad(targetFwd, scratchLos);
  // off-boresight celu = kąt(nos_target, −LOS) = π − aspekt (tożsamość kąta z wektorem przeciwnym)
  out.targetOffBoresightRad = Math.PI - out.aspectRad;

  scratchRelVel.subVectors(selfVel, targetVel);
  out.closureMs = scratchRelVel.dot(scratchLos);
  return out;
}

/**
 * Czy jestem na ogonie celu ("na szóstej"): celuję w niego (mały off-boresight)
 * i jestem za nim (mały aspekt), w zasięgu. To pozycja ofensywna.
 */
export function amIOnTargetTail(
  g: AirCombatGeometry,
  coneRad: number,
  maxRangeM: number,
): boolean {
  return (
    g.attackerOffBoresightRad < coneRad && g.aspectRad < coneRad && g.rangeM < maxRangeM
  );
}

/**
 * Czy cel jest na MOIM ogonie (zagrożenie): celuje we mnie (mały off-boresight
 * celu) i siedzi za mną (duży mój off-boresight = cel poza linią 3-9), w zasięgu.
 */
export function isTargetOnMyTail(
  g: AirCombatGeometry,
  coneRad: number,
  behindRad: number,
  maxRangeM: number,
): boolean {
  return (
    g.targetOffBoresightRad < coneRad &&
    g.attackerOffBoresightRad > behindRad &&
    g.rangeM < maxRangeM
  );
}
