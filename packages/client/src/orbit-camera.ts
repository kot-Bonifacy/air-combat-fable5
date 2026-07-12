import { PerspectiveCamera, Vector3 } from 'three';

const MIN_DISTANCE_M = 8;
const MAX_DISTANCE_M = 150;

/**
 * Kamera orbitalna fazy 2: krąży wokół samolotu (przeciągnięcie myszą = obrót,
 * kółko = zoom). Kamera pościgowa przyjdzie w późniejszej fazie.
 */
export class OrbitCamera {
  private yawRad = Math.PI; // start za ogonem (samolot leci w +Z)
  private pitchRad = 0.25;
  private distanceM = 30;
  private dragging = false;
  private readonly offset = new Vector3();
  /**
   * Aktywna tylko w trybie kamery swobodnej (orbitalnej) — w pościgowej kamerą rządzi ChaseCamera
   * i mysz celuje samolotem (MouseAim). KRYTYCZNE: bez tej bramki listener `pointerdown` reagował
   * w KAŻDYM trybie i na wciśnięciu PPM (przybliżenie, zanim mysz przejęta) robił setPointerCapture,
   * co BLOKOWAŁO późniejszy requestPointerLock z LPM → strzał nie wchodził, gdy PPM był pierwszy.
   * online-main ustawia tę flagę przy zmianie trybu kamery (klawisz C / reset / start meczu).
   */
  enabled = false;

  constructor(
    private readonly camera: PerspectiveCamera,
    dom: HTMLElement,
  ) {
    dom.addEventListener('pointerdown', (event) => {
      if (!this.enabled) return;
      this.dragging = true;
      // Pointer lock na czas przeciągania: bez niego kursor dojeżdża do krawędzi
      // ekranu i movementX gaśnie — kamery nie dało się kręcić w kółko w jedną stronę.
      if (document.pointerLockElement !== dom) {
        // lock może zostać odrzucony (np. za szybko po Esc) — wtedy drag działa do krawędzi ekranu
        try {
          void dom.requestPointerLock();
        } catch {
          // przeglądarka odmówiła — ignorujemy
        }
      }
      // setPointerCapture rzuca DOMException, gdy pointer jest w stanie locked
      // (po pointer lock z celownika myszy) — bez przechwycenia obsłużymy ruch
      try {
        dom.setPointerCapture(event.pointerId);
      } catch {
        // pointer niedostępny do przechwycenia — ignorujemy
      }
    });
    dom.addEventListener('pointerup', (event) => {
      this.dragging = false;
      try {
        dom.releasePointerCapture(event.pointerId);
      } catch {
        // nic nie było przechwycone
      }
    });
    dom.addEventListener('pointermove', (event) => {
      if (!this.enabled || !this.dragging) return;
      this.yawRad -= event.movementX * 0.005;
      // pitch BEZ clampu (życzenie usera): pełny obrót 360° w pionie, przez zenit/nadir —
      // update() prowadzi wektor „góry" kamery po stycznej orbity, więc nie ma przeskoku
      // na biegunach. Zawijanie mod 2π tylko trzyma kąt w ryzach numerycznie.
      this.pitchRad = (this.pitchRad + event.movementY * 0.005) % (Math.PI * 2);
    });
    dom.addEventListener(
      'wheel',
      (event) => {
        if (!this.enabled) return; // w pościgowej kółkiem rządzi ChaseCamera (dolly)
        event.preventDefault();
        this.distanceM = Math.min(
          MAX_DISTANCE_M,
          Math.max(MIN_DISTANCE_M, this.distanceM * (event.deltaY > 0 ? 1.15 : 1 / 1.15)),
        );
      },
      { passive: false },
    );
  }

  update(targetPos: Vector3): void {
    const cosP = Math.cos(this.pitchRad);
    const sinP = Math.sin(this.pitchRad);
    this.offset.set(Math.sin(this.yawRad) * cosP, sinP, Math.cos(this.yawRad) * cosP);
    this.camera.position.copy(targetPos).addScaledVector(this.offset, this.distanceM);
    // „Góra" kamery = styczna orbity w kierunku rosnącego pitcha (d offset/d pitch) zamiast
    // światowego (0,1,0): dzięki temu przejście przez zenit/nadir jest ciągłe (pełne 360° w pionie),
    // a lookAt nie robi nagłego odwrócenia kadru na biegunie. ChaseCamera i tak nadpisuje camera.up
    // co klatkę, więc nie kolidujemy z trybem pościgowym.
    this.camera.up.set(-Math.sin(this.yawRad) * sinP, cosP, -Math.cos(this.yawRad) * sinP);
    this.camera.lookAt(targetPos);
  }
}
