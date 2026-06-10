import {
  AmbientLight,
  BoxGeometry,
  Color,
  DirectionalLight,
  GridHelper,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Quaternion,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';
import {
  FixedStepLoop,
  GRAVITY_MS2,
  PHYSICS_HZ,
  createPlaneState,
  gravityForce,
  integrateStep,
  sumForces,
  validatePlaneState,
  type ForceContribution,
} from '@air-combat/shared';
import { ForceArrows } from './force-arrows';
import { Hud } from './hud';
import { connectNetStatus } from './net-status';

// --- fizyka demo fazy 1: spadający sześcian (masa testowa, nie samolot) ---

const CUBE_MASS_KG = 100;
const DROP_HEIGHT_M = 80;
const CUBE_HALF_M = 0.5;
/** Obniżony tick do wizualnej weryfikacji interpolacji (F4). */
const SLOW_PHYSICS_HZ = 10;

const state = createPlaneState();
const prevPosition = new Vector3();
const prevOrientation = new Quaternion();
let contributions: readonly ForceContribution[] = [];

function resetCube(): void {
  state.position.set(0, DROP_HEIGHT_M, 0);
  state.velocity.set(0, 0, 0);
  state.orientation.identity();
  // powolny obrót, żeby interpolacja orientacji była widoczna gołym okiem
  state.angularRates.pitch = 0.4;
  state.angularRates.roll = 0.8;
  prevPosition.copy(state.position);
  prevOrientation.copy(state.orientation);
}

function physicsStep(dtS: number): void {
  prevPosition.copy(state.position);
  prevOrientation.copy(state.orientation);

  contributions = [gravityForce(CUBE_MASS_KG)];
  integrateStep(state, sumForces(contributions), CUBE_MASS_KG, dtS);
  if (import.meta.env.DEV) validatePlaneState(state, 'tick demo');

  if (state.position.y < CUBE_HALF_M) resetCube();
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

const camera = new PerspectiveCamera(60, 1, 0.1, 1000);

const cube = new Mesh(
  new BoxGeometry(2 * CUBE_HALF_M, 2 * CUBE_HALF_M, 2 * CUBE_HALF_M),
  new MeshStandardMaterial({ color: 0x4a90d9 }),
);
scene.add(cube);

scene.add(new GridHelper(400, 40, 0x446644, 0x223322));
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
    resetCube();
  }
});

// --- pętla renderu: stały krok fizyki + interpolacja stanem prev/curr ---

resetCube();
const cameraOffset = new Vector3(10, 6, 14);
let lastTimeMs: number | undefined;

renderer.setAnimationLoop((timeMs) => {
  const frameDtS = lastTimeMs === undefined ? 0 : (timeMs - lastTimeMs) / 1000;
  lastTimeMs = timeMs;

  const alpha = loop.advance(frameDtS);
  cube.position.lerpVectors(prevPosition, state.position, alpha);
  cube.quaternion.slerpQuaternions(prevOrientation, state.orientation, alpha);

  camera.position.copy(cube.position).add(cameraOffset);
  camera.lookAt(cube.position);

  arrows.update(cube.position, contributions);

  const speed = state.velocity.length();
  const energyKj =
    (0.5 * CUBE_MASS_KG * speed * speed + CUBE_MASS_KG * GRAVITY_MS2 * state.position.y) / 1000;
  hud.update([
    `poz   x ${state.position.x.toFixed(1)}  y ${state.position.y.toFixed(1)}  z ${state.position.z.toFixed(1)} m`,
    `V     ${speed.toFixed(1)} m/s`,
    `E     ${energyKj.toFixed(1)} kJ (kinetyczna + potencjalna)`,
    `tick  ${physicsHz} Hz${physicsHz !== PHYSICS_HZ ? '  ← SPOWOLNIONY (test interpolacji)' : ''}`,
    '',
    `[F3] strzałki sił: ${arrowsVisible ? 'ON' : 'OFF'}   [F4] tick 60↔10 Hz   [R] reset`,
  ]);

  renderer.render(scene, camera);
});

const statusEl = document.getElementById('net-status');
if (!statusEl) throw new Error('brak elementu #net-status');
connectNetStatus(statusEl);
