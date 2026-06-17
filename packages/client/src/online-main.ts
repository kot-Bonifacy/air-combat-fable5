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
  BULLET_POOL_CAPACITY,
  BulletPool,
  INPUT_HZ,
  MRAD_TO_RAD,
  MS_TO_KMH,
  MouseAimCore,
  PORT,
  SPITFIRE_MK2,
  aimDirectionBody,
  applyDispersion,
  createRng,
  createTerrain,
  getForward,
  type EntitySnapshot,
  type GameEvent,
  type InputFrame,
  type KillCause,
  type MatchEndedMessage,
  type RoomJoinedMessage,
  type RoomPlayer,
  type Snapshot,
  type StandingsMessage,
} from '@air-combat/shared';
import { BulletTracers } from './bullet-tracers';
import { ChaseCamera } from './chase-camera';
import { KeyboardInput } from './input';
import { MouseAim } from './mouse-aim';
import { NetClient, defaultServerUrl } from './net/net-client';
import { SnapshotInterpolator, createInterpolatedState } from './net/interpolation';
import { NetDebugOverlay } from './net/net-debug-overlay';
import { Predictor } from './net/prediction';
import { LobbyUI, type WaitingView } from './net/lobby-ui';
import { ResultsOverlay, ScoreboardOverlay } from './net/match-ui';
import type { NetConditionsPanel } from './net/net-conditions-panel';
import { createPlaneMesh, type PlaneModel } from './plane-mesh';
import { createWorld } from './world';

// Tryb online faza 10 — lobby + pokoje. Klient łączy się LENIWIE (przy pierwszej akcji
// w lobby), dzięki czemu hello niesie aktualny nick. Token sesji z welcome trzymamy w
// localStorage → przy odświeżeniu próbujemy reconnectu do tego samego samolotu. Render +
// input + predykcja działają tylko w fazie 'playing'; w lobby pokazujemy ekrany DOM.
// Predykcja/interpolacja jak w fazie 9. Faza 11: broń online — spust w INPUT, pociski
// autorytatywne na serwerze; klient rysuje smugacze z eventu MUZZLE i pokazuje hit marker /
// kill feed z eventów HIT / KILL (zero hit-detekcji po stronie klienta). Faza 13: pętla
// meczu FFA — scoreboard na Tab (standings), ekran wyników z rewanżem (matchEnded), HUD
// z zegarem i wynikiem; wszystko AUTORYTATYWNE z serwera (klient tylko wyświetla).

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

// spust (faza 11): LPM przy aktywnej myszy albo Spacja. Pierwsze kliknięcie wchodzi
// w pointer lock i NIE strzela (triggerHeld bramkuje LPM na mouseAim.locked) — jak offline.
let triggerMouse = false;
let triggerKey = false;
renderer.domElement.addEventListener('pointerdown', (e) => {
  if (e.button === 0) triggerMouse = true;
});
window.addEventListener('pointerup', (e) => {
  if (e.button === 0) triggerMouse = false;
});
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') triggerKey = true;
  // Tab (przytrzymanie) = tabela wyników w trakcie meczu; blokujemy domyślną zmianę fokusu
  if (e.code === 'Tab') {
    e.preventDefault();
    if (phase === 'playing' && !matchResultsShown) scoreboard.show();
  }
});
window.addEventListener('keyup', (e) => {
  if (e.code === 'Space') triggerKey = false;
  if (e.code === 'Tab') {
    e.preventDefault();
    scoreboard.hide();
  }
});
function triggerHeld(): boolean {
  return (mouseAim.locked && triggerMouse) || triggerKey;
}

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

// --- walka (faza 11): pociski są autorytatywne na serwerze; klient rysuje WYŁĄCZNIE
//     kosmetyczne smugacze z eventu MUZZLE (z pozy strzelca), a hit marker / kill feed
//     z eventów HIT / KILL. Żadnej hit-detekcji po stronie klienta. ---
const arm = plane.armament;
const cosmeticPool = new BulletPool(BULLET_POOL_CAPACITY);
const tracers = new BulletTracers(scene, BULLET_POOL_CAPACITY);
const tracerCounter = new Map<number, number>(); // ciągłość kadencji smugaczy per strzelec
const cosmDir = new Vector3();
const cosmMuzzle = new Vector3();
const cosmVel = new Vector3();

