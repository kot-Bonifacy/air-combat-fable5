import {
  AmbientLight,
  DirectionalLight,
  PerspectiveCamera,
  Quaternion,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';
import {
  ARENA_RELEASE_DISTANCE_M,
  ARENA_WARNING_DISTANCE_M,
  FixedStepLoop,
  GRAVITY_MS2,
  Instructor,
  MS_TO_KMH,
  PHYSICS_HZ,
  RESPAWN_DELAY_S,
  SPITFIRE_MK1,
  createPilotDemands,
  createSimPlane,
  createTerrain,
  distanceToArenaEdgeM,
  getForward,
  getRight,
  getUp,
  maxRollRateRadS,
  nDemandForPitchRate,
  pilotStep,
  sumForces,
  surfaceHeightM,
  updateLifecycle,
  validatePlaneState,
  type PilotTickResult,
} from '@air-combat/shared';
import { ChaseCamera } from './chase-camera';
import { Explosions } from './explosion';
import { FlightRecorder } from './flight-recorder';
import { ForceArrows } from './force-arrows';
import { Hud } from './hud';
import { KeyboardInput } from './input';
import { MouseAim, projectDirToScreen } from './mouse-aim';
import { connectNetStatus } from './net-status';
import { OrbitCamera } from './orbit-camera';
import { createPlaneMesh } from './plane-mesh';
import { createWorld } from './world';

// --- faza 4: świat (ocean + wyspa + kolizje + granice areny) na sterowaniu z fazy 3 ---

const SPAWN_ALTITUDE_M = 800;
const SPAWN_SPEED_MS = 120;
/** Punkt startu: nad oceanem na południu, nosem (+Z) na wyspę w centrum areny. */
const SPAWN_Z_M = -7000;
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
/** Poza areną stery przejmuje autopilot zawracający (histereza ARENA_RELEASE_DISTANCE_M). */
let autopilotActive = false;

const scratchTargetDir = new Vector3();
const scratchFwd = new Vector3();
const scratchUp = new Vector3();
const scratchRight = new Vector3();

function resetPlane(): void {
  state.position.set(0, SPAWN_ALTITUDE_M, SPAWN_Z_M);
  state.velocity.set(0, 0, SPAWN_SPEED_MS);
  state.orientation.identity();
  state.angularRates.pitch = 0;
  state.angularRates.roll = 0;
  state.angularRates.yaw = 0;
  state.throttle = 0.8;
  state.iasMs = SPAWN_SPEED_MS;
  state.life = 'alive';
  state.lifeTimerS = 0;
  keyboard.throttle = 0.8;
  autopilotActive = false;
  instructor.reset();
  mouseAim.alignTo(scratchTargetDir.set(0, 0, 1));
  prevPosition.copy(state.position);
  prevOrientation.copy(state.orientation);
  planeMesh.visible = true;
  chaseCamera.reset();
}

function physicsStep(dtS: number): void {
  prevPosition.copy(state.position);
  prevOrientation.copy(state.orientation);

  if (state.life !== 'alive') {
    // wrak: fizyka stoi, liczy się tylko timer respawnu
    if (updateLifecycle(state, terrain, dtS) === 'respawnReady') resetPlane();
    return;
  }

  keyboard.update(dtS);
  state.throttle = keyboard.throttle;

  // granice areny: poza nimi miękka utrata kontroli na rzecz autopilota zawracającego
  const edgeM = distanceToArenaEdgeM(state.position.x, state.position.z);
  if (edgeM < 0) autopilotActive = true;
  else if (edgeM >= ARENA_RELEASE_DISTANCE_M) autopilotActive = false;

  if (autopilotActive) {
    scratchTargetDir.set(-state.position.x, 0, -state.position.z).normalize();
    instructor.update(state, plane, scratchTargetDir, dtS, demands);
    // cel myszy trzymany na nosie → po oddaniu sterów brak szarpnięcia
    mouseAim.alignTo(getForward(state.orientation, scratchFwd));
    keyboardActive = false;
  } else if (keyboard.hasRotationInput) {
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

  if (updateLifecycle(state, terrain, dtS) === 'crashed') {
    explosions.spawn(state.position);
    planeMesh.visible = false;
  }
}

let physicsHz = PHYSICS_HZ;
let loop = new FixedStepLoop(1 / physicsHz, physicsStep);

const scene = new Scene();

const camera = new PerspectiveCamera(60, 1, 0.1, 30000);
const chaseCamera = new ChaseCamera(camera);
const orbit = new OrbitCamera(camera, renderer.domElement);
let cameraMode: 'pościgowa' | 'orbitalna' = 'pościgowa';

const planeMesh = createPlaneMesh();
scene.add(planeMesh);

const terrain = createTerrain();
const world = createWorld(scene, terrain);
const explosions = new Explosions(scene);

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
const alertEl = requireEl('arena-alert');

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

// licznik fps: średnia z okna 0.5 s (kryterium fazy 4: pomiar wydajności w HUD)
let fpsFrames = 0;
let fpsWindowS = 0;
let fpsValue = 0;

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

  // kamera nigdy pod powierzchnią (kraksa na zboczu wbijała ją w teren)
  const cameraFloorM = surfaceHeightM(terrain, camera.position.x, camera.position.z) + 3;
  if (camera.position.y < cameraFloorM) camera.position.y = cameraFloorM;

  world.update(camera.position);
  explosions.update(frameDtS);

  fpsFrames++;
  fpsWindowS += frameDtS;
  if (fpsWindowS >= 0.5) {
    fpsValue = Math.round(fpsFrames / fpsWindowS);
    fpsFrames = 0;
    fpsWindowS = 0;
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
  const reticlePos =
    mouseAim.locked && state.life === 'alive' && !autopilotActive
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
  if (nosePos && mouseAim.locked && state.life === 'alive') {
    noseMarkerEl.style.display = 'block';
    noseMarkerEl.style.left = `${nosePos.x.toFixed(0)}px`;
    noseMarkerEl.style.top = `${nosePos.y.toFixed(0)}px`;
  } else {
    noseMarkerEl.style.display = 'none';
  }

  // alert pełnoekranowy: rozbicie > autopilot poza areną > ostrzeżenie o granicy
  const edgeM = distanceToArenaEdgeM(state.position.x, state.position.z);
  if (state.life !== 'alive') {
    const leftS = Math.max(0, RESPAWN_DELAY_S - state.lifeTimerS);
    alertEl.textContent = `ROZBICIE — respawn za ${leftS.toFixed(1)} s`;
    alertEl.className = 'crash';
    alertEl.style.opacity = '1';
  } else if (autopilotActive) {
    alertEl.textContent = 'POZA ARENĄ — AUTOPILOT ZAWRACA';
    alertEl.className = 'outside';
    alertEl.style.opacity = Date.now() % 600 < 400 ? '1' : '0.35';
  } else if (edgeM <= ARENA_WARNING_DISTANCE_M) {
    alertEl.textContent = `GRANICA ARENY ZA ${Math.max(0, edgeM).toFixed(0)} m — ZAWRACAJ`;
    alertEl.className = 'warning';
    alertEl.style.opacity = '1';
  } else {
    alertEl.style.opacity = '0';
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
      `fps   ${String(fpsValue).padStart(3)}`,
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
