import {
  AmbientLight,
  Color,
  DirectionalLight,
  GridHelper,
  PerspectiveCamera,
  Quaternion,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';
import {
  FixedStepLoop,
  GRAVITY_MS2,
  Instructor,
  MS_TO_KMH,
  PHYSICS_HZ,
  SPITFIRE_MK1,
  createPilotDemands,
  createSimPlane,
  getForward,
  getRight,
  getUp,
  maxRollRateRadS,
  nDemandForPitchRate,
  pilotStep,
  sumForces,
  validatePlaneState,
  type PilotTickResult,
} from '@air-combat/shared';
import { ChaseCamera } from './chase-camera';
import { FlightRecorder } from './flight-recorder';
import { ForceArrows } from './force-arrows';
import { Hud } from './hud';
import { KeyboardInput } from './input';
import { MouseAim, projectDirToScreen } from './mouse-aim';
import { connectNetStatus } from './net-status';
import { OrbitCamera } from './orbit-camera';
import { createPlaneMesh } from './plane-mesh';

// --- faza 3: pełne sterowanie (instruktor mouse-aim + klawiatura przez kopertę) ---

const SPAWN_ALTITUDE_M = 800;
const SPAWN_SPEED_MS = 120;
/** Obniżony tick do wizualnej weryfikacji interpolacji (F4). */
const SLOW_PHYSICS_HZ = 10;
const DEG_TO_RAD = Math.PI / 180;

const plane = SPITFIRE_MK1;
const sim = createSimPlane(0xc0ffee);
const state = sim.state;
const instructor = new Instructor();
const demands = createPilotDemands();
const prevPosition = new Vector3();
const prevOrientation = new Quaternion();
let lastTick: PilotTickResult | undefined;

// --- scena (przed inputem: mysz wymaga elementu canvas) ---

const app = document.getElementById('app');
if (!app) throw new Error('brak elementu #app');

const renderer = new WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
app.appendChild(renderer.domElement);

const keyboard = new KeyboardInput(window);
const mouseAim = new MouseAim(renderer.domElement);
/** Czy ostatnio sterowała klawiatura (po puszczeniu mysz przejmuje od nosa). */
let keyboardActive = false;

const scratchTargetDir = new Vector3();
const scratchFwd = new Vector3();
const scratchUp = new Vector3();
const scratchRight = new Vector3();

function resetPlane(): void {
  state.position.set(0, SPAWN_ALTITUDE_M, 0);
  state.velocity.set(0, 0, SPAWN_SPEED_MS);
  state.orientation.identity();
  state.angularRates.pitch = 0;
  state.angularRates.roll = 0;
  state.angularRates.yaw = 0;
  state.throttle = 0.8;
  state.iasMs = SPAWN_SPEED_MS;
  keyboard.throttle = 0.8;
  instructor.reset();
  mouseAim.alignTo(scratchTargetDir.set(0, 0, 1));
  prevPosition.copy(state.position);
  prevOrientation.copy(state.orientation);
  chaseCamera.reset();
}

function physicsStep(dtS: number): void {
  prevPosition.copy(state.position);
  prevOrientation.copy(state.orientation);

  keyboard.update(dtS);
  state.throttle = keyboard.throttle;

  if (keyboard.hasRotationInput) {
    // klawiatura omija instruktora: wychylenia → żądania, nasycenie robi koperta
    keyboardActive = true;
    instructor.reset();
    const baseN = nDemandForPitchRate(state, 0);
    const pitchD = keyboard.pitchDeflection;
    demands.nDemandG =
      pitchD >= 0
        ? baseN + pitchD * (plane.nMaxG - baseN)
        : baseN + pitchD * (baseN - plane.nMinG);
    demands.rollRateRadS = keyboard.rollDeflection * maxRollRateRadS(state.iasMs, plane);
    demands.yawRateRadS =
      keyboard.yawDeflection * plane.instructor.maxYawRateDegS * DEG_TO_RAD;
  } else {
    if (keyboardActive) {
      // przejęcie przez mysz bez szarpnięcia: cel = aktualny kierunek nosa
      mouseAim.alignTo(getForward(state.orientation, scratchFwd));
      keyboardActive = false;
    }
    mouseAim.renormalize(getForward(state.orientation, scratchFwd));
    mouseAim.targetDir(scratchTargetDir);
    instructor.update(state, plane, scratchTargetDir, dtS, demands);
  }

  lastTick = pilotStep(sim, plane, demands, dtS);
  if (import.meta.env.DEV) {
    validatePlaneState(state, 'tick klienta');
    recorder?.record(state, lastTick, plane, dtS);
  }

  if (state.position.y < 2) resetPlane(); // brak terenu w tej fazie — siatka y=0 to "ziemia"
}

let physicsHz = PHYSICS_HZ;
let loop = new FixedStepLoop(1 / physicsHz, physicsStep);

const scene = new Scene();
scene.background = new Color(0x10141c);

const camera = new PerspectiveCamera(60, 1, 0.1, 30000);
const chaseCamera = new ChaseCamera(camera);
const orbit = new OrbitCamera(camera, renderer.domElement);
let cameraMode: 'pościgowa' | 'orbitalna' = 'pościgowa';

const planeMesh = createPlaneMesh();
scene.add(planeMesh);

scene.add(new GridHelper(20000, 100, 0x446644, 0x223322));
scene.add(new AmbientLight(0xffffff, 0.4));
const sun = new DirectionalLight(0xffffff, 1.2);
sun.position.set(30, 50, 20);
scene.add(sun);

const arrows = new ForceArrows(scene);

function requireEl(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`brak elementu #${id}`);
  return el;
}

