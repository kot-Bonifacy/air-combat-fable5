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
import { NetClient, defaultServerUrl } from './net/net-client';
import { SnapshotInterpolator, createInterpolatedState } from './net/interpolation';
import { NetDebugOverlay } from './net/net-debug-overlay';
import { Predictor } from './net/prediction';
import type { NetConditionsPanel } from './net/net-conditions-panel';
import { createPlaneMesh, type PlaneModel } from './plane-mesh';
import { createWorld } from './world';

// Tryb online fazy 9 — osobna strona (online.html). Własny samolot jest PREDYKOWANY
// lokalnie (ta sama fizyka co serwer, przez Predictor): input działa natychmiast, a
// snapshot serwera koryguje dryf (reconciliation). Obce samoloty idą przez interpolację
// snapshotów (bufor ~100 ms). Klawisze: [N] overlay sieci, [P] panel symulatora (dev).
// Broń online wciąż wyłączona (wraca w fazie 11).

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

// --- sieć + predykcja + interpolacja ---
const net = new NetClient(defaultServerUrl(PORT));
const predictor = new Predictor(plane, terrain);
const interpolator = new SnapshotInterpolator();
const interpOut = createInterpolatedState();
const overlay = new NetDebugOverlay();

// --- meshe encji (jeden PlaneModel na id z serwera) ---
const meshes = new Map<number, PlaneModel>();
const presentIds = new Set<number>();
const remoteScratch: EntitySnapshot[] = [];
let remoteCount = 0;
let extrapolatingCount = 0;

function ensureMesh(id: number): PlaneModel {
  let m = meshes.get(id);
  if (!m) {
    m = createPlaneMesh(wingspanM);
    scene.add(m.object);
    meshes.set(id, m);
  }
  return m;
}

// Każdy snapshot: własny samolot → reconciliation predyktora, obce → bufor interpolacji,
// plus zarządzanie obecnością meshów (gracz wszedł/wyszedł).
net.onSnapshot = (snap) => {
  presentIds.clear();
  remoteScratch.length = 0;
  for (const e of snap.entities) {
    presentIds.add(e.id);
    ensureMesh(e.id);
    if (e.isLocal) predictor.reconcile(e, snap.ackSeq);
    else remoteScratch.push(e);
  }
  interpolator.ingest(snap.serverTick, remoteScratch);
  for (const [id, m] of meshes) {
    if (presentIds.has(id)) continue;
    scene.remove(m.object);
    meshes.delete(id);
  }
};

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

  // nos z PREDYKOWANEGO stanu (instant) — celownik renormalizowany lokalnie, nie z serwera;
  // dzięki temu mysz odpowiada natychmiast (klucz fazy 9), a nie po RTT
  if (predictor.ready) getForward(predictor.sim.state.orientation, scratchNose);
  else scratchNose.set(0, 0, 1);

  const hasKeyboard = pitchUp !== 0 || rollRight !== 0 || yawRight !== 0;
  if (mouseAim.locked && !hasKeyboard) {
    aimCore.renormalize(scratchNose);
    aimCore.targetDir(scratchAim);
  } else {
    // klawiatura lub brak locka: cel = nos; aim nigdy zerowy (walidacja serwera)
    aimCore.alignTo(scratchNose);
    scratchAim.copy(scratchNose);
  }

  inputFrame.sequence = ++sequence;
  inputFrame.clientTimeMs = Date.now() >>> 0;
  inputFrame.throttle = keyboard.throttle;
  inputFrame.pitchUp = pitchUp;
  inputFrame.rollRight = rollRight;
  inputFrame.yawRight = yawRight;
  inputFrame.fire = false; // broń online wyłączona w fazie 9 (wraca w fazie 11)
  inputFrame.aimX = scratchAim.x;
  inputFrame.aimY = scratchAim.y;
  inputFrame.aimZ = scratchAim.z;

  net.sendInput(inputFrame); // do serwera (autorytet)
  predictor.predict(inputFrame, inputFrame.sequence); // i natychmiast lokalnie
}