const hitMarkerEl = requireEl('hit-marker');
const killFeedEl = requireEl('kill-feed');
const HIT_MARKER_S = 0.12;
const HIT_MARKER_KILL_S = 0.5;
const KILL_FEED_TTL_S = 6;
let hitMarkerTimerS = 0;
let hitMarkerKill = false;
interface KillFeedLine {
  text: string;
  ageS: number;
}
const killFeed: KillFeedLine[] = [];
/** Ułamek HP własnego samolotu z ostatniego snapshotu (HUD) — HP jest autorytetem serwera. */
let localHealthFrac = 1;

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
  // czysty stan walki: zgaś smugacze, wyczyść feed/marker (nowy mecz / reconnect)
  for (const b of cosmeticPool.bullets) b.active = false;
  tracerCounter.clear();
  killFeed.length = 0;
  hitMarkerTimerS = 0;
  hitMarkerKill = false;
  localHealthFrac = 1;
  latestStandings = null;
}

function handleSnapshot(snap: Snapshot): void {
  if (phase !== 'playing' || !net) return;
  presentIds.clear();
  remoteScratch.length = 0;
  for (const e of snap.entities) {
    presentIds.add(e.id);
    ensureMesh(e.id);
    if (e.isLocal) {
      predictor.reconcile(e, snap.ackSeq);
      localHealthFrac = e.healthFrac;
    } else {
      remoteScratch.push(e);
    }
  }
  interpolator.ingest(snap.serverTick, remoteScratch);
  for (const [id, m] of meshes) {
    if (presentIds.has(id)) continue;
    scene.remove(m.object);
    meshes.delete(id);
  }
}

// --- zdarzenia walki (faza 11): MUZZLE → smugacze, HIT → marker, KILL → feed/marker ---
function handleEvents(events: GameEvent[]): void {
  if (phase !== 'playing') return;
  const localId = net?.localPlayerId ?? null;
  for (const ev of events) {
    if (ev.kind === 'muzzle') {
      spawnCosmeticVolley(ev.ownerId, ev.seed, ev.shots);
    } else if (ev.kind === 'hit') {
      // hit marker dopiero z potwierdzenia serwera (uczciwość > responsywność) — gdy to JA trafiłem
      if (ev.shooterId === localId && !hitMarkerKill) hitMarkerTimerS = HIT_MARKER_S;
    } else {
      onKill(ev.killerId, ev.victimId, ev.cause, localId);
    }
  }
}

/**
 * Kosmetyczna salwa smugaczy z pozy RENDEROWANEJ strzelca (mesh). Pociski autorytatywne
 * liczy serwer — te tu nie mają hit-detekcji, gasną po czasie życia. Rozrzut z seeda eventu
 * (stabilny per salwa); prędkość płatowca pomijamy (muzzleVelocity dominuje — kosmetyka).
 */
function spawnCosmeticVolley(ownerId: number, seed: number, shots: number): void {
  const mesh = meshes.get(ownerId);
  if (!mesh) return;
  const rng = createRng(seed);
  const dispersionRad = arm.dispersionMrad * MRAD_TO_RAD;
  let counter = tracerCounter.get(ownerId) ?? 0;
  const pos = mesh.object.position;
  const quat = mesh.object.quaternion;
  for (let i = 0; i < shots; i++) {
    const m = arm.muzzles[i % arm.muzzles.length]!;
    cosmMuzzle.set(m[0], m[1], m[2]);
    aimDirectionBody(cosmMuzzle, arm.convergenceM, arm.convergenceRiseM, cosmDir);
    applyDispersion(cosmDir, dispersionRad, rng);
    cosmDir.applyQuaternion(quat);
    cosmMuzzle.applyQuaternion(quat).add(pos);
    cosmVel.copy(cosmDir).multiplyScalar(arm.muzzleVelocityMs);
    const tracer = counter % 3 === 0;
    counter++;
    cosmeticPool.spawn(cosmMuzzle, cosmVel, 0, ownerId, tracer);
  }
  tracerCounter.set(ownerId, counter);
}

