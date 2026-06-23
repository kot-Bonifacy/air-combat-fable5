import { PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { getForward, getUp } from '@air-combat/shared';

// Kamera pościgowa (faza 3): za ogonem, z wyprzedzeniem skrętu (punkt patrzenia ciągnięty
// w stronę wektora prędkości). Horyzont w miarę stabilny: up kamery to mieszanka pionu świata
// i góry kadłuba.
//
// TŁUMACZENIE DRŻENIA (2026-06-23): kamera jest SZTYWNO przyklejona do pozycji renderu samolotu
// w TRANSLACJI — wygładzamy tylko OBRÓT offsetu (wektor „za ogon + nad kadłub"), nie pozycję
// absolutną. Wcześniej wygładzana była pozycja absolutna: korekta rekonsyliacji (±~1,5 m co
// snapshot) ruszała meshem samolotu, a leniwa kamera jej nie nadążała → samolot „pływał"
// względem kamery = drżenie. Teraz ta sama korekta rusza kamerą i meshem RAZEM (jak kamera
// orbitalna, która nie drżała) → samolot stoi w kadrze, drobny ruch przejmuje odległy świat.

const DISTANCE_M = 16;
const HEIGHT_M = 4.5;
/**
 * Zoom kółkiem myszy (decyzja użytkownika 2026-06-23): mnożnik całego offsetu kamery
 * (dolly wzdłuż wektora „za ogon + nad kadłub"). Przybliżenie = precyzyjne celowanie,
 * oddalenie = łatwiejsze manewrowanie (więcej otoczenia w kadrze). Mnożymy CAŁY offset,
 * więc proporcje (kąt patrzenia) zostają — to czysty dolly. Domyślnie 1.0 = 16 m jak dawniej.
 * Zmiana zoomu jest wygładzana razem z offsetem (OFFSET_TAU_S) → płynne przybliżanie.
 */
const MIN_ZOOM = 0.56; // ≈ 9 m za ogonem
const MAX_ZOOM = 3.0; // ≈ 48 m za ogonem
/** Krok zoomu na „ząbek" kółka (jak OrbitCamera, nieco drobniejszy). */
const ZOOM_STEP = 1.12;
/** Stała czasowa wygładzania OBROTU offsetu kamery [s] — płynne wchodzenie za ogon w zakręcie. */
const OFFSET_TAU_S = 0.22;
/**
 * Stała czasowa wygładzania wektora prędkości [s]. Surowa prędkość aktualizuje się
 * skokowo co tick fizyki 60 Hz — przy fps > 60 ten schodek przebija do punktu lookAt
 * i objawia się drżeniem kierunku patrzenia (horyzontu). Filtr 1. rzędu (krótszy niż
 * offsetowy — wyprzedzenie skrętu zostaje czujne) sprawia, że punkt patrzenia zależy
 * WYŁĄCZNIE od gładkich wielkości. Pozycja i orientacja przychodzą już interpolowane.
 */
const VELOCITY_TAU_S = 0.1;
/** Ile przechylenia samolotu przejmuje kamera (0 = sztywny horyzont). */
const ROLL_FOLLOW = 0.35;
/** Wyprzedzenie skrętu: punkt patrzenia = pozycja + mix(nos, kierunek lotu). */
const LOOK_AHEAD_M = 60;
const LOOK_VELOCITY_BLEND = 0.45;
/** Amplituda drgań buffetu przy pełnej intensywności [m]. */
const BUFFET_SHAKE_M = 0.35;

const WORLD_UP = new Vector3(0, 1, 0);

const scratchFwd = new Vector3();
const scratchUp = new Vector3();
const scratchOffset = new Vector3();
const scratchLook = new Vector3();
const scratchVHat = new Vector3();

export class ChaseCamera {
  /** Wektor od samolotu DO kamery (za ogonem + nad kadłubem) — wygładzany jest tylko jego obrót. */
  private readonly smoothedOffset = new Vector3();
  private readonly smoothedVel = new Vector3();
  private initialized = false;
  /** Mnożnik dystansu kamery (kółko myszy). Trwa w obrębie sesji — reset() go NIE rusza. */
  private zoom = 1;

  constructor(
    private readonly camera: PerspectiveCamera,
    dom: HTMLElement,
  ) {
    // kółko = dolly: w dół (deltaY>0) oddala, w górę przybliża (konwencja jak OrbitCamera).
    // Działa też pod pointer lockiem celownika (wheel nie jest blokowany przez lock).
    dom.addEventListener(
      'wheel',
      (event) => {
        event.preventDefault(); // bez tego strona by się przewijała
        const factor = event.deltaY > 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
        this.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, this.zoom * factor));
      },
      { passive: false },
    );
  }

  reset(): void {
    this.initialized = false;
  }

  update(
    dtS: number,
    planePos: Vector3,
    orientation: Quaternion,
    velocity: Vector3,
    buffetIntensity: number,
  ): void {
    getForward(orientation, scratchFwd);
    getUp(orientation, scratchUp);

    // offset = za ogonem + nad kadłubem (część pionu sztywna do świata, część przejmuje przechylenie)
    scratchOffset
      .copy(scratchFwd)
      .multiplyScalar(-DISTANCE_M)
      .addScaledVector(WORLD_UP, HEIGHT_M * (1 - ROLL_FOLLOW))
      .addScaledVector(scratchUp, HEIGHT_M * ROLL_FOLLOW)
      .multiplyScalar(this.zoom); // dolly kółkiem; wygładzany przez lerp offsetu → płynny zoom

    if (!this.initialized) {
      this.smoothedOffset.copy(scratchOffset);
      this.smoothedVel.copy(velocity);
      this.initialized = true;
    } else {
      // wygładzamy TYLKO obrót offsetu (płynne wejście za ogon); translacja zostaje sztywna
      this.smoothedOffset.lerp(scratchOffset, -Math.expm1(-dtS / OFFSET_TAU_S));
      // prędkość wygładzana osobno (krótszy tau) — surowa schodkuje co tick i drży lookAt
      this.smoothedVel.lerp(velocity, -Math.expm1(-dtS / VELOCITY_TAU_S));
    }

    // pozycja kamery przyklejona do pozycji renderu samolotu → korekta sieciowa rusza obojgiem
    // naraz (samolot nie „pływa" w kadrze). Drobny ruch przejmuje świat, jak w kamerze orbitalnej.
    this.camera.position.copy(planePos).add(this.smoothedOffset);
    if (buffetIntensity > 0) {
      // drganie czysto wizualne — Math.random() poza logiką symulacji jest OK
      const amp = BUFFET_SHAKE_M * buffetIntensity;
      this.camera.position.x += (Math.random() - 0.5) * amp;
      this.camera.position.y += (Math.random() - 0.5) * amp;
      this.camera.position.z += (Math.random() - 0.5) * amp;
    }

    // wyprzedzenie skrętu: patrz tam, dokąd samolot LECI, nie tylko gdzie celuje nos.
    // Punkt patrzenia też kotwiczony w planePos → rusza się RAZEM z kamerą (brak drżenia kąta).
    const speed = this.smoothedVel.length();
    if (speed > 1) {
      scratchVHat.copy(this.smoothedVel).divideScalar(speed);
    } else {
      scratchVHat.copy(scratchFwd);
    }
    scratchLook
      .copy(planePos)
      .addScaledVector(scratchFwd, LOOK_AHEAD_M * (1 - LOOK_VELOCITY_BLEND))
      .addScaledVector(scratchVHat, LOOK_AHEAD_M * LOOK_VELOCITY_BLEND);

    this.camera.up.copy(WORLD_UP).lerp(scratchUp, ROLL_FOLLOW).normalize();
    this.camera.lookAt(scratchLook);
  }
}