// --- HUD / status połączenia ---
function updateHud(): void {
  const lines: string[] = ['TRYB ONLINE — faza 9 (predykcja + interpolacja)'];
  if (predictor.ready) {
    const s = predictor.sim.state;
    const tasKmh = s.velocity.length() * MS_TO_KMH;
    lines.push(
      `prędkość ${tasKmh.toFixed(0).padStart(4)} km/h`,
      `wysokość ${s.position.y.toFixed(0).padStart(5)} m`,
      `gaz      ${(s.throttle * 100).toFixed(0).padStart(3)} %`,
      `stan     ${s.life}${s.stalled ? '  PRZECIĄGNIĘCIE' : ''}`,
    );
  }
  lines.push(
    '',
    `ping ${String(net.rttMs).padStart(3)} ms   id ${net.localPlayerId ?? '—'}   gracze ${net.latestSnapshot?.entities.length ?? 0}`,
    mouseAim.locked ? '[mysz aktywna]' : '[kliknij, by przejąć celowanie myszą]',
    'WSAD/strzałki — ster • Q/E — kierunek • Shift/Ctrl — gaz • [N] sieć',
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

// --- przełączniki debug: [N] overlay sieci, [P] panel symulatora (tylko dev) ---
let conditionsPanel: NetConditionsPanel | undefined;
let panelLoading = false;
window.addEventListener('keydown', (event) => {
  if (event.code === 'KeyN') {
    overlay.toggle();
  } else if (event.code === 'KeyP' && import.meta.env.DEV) {
    if (conditionsPanel) {
      conditionsPanel.toggle();
    } else if (!panelLoading) {
      panelLoading = true;
      void import('./net/net-conditions-panel').then((m) => {
        conditionsPanel = m.createNetConditionsPanel(net.conditions);
      });
    }
  }
});

// --- pętla renderu ---
let lastMs = performance.now();
let inputAccumS = 0;
let loadingHidden = false;
// wykrycie teleportu własnego samolotu (zawinięcie torusa / respawn / twardy snap):
// reset kamery zamiast wygładzonego przelotu przez całą arenę
const prevLocalPos = new Vector3();
let hasPrevLocal = false;
const TELEPORT_JUMP_M = 1000; // > max ruchu na klatkę (600 m/s · 0.1 s = 60 m)

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

  predictor.updateRender(frameDtS); // wygładź offset korekty
  interpolator.update(frameDtS); // posuń zegar odtwarzania obcych

  remoteCount = 0;
  extrapolatingCount = 0;
  const localId = net.localPlayerId;
  for (const [id, m] of meshes) {
    if (id === localId) {
      if (!predictor.ready) continue;
      const s = predictor.sim.state;
      m.object.position.copy(predictor.renderPosition); // predykcja + wygładzenie
      m.object.quaternion.copy(predictor.renderOrientation);
      m.object.visible = s.life !== 'dead';
      m.update(frameDtS, s.throttle, s.life === 'alive');
    } else if (interpolator.sample(id, interpOut)) {
      remoteCount++;
      if (interpOut.extrapolated) extrapolatingCount++;
      m.object.position.copy(interpOut.position); // interpolacja snapshotów
      m.object.quaternion.copy(interpOut.orientation);
      m.object.visible = interpOut.life !== 'dead';
      m.update(frameDtS, interpOut.throttle, interpOut.life === 'alive');
    }
  }

  if (predictor.ready) {
    const s = predictor.sim.state;
    if (hasPrevLocal && prevLocalPos.distanceTo(predictor.renderPosition) > TELEPORT_JUMP_M) {
      chaseCamera.reset(); // teleport — bez przelotu kamery przez arenę
    }
    prevLocalPos.copy(predictor.renderPosition);
    hasPrevLocal = true;
    chaseCamera.update(frameDtS, predictor.renderPosition, predictor.renderOrientation, s.velocity, 0);
    if (!loadingHidden) {
      document.getElementById('loading')?.classList.add('hidden');
      loadingHidden = true;
    }
  }

  world.update(camera.position);
  updateHud();
  updateConnOverlay();
  overlay.update({
    status: net.status,
    rttMs: net.rttMs,
    conditions: net.conditions,
    reconcile: predictor.metrics,
    bufferMs: interpolator.bufferMs,
    lostSnapshots: interpolator.lostSnapshots,
    remoteCount,
    extrapolatingCount,
  });
  renderer.render(scene, camera);
});

// awaryjne zdjęcie ekranu ładowania, gdyby połączenie zawisło (np. brak serwera)
setTimeout(() => document.getElementById('loading')?.classList.add('hidden'), 8000);
