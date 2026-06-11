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
  MS_TO_KMH,
  PHYSICS_HZ,
  SPITFIRE_MK1,
  createPlaneState,
  nDemandForPitchRate,
  stepPlane,
  sumForces,
  validatePlaneState,
  type PlaneTickResult,
} from '@air-combat/shared';
import { ForceArrows } from './force-arrows';
import { Hud } from './hud';
import { TempInput } from './input';
import { connectNetStatus } from './net-status';
import { OrbitCamera } from './orbit-camera';
import { createPlaneMesh } from './plane-mesh';

// --- fizyka: Spitfire Mk I pod prawdziwymi siłami (faza 2) ---

const SPAWN_ALTITUDE_M = 600;
const SPAWN_SPEED_MS = 120;
/** Obniżony tick do wizualnej weryfikacji interpolacji (F4). */
const SLOW_PHYSICS_HZ = 10;

const plane = SPITFIRE_MK1;
const state = createPlaneState();
const prevPosition = new Vector3();
const prevOrientation = new Quaternion();
const input = new TempInput(window);
let lastTick: PlaneTickResult | undefined;

function resetPlane(): void {
  state.position.set(0, SPAWN_ALTITUDE_M, 0);
  state.velocity.set(0, 0, SPAWN_SPEED_MS);
  state.orientation.identity();
  state.angularRates.pitch = 0;
  state.angularRates.roll = 0;
  state.angularRates.yaw = 0;
  state.throttle = 0.8;
  input.throttle = 0.8;
  prevPosition.copy(state.position);
  prevOrientation.copy(state.orientation);
}

function physicsStep(dtS: number): void {
  prevPosition.copy(state.position);
  prevOrientation.copy(state.orientation);

  input.update(dtS);
  state.throttle = input.throttle;
  state.angularRates.pitch = input.pitchRate;
  state.angularRates.roll = input.rollRate;

  const nDemand = nDemandForPitchRate(state, input.pitchRate);
  lastTick = stepPlane(state, plane, nDemand, dtS);
  if (import.meta.env.DEV) validatePlaneState(state, 'tick klienta');

  if (state.position.y < 2) resetPlane(); // brak terenu w tej fazie — siatka y=0 to "ziemia"
}

let physicsHz = PHYSICS_HZ;
let loop = new FixedStepLoop(1 / physicsHz, physicsStep);

// --- scena ---

const app = document.getElementById('app');
if (!app) throw new Error('brak elementu #app');

const renderer = new WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
app.appendChild(renderer.domElement);

const scene = new Scene();
scene.background = new Color(0x10141c);

const camera = new PerspectiveCamera(60, 1, 0.1, 30000);
const orbit = new OrbitCamera(camera, renderer.domElement);

const planeMesh = createPlaneMesh();
scene.add(planeMesh);

scene.add(new GridHelper(20000, 100, 0x446644, 0x223322));
scene.add(new AmbientLight(0xffffff, 0.4));
const sun = new DirectionalLight(0xffffff, 1.2);
sun.position.set(30, 50, 20);
scene.add(sun);

const arrows = new ForceArrows(scene);
const hudEl = document.getElementById('hud');
if (!hudEl) throw new Error('brak elementu #hud');
const hud = new Hud(hudEl);

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

  orbit.update(planeMesh.position);
  if (lastTick) {
    arrows.update(planeMesh.position, [
      ...lastTick.contributions,
      { name: 'wypadkowa', force: sumForces(lastTick.contributions) },
    ]);
  }

  const tas = state.velocity.length();
  const energyMj =
    (0.5 * plane.massKg * tas * tas + plane.massKg * GRAVITY_MS2 * state.position.y) / 1e6;
  const alphaDeg = lastTick ? (lastTick.lift.alphaImpliedRad * 180) / Math.PI : 0;
  hud.update([
    `IAS   ${(state.iasMs * MS_TO_KMH).toFixed(0)} km/h   TAS ${(tas * MS_TO_KMH).toFixed(0)} km/h`,
    `alt   ${state.position.y.toFixed(0)} m   gaz ${(state.throttle * 100).toFixed(0)}%`,
    `n     ${state.loadFactor.toFixed(2)} G   α ${alphaDeg.toFixed(1)}°${state.stalled ? '   *** PRZECIĄGNIĘCIE ***' : ''}`,
    `E     ${energyMj.toFixed(1)} MJ   tick ${physicsHz} Hz${physicsHz !== PHYSICS_HZ ? ' ← SPOWOLNIONY' : ''}`,
    '',
    `strzałki: pitch/roll (dół = nos w górę)   Z/X: gaz   mysz: kamera`,
    `[F3] strzałki sił: ${arrowsVisible ? 'ON' : 'OFF'}   [F4] tick 60↔10 Hz   [R] reset`,
  ]);

  renderer.render(scene, camera);
});

const statusEl = document.getElementById('net-status');
if (!statusEl) throw new Error('brak elementu #net-status');
connectNetStatus(statusEl);
