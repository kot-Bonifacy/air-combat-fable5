import { Vector3 } from 'three';

// Wyprzedzenie / punkt przechwycenia (faza-06.md krok 2): gdzie celować nosem,
// by pocisk trafił manewrujący (tu: liniowy w chwili strzału) cel. Pocisk
// dziedziczy prędkość strzelca, więc rachunek prowadzimy w układzie strzelca.
//
// W tym układzie pozycja względna celu zmienia się z prędkością relVel =
// targetVel − shooterVel, a pocisk leci ze stałą prędkością `muzzleSpeed`
// w kierunku nosa. Szukamy czasu lotu t, dla którego |relPos + relVel·t| =
// muzzleSpeed·t. Po podniesieniu do kwadratu:
//   (|relVel|² − s²)·t² + 2·(relPos·relVel)·t + |relPos|² = 0
// To DOKŁADNE rozwiązanie dla celu lecącego po prostej (kryterium testu).
// Grawitację i opór pocisku pomijamy — na dystansach walki (≤ ~600 m, lot
// ≤ ~0.8 s) opad kompensuje przystrzelanie dział (convergenceRise), a błąd
// mieści się w promieniu trafienia. Iteracyjne uściślenie → backlog.

export interface LeadSolution {
  /** Czas lotu pocisku do przechwycenia [s]; -1 = brak rozwiązania (cel szybszy i ucieka). */
  timeToInterceptS: number;
  /** Kierunek świata, w który celować nosem (jednostkowy). Przy braku rozwiązania = LOS do celu. */
  aimDir: Vector3;
  /** Punkt przechwycenia w świecie [m]. */
  aimPoint: Vector3;
}

export function createLeadSolution(): LeadSolution {
  return { timeToInterceptS: -1, aimDir: new Vector3(0, 0, 1), aimPoint: new Vector3() };
}

const scratchRelPos = new Vector3();
const scratchRelVel = new Vector3();

/** Najmniejszy dodatni pierwiastek a·t²+b·t+c=0, albo -1 gdy brak. */
function smallestPositiveRoot(a: number, b: number, c: number): number {
  if (Math.abs(a) < 1e-9) {
    // równanie liniowe b·t + c = 0
    if (Math.abs(b) < 1e-12) return -1;
    const t = -c / b;
    return t > 0 ? t : -1;
  }
  const disc = b * b - 4 * a * c;
  if (disc < 0) return -1;
  const sq = Math.sqrt(disc);
  const t1 = (-b - sq) / (2 * a);
  const t2 = (-b + sq) / (2 * a);
  const lo = Math.min(t1, t2);
  const hi = Math.max(t1, t2);
  if (lo > 0) return lo;
  if (hi > 0) return hi;
  return -1;
}

/**
 * Rozwiązuje wyprzedzenie i zapisuje do `out`. `shooterVel` to prędkość
 * strzelca (pocisk ją dziedziczy). Gdy brak rozwiązania — aimDir = LOS do
 * bieżącej pozycji celu, timeToInterceptS = -1.
 */
export function solveLead(
  shooterPos: Vector3,
  shooterVel: Vector3,
  targetPos: Vector3,
  targetVel: Vector3,
  muzzleSpeedMs: number,
  out: LeadSolution,
): LeadSolution {
  scratchRelPos.subVectors(targetPos, shooterPos);
  scratchRelVel.subVectors(targetVel, shooterVel);

  const a = scratchRelVel.lengthSq() - muzzleSpeedMs * muzzleSpeedMs;
  const b = 2 * scratchRelPos.dot(scratchRelVel);
  const c = scratchRelPos.lengthSq();
  const t = smallestPositiveRoot(a, b, c);

  if (t < 0) {
    out.timeToInterceptS = -1;
    out.aimPoint.copy(targetPos);
    out.aimDir.copy(scratchRelPos);
    if (out.aimDir.lengthSq() < 1e-12) out.aimDir.set(0, 0, 1);
    else out.aimDir.normalize();
    return out;
  }

  out.timeToInterceptS = t;
  // punkt przechwycenia w świecie: gdzie cel będzie po czasie t
  out.aimPoint.copy(targetPos).addScaledVector(targetVel, t);
  // nos = kierunek składowej wylotowej pocisku = (relPos + relVel·t)/(s·t),
  // co jest jednostkowe z definicji równania; liczymy z relPos/relVel by uniknąć
  // odejmowania przyszłej pozycji strzelca
  out.aimDir
    .copy(scratchRelPos)
    .addScaledVector(scratchRelVel, t)
    .divideScalar(muzzleSpeedMs * t)
    .normalize();
  return out;
}
