import {
  AmbientLight,
  DirectionalLight,
  PerspectiveCamera,
  PMREMGenerator,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import {
  INPUT_HZ,
  MS_TO_KMH,
  MouseAimCore,
  PORT,
  SPITFIRE_MK2,
  createTerrain,
  getForward,
  type EntitySnapshot,
  type InputFrame,
} from '@air-combat/shared';
import { ChaseCamera } from './chase-camera';
import { KeyboardInput } from './input';
import { MouseAim } from './mouse-aim';
import { NetClient, defaultServerUrl } from './net-client';
import { createPlaneMesh, type PlaneModel } from './plane-mesh';
import { createWorld } from './world';

// Tryb online fazy 8 — osobna strona (online.html), izolowana od gry offline (main.ts).
// Klient NIE liczy fizyki: wysyła input 60 Hz i renderuje najświeższy snapshot z serwera
// SUROWO (bez interpolacji/predykcji — to faza 9). Broń online wyłączona (faza 11).

const plane = SPITFIRE_MK2;
const wingspanM = Math.sqrt(plane.aspectRatio * plane.wingAreaM2);
const INPUT_DT_S = 1 / INPUT_HZ;

function requireEl(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`brak elementu #${id}`);
  return el;
}

function showWebglError(): void {
  document.getElementById('webgl-error')?.classList.add('show');
  document.getElementById('loading')?.classList.add('hidden');
}

const app = requireEl('app');
const hudEl = requireEl('hud');
const connEl = requireEl('conn-overlay');

let renderer: WebGLRenderer;
try {
  renderer = new WebGLRenderer({ antialias: true });
} catch (err) {
  showWebglError();
  throw err instanceof Error ? err : new Error('inicjalizacja WebGL nie powiodła się');
}
renderer.setPixelRatio(window.devicePixelRatio);
app.appendChild(renderer.domElement);
renderer.domElement.addEventListener('webglcontextlost', (event) => {
  event.preventDefault();
  showWebglError();
});
renderer.domElement.addEventListener('webglcontextrestored', () => {
  document.getElementById('webgl-error')?.classList.remove('show');
});

const scene = new Scene();
const camera = new PerspectiveCamera(60, 1, 0.5, 30000);
camera.position.set(0, 1500, -1000);
camera.lookAt(0, 800, 0);
const chaseCamera = new ChaseCamera(camera);

// teren z TYM SAMYM seedem co serwer (TERRAIN_SEED) — świat zgodny po obu stronach
const terrain = createTerrain();
const world = createWorld(scene, terrain);

scene.add(new AmbientLight(0xffffff, 0.4));
const sun = new DirectionalLight(0xffffff, 1.2);
sun.position.set(30, 50, 20);
scene.add(sun);
const pmrem = new PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

