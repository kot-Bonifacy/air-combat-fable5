import { Quaternion, Vector3 } from 'three';
import { MRAD_TO_RAD } from '../constants';
import type { Armament, WeaponGroup } from '../planes/loader';
import type { BulletPool } from './ballistics';

// Kontrola ognia (faza-05.md krok 4): kadencja, amunicja, konwergencja luf i
// rozrzut. Konwergencja to nie bajer — bez niej strumień z 8 luf w skrzydłach
// rozjeżdża się i trafianie frustruje (200 m = historyczny default RAF).
// Rozrzut z seeded RNG z shared: ten sam strumień liczb po obu stronach sieci
// przy tym samym seedzie (przygotowanie pod serwer w fazie 11).
//
// Faza 19: samolot ma WIELE grup broni (Bf 109 E-3: 2× MG 17 + 2× MG FF). Każda
// grupa strzela niezależnie własną kadencją i produkuje pociski o własnej balistyce
// (prędkość/opór/czas życia → różny tracer i łuk). FireControl trzyma stan per grupa.

/** Minimum stanu samolotu potrzebne do oddania strzału (PlaneState spełnia). */
export interface FiringPlatform {
  position: Vector3;
  velocity: Vector3;
  orientation: Quaternion;
}

/** Stan spustu/magazynka JEDNEJ grupy broni. */
export interface GroupFireControl {
  /** Czas do następnej możliwej salwy tej grupy [s]; ≤0 = gotów. */
  cooldownS: number;
  /** Pozostała amunicja grupy łącznie (wszystkie lufy grupy). */
  ammoRemaining: number;
  /** Licznik wystrzelonych pocisków grupy — co 3. jest smugaczem (tracer). */
  shotCounter: number;
}

/** Stan spustu/magazynka całego samolotu — po jednym podstanie na grupę broni. */
export interface FireControl {
  /**
   * Łączna pozostała amunicja (suma wszystkich grup) — cache trzymany na bieżąco,
   * by snapshot (faza 14) kodował ułamek amunicji bez sumowania grup przy każdym
   * enkodowaniu. Niezmiennik: `ammoRemaining === Σ groups[i].ammoRemaining`.
   */
  ammoRemaining: number;
  /** Stan per grupa broni (równoległy do `armament.groups`). */
  groups: GroupFireControl[];
}

/** Amunicja jednej grupy = zapas na lufę × liczba luf grupy. */
function groupAmmo(group: WeaponGroup): number {
  return group.ammoPerGun * group.muzzles.length;
}

/** Łączny zapas amunicji samolotu (wszystkie grupy, wszystkie lufy). */
export function totalAmmo(armament: Armament): number {
  let sum = 0;
  for (const g of armament.groups) sum += groupAmmo(g);
  return sum;
}

/** Wszystkie pozycje luf samolotu (spłaszczone grupy) — do błysków wylotowych w kliencie. */
export function allMuzzles(armament: Armament): readonly (readonly [number, number, number])[] {
  return armament.groups.flatMap((g) => g.muzzles);
}

/**
 * Grupa „główna" (pierwsza zadeklarowana) — reprezentatywna broń tam, gdzie potrzeba
 * JEDNEJ (wyprzedzenie bota: rachunek z jedną prędkością wylotową; kosmetyczne smugacze
 * online). JSON ma listować dominujący typ pierwszy.
 */
export function primaryGroup(armament: Armament): WeaponGroup {
  const g = armament.groups[0];
  if (!g) throw new Error('armament.groups puste — walidacja loadera powinna to złapać');
  return g;
}

export function createFireControl(armament: Armament): FireControl {
  return {
    ammoRemaining: totalAmmo(armament),
    groups: armament.groups.map((g) => ({ cooldownS: 0, ammoRemaining: groupAmmo(g), shotCounter: 0 })),
  };
}

/** Reset spustu i magazynka do pełna (nowe życie/respawn) — pełny zapas, cooldowny zerowane. */
export function resetFireControl(fc: FireControl, armament: Armament): void {
  fc.ammoRemaining = totalAmmo(armament);
  armament.groups.forEach((g, i) => {
    const gfc = fc.groups[i];
    if (!gfc) return;
    gfc.cooldownS = 0;
    gfc.ammoRemaining = groupAmmo(g);
    gfc.shotCounter = 0;
  });
}

/** Odstęp między salwami grupy [s] z kadencji jednej lufy (salwa = wszystkie lufy grupy naraz). */
export function volleyIntervalS(group: WeaponGroup): number {
  return 60 / group.fireRateRpmPerGun;
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
 * Jedna salwa JEDNEJ grupy: po jednym pocisku z każdej lufy grupy (lub mniej, gdy
 * kończy się amunicja). Pocisk dziedziczy prędkość samolotu (muzzleVel względem niego)
 * oraz balistykę grupy (dragK, lifetime). Zwraca liczbę wystrzelonych pocisków.
 */
function fireGroupVolley(
  fc: FireControl,
  gfc: GroupFireControl,
  group: WeaponGroup,
  platform: FiringPlatform,
  ownerId: number,
  rng: () => number,
  pool: BulletPool,
  rewindTicks: number,
): number {
  const dispersionRad = group.dispersionMrad * MRAD_TO_RAD;
  let fired = 0;
  for (const muzzle of group.muzzles) {
    if (gfc.ammoRemaining <= 0) break;
    scratchMuzzleWorld.set(muzzle[0], muzzle[1], muzzle[2]);
    aimDirectionBody(scratchMuzzleWorld, group.convergenceM, group.convergenceRiseM, scratchDir);
    applyDispersion(scratchDir, dispersionRad, rng);
    // body → world
    scratchDir.applyQuaternion(platform.orientation);
    scratchMuzzleWorld.applyQuaternion(platform.orientation).add(platform.position);
    scratchVel.copy(platform.velocity).addScaledVector(scratchDir, group.muzzleVelocityMs);
    const tracer = gfc.shotCounter % 3 === 0;
    gfc.shotCounter++;
    pool.spawn(
      scratchMuzzleWorld,
      scratchVel,
      group.damagePerHit,
      ownerId,
      tracer,
      group.bulletDragK,
      group.bulletLifetimeS,
      rewindTicks,
    );
    gfc.ammoRemaining--;
    fc.ammoRemaining--;
    fired++;
  }
  return fired;
}

/**
 * Krok kontroli ognia — wołać co tick fizyki. Gdy spust trzymany i kadencja
 * pozwala, KAŻDA grupa broni oddaje swoje salwy niezależnie (różne kadencje →
 * MG 17 prują gęsto, MG FF rzadziej). Pętla while obsługuje też krok wolniejszy
 * niż odstęp salw. Zwraca łączną liczbę pocisków wystrzelonych w tym ticku
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
  let fired = 0;
  armament.groups.forEach((group, i) => {
    const gfc = fc.groups[i];
    if (!gfc) return;
    gfc.cooldownS -= dtS;
    if (!triggerHeld) {
      if (gfc.cooldownS < 0) gfc.cooldownS = 0; // gotów do natychmiastowego strzału po naciśnięciu
      return;
    }
    const interval = volleyIntervalS(group);
    // limit iteracji = bezpiecznik przed pętlą przy patologicznym dtS
    for (let guard = 0; guard < 32 && gfc.cooldownS <= 0 && gfc.ammoRemaining > 0; guard++) {
      fired += fireGroupVolley(fc, gfc, group, platform, ownerId, rng, pool, rewindTicks);
      gfc.cooldownS += interval;
    }
  });
  return fired;
}
