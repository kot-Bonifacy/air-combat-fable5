import { Quaternion, Vector3 } from 'three';
import { MRAD_TO_RAD } from '../constants';
import type { Armament } from '../planes/loader';
import type { BulletPool } from './ballistics';

// Kontrola ognia (faza-05.md krok 4): kadencja, amunicja, konwergencja luf i
// rozrzut. Konwergencja to nie bajer — bez niej strumień z 8 luf w skrzydłach
// rozjeżdża się i trafianie frustruje (200 m = historyczny default RAF).
// Rozrzut z seeded RNG z shared: ten sam strumień liczb po obu stronach sieci
// przy tym samym seedzie (przygotowanie pod serwer w fazie 11).

/** Minimum stanu samolotu potrzebne do oddania strzału (PlaneState spełnia). */
export interface FiringPlatform {
  position: Vector3;
  velocity: Vector3;
  orientation: Quaternion;
}

/** Stan spustu/magazynka jednego samolotu. */
export interface FireControl {
  /** Czas do następnej możliwej salwy [s]; ≤0 = gotów. */
  cooldownS: number;
  /** Pozostała amunicja łącznie (wszystkie lufy). */
  ammoRemaining: number;
  /** Licznik wystrzelonych pocisków — co 3. jest smugaczem (tracer). */
  shotCounter: number;
}

export function totalAmmo(armament: Armament): number {
  return armament.ammoPerGun * armament.muzzles.length;
}

export function createFireControl(armament: Armament): FireControl {
  return { cooldownS: 0, ammoRemaining: totalAmmo(armament), shotCounter: 0 };
}

/** Odstęp między salwami [s] z kadencji jednej lufy (salwa = wszystkie naraz). */
export function volleyIntervalS(armament: Armament): number {
  return 60 / armament.fireRateRpmPerGun;
}

/**
 * Kierunek lufy w body frame: od wylotu do punktu harmonizacji
 * (0, riseM, convergenceM). Toe-in (zbieg ku osi) wynika z członów x/z, a `riseM`
 * podnosi punkt celowania nad oś o opad grawitacyjny na dystansie zbieżności —
 * bez tego pociski trafiają PONIŻEJ linii celownika („przystrzelanie" dział).
 */
export function aimDirectionBody(
  muzzleBody: Vector3,
  convergenceM: number,
  riseM: number,
  out: Vector3,
): Vector3 {
  return out.set(-muzzleBody.x, riseM - muzzleBody.y, convergenceM - muzzleBody.z).normalize();
}

const scratchRef = new Vector3();
const scratchE1 = new Vector3();
const scratchE2 = new Vector3();

/**
 * Losowe odchylenie kierunku w stożku o promieniu kątowym `halfAngleRad`
 * (rozkład ~równomierny na tarczy). `dir` musi być jednostkowy; mutowany in place.
 * Dwie liczby z `rng` ∈ [0,1). halfAngle=0 → bez zmian (test konwergencji).
 */
export function applyDispersion(
  dir: Vector3,
  halfAngleRad: number,
  rng: () => number,
  // dwie liczby pobierane ZAWSZE, też przy halfAngle=0, by strumień RNG nie
  // zależał od rozrzutu (determinizm klient↔serwer niezależny od strojenia)
): Vector3 {
  const u = rng();
  const v = rng();
  if (halfAngleRad <= 0) return dir;
  // baza prostopadła do dir: cross z osią najmniej z nim współliniową
  scratchRef.set(Math.abs(dir.x) < 0.9 ? 1 : 0, Math.abs(dir.x) < 0.9 ? 0 : 1, 0);
  scratchE1.crossVectors(dir, scratchRef).normalize();
  scratchE2.crossVectors(dir, scratchE1); // jednostkowy (dir⊥e1, oba unit)
  const phi = 2 * Math.PI * u;
  const offset = Math.tan(halfAngleRad * Math.sqrt(v)); // |offset| = tan(r) ⇒ kąt = r po normalizacji
  dir.addScaledVector(scratchE1, Math.cos(phi) * offset);
  dir.addScaledVector(scratchE2, Math.sin(phi) * offset);
  return dir.normalize();
}

const scratchMuzzleWorld = new Vector3();
const scratchDir = new Vector3();
const scratchVel = new Vector3();

/**
 * Jedna salwa: po jednym pocisku z każdej lufy (lub mniej, gdy kończy się
 * amunicja). Pocisk dziedziczy prędkość samolotu (muzzleVel jest względem niego).
 * Zwraca liczbę wystrzelonych pocisków.
 */
function fireVolley(
  fc: FireControl,
  armament: Armament,
  platform: FiringPlatform,
  ownerId: number,
  rng: () => number,
  pool: BulletPool,
  rewindTicks: number,
): number {
  const dispersionRad = armament.dispersionMrad * MRAD_TO_RAD;
  let fired = 0;
  for (const muzzle of armament.muzzles) {
    if (fc.ammoRemaining <= 0) break;
    scratchMuzzleWorld.set(muzzle[0], muzzle[1], muzzle[2]);
    aimDirectionBody(scratchMuzzleWorld, armament.convergenceM, armament.convergenceRiseM, scratchDir);
    applyDispersion(scratchDir, dispersionRad, rng);
    // body → world
    scratchDir.applyQuaternion(platform.orientation);
    scratchMuzzleWorld.applyQuaternion(platform.orientation).add(platform.position);
    scratchVel.copy(platform.velocity).addScaledVector(scratchDir, armament.muzzleVelocityMs);
    const tracer = fc.shotCounter % 3 === 0;
    fc.shotCounter++;
    pool.spawn(scratchMuzzleWorld, scratchVel, armament.damagePerHit, ownerId, tracer, rewindTicks);
    fc.ammoRemaining--;
    fired++;
  }
  return fired;
}

/**
 * Krok kontroli ognia — wołać co tick fizyki. Gdy spust trzymany i kadencja
 * pozwala, oddaje salwy (pętla while obsługuje też krok wolniejszy niż odstęp
 * salw, np. tryb F4). Zwraca liczbę pocisków wystrzelonych w tym ticku
 * (>0 = klient może błysnąć lufami).
 */
export function updateFire(
  fc: FireControl,
  armament: Armament,
  platform: FiringPlatform,
  ownerId: number,
  rng: () => number,
  pool: BulletPool,
  triggerHeld: boolean,
  dtS: number,
  // lag-compensation (faza 11): o ile ticków cofać cele dla pocisków z tej salwy.
  // 0 = offline/serwer lokalny (zachowanie z fazy 5 bez zmian).
  rewindTicks = 0,
): number {
  fc.cooldownS -= dtS;
  if (!triggerHeld) {
    if (fc.cooldownS < 0) fc.cooldownS = 0; // gotów do natychmiastowego strzału po naciśnięciu
    return 0;
  }
  const interval = volleyIntervalS(armament);
  let fired = 0;
  // limit iteracji = bezpiecznik przed pętlą przy patologicznym dtS
  for (let guard = 0; guard < 32 && fc.cooldownS <= 0 && fc.ammoRemaining > 0; guard++) {
    fired += fireVolley(fc, armament, platform, ownerId, rng, pool, rewindTicks);
    fc.cooldownS += interval;
  }
  return fired;
}