function onKill(killerId: number, victimId: number, cause: KillCause, localId: number | null): void {
  const victim = playerName(victimId);
  if (cause === 'air') {
    pushKillFeed(`✕ ${playerName(killerId)} → ${victim}`);
    if (killerId === localId) {
      hitMarkerTimerS = HIT_MARKER_KILL_S;
      hitMarkerKill = true;
    }
  } else {
    pushKillFeed(`✕ ${victim} — ${cause === 'collision' ? 'kolizja' : 'rozbicie'}`);
  }
}

function pushKillFeed(text: string): void {
  killFeed.push({ text, ageS: 0 });
  if (killFeed.length > 5) killFeed.shift();
}

function playerName(id: number): string {
  const found = roomView?.players.find((p: RoomPlayer) => p.id === id);
  return found?.nick ?? `#${String(id)}`;
}

// --- lobby UI + sieć ---
const lobby = new LobbyUI({
  onQuickPlay: () => withConnection((c) => c.quickPlay()),
  onCreateRoom: (bots, difficulty, scoreLimit) => withConnection((c) => c.createRoom(bots, difficulty, scoreLimit)),
  onJoinRoom: (code) => withConnection((c) => c.joinRoom(code)),
  onRefreshList: () => withConnection((c) => c.requestRoomList()),
  onStartMatch: () => net?.startMatch(),
  onLeaveRoom: () => {
    net?.leaveRoom();
    enterLobby();
  },
});

// --- nakładki pętli meczu (faza 13): scoreboard (Tab) + ekran wyników z rewanżem ---
const scoreboard = new ScoreboardOverlay();
const results = new ResultsOverlay({
  onRematch: () => net?.startMatch(), // host: ended → playing (start() na serwerze)
  onLeave: () => {
    net?.leaveRoom();
    enterLobby();
  },
});
/** Ostatnia tabela wyników z serwera (HUD + scoreboard); null poza meczem. */
let latestStandings: StandingsMessage | null = null;
/** Czy widać ekran wyników (blokuje scoreboard na Tab — tabela jest już na ekranie). */
let matchResultsShown = false;

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
  c.onEvents = handleEvents;
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
    if (msg.state === 'playing') {
      if (phase !== 'playing') enterPlaying();
    } else if (msg.state === 'waiting') {
      // ekran wyników wygasł na serwerze → powrót do poczekalni (z meczu albo z lobby)
      results.hide();
      if (phase === 'playing') enterWaiting(roomView);
      else if (phase === 'lobby') lobby.updateWaiting(roomView);
    }
    // 'ended' obsługuje onMatchEnded (overlay wyników); roomView już zaktualizowane
  };
  c.onMatchStarted = () => enterPlaying();
  c.onStandings = (msg) => {
    latestStandings = msg;
    scoreboard.update(msg.rows, msg.scoreLimit, msg.timeLeftS);
  };
  c.onMatchEnded = (msg) => onMatchEnded(msg);
  c.onServerShutdown = () => {
    // status 'error' (ustawiony w NetClient) wyświetli komunikat zamiast spinnera;
    // chowamy nakładki meczu, żeby nie zasłaniały
    scoreboard.hide();
    results.hide();
  };
  c.onLobbyError = (_code, message) => lobby.setError(message);
  return c;
}

function onMatchEnded(msg: MatchEndedMessage): void {
  if (!roomView) return;
  scoreboard.hide();
  matchResultsShown = true;
  const isHost = roomView.youId === roomView.hostId;
  results.show(msg.winnerId, msg.reason, msg.rows, net?.localPlayerId ?? null, isHost);
}

function onRoomJoined(msg: RoomJoinedMessage): void {
  roomView = {
    code: msg.code,
    state: msg.state,
    players: msg.players,
    hostId: msg.hostId,
    youId: msg.youId,
  };
  scoreboard.setLocalId(msg.youId);
  if (msg.state === 'playing') enterPlaying();
  else enterWaiting(roomView);
}

function enterLobby(): void {
  phase = 'lobby';
  roomView = null;
  matchResultsShown = false;
  resetGameState();
  scoreboard.hide();
  results.hide();
  lobby.showEntry();
  document.getElementById('loading')?.classList.add('hidden');
}

