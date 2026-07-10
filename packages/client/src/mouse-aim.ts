import { PerspectiveCamera, Vector3 } from 'three';

/**
 * Warstwa celownika myszy (mouse-aim) — MODEL OSIADAJĄCY (2026-07-10 cz.2, życzenie usera
 * „dziób ma zmierzać do miejsca kursora i STANĄĆ na jego linii; zostawiony z boku kursor NIE
 * może wiecznie skręcać samolotu").
 *
 * KOTWICA CELU JEST W ŚWIECIE (`aimDir`), nie względem kamery: kursor wyznacza punkt na niebie,
 * instruktor obraca nos ku niemu i STAJE, gdy nos = aimDir (błąd = 0). Ponieważ kamera pościgowa
 * podąża za nosem, w miarę obracania się ku celowi celownik SAM wraca do środka kadru (gdy nos
 * celuje w punkt, punkt jest na wprost). Zostawienie kursora z boku ≠ ciągły skręt — samolot
 * dolatuje do niego i się prostuje. Ciągły zakręt = ciągłe „zamiatanie" myszą (przeciąganie celu).
 *
 * DLACZEGO odwrócenie modelu (było: offset ekranowy WZGLĘDEM kamery → aim = kierunek o kąt θ od
 * osi kamery): kamera podąża za nosem, więc komenda „θ w bok od osi patrzenia" nigdy się nie
 * zerowała → samolot skręcał bez końca (model „rate"). Teraz aimDir jest stały w świecie i osiągalny.
 *
 * ZACHOWANE z poprzedniej rewizji (model ekranowy): kursorowy ruch 1:1 w px, twardy clamp offsetu
 * do OKRĘGU (promień = ułamek wysokości) → brak przeskoków; „mocna krawędź" (nieliniowa mapa
 * px→kąt). Nowość: offset ekranowy jest teraz POCHODNĄ aimDir (rzut na bieżącą kamerę), więc kurczy
 * się, gdy nos obraca się do celu. Okrąg granicy przestał być RYSOWANY (życzenie usera), ale clamp
 * stożka zostaje — bez niego wracają przeskoki (cel za samolot / przez biegun).
 *
 * Rdzeń świata `MouseAimCore` (shared) zostaje dla harnessu manewrów — ta warstwa jest z natury
 * kliencka (potrzebuje kamery), więc żyje tylko tutaj.
 */

/** Promień sfery celownika [m] — tylko do projekcji znacznika NOSA na ekran. */
const RETICLE_DISTANCE_M = 1500;

/**
 * Promień okręgu ograniczającego celownik jako UŁAMEK wysokości ekranu (~2/3 wys. → promień = 1/3).
 * Okrąg NIE jest już rysowany (życzenie usera), ale nadal ogranicza offset (i mapę px→kąt). Czysto
 * wizualny knob wygody (jak RETICLE_DISTANCE_M), nie strojenie fizyki — samoloty stroi się w JSON.
 */
const RETICLE_RADIUS_FRACTION = 1 / 3;

/**
 * „Mocna krawędź" (decyzja usera 2026-07-10): mapa promienia znormalizowanego r01∈[0,1]
 * (środek→krawędź) na kąt celu od osi kamery jest NIELINIOWA — środek płaski/precyzyjny, krawędź
 * stroma/agresywna. θ(r01) = coneMax · r01^EXP.
 */
const RETICLE_ANGLE_CURVE_EXP = 1.7;
/**
 * Kąt celu na krawędzi okręgu jako WIELOKROTNOŚĆ połowy pionowego FOV. >1 = celowa przesada ponad
 * geometryczny unproject krawędzi: krawędź ściąga nos mocniej → agresywne pętle/zakręty. Skaluje
 * się z FOV (zoom PPM zawęża i okrąg, i kąt). Także maks. odchylenie aimDir od osi kamery = stożek,
 * w którym cel pozostaje „z przodu" (bez przeskoków azymutu).
 */
const RETICLE_EDGE_CONE_K = 1.6;

const DEG_TO_RAD = Math.PI / 180;

const scratchAxis = new Vector3();
const scratchRight = new Vector3();
const scratchUp = new Vector3();
const scratchFwd = new Vector3();

export class MouseAim {
  locked = false;
  /**
   * Czy klik może przejąć pointer lock do celowania myszą. Kamera orbitalna to wyłącza (klawisz C
   * w online-main): mysz służy wtedy do rozglądania się (orbita), a lot prowadzi tylko klawiatura.
   */
  enabled = true;
  /**
   * Mnożnik czułości celowania (0..1). Przybliżenie PPM (online-main) zmniejsza go proporcjonalnie
   * do zawężenia FOV, więc przy zoomie ten sam ruch ręki przesuwa celownik mniej. 1 = brak zoomu.
   */
  aimSensitivityScale = 1;

