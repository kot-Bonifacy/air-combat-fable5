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
// Opór pocisku pomijamy — czas lotu z tej stałej prędkości lekko go zaniża.
//
// Grawitacja: domyślnie pomijana (gravityMs2=0), bo `convergenceRise` przystrzeliwuje
// działa i na ~200 m opad jest skompensowany. ALE dalej opad rośnie (½·g·t²) i na 350 m
// pocisk pada ~0,9 m pod cel, na 550 m ~2,6 m (zmierzone) — dla precyzyjnego strzelca
// (bot „as") to za dużo. Gdy `gravityMs2 > 0`, podnosimy namiar o ½·g·t² (kierunek startowy,
// który po czasie t opadnie DOKŁADNIE w cel) — ten sam wzór, którym celują działka AA
// (world/emplacement.ts). t liczone bez grawitacji (sprzężenie 2. rzędu, pomijalne na tych t).

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
 *
 * `gravityMs2` (domyślnie 0 = bez kompensacji, jak dotąd): gdy > 0, namiar podnoszony
 * o ½·gravityMs2·t², by pocisk opadający w polu grawitacji trafił w cel na dystansie
 * (kompensacja opadu — patrz nagłówek). Bot „as" podaje tu g·leadGravityFrac.
 */
export function solveLead(
  shooterPos: Vector3,
  shooterVel: Vector3,
  targetPos: Vector3,
  targetVel: Vector3,
  muzzleSpeedMs: number,
  out: LeadSolution,
  gravityMs2 = 0,
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
  // podniesienie namiaru kompensujące opad grawitacyjny na czasie lotu (0 = brak kompensacji)
  const gravRise = 0.5 * gravityMs2 * t * t;
  // punkt przechwycenia w świecie: gdzie cel będzie po czasie t (+ kompensacja opadu w pionie świata)
  out.aimPoint.copy(targetPos).addScaledVector(targetVel, t);
  out.aimPoint.y += gravRise;
  // nos = kierunek składowej wylotowej pocisku = (relPos + relVel·t + ½g t²·ŷ)/(s·t),
  // co jest jednostkowe (bez grawitacji z definicji równania; człon grawitacji to mała korekta
  // startowego kierunku, by po czasie t pocisk opadł w cel); normalize domyka jednostkowość.
  out.aimDir
    .copy(scratchRelPos)
    .addScaledVector(scratchRelVel, t)
    .divideScalar(muzzleSpeedMs * t);
  out.aimDir.y += gravRise / (muzzleSpeedMs * t);
  out.aimDir.normalize();
  return out;
}
