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
  type RoomJoinedMessage,
  type Snapshot,
} from '@air-combat/shared';
import { ChaseCamera } from './chase-camera';
import { KeyboardInput } from './input';
import { MouseAim } from './mouse-aim';
import { NetClient, defaultServerUrl } from './net/net-client';
import { SnapshotInterpolator, createInterpolatedState } from './net/interpolation';
import { NetDebugOverlay } from './net/net-debug-overlay';
import { Predictor } from './net/prediction';
import { LobbyUI, type WaitingView } from './net/lobby-ui';
import type { NetConditionsPanel } from './net/net-conditions-panel';
import { createPlaneMesh, type PlaneModel } from './plane-mesh';
import { createWorld } from './world';

// Tryb online faza 10 — lobby + pokoje. Klient łączy się LENIWIE (przy pierwszej akcji
// w lobby), dzięki czemu hello niesie aktualny nick. Token sesji z welcome trzymamy w
// localStorage → przy odświeżeniu próbujemy reconnectu do tego samego samolotu. Render +
// input + predykcja działają tylko w fazie 'playing'; w lobby pokazujemy ekrany DOM.
// Predykcja/interpolacja jak w fazie 9 (broń wciąż wyłączona — wraca w fazie 11).

const plane = SPITFIRE_MK2;
const wingspanM = Math.sqrt(plane.aspectRatio * plane.wingAreaM2);
const INPUT_DT_S = 1 / INPUT_HZ;
const TOKEN_STORAGE_KEY = 'air-combat:token';

type Phase = 'lobby' | 'playing';

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

// --- stan sieci/lobby ---
let net: NetClient | null = null;
let phase: Phase = 'lobby';
let attemptingResume = false;
let roomView: WaitingView | null = null;

// --- predykcja + interpolacja (odtwarzane przy wejściu do nowego meczu) ---
let predictor = new Predictor(plane, terrain);
let interpolator = new SnapshotInterpolator();
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

function clearMeshes(): void {
  for (const [, m] of meshes) scene.remove(m.object);
  meshes.clear();
  presentIds.clear();
}

/** Świeży stan gry przy wejściu do meczu (nowy mecz / reconnect): zero starych encji. */
function resetGameState(): void {
  clearMeshes();
  predictor = new Predictor(plane, terrain);
  interpolator = new SnapshotInterpolator();
  hasPrevLocal = false;
  chaseCamera.reset();
}

function handleSnapshot(snap: Snapshot): void {
  if (phase !== 'playing' || !net) return;
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
}

// --- lobby UI + sieć ---
const lobby = new LobbyUI({
  onQuickPlay: () => withConnection((c) => c.quickPlay()),
  onCreateRoom: () => withConnection((c) => c.createRoom()),
  onJoinRoom: (code) => withConnection((c) => c.joinRoom(code)),
  onRefreshList: () => withConnection((c) => c.requestRoomList()),
  onStartMatch: () => net?.startMatch(),
  onLeaveRoom: () => {
    net?.leaveRoom();
    enterLobby();
  },
});

function loadToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}
function saveToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_STORAGE_KEY, token);
  } catch {
    /* localStorage niedostępny — reconnect po reloadzie po prostu nie zadziała */
  }
}

/** Tworzy NetClient z bieżącym nickiem (lub używa istniejącego) i wykonuje akcję po welcome. */
function withConnection(action: (c: NetClient) => void): void {
  const nick = lobby.nick;
  if (net && net.status === 'connected' && connectedNick === nick) {
    action(net);
    return;
  }
  // nick się zmienił lub brak połączenia → (re)połącz z aktualnym nickiem
  if (net) net.close();
  pendingAction = action;
  connectedNick = nick;
  net = createNet(nick, loadToken());
}

let connectedNick = '';
let pendingAction: ((c: NetClient) => void) | null = null;