function resize(): void {
  const { clientWidth, clientHeight } = app;
  renderer.setSize(clientWidth, clientHeight);
  camera.aspect = clientWidth / clientHeight || 1;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// --- sterowanie ---
const keyboard = new KeyboardInput(window);
const aimCore = new MouseAimCore();
const mouseAim = new MouseAim(renderer.domElement, aimCore);
renderer.domElement.addEventListener('contextmenu', (event) => event.preventDefault());

// --- sieć ---
const net = new NetClient(defaultServerUrl(PORT));

// --- meshe encji (jeden PlaneModel na id z serwera) ---
const meshes = new Map<number, PlaneModel>();
const seenIds = new Set<number>();

function ensureMesh(id: number): PlaneModel {
  let m = meshes.get(id);
  if (!m) {
    m = createPlaneMesh(wingspanM);
    scene.add(m.object);
    meshes.set(id, m);
  }
  return m;
}

function localEntity(): EntitySnapshot | undefined {
  return net.latestSnapshot?.entities.find((e) => e.isLocal);
}

// --- pętla wejścia (60 Hz, niezależnie od fps renderu) ---
const scratchNose = new Vector3();
const scratchAim = new Vector3();
let sequence = 0;
const inputFrame: InputFrame = {
  sequence: 0,
  clientTimeMs: 0,
  throttle: 0.8,
  pitchUp: 0,
  rollRight: 0,
  yawRight: 0,
  fire: false,
  aimX: 0,
  aimY: 0,
  aimZ: 1,
};

function sendInputTick(dtS: number): void {
  keyboard.update(dtS);
  const pitchUp = keyboard.pitchDeflection;
  const rollRight = keyboard.rollDeflection;
  const yawRight = keyboard.yawDeflection;

  const local = localEntity();
  if (local) getForward(local.orientation, scratchNose);
  else scratchNose.set(0, 0, 1);

  const hasKeyboard = pitchUp !== 0 || rollRight !== 0 || yawRight !== 0;
  if (mouseAim.locked && !hasKeyboard) {
    // mysz prowadzi: cel z celownika, renormalizowany względem nosa z serwera
    aimCore.renormalize(scratchNose);
    aimCore.targetDir(scratchAim);
  } else {
    // klawiatura lub brak locka: cel = nos (serwer i tak użyje klawiatury); aim nigdy zerowy
    aimCore.alignTo(scratchNose);
    scratchAim.copy(scratchNose);
  }

  inputFrame.sequence = ++sequence;
  inputFrame.clientTimeMs = Date.now() >>> 0;
  inputFrame.throttle = keyboard.throttle;
  inputFrame.pitchUp = pitchUp;
  inputFrame.rollRight = rollRight;
  inputFrame.yawRight = yawRight;
  inputFrame.fire = false; // broń online wyłączona w fazie 8 (wraca w fazie 11)
  inputFrame.aimX = scratchAim.x;
  inputFrame.aimY = scratchAim.y;
  inputFrame.aimZ = scratchAim.z;
  net.sendInput(inputFrame);
}

// --- HUD / status połączenia ---
function updateHud(): void {
  const local = localEntity();
  const lines: string[] = ['TRYB ONLINE — faza 8 (broń wyłączona, input z opóźnieniem)'];
  if (local) {
    const tasKmh = local.velocity.length() * MS_TO_KMH;
    lines.push(
      `prędkość ${tasKmh.toFixed(0).padStart(4)} km/h`,
      `wysokość ${local.position.y.toFixed(0).padStart(5)} m`,
      `gaz      ${(local.throttle * 100).toFixed(0).padStart(3)} %`,
      `stan     ${local.life}${local.stalled ? '  PRZECIĄGNIĘCIE' : ''}`,
    );
  }
  lines.push(
    '',
    `ping ${String(net.rttMs).padStart(3)} ms   id ${net.localPlayerId ?? '—'}   gracze ${net.latestSnapshot?.entities.length ?? 0}`,
    mouseAim.locked ? '[mysz aktywna]' : '[kliknij, by przejąć celowanie myszą]',
    'WSAD/strzałki — ster • Q/E — kierunek • Shift/Ctrl — gaz',
  );
  hudEl.textContent = lines.join('\n');
}

function updateConnOverlay(): void {
  switch (net.status) {
    case 'connecting':
    case 'handshaking':
      connEl.classList.add('show');
      connEl.innerHTML = '<div class="msg">Łączenie z serwerem…</div>';
      break;
    case 'error':
      connEl.classList.add('show');
      connEl.innerHTML = `<div class="head">Błąd połączenia</div><div class="msg">${escapeHtml(net.statusMessage)}</div><button onclick="location.reload()">Spróbuj ponownie</button>`;
      break;
    case 'closed':
      connEl.classList.add('show');
      connEl.innerHTML = `<div class="head">Rozłączono</div><div class="msg">${escapeHtml(net.statusMessage)}</div><button onclick="location.reload()">Połącz ponownie</button>`;
      break;
    case 'online':
      connEl.classList.remove('show');
      break;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'));
}

// --- pętla renderu ---
let lastMs = performance.now();
let inputAccumS = 0;
let loadingHidden = false;

renderer.setAnimationLoop(() => {
  const now = performance.now();
  const frameDtS = Math.min(0.1, (now - lastMs) / 1000);
  lastMs = now;

  // input 60 Hz (stały krok) — niezależnie od częstotliwości renderu
  inputAccumS = Math.min(inputAccumS + frameDtS, 0.25);
  while (inputAccumS >= INPUT_DT_S) {
    sendInputTick(INPUT_DT_S);
    inputAccumS -= INPUT_DT_S;
  }

  const snap = net.latestSnapshot;
  if (snap) {
    seenIds.clear();
    for (const e of snap.entities) {
      seenIds.add(e.id);
      const m = ensureMesh(e.id);
      m.object.position.copy(e.position); // SUROWO: bez interpolacji (faza 9)
      m.object.quaternion.copy(e.orientation);
      m.object.visible = e.life !== 'dead';
      m.update(frameDtS, e.throttle, e.life === 'alive');
    }
    for (const [id, m] of meshes) {
      if (seenIds.has(id)) continue;
      scene.remove(m.object);
      meshes.delete(id);
    }
  }

  const local = localEntity();
  if (local) {
    const lm = meshes.get(local.id);
    if (lm) chaseCamera.update(frameDtS, lm.object.position, lm.object.quaternion, local.velocity, 0);
    if (!loadingHidden) {
      document.getElementById('loading')?.classList.add('hidden');
      loadingHidden = true;
    }
  }

  world.update(camera.position);
  updateHud();
  updateConnOverlay();
  renderer.render(scene, camera);
});

// awaryjne zdjęcie ekranu ładowania, gdyby połączenie zawisło (np. brak serwera)
setTimeout(() => document.getElementById('loading')?.classList.add('hidden'), 8000);
