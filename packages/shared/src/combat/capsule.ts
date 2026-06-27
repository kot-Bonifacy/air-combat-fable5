import { Vector3 } from 'three';

// Geometria stref trafień (faza 22a): odcinek↔kapsuła. Kapsuła = odcinek osi (a→b)
// otoczony promieniem — dobrze modeluje DŁUGIE, CIENKIE bryły (skrzydło, kadłub, ogon),
// których pojedyncza sfera albo nie obejmuje (dziury), albo jest za gruba. Sfera zostaje
// dla zwartych stref (silnik/kabina/zbiornik) — patrz hit.ts (segmentSphereHitT).
//
// Test trafienia pociskiem: pocisk przemieszcza się o ODCINEK na tick (p0→p1, ~12 m przy
// 744 m/s), więc liczymy najmniejszy dystans między odcinkiem toru pocisku a osią kapsuły;
// trafienie, gdy ≤ promień (łapie też tunelowanie — oba końce poza, środek przechodzi).

const scratchD1 = new Vector3();
const scratchD2 = new Vector3();
const scratchR = new Vector3();
const scratchC1 = new Vector3();
const scratchC2 = new Vector3();

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Wynik najbliższego zbliżenia dwóch odcinków: parametry s,t ∈ [0,1] punktów. */
export interface ClosestSegResult {
  /** Parametr na pierwszym odcinku (p1→q1). */
  s: number;
  /** Parametr na drugim odcinku (p2→q2). */
  t: number;
}

/**
 * Najmniejszy KWADRAT odległości między odcinkami p1→q1 i p2→q2 (Ericson,
 * „Real-Time Collision Detection" §5.1.9). Wypełnia `out` parametrami s,t punktów
 * najbliższego zbliżenia. Zwraca dist². Obsługuje odcinki zdegenerowane (punkt).
 * Czysta matematyka, bez alokacji (scratch modułowy — jeden wątek, sekwencyjnie).
 */
export function closestSegmentSegment(
  p1: Vector3,
  q1: Vector3,
  p2: Vector3,
  q2: Vector3,
  out: ClosestSegResult,
): number {
  scratchD1.subVectors(q1, p1); // kierunek odcinka 1
  scratchD2.subVectors(q2, p2); // kierunek odcinka 2
  scratchR.subVectors(p1, p2);
  const a = scratchD1.lengthSq(); // |d1|²
  const e = scratchD2.lengthSq(); // |d2|²
  const f = scratchD2.dot(scratchR);
  const EPS = 1e-12;

  let s: number;
  let t: number;
  if (a <= EPS && e <= EPS) {
    // oba odcinki to punkty
    s = 0;
    t = 0;
  } else if (a <= EPS) {
    // pierwszy odcinek to punkt
    s = 0;
    t = clamp01(f / e);
  } else {
    const c = scratchD1.dot(scratchR);
    if (e <= EPS) {
      // drugi odcinek to punkt
      t = 0;
      s = clamp01(-c / a);
    } else {
      // ogólny przypadek 3D
      const b = scratchD1.dot(scratchD2);
      const denom = a * e - b * b; // ≥ 0 (nierówność Cauchy'ego-Schwarza)
      // równoległe (denom≈0) → dowolny s; bierzemy 0 i domykamy przez t
      s = denom > EPS ? clamp01((b * f - c * e) / denom) : 0;
      t = (b * s + f) / e;
      // t poza [0,1] → przypnij i przelicz s na przyciętym końcu
      if (t < 0) {
        t = 0;
        s = clamp01(-c / a);
      } else if (t > 1) {
        t = 1;
        s = clamp01((b - c) / a);
      }
    }
  }

  scratchC1.copy(p1).addScaledVector(scratchD1, s);
  scratchC2.copy(p2).addScaledVector(scratchD2, t);
  out.s = s;
  out.t = t;
  return scratchC1.distanceToSquared(scratchC2);
}

const scratchSeg: ClosestSegResult = { s: 0, t: 0 };

/**
 * Parametr t ∈ [0,1] najbliższego zbliżenia toru pocisku p0→p1 do kapsuły (oś a→b,
 * promień), gdy ten dystans ≤ promień; inaczej -1. t mierzy POŁOŻENIE wzdłuż toru
 * pocisku (jak segmentSphereHitT) — caller używa go do wyboru NAJWCZEŚNIEJ trafionej
 * strefy. Uwaga: to t najbliższego zbliżenia, nie wejścia w bryłę (wystarczające do
 * sortowania stref w simcade; promień jest mały względem długości toru).
 */
export function segmentCapsuleHitT(
  p0: Vector3,
  p1: Vector3,
  a: Vector3,
  b: Vector3,
  radius: number,
): number {
  const dist2 = closestSegmentSegment(p0, p1, a, b, scratchSeg);
  return dist2 <= radius * radius ? scratchSeg.s : -1;
}

/** Czy tor pocisku p0→p1 przecina kapsułę (oś a→b, promień). */
export function segmentCapsuleHit(
  p0: Vector3,
  p1: Vector3,
  a: Vector3,
  b: Vector3,
  radius: number,
): boolean {
  return segmentCapsuleHitT(p0, p1, a, b, radius) >= 0;
}