  /**
   * Kierunek celu w ŚWIECIE (jednostkowy). PERSYSTENTNY między klatkami — to on jest komendą dla
   * instruktora; samolot „dolatuje" do niego i staje (osiadanie), zamiast skręcać w nieskończoność.
   */
  private readonly aimDir = new Vector3(0, 0, 1);
  /** false = celownik wyśrodkowany (aim wzdłuż osi kamery); pierwszy advance zasiewa aimDir. */
  private aimSeeded = false;
  /** Nieskonsumowany ruch myszy [px] (×czułość), zbierany z mousemove, wchłaniany w advance. */
  private pendingDx = 0;
  private pendingDy = 0;
  /** Ostatnio wyliczony offset celownika na ekranie [px]: +x prawo, +y dół — do rysowania i debug. */
  private reticleXPx = 0;
  private reticleYPx = 0;

  constructor(private readonly dom: HTMLElement) {
    // Przejęcie myszy na `pointerdown` DOWOLNEGO przycisku (nie tylko LPM i nie na `click`): gracz
    // może NAJPIERW przytrzymać PPM (przybliżenie), a potem strzelić LPM — requestPointerLock z
    // późniejszego LPM przy trzymanym PPM jest odrzucany. Pierwsze „czyste" wciśnięcie zakłada lock;
    // ono nie strzela — bramkuje je `suppressFireUntilRelease` w online-main.
    dom.addEventListener('pointerdown', () => this.requestLock());
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.dom;
    });
    document.addEventListener('mousemove', (event) => {
      if (!this.locked) return;
      // ruch tylko zbieramy — wchłonie go advance() z bieżącą kamerą (offset→aimDir w świecie)
      this.pendingDx += event.movementX * this.aimSensitivityScale;
      this.pendingDy += event.movementY * this.aimSensitivityScale;
    });
  }

  /** Przejmij mysz (pointer lock), jeśli aktywne sterowanie myszą i jeszcze nie przejęta. */
  requestLock(): void {
    if (this.enabled && !this.locked) void this.dom.requestPointerLock();
  }

  /** Bieżący promień okręgu ograniczającego [px] (z wysokości kadru). */
  private radiusPxNow(): number {
    return RETICLE_RADIUS_FRACTION * this.dom.clientHeight;
  }

  /** Zapisz bazę kamery do scratchFwd/Right/Up (fwd = kierunek patrzenia, right/up = osie ekranu). */
  private readCameraBasis(camera: PerspectiveCamera): void {
    camera.updateMatrixWorld();
    camera.getWorldDirection(scratchFwd);
    scratchRight.setFromMatrixColumn(camera.matrixWorld, 0).normalize(); // +X kamery = prawo ekranu
    scratchUp.setFromMatrixColumn(camera.matrixWorld, 1).normalize(); // +Y kamery = góra ekranu
  }

  /**
   * Przelicz offset celownika na ekranie [px] jako RZUT aimDir na bieżącą kamerę (środek→krawędź
   * przez odwrotność mapy „mocnej krawędzi"). Kurczy się, gdy nos obraca się ku aimDir (aimDir stały
   * w świecie) → celownik wraca do środka. Aktualizuje reticleXPx/YPx i bazę kamery w scratch*.
   */
  private offsetPxFromAim(camera: PerspectiveCamera): void {
    this.readCameraBasis(camera);
    if (!this.aimSeeded) {
      this.reticleXPx = 0;
      this.reticleYPx = 0;
      return;
    }
    const cosT = Math.min(1, Math.max(-1, this.aimDir.dot(scratchFwd)));
    const theta = Math.acos(cosT);
    const pr = this.aimDir.dot(scratchRight);
    const pu = this.aimDir.dot(scratchUp);
    const plen = Math.hypot(pr, pu); // = sin(theta)
    const coneMax = RETICLE_EDGE_CONE_K * (camera.fov * 0.5) * DEG_TO_RAD;
    const r01 = coneMax > 1e-6 ? Math.min(1, Math.pow(theta / coneMax, 1 / RETICLE_ANGLE_CURVE_EXP)) : 0;
    const offLen = r01 * this.radiusPxNow();
    if (plen < 1e-9) {
      this.reticleXPx = 0;
      this.reticleYPx = 0;
    } else {
      this.reticleXPx = (pr / plen) * offLen; // +x prawo
      this.reticleYPx = (-pu / plen) * offLen; // +y dół (y ekranu rośnie w dół)
    }
  }

  /**
   * Ustaw aimDir (świat) z offsetu celownika [px] względem BIEŻĄCEJ kamery — odwrotność
   * offsetPxFromAim. Wymaga świeżej bazy kamery w scratch* (woła się tuż po offsetPxFromAim).
   */
  private aimFromOffsetPx(xPx: number, yPx: number, camera: PerspectiveCamera): void {
    const len = Math.hypot(xPx, yPx);
    if (len < 1e-6) {
      this.aimDir.copy(scratchFwd);
      return;
    }
    const r01 = Math.min(1, len / this.radiusPxNow());
    const coneMax = RETICLE_EDGE_CONE_K * (camera.fov * 0.5) * DEG_TO_RAD;
    const theta = coneMax * Math.pow(r01, RETICLE_ANGLE_CURVE_EXP);
    const ux = xPx / len;
    const uy = yPx / len; // +y = w dół ekranu
    scratchAxis
      .copy(scratchRight)
      .multiplyScalar(ux)
      .addScaledVector(scratchUp, -uy) // y ekranu rośnie w dół → góra świata to −uy
      .normalize();
    this.aimDir
      .copy(scratchFwd)
      .multiplyScalar(Math.cos(theta))
      .addScaledVector(scratchAxis, Math.sin(theta))
      .normalize();
  }

  /**
   * Zaawansuj celownik o jedną klatkę sterowania myszą: wchłoń zebrany ruch, docina offset do okręgu,
   * przelicz kierunek celu w świecie. aimDir jest KOTWICZONY W ŚWIECIE — gdy nie ruszasz myszą, nos
   * dolatuje do aimDir i STAJE (celownik wraca do środka), zamiast skręcać w nieskończoność. Wołane
   * z pętli wejścia, gdy mysz steruje lotem.
   */
  advance(camera: PerspectiveCamera): void {
    this.offsetPxFromAim(camera); // reticleXPx/YPx = bieżący rzut aimDir (kurczy się w miarę skrętu)
    if (!this.aimSeeded) {
      this.aimDir.copy(scratchFwd); // zasiew: cel wzdłuż osi kamery ≈ nos
      this.aimSeeded = true;
      this.reticleXPx = 0;
      this.reticleYPx = 0;
    }
    let x = this.reticleXPx + this.pendingDx;
    let y = this.reticleYPx + this.pendingDy;
    this.pendingDx = 0;
    this.pendingDy = 0;
    const r = this.radiusPxNow();
    const len = Math.hypot(x, y);
    if (len > r && len > 0) {
      const k = r / len;
      x *= k;
      y *= k;
    }
    this.reticleXPx = x;
    this.reticleYPx = y;
    this.aimFromOffsetPx(x, y, camera);
  }

  /** Wyśrodkuj celownik (respawn / przejęcie sterów przez klawiaturę — cel wzdłuż osi kamery ≈ nos). */
  recenter(): void {
    this.aimSeeded = false; // następny advance zasieje aimDir = oś kamery
    this.pendingDx = 0;
    this.pendingDy = 0;
    this.reticleXPx = 0;
    this.reticleYPx = 0;
    this.aimDir.set(0, 0, 1);
  }

  /** Bieżący kierunek celu w świecie (jednostkowy) — komenda dla instruktora. Nie zmienia stanu. */
  aimDirection(out: Vector3): Vector3 {
    return out.copy(this.aimDir);
  }

  /**
   * Pozycja celownika na ekranie [px] względem lewego górnego rogu — RZUT aimDir na PODANĄ (świeżą)
   * kamerę, liczony co klatkę renderu (płynny nawet przy fps > tick wejścia; wraca do środka, gdy nos
   * dolatuje do celu). Zawsze w okręgu (aimDir w stożku), więc nigdy null i bez przeskoków.
   */
  reticlePixel(camera: PerspectiveCamera, widthPx: number, heightPx: number): { x: number; y: number } {
    this.offsetPxFromAim(camera);
    return { x: widthPx * 0.5 + this.reticleXPx, y: heightPx * 0.5 + this.reticleYPx };
  }

  /** Ostatni offset celownika [px] względem środka + promień — dla haka diagnostycznego E2E. */
  debugOffsetPx(): { x: number; y: number; radiusPx: number } {
    return { x: this.reticleXPx, y: this.reticleYPx, radiusPx: this.radiusPxNow() };
  }

  /** Testowy ruch myszy [px] (E2E bez pointer locka) — dokłada do bufora, wchłonie go advance(). */
  nudge(dxPx: number, dyPx: number): void {
    this.pendingDx += dxPx;
    this.pendingDy += dyPx;
  }
}

/** Projekcja dowolnego kierunku świata na ekran (znacznik nosa itp.). */
export function projectDirToScreen(
  dir: Vector3,
  planePos: Vector3,
  camera: PerspectiveCamera,
  widthPx: number,
  heightPx: number,
): { x: number; y: number } | null {
  scratchAxis.copy(dir).multiplyScalar(RETICLE_DISTANCE_M).add(planePos);
  scratchAxis.project(camera);
  if (scratchAxis.z > 1) return null;
  return {
    x: (scratchAxis.x * 0.5 + 0.5) * widthPx,
    y: (-scratchAxis.y * 0.5 + 0.5) * heightPx,
  };
}
