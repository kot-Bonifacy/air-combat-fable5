import { Vector3 } from 'three';
import { GRAVITY_MS2 } from '../constants';

// Balistyka pocisku (faza 5, docs/phases/faza-05.md): punkt materialny z
// grawitacją i oporem KWADRATOWYM a = −k·|v|·v (decyzja użytkownika 2026-06-13:
// realistyczniejszy spadek prędkości niż liniowy). Całkowanie semi-implicit
// Euler tym samym schematem co samolot (physics/loop.ts) — krok 1/60 s.
//
// Własności analityczne modelu (do testów): wzdłuż toru bez grawitacji
// dv/dx = −k·v ⇒ v(x) = v0·e^(−k·x); k ma jednostkę [1/m].

/**
 * Pocisk w puli. Bufory Vector3 alokowane RAZ przy budowie puli — spawn/krok
 * tylko je nadpisują (niezmiennik: zero alokacji w hot pathcie).
 */
export interface Bullet {
  /** Pozycja w układzie świata [m]. */
  position: Vector3;
  /** Pozycja na początku bieżącego ticku [m] — start odcinka do hit-detekcji. */
  prevPosition: Vector3;
  /** Punkt wylotu (spawn) [m] — render smugi przycina ślad, by nie wychodził za lufę. */
  origin: Vector3;
  /** Prędkość w układzie świata [m/s]. */
  velocity: Vector3;
  /** Wiek [s] — pocisk gaśnie po przekroczeniu czasu życia. */
  ageS: number;
  /** Czy slot jest w użyciu. */
  active: boolean;
  /** Obrażenia zadawane przez to trafienie [HP]. */
  damage: number;
  /**
   * Współczynnik oporu kwadratowego k [1/m] tego pocisku (a = −k·|v|·v). PER POCISK,
   * bo jedna pula miesza typy o różnej balistyce (faza 19: .303 vs łukowy 20 mm MG FF).
   */
  dragK: number;
  /** Czas życia [s] — po nim slot gaśnie (cap zasięgu; per pocisk, różny dla typów broni). */
  lifetimeS: number;
  /** Id właściciela (kill credit; teraz lokalnie 0, używane od fazy 11). */
  ownerId: number;
  /** Czy klient ma rysować ten pocisk jako smugę (co N-ty — ustawia spawner). */
  tracer: boolean;
  /**
   * Lag-compensation (faza 11): o tyle ticków cofamy CELE przy hit-detekcji tego
   * pocisku (= opóźnienie strzelca w chwili strzału). 0 = bez rewindu (offline/serwer
   * lokalny). Stałe przez całe życie pocisku — tor leci w „teraźniejszości", a cel jest
   * porównywany w pozycji opóźnionej o tę samą wartość („co widzę, to trafiam").
   */
  rewindTicks: number;
}

function createBullet(): Bullet {
  return {
    position: new Vector3(),
    prevPosition: new Vector3(),
    origin: new Vector3(),
    velocity: new Vector3(),
    ageS: 0,
    active: false,
    damage: 0,
    dragK: 0,
    lifetimeS: 0,
    ownerId: 0,
    tracer: false,
    rewindTicks: 0,
  };
}

/**
 * Jeden krok pocisku: grawitacja + opór kwadratowy a = −k·|v|·v, przyspieszenie
 * liczone z prędkości na POCZĄTKU kroku (explicit dla członu oporu). `dragK`
 * [1/m] z konfiguracji uzbrojenia (0 = balistyka próżniowa).
 *
 * Pozycja: p += v·dt + ½·a·dt² (NIE p += v_new·dt jak w locie samolotu). Człon
 * ½·a·dt² czyni opad grawitacyjny DOKŁADNYM (semi-implicit Euler zawyżałby go
 * o ~1/n na krótkim locie — przy 300 m ≈ 4%, ponad próg balistyki ±2%). Pocisk
 * to osobny punkt bez rotacji, więc może mieć dokładniejszy schemat niż płatowiec.
 *
 * `prevPosition` zapisywane PRZED ruchem — odcinek prev→pos jest wejściem do
 * hit-detekcji (segment vs sfera). `dragK` brany Z POCISKU (różny per typ broni).
 */
export function stepBullet(bullet: Bullet, dtS: number): void {
  bullet.prevPosition.copy(bullet.position);
  const v = bullet.velocity;
  const dragMag = bullet.dragK * v.length();
  const ax = -dragMag * v.x;
  const ay = -GRAVITY_MS2 - dragMag * v.y;
  const az = -dragMag * v.z;
  const halfDt2 = 0.5 * dtS * dtS;
  bullet.position.x += v.x * dtS + ax * halfDt2;
  bullet.position.y += v.y * dtS + ay * halfDt2;
  bullet.position.z += v.z * dtS + az * halfDt2;
  v.x += ax * dtS;
  v.y += ay * dtS;
  v.z += az * dtS;
  bullet.ageS += dtS;
}

/**
 * Pula pocisków o stałej pojemności. Spawn znajduje wolny (lub najstarszy)
 * slot i nadpisuje go bez alokacji; update kroczy wszystkimi aktywnymi i gasi
 * te, które przeżyły dłużej niż `lifetimeS`. Hit-detekcję robi caller (czyta
 * `bullets` i bierze odcinek prevPosition→position każdego aktywnego pocisku).
 */
export class BulletPool {
  readonly bullets: readonly Bullet[];

  constructor(capacity: number) {
    const arr: Bullet[] = new Array<Bullet>(capacity);
    for (let i = 0; i < capacity; i++) arr[i] = createBullet();
    this.bullets = arr;
  }

  /** Liczba aktywnych pocisków (diagnostyka / HUD). */
  get activeCount(): number {
    let n = 0;
    for (const b of this.bullets) if (b.active) n++;
    return n;
  }

  /**
   * Wstawia pocisk do puli i zwraca jego referencję (lub null, gdy brak slotu —
   * przy poprawnie dobranej pojemności nieosiągalne). Nadpisuje wektory in place.
   */
  spawn(
    position: Vector3,
    velocity: Vector3,
    damage: number,
    ownerId: number,
    tracer: boolean,
    dragK: number,
    lifetimeS: number,
    rewindTicks = 0,
  ): Bullet | null {
    const slot = this.freeSlot();
    if (slot === null) return null;
    slot.position.copy(position);
    slot.prevPosition.copy(position);
    slot.origin.copy(position);
    slot.velocity.copy(velocity);
    slot.ageS = 0;
    slot.active = true;
    slot.damage = damage;
    slot.dragK = dragK;
    slot.lifetimeS = lifetimeS;
    slot.ownerId = ownerId;
    slot.tracer = tracer;
    slot.rewindTicks = rewindTicks;
    return slot;
  }

  /** Kroczy wszystkie aktywne pociski; gasi te starsze niż ICH `lifetimeS` (per pocisk). */
  update(dtS: number): void {
    for (const b of this.bullets) {
      if (!b.active) continue;
      stepBullet(b, dtS);
      if (b.ageS >= b.lifetimeS) b.active = false;
    }
  }

  /** Zwalnia slot (np. po trafieniu) — caller dezaktywuje też ręcznie b.active. */
  deactivate(bullet: Bullet): void {
    bullet.active = false;
  }

  private freeSlot(): Bullet | null {
    let oldest: Bullet | null = null;
    let oldestAge = -Infinity;
    for (const b of this.bullets) {
      if (!b.active) return b;
      if (b.ageS > oldestAge) {
        oldestAge = b.ageS;
        oldest = b;
      }
    }
    return oldest; // pula pełna: nadpisz najstarszy (graceful degradation)
  }
}