function enterWaiting(view: WaitingView): void {
  phase = 'lobby';
  matchResultsShown = false;
  scoreboard.hide();
  results.hide();
  lobby.showWaiting(view);
  document.getElementById('loading')?.classList.add('hidden');
}

function enterPlaying(): void {
  if (phase === 'playing') return;
  phase = 'playing';
  matchResultsShown = false;
  resetGameState();
  scoreboard.hide();
  results.hide();
  lobby.hide();
  loadingHidden = false;
}

// --- pętla wejścia (60 Hz, niezależnie od fps renderu) ---
const scratchNose = new Vector3();
const scratchAim = new Vector3();
let sequence = 0;
const inputFrame: InputFrame = {
  sequence: 0,
  ackServerTick: 0,
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
  // echo najnowszego ticku serwera → serwer liczy z niego rewind lag-comp (faza 11)
  inputFrame.ackServerTick = net.latestSnapshot?.serverTick ?? 0;
  inputFrame.throttle = keyboard.throttle;
  inputFrame.pitchUp = pitchUp;
  inputFrame.rollRight = rollRight;
  inputFrame.yawRight = yawRight;
  inputFrame.fire = triggerHeld();
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
      `HP       ${(localHealthFrac * 100).toFixed(0).padStart(3)} %`,
      `stan     ${s.life}${s.stalled ? '  PRZECIĄGNIĘCIE' : ''}`,
    );
  }
  if (latestStandings) {
    const localId = net?.localPlayerId ?? null;
    const myKills = latestStandings.rows.find((r) => r.id === localId)?.kills ?? 0;
    lines.push(
      `mecz     ${String(myKills).padStart(2)} / ${String(latestStandings.scoreLimit)} zestrz.   czas ${formatClock(latestStandings.timeLeftS)}`,
    );
  }
  lines.push(
    '',
    `ping ${String(net?.rttMs ?? 0).padStart(3)} ms   id ${net?.localPlayerId ?? '—'}   gracze ${describePlayers()}`,
    mouseAim.locked ? '[mysz aktywna]' : '[kliknij, by przejąć celowanie myszą]',
    'WSAD/strzałki — ster • Q/E — kierunek • Shift/Ctrl — gaz • LPM/Spacja — ogień • [Tab] tabela • [N] sieć',
  );
  hudEl.textContent = lines.join('\n');
}

/** MM:SS dla zegara meczu w HUD. */
function formatClock(totalS: number): string {
  const s = Math.max(0, Math.floor(totalS));
  return `${String(Math.floor(s / 60))}:${String(s % 60).padStart(2, '0')}`;
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

// --- render walki (faza 11): smugacze, hit marker, kill feed ---
function updateCombatVisuals(frameDtS: number): void {
  cosmeticPool.update(arm.bulletDragK, arm.bulletLifetimeS, frameDtS);
  tracers.update(cosmeticPool.bullets, 1);

  if (hitMarkerTimerS > 0) {
    const dur = hitMarkerKill ? HIT_MARKER_KILL_S : HIT_MARKER_S;
    hitMarkerEl.className = hitMarkerKill ? 'kill' : '';
    hitMarkerEl.style.opacity = Math.min(1, hitMarkerTimerS / dur).toFixed(2);
    hitMarkerTimerS -= frameDtS;
    if (hitMarkerTimerS <= 0) hitMarkerKill = false;
  } else {
    hitMarkerEl.style.opacity = '0';
  }

  if (killFeed.length > 0) {
    for (let i = killFeed.length - 1; i >= 0; i--) {
      const line = killFeed[i]!;
      line.ageS += frameDtS;
      if (line.ageS >= KILL_FEED_TTL_S) killFeed.splice(i, 1);
    }
    killFeedEl.replaceChildren(
      ...killFeed.map((line) => {
        const div = document.createElement('div');
        div.textContent = line.text;
        div.style.opacity = Math.min(1, KILL_FEED_TTL_S - line.ageS).toFixed(2);
        return div;
      }),
    );
  } else if (killFeedEl.childElementCount > 0) {
    killFeedEl.replaceChildren();
  }
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
    updateCombatVisuals(frameDtS);
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
