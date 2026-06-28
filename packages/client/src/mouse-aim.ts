import { PerspectiveCamera, Vector3 } from 'three';
import type { MouseAimCore } from '@air-combat/shared';

/**
 * Warstwa DOM celownika myszy: pointer lock + przekazywanie delt do
 * MouseAimCore (matematyka sfery celu żyje w shared — używa jej też harness
 * testów manewrów). Celownik NIE jest sprzężony 1:1 z kamerą (pułapka
 * z faza-03.md: choroba symulatorowa) — kamera podąża za samolotem,
 * celownik za myszą.
 */
/** Promień sfery celownika [m] — tylko do projekcji znacznika na ekran. */
const RETICLE_DISTANCE_M = 1500;

const scratchWorld = new Vector3();

export class MouseAim {
  locked = false;
  /**
   * Czy klik może przejąć pointer lock do celowania myszą. Kamera orbitalna to
   * wyłącza (klawisz C w main.ts): mysz służy wtedy do rozglądania się (orbita),
   * a lot prowadzi tylko klawiatura. Po wyłączeniu zwalniamy też istniejący lock.
   */
  enabled = true;
  /**
   * Mnożnik czułości celowania (0..1). Przybliżenie PPM (online-main) zmniejsza go
   * proporcjonalnie do zawężenia FOV (= fov/BASE_FOV), więc przy zoomie ten sam ruch
   * ręki przesuwa celownik mniej — precyzyjne strzelanie na dystans. 1 = brak zoomu.
   */
  aimSensitivityScale = 1;

  constructor(
    private readonly dom: HTMLElement,
    private readonly core: MouseAimCore,
  ) {
    // Przejęcie myszy na `pointerdown` DOWOLNEGO przycisku (nie tylko LPM i nie na `click`).
    // Powód: gracz może NAJPIERW przytrzymać PPM (przybliżenie), a potem strzelić LPM. Gdy PPM jest
    // już wciśnięty, requestPointerLock z PÓŹNIEJSZEGO zdarzenia LPM jest przez przeglądarkę odrzucany
    // (a `click` LPM wręcz tłumiony przy trzymanym PPM) → mysz się nie przejmuje: widać kursor systemowy
    // i nie da się strzelać. Zakładając lock na pierwszym, „czystym" wciśnięciu (także PPM), przejmujemy
    // mysz od razu, a kolejne przyciski już tylko działają. enabled = tylko tryb pościgowy (sterowanie
    // myszą); w orbitalnym mysz obraca kamerą i lock jest wyłączony. Pierwsze wciśnięcie NIE strzela
    // (triggerHeld bramkuje ogień na mouseAim.locked, które wstaje po pointerlockchange — patrz online-main).
    dom.addEventListener('pointerdown', () => this.requestLock());
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.dom;
    });
    document.addEventListener('mousemove', (event) => {
      if (!this.locked) return;
      this.core.applyMovementPx(
        event.movementX * this.aimSensitivityScale,
        event.movementY * this.aimSensitivityScale,
      );
    });
  }

  /** Przejmij mysz (pointer lock), jeśli aktywne sterowanie myszą i jeszcze nie przejęta. Wołane
   *  z gestu użytkownika (pointerdown LUB powrót do trybu pościgowego klawiszem C — oba to gesty,
   *  których wymaga requestPointerLock). Bez gestu przeglądarka i tak odrzuci żądanie (void łyka). */
  requestLock(): void {
    if (this.enabled && !this.locked) void this.dom.requestPointerLock();
  }

  /**
   * Pozycja znacznika celu na ekranie [px] względem lewego górnego rogu,
   * albo null gdy cel za kamerą. planePos = środek sfery celownika.
   */
  reticleScreenPos(
    planePos: Vector3,
    camera: PerspectiveCamera,
    widthPx: number,
    heightPx: number,
  ): { x: number; y: number } | null {
    this.core.targetDir(scratchWorld).multiplyScalar(RETICLE_DISTANCE_M).add(planePos);
    scratchWorld.project(camera);
    if (scratchWorld.z > 1) return null; // za płaszczyzną daleką / za kamerą
    return {
      x: (scratchWorld.x * 0.5 + 0.5) * widthPx,
      y: (-scratchWorld.y * 0.5 + 0.5) * heightPx,
    };
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
  scratchWorld.copy(dir).multiplyScalar(RETICLE_DISTANCE_M).add(planePos);
  scratchWorld.project(camera);
  if (scratchWorld.z > 1) return null;
  return {
    x: (scratchWorld.x * 0.5 + 0.5) * widthPx,
    y: (-scratchWorld.y * 0.5 + 0.5) * heightPx,
  };
}