function createNet(nick: string, token: string | null): NetClient {
  const c = new NetClient(defaultServerUrl(PORT), nick, token);
  c.onSnapshot = handleSnapshot;
  c.onWelcome = (msg) => {
    saveToken(msg.sessionToken);
    // świeże połączenie (nie reconnect) → pokaż lobby i pobierz listę pokoi
    if (!attemptingResume) {
      enterLobby();
      c.requestRoomList();
    }
    attemptingResume = false;
    const queued = pendingAction;
    pendingAction = null;
    queued?.(c);
  };
  c.onRoomList = (msg) => lobby.setRoomList(msg.rooms);
  c.onRoomJoined = (msg) => onRoomJoined(msg);
  c.onRoomUpdate = (msg) => {
    if (!roomView) return;
    roomView = { ...roomView, state: msg.state, players: msg.players, hostId: msg.hostId };
    if (msg.state === 'playing' && phase !== 'playing') enterPlaying();
    else if (phase === 'lobby') lobby.updateWaiting(roomView);
  };
  c.onMatchStarted = () => enterPlaying();
  c.onLobbyError = (_code, message) => lobby.setError(message);
  return c;
}

function onRoomJoined(msg: RoomJoinedMessage): void {
  roomView = {
    code: msg.code,
    state: msg.state,
    players: msg.players,
    hostId: msg.hostId,
    youId: msg.youId,
  };
  if (msg.state === 'playing') enterPlaying();
  else enterWaiting(roomView);
}

function enterLobby(): void {
  phase = 'lobby';
  roomView = null;
  resetGameState();
  lobby.showEntry();
  document.getElementById('loading')?.classList.add('hidden');
}

function enterWaiting(view: WaitingView): void {
  phase = 'lobby';
  lobby.showWaiting(view);
  document.getElementById('loading')?.classList.add('hidden');
}

function enterPlaying(): void {
  if (phase === 'playing') return;
  phase = 'playing';
  resetGameState();
  lobby.hide();
  loadingHidden = false;
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
  if (!net) return;
  keyboard.update(dtS);
  const pitchUp = keyboard.pitchDeflection;
  const rollRight = keyboard.rollDeflection;
  const yawRight = keyboard.yawDeflection;

  if (predictor.ready) getForward(predictor.sim.state.orientation, scratchNose);
  else scratchNose.set(0, 0, 1);

  const hasKeyboard = pitchUp !== 0 || rollRight !== 0 || yawRight !== 0;
  if (mouseAim.locked && !hasKeyboard) {
    aimCore.renormalize(scratchNose);
    aimCore.targetDir(scratchAim);
  } else {
    aimCore.alignTo(scratchNose);
    scratchAim.copy(scratchNose);
  }

  inputFrame.sequence = ++sequence;
  inputFrame.clientTimeMs = Date.now() >>> 0;
  inputFrame.throttle = keyboard.throttle;
  inputFrame.pitchUp = pitchUp;
  inputFrame.rollRight = rollRight;
  inputFrame.yawRight = yawRight;
  inputFrame.fire = false; // broń online wyłączona w fazie 10 (wraca w fazie 11)
  inputFrame.aimX = scratchAim.x;
  inputFrame.aimY = scratchAim.y;
  inputFrame.aimZ = scratchAim.z;

  net.sendInput(inputFrame);
  predictor.predict(inputFrame, inputFrame.sequence);
}

// --- HUD / status połączenia ---
function updateHud(): void {
  const lines: string[] = [`TRYB ONLINE — pokój ${roomView?.code ?? '—'}`];
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
    `ping ${String(net?.rttMs ?? 0).padStart(3)} ms   id ${net?.localPlayerId ?? '—'}   gracze ${describePlayers()}`,
    mouseAim.locked ? '[mysz aktywna]' : '[kliknij, by przejąć celowanie myszą]',
    'WSAD/strzałki — ster • Q/E — kierunek • Shift/Ctrl — gaz • [N] sieć',
  );
  hudEl.textContent = lines.join('\n');
}

function describePlayers(): string {
  const n = net?.latestSnapshot?.entities.length ?? 0;
  return String(n);
}