const hud = new Hud(requireEl('hud'), requireEl('stall-warning'), requireEl('horizon-disc'));
const reticleEl = requireEl('reticle');
const noseMarkerEl = requireEl('nose-marker');

function resize(): void {
  const { clientWidth, clientHeight } = app as HTMLElement;
  renderer.setSize(clientWidth, clientHeight);
  camera.aspect = clientWidth / clientHeight;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// --- sterowanie debug ---

let arrowsVisible = true;
window.addEventListener('keydown', (event) => {
  if (event.key === 'F3') {
    event.preventDefault(); // F3 = "znajdź" w przeglądarce
    arrowsVisible = arrows.toggle();
  } else if (event.key === 'F4') {
    event.preventDefault();
    physicsHz = physicsHz === PHYSICS_HZ ? SLOW_PHYSICS_HZ : PHYSICS_HZ;
    loop = new FixedStepLoop(1 / physicsHz, physicsStep);
  } else if (event.code === 'KeyC') {
    cameraMode = cameraMode === 'pościgowa' ? 'orbitalna' : 'pościgowa';
    if (cameraMode === 'pościgowa') chaseCamera.reset();
  } else if (event.key === 'r' || event.key === 'R') {
    resetPlane();
  }
});

// --- pętla renderu: stały krok fizyki + interpolacja stanem prev/curr ---

resetPlane();
let lastTimeMs: number | undefined;

renderer.setAnimationLoop((timeMs) => {
  const frameDtS = lastTimeMs === undefined ? 0 : (timeMs - lastTimeMs) / 1000;
  lastTimeMs = timeMs;

  const alpha = loop.advance(frameDtS);
  planeMesh.position.lerpVectors(prevPosition, state.position, alpha);
  planeMesh.quaternion.slerpQuaternions(prevOrientation, state.orientation, alpha);

  const buffet = lastTick ? lastTick.stall.buffetIntensity : 0;
  if (cameraMode === 'pościgowa') {
    chaseCamera.update(frameDtS, planeMesh.position, planeMesh.quaternion, state.velocity, buffet);
  } else {
    orbit.update(planeMesh.position);
  }

  if (lastTick) {
    arrows.update(planeMesh.position, [
      ...lastTick.contributions,
      { name: 'wypadkowa', force: sumForces(lastTick.contributions) },
    ]);
  }

  // celownik (mysz) + znacznik nosa — celowo NIE sprzężone z kamerą 1:1
  const w = (app as HTMLElement).clientWidth;
  const h = (app as HTMLElement).clientHeight;
  const reticlePos = mouseAim.locked
    ? mouseAim.reticleScreenPos(planeMesh.position, camera, w, h)
    : null;
  if (reticlePos && !keyboardActive) {
    reticleEl.style.display = 'block';
    reticleEl.style.left = `${reticlePos.x.toFixed(0)}px`;
    reticleEl.style.top = `${reticlePos.y.toFixed(0)}px`;
  } else {
    reticleEl.style.display = 'none';
  }
  getForward(state.orientation, scratchFwd);
  const nosePos = projectDirToScreen(scratchFwd, planeMesh.position, camera, w, h);
  if (nosePos && mouseAim.locked) {
    noseMarkerEl.style.display = 'block';
    noseMarkerEl.style.left = `${nosePos.x.toFixed(0)}px`;
    noseMarkerEl.style.top = `${nosePos.y.toFixed(0)}px`;
  } else {
    noseMarkerEl.style.display = 'none';
  }

  const tas = state.velocity.length();
  const energyMj =
    (0.5 * plane.massKg * tas * tas + plane.massKg * GRAVITY_MS2 * state.position.y) / 1e6;
  getUp(state.orientation, scratchUp);
  getRight(state.orientation, scratchRight);
  hud.update({
    iasKmh: state.iasMs * MS_TO_KMH,
    tasKmh: tas * MS_TO_KMH,
    altM: state.position.y,
    throttle01: state.throttle,
    nG: state.loadFactor,
    nAvailG: lastTick ? lastTick.nAvailG : 0,
    alphaDeg: lastTick ? lastTick.lift.alphaImpliedRad / DEG_TO_RAD : 0,
    energyMj,
    stallPhase: lastTick ? lastTick.stall.phase : 'normal',
    buffetIntensity: buffet,
    bankRad: Math.atan2(-scratchRight.y, scratchUp.y),
    pitchRad: Math.asin(Math.min(1, Math.max(-1, scratchFwd.y))),
    controlMode: keyboardActive ? 'klawiatura' : 'mysz',
    extraLines: [
      '',
      mouseAim.locked
        ? 'mysz: celuj   WSAD/QE: stery   Z/X: gaz   [Esc] zwolnij mysz'
        : 'KLIKNIJ, by sterować myszą (pointer lock)   WSAD/QE: stery   Z/X: gaz',
      `[C] kamera: ${cameraMode}   [F3] siły: ${arrowsVisible ? 'ON' : 'OFF'}   [F4] tick ${physicsHz} Hz${physicsHz !== PHYSICS_HZ ? ' ← SPOWOLNIONY' : ''}   [R] reset`,
    ],
  });

  renderer.render(scene, camera);
});

const statusEl = document.getElementById('net-status');
if (!statusEl) throw new Error('brak elementu #net-status');
connectNetStatus(statusEl);

// --- narzędzia dev: rejestrator + panel strojenia (poza prod bundle) ---

const recorder = import.meta.env.DEV ? new FlightRecorder() : undefined;
if (import.meta.env.DEV) {
  void import('./tuning-panel').then(({ createTuningPanel }) => {
    createTuningPanel(plane, {
      onExportCsv: () => recorder?.exportCsv(),
      onOpenTelemetry: () => {
        if (recorder?.saveForTelemetry() === true) {
          window.open('/telemetry.html', '_blank');
        } else {
          alert('Nie udało się zapisać nagrania (limit localStorage?)');
        }
      },
    });
  });
}