function updateConnOverlay(): void {
  if (!net) {
    connEl.classList.remove('show');
    return;
  }
  switch (net.status) {
    case 'error':
      connEl.classList.add('show');
      connEl.innerHTML = `<div class="head">Błąd połączenia</div><div class="msg">${escapeHtml(net.statusMessage)}</div><button onclick="location.reload()">Spróbuj ponownie</button>`;
      break;
    case 'closed':
      connEl.classList.add('show');
      connEl.innerHTML = `<div class="head">Rozłączono</div><div class="msg">${escapeHtml(net.statusMessage)}</div><button onclick="location.reload()">Połącz ponownie</button>`;
      break;
    default:
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
  } else if (event.code === 'KeyP' && import.meta.env.DEV && net) {
    if (conditionsPanel) {
      conditionsPanel.toggle();
    } else if (!panelLoading) {
      panelLoading = true;
      const conditions = net.conditions;
      void import('./net/net-conditions-panel').then((m) => {
        conditionsPanel = m.createNetConditionsPanel(conditions);
      });
    }
  }
});

// --- pętla renderu ---
let lastMs = performance.now();
let inputAccumS = 0;
let loadingHidden = false;
const prevLocalPos = new Vector3();
let hasPrevLocal = false;
const TELEPORT_JUMP_M = 1000;

renderer.setAnimationLoop(() => {
  const now = performance.now();
  const frameDtS = Math.min(0.1, (now - lastMs) / 1000);
  lastMs = now;

  if (phase === 'playing') {
    inputAccumS = Math.min(inputAccumS + frameDtS, 0.25);
    while (inputAccumS >= INPUT_DT_S) {
      sendInputTick(INPUT_DT_S);
      inputAccumS -= INPUT_DT_S;
    }

    predictor.updateRender(frameDtS);
    interpolator.update(frameDtS);

    remoteCount = 0;
    extrapolatingCount = 0;
    const localId = net?.localPlayerId ?? null;
    for (const [id, m] of meshes) {
      if (id === localId) {
        if (!predictor.ready) continue;
        const s = predictor.sim.state;
        m.object.position.copy(predictor.renderPosition);
        m.object.quaternion.copy(predictor.renderOrientation);
        m.object.visible = s.life !== 'dead';
        m.update(frameDtS, s.throttle, s.life === 'alive');
      } else if (interpolator.sample(id, interpOut)) {
        remoteCount++;
        if (interpOut.extrapolated) extrapolatingCount++;
        m.object.position.copy(interpOut.position);
        m.object.quaternion.copy(interpOut.orientation);
        m.object.visible = interpOut.life !== 'dead';
        m.update(frameDtS, interpOut.throttle, interpOut.life === 'alive');
      }
    }

    if (predictor.ready) {
      const s = predictor.sim.state;
      if (hasPrevLocal && prevLocalPos.distanceTo(predictor.renderPosition) > TELEPORT_JUMP_M) {
        chaseCamera.reset();
      }
      prevLocalPos.copy(predictor.renderPosition);
      hasPrevLocal = true;
      chaseCamera.update(frameDtS, predictor.renderPosition, predictor.renderOrientation, s.velocity, 0);
      if (!loadingHidden) {
        document.getElementById('loading')?.classList.add('hidden');
        loadingHidden = true;
      }
    }
    updateHud();
  }

  world.update(camera.position);
  updateConnOverlay();
  if (net) {
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
  }
  renderer.render(scene, camera);
});

// --- start: pokaż lobby; spróbuj reconnectu, jeśli mamy token z poprzedniej sesji ---
const savedToken = loadToken();
if (savedToken) {
  attemptingResume = true;
  connectedNick = lobby.nick;
  net = createNet(lobby.nick, savedToken);
  // gdyby reconnect nie zwrócił pokoju (token wygasł), po chwili pokaż lobby
  setTimeout(() => {
    if (phase === 'lobby' && !roomView) {
      lobby.showEntry();
      net?.requestRoomList();
    }
  }, 1500);
} else {
  lobby.showEntry();
}
document.getElementById('loading')?.classList.add('hidden');
