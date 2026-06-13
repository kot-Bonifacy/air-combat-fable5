import {
  AmbientLight,
  DirectionalLight,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PMREMGenerator,
  Quaternion,
  Scene,
  SphereGeometry,
  Vector3,
  WebGLRenderer,
} from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import {
  ARENA_RELEASE_DISTANCE_M,
  ARENA_WARNING_DISTANCE_M,
  BOT_CONFIG,
  BULLET_POOL_CAPACITY,
  Bot,
  BulletPool,
  FixedStepLoop,
  GRAVITY_MS2,
  MATCH_SCORE_TO_WIN,
  MS_TO_KMH,
  PHYSICS_HZ,
  PilotControl,
  RESPAWN_DELAY_S,
  SPITFIRE_MK1,
  applyDamage,
  createControlDeflections,
  createFireControl,
  createHealth,
  createPilotDemands,
  createRng,
  createSimPlane,
  createTerrain,
  distanceToArenaEdgeM,
  getForward,
  getRight,
  getUp,
  lookaheadSurfaceM,
  pilotStep,
  resetHealth,
  segmentSphereHit,
  sumForces,
  surfaceHeightM,
  totalAmmo,
  updateFire,
  updateLifecycle,
  validatePlaneState,
  type DifficultyLevel,
  type PilotTickResult,
} from '@air-combat/shared';
import { BulletTracers } from './bullet-tracers';
import { EnemyMarker } from './enemy-marker';
import { GameMenu, type GameModeChoice } from './menu';
import { ChaseCamera } from './chase-camera';
import { Explosions } from './explosion';
import { FlightRecorder } from './flight-recorder';
import { ForceArrows } from './force-arrows';
import { Hud } from './hud';
import { KeyboardInput } from './input';
import { MouseAim, projectDirToScreen } from './mouse-aim';
import { MuzzleFlash } from './muzzle-flash';
import { connectNetStatus } from './net-status';
import { OrbitCamera } from './orbit-camera';
import { createPlaneMesh } from './plane-mesh';
import { Targets, type TargetHit } from './targets';
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
const control = new PilotControl();
const deflections = createControlDeflections();
const demands = createPilotDemands();
const prevPosition = new Vector3();
const prevOrientation = new Quaternion();
let lastTick: PilotTickResult | undefined;

// --- walka (faza 5) ---
/** Seed rozrzutu — lokalnie stały; serwer zaseeduje per mecz (faza 11). */
const COMBAT_SEED = 0x5eed;
/** Id właściciela pocisków (kill credit) — lokalnie jeden gracz. */
const OWNER_ID = 0;
const pool = new BulletPool(BULLET_POOL_CAPACITY);
const fireControl = createFireControl(plane.armament);
const combatRng = createRng(COMBAT_SEED);
const AMMO_MAX = totalAmmo(plane.armament);
/** Spust: LPM aktywne tylko przy zablokowanej myszy, Spacja zawsze. */
let triggerMouse = false;
let triggerKey = false;
let pendingMuzzleFlash = false;

// hit marker (krzyżyk) + kill feed
const HIT_MARKER_S = 0.12;
const HIT_MARKER_KILL_S = 0.5;
const KILL_FEED_TTL_S = 4;
let hitMarkerTimerS = 0;
let hitMarkerKill = false;
interface KillFeedLine {
  text: string;
  ageS: number;
}
const killFeed: KillFeedLine[] = [];

// --- tryb gry / mecz (faza 6) ---
type GameMode = 'menu' | 'dogfight' | 'training';
const ENEMY_ID = 1;
/** Pozycje startowe pojedynku: gracz na −Z, bot na +Z, ~2.6 km od siebie. */
const DOGFIGHT_PLAYER_Z = -1300;
const DOGFIGHT_ENEMY_Z = 1300;
/** Dystanse próbkowania terenu przed botem (omijanie grani). */
const GROUND_LOOKAHEAD_M = [300, 600, 1000, 1500];

let gameMode: GameMode = 'menu';
let matchOver = false;
let playerKills = 0;
let enemyKills = 0;
let difficulty: DifficultyLevel = 'normalny';

const playerHealth = createHealth(plane.hpPool);

const enemySim = createSimPlane(0xb0b1e);
const enemyState = enemySim.state;
const enemyHealth = createHealth(plane.hpPool);
const enemyFire = createFireControl(plane.armament);
const enemyDemands = createPilotDemands();
const enemyCombatRng = createRng(COMBAT_SEED ^ 0x9e37);
const enemyPrevPos = new Vector3();
const enemyPrevOrient = new Quaternion();
let enemyBot = new Bot(BOT_CONFIG.tuning, BOT_CONFIG.levels[difficulty], 0xb0b1e);

function triggerHeld(): boolean {
  return (mouseAim.locked && triggerMouse) || triggerKey;
}

/** Reakcja na trafienie pocisku w cel: hit marker, a przy zniszczeniu wybuch + kill feed. */
function onTargetHit(hit: TargetHit): void {
  if (hit.destroyed) {
    hitMarkerTimerS = HIT_MARKER_KILL_S;
    hitMarkerKill = true;
    explosions.spawn(hit.position);
    killFeed.push({ text: `✕ ${hit.label} zestrzelony`, ageS: 0 });
    if (killFeed.length > 5) killFeed.shift();
  } else if (!hitMarkerKill) {
    hitMarkerTimerS = HIT_MARKER_S;
  }
}

// --- scena (przed inputem: mysz wymaga elementu canvas) ---

const app = document.getElementById('app');
if (!app) throw new Error('brak elementu #app');

const renderer = new WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
app.appendChild(renderer.domElement);

const keyboard = new KeyboardInput(window);
const mouseAim = new MouseAim(renderer.domElement, control.mouseAim);
/** Poza areną stery przejmuje autopilot zawracający (histereza ARENA_RELEASE_DISTANCE_M). */
let autopilotActive = false;

// spust: LPM (na canvasie) + Spacja (globalnie). Pierwsze kliknięcie przejmuje
// pointer lock i NIE strzela (triggerHeld bramkuje LPM na mouseAim.locked).
renderer.domElement.addEventListener('mousedown', (event) => {
  if (event.button === 0) triggerMouse = true;
});
window.addEventListener('mouseup', (event) => {
  if (event.button === 0) triggerMouse = false;
});
window.addEventListener('keydown', (event) => {
  if (event.code === 'Space') {
    event.preventDefault();
    triggerKey = true;
  }
});
window.addEventListener('keyup', (event) => {
  if (event.code === 'Space') triggerKey = false;
});

const scratchTargetDir = new Vector3();
const scratchFwd = new Vector3();
const scratchUp = new Vector3();
const scratchRight = new Vector3();

function resetPlane(): void {
  const spawnZ = gameMode === 'dogfight' ? DOGFIGHT_PLAYER_Z : SPAWN_Z_M;
  state.position.set(0, SPAWN_ALTITUDE_M, spawnZ);
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
  fireControl.ammoRemaining = AMMO_MAX;
  fireControl.cooldownS = 0;
  resetHealth(playerHealth);
  control.reset(state);
  prevPosition.copy(state.position);
  prevOrientation.copy(state.orientation);
  planeMesh.visible = true;
  chaseCamera.reset();
}

const scratchEnemyDir = new Vector3();

/** (Re)spawn bota-przeciwnika dla pojedynku: nosem ku graczowi, pełne HP/amunicja. */
function resetEnemy(): void {
  enemyState.position.set(0, SPAWN_ALTITUDE_M + 100, DOGFIGHT_ENEMY_Z);
  scratchEnemyDir.set(0, 0, -1); // ku graczowi (−Z)
  enemyState.velocity.copy(scratchEnemyDir).multiplyScalar(SPAWN_SPEED_MS);
  enemyState.orientation.setFromUnitVectors(scratchFwd.set(0, 0, 1), scratchEnemyDir);
  enemyState.angularRates.pitch = 0;
  enemyState.angularRates.roll = 0;
  enemyState.angularRates.yaw = 0;
  enemyState.throttle = 0.9;
  enemyState.iasMs = SPAWN_SPEED_MS;
  enemyState.life = 'alive';
  enemyState.lifeTimerS = 0;
  enemyFire.ammoRemaining = AMMO_MAX;
  enemyFire.cooldownS = 0;
  resetHealth(enemyHealth);
  enemyBot.reset(enemyState);
  enemyPrevPos.copy(enemyState.position);
  enemyPrevOrient.copy(enemyState.orientation);
  enemyMesh.visible = true;
}

function physicsStep(dtS: number): void {
  prevPosition.copy(state.position);
  prevOrientation.copy(state.orientation);

  if (state.life === 'alive') {
    keyboard.update(dtS);
    state.throttle = keyboard.throttle;

    // granice areny: poza nimi miękka utrata kontroli na rzecz autopilota zawracającego
    const edgeM = distanceToArenaEdgeM(state.position.x, state.position.z);
    if (edgeM < 0) autopilotActive = true;
    else if (edgeM >= ARENA_RELEASE_DISTANCE_M) autopilotActive = false;

    if (autopilotActive) {
      scratchTargetDir.set(-state.position.x, 0, -state.position.z).normalize();
      control.updateWithTarget(state, plane, scratchTargetDir, dtS, demands);
    } else {
      deflections.pitchUp = keyboard.pitchDeflection;
      deflections.rollRight = keyboard.rollDeflection;
      deflections.yawRight = keyboard.yawDeflection;
      control.update(state, plane, deflections, dtS, demands);
    }

    lastTick = pilotStep(sim, plane, demands, dtS);
    if (import.meta.env.DEV) {
      validatePlaneState(state, 'tick klienta');
      recorder?.record(state, lastTick, plane, dtS);
    }

    // ogień: tylko pod kontrolą gracza (nie podczas autopilota zawracającego)
    const wantFire = !autopilotActive && triggerHeld();
    const fired = updateFire(fireControl, plane.armament, state, OWNER_ID, combatRng, pool, wantFire, dtS);
    if (fired > 0) pendingMuzzleFlash = true;

    if (updateLifecycle(state, terrain, dtS) === 'crashed') {
      explosions.spawn(state.position);
      planeMesh.visible = false;
    }
  } else {
    // wrak: fizyka samolotu stoi, liczy się tylko timer respawnu
    if (updateLifecycle(state, terrain, dtS) === 'respawnReady') resetPlane();
  }

  // przeciwnik (pojedynek) — bot lata przez ten sam instruktor co gracz
  if (gameMode === 'dogfight') stepEnemy(dtS);

  // pociski żyją niezależnie od stanu samolotów
  pool.update(plane.armament.bulletDragK, plane.armament.bulletLifetimeS, dtS);

  if (gameMode === 'training') {
    targets.update(dtS);
    targets.resolveBulletHits(pool, onTargetHit);
  } else if (gameMode === 'dogfight') {
    resolveDogfightHits();
  }
}

/** Jeden tick przeciwnika: decyzja bota → instruktor → fizyka → ogień → cykl życia. */
function stepEnemy(dtS: number): void {
  enemyPrevPos.copy(enemyState.position);
  enemyPrevOrient.copy(enemyState.orientation);
  if (enemyState.life === 'alive') {
    const surf = lookaheadSurfaceM(
      terrain,
      enemyState.position.x,
      enemyState.position.z,
      enemyState.velocity.x,
      enemyState.velocity.z,
      GROUND_LOOKAHEAD_M,
    );
    const target = state.life === 'alive' ? state : null;
    const out = enemyBot.update(enemyState, plane, target, { surfaceHeightM: surf }, dtS, enemyDemands);
    enemyState.throttle = out.throttle;
    pilotStep(enemySim, plane, enemyDemands, dtS);
    if (import.meta.env.DEV) validatePlaneState(enemyState, 'tick bota');
    updateFire(enemyFire, plane.armament, enemyState, ENEMY_ID, enemyCombatRng, pool, out.fire, dtS);
    if (updateLifecycle(enemyState, terrain, dtS) === 'crashed') {
      explosions.spawn(enemyState.position);
      enemyMesh.visible = false;
    }
  } else if (updateLifecycle(enemyState, terrain, dtS) === 'respawnReady') {
    resetEnemy();
  }
}

/** Trafienia w pojedynku: pocisk gracza→bot, pocisk bota→gracz (odcinek vs sfera). */
function resolveDogfightHits(): void {
  for (const b of pool.bullets) {
    if (!b.active) continue;
    if (b.ownerId === OWNER_ID) {
      if (enemyState.life !== 'alive') continue;
      if (!segmentSphereHit(b.prevPosition, b.position, enemyState.position, plane.hitRadiusM)) continue;
      const res = applyDamage(enemyHealth, b.damage);
      b.active = false;
      if (res === 'destroyed') onEnemyDestroyed();
      else if (res === 'absorbed' && !hitMarkerKill) hitMarkerTimerS = HIT_MARKER_S;
    } else {
      if (state.life !== 'alive' || autopilotActive) continue;
      if (!segmentSphereHit(b.prevPosition, b.position, state.position, plane.hitRadiusM)) continue;
      applyDamage(playerHealth, b.damage);
      b.active = false;
      if (!playerHealth.alive) onPlayerDestroyed();
    }
  }
}

function onEnemyDestroyed(): void {
  playerKills++;
  hitMarkerTimerS = HIT_MARKER_KILL_S;
  hitMarkerKill = true;
  explosions.spawn(enemyState.position);
  enemyMesh.visible = false;
  enemyState.life = 'dead';
  enemyState.lifeTimerS = 0;
  killFeed.push({ text: `✕ Bot zestrzelony   ${playerKills}:${enemyKills}`, ageS: 0 });
  if (killFeed.length > 5) killFeed.shift();
  checkMatchEnd();
}

function onPlayerDestroyed(): void {
  enemyKills++;
  explosions.spawn(state.position);
  planeMesh.visible = false;
  state.life = 'dead';
  state.lifeTimerS = 0;
  killFeed.push({ text: `✕ Zestrzelony przez bota   ${playerKills}:${enemyKills}`, ageS: 0 });
  if (killFeed.length > 5) killFeed.shift();
  checkMatchEnd();
}

function checkMatchEnd(): void {
  if (playerKills < MATCH_SCORE_TO_WIN && enemyKills < MATCH_SCORE_TO_WIN) return;
  matchOver = true;
  if (document.pointerLockElement) document.exitPointerLock();
  menu.showResult(playerKills >= MATCH_SCORE_TO_WIN, playerKills, enemyKills);
}

/** Start trybu z menu: zeruje wynik, ustawia spawny, włącza/wyłącza strzelnicę. */
function startMatch(choice: GameModeChoice): void {
  matchOver = false;
  playerKills = 0;
  enemyKills = 0;
  if (choice.mode === 'dogfight') {
    gameMode = 'dogfight';
    difficulty = choice.difficulty;
    enemyBot = new Bot(BOT_CONFIG.tuning, BOT_CONFIG.levels[difficulty], 0xb0b1e);
    targets.setActive(false);
    resetPlane();
    resetEnemy();
  } else {
    gameMode = 'training';
    enemyMesh.visible = false;
    targets.setActive(true);
    resetPlane();
  }
}

let physicsHz = PHYSICS_HZ;
let loop = new FixedStepLoop(1 / physicsHz, physicsStep);

const scene = new Scene();

// near 0.5 (nie 0.1): rozdzielczość depth buffera — przy 0.1 linia brzegowa
// migotała (z-fighting teren↔ocean); kamera pościgowa nigdy nie jest bliżej
const camera = new PerspectiveCamera(60, 1, 0.5, 30000);
const chaseCamera = new ChaseCamera(camera);
const orbit = new OrbitCamera(camera, renderer.domElement);
let cameraMode: 'pościgowa' | 'orbitalna' = 'pościgowa';

// rozpiętość skrzydeł [m] z parametrów fizyki: b = √(AR · S) — bez literału w kodzie
const wingspanM = Math.sqrt(plane.aspectRatio * plane.wingAreaM2);
const planeModel = createPlaneMesh(wingspanM);
const planeMesh = planeModel.object;
scene.add(planeMesh);

// przeciwnik: ten sam model + czerwony beacon (model gracza i bota są identyczne,
// beacon + marker HUD odróżniają wroga); ukryty poza pojedynkiem
const enemyModel = createPlaneMesh(wingspanM);
const enemyMesh = enemyModel.object;
const enemyBeacon = new Mesh(new SphereGeometry(1.6, 12, 10), new MeshBasicMaterial({ color: 0xff3020 }));
enemyBeacon.position.set(0, 4, 0);
enemyMesh.add(enemyBeacon);
enemyMesh.visible = false;
scene.add(enemyMesh);

const terrain = createTerrain();
const world = createWorld(scene, terrain);
const explosions = new Explosions(scene);
const targets = new Targets(scene);
targets.setActive(false); // ukryte w menu; tryb treningu je włączy
const tracers = new BulletTracers(scene, BULLET_POOL_CAPACITY);
const muzzleFlash = new MuzzleFlash(scene, plane.armament.muzzles);

scene.add(new AmbientLight(0xffffff, 0.4));
const sun = new DirectionalLight(0xffffff, 1.2);
sun.position.set(30, 50, 20);
scene.add(sun);

// IBL: bez environment mapy materiały PBR metalu (model Spitfire'a) renderują
// się prawie czarne. RoomEnvironment to tani, neutralny refleks otoczenia.
// Dotyczy tylko MeshStandardMaterial — teren/ocean (Lambert) bez zmian.
const pmrem = new PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

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
const hitMarkerEl = requireEl('hit-marker');
const killFeedEl = requireEl('kill-feed');
const enemyMarker = new EnemyMarker(document.body);

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

resetPlane(); // statyczne tło pod menu (gameMode === 'menu' wstrzymuje fizykę)
const menu = new GameMenu(startMatch);
menu.showStart();
let lastTimeMs: number | undefined;

// licznik fps: średnia z okna 0.5 s (kryterium fazy 4: pomiar wydajności w HUD)
let fpsFrames = 0;
let fpsWindowS = 0;
let fpsValue = 0;

renderer.setAnimationLoop((timeMs) => {
  const frameDtS = lastTimeMs === undefined ? 0 : (timeMs - lastTimeMs) / 1000;
  lastTimeMs = timeMs;

  // fizyka stoi w menu i po zakończonym meczu (alpha=1 → render bieżącego stanu)
  const playing = gameMode !== 'menu' && !matchOver;
  const alpha = playing ? loop.advance(frameDtS) : 1;
  planeMesh.position.lerpVectors(prevPosition, state.position, alpha);
  planeMesh.quaternion.slerpQuaternions(prevOrientation, state.orientation, alpha);
  planeModel.update(frameDtS, state.throttle);

  if (gameMode === 'dogfight') {
    enemyMesh.visible = enemyState.life === 'alive';
    enemyMesh.position.lerpVectors(enemyPrevPos, enemyState.position, alpha);
    enemyMesh.quaternion.slerpQuaternions(enemyPrevOrient, enemyState.orientation, alpha);
    enemyModel.update(frameDtS, enemyState.throttle);
  }

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

  // smugacze (interpolacja prev→curr alfą) + błysk luf na każdej oddanej salwie
  tracers.update(pool.bullets, alpha);
  if (pendingMuzzleFlash) {
    muzzleFlash.flash();
    pendingMuzzleFlash = false;
  }
  muzzleFlash.update(planeMesh.position, planeMesh.quaternion, camera.position, frameDtS);

  // hit marker (krzyżyk w centrum) — błysk na trafieniu, mocniejszy na zestrzeleniu
  if (hitMarkerTimerS > 0) {
    const dur = hitMarkerKill ? HIT_MARKER_KILL_S : HIT_MARKER_S;
    hitMarkerEl.className = hitMarkerKill ? 'kill' : '';
    hitMarkerEl.style.opacity = Math.min(1, hitMarkerTimerS / dur).toFixed(2);
    hitMarkerTimerS -= frameDtS;
    if (hitMarkerTimerS <= 0) hitMarkerKill = false;
  } else {
    hitMarkerEl.style.opacity = '0';
  }

  // kill feed — linie gasną przez ostatnią sekundę życia
  if (killFeed.length > 0) {
    for (let i = killFeed.length - 1; i >= 0; i--) {
      const line = killFeed[i];
      if (!line) continue;
      line.ageS += frameDtS;
      if (line.ageS >= KILL_FEED_TTL_S) killFeed.splice(i, 1);
    }
  }
  killFeedEl.replaceChildren(
    ...killFeed.map((line) => {
      const span = document.createElement('span');
      span.textContent = line.text;
      span.style.opacity = Math.max(0, Math.min(1, KILL_FEED_TTL_S - line.ageS)).toFixed(2);
      return span;
    }),
  );

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

  // marker przeciwnika: ramka na ekranie / strzałka przy krawędzi + dystans
  if (gameMode === 'dogfight' && enemyState.life === 'alive') {
    enemyMarker.update(enemyMesh.position, planeMesh.position, camera, w, h);
  } else {
    enemyMarker.hide();
  }

  const reticlePos =
    mouseAim.locked && state.life === 'alive' && !autopilotActive
      ? mouseAim.reticleScreenPos(planeMesh.position, camera, w, h)
      : null;
  if (reticlePos && control.mode !== 'klawiatura') {
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
    controlMode: control.mode,
    ammo: fireControl.ammoRemaining,
    ammoMax: AMMO_MAX,
    extraLines: [
      '',
      ...(gameMode === 'dogfight'
        ? [
            `WYNIK Ty ${String(playerKills)} : ${String(enemyKills)} Bot   (do ${String(MATCH_SCORE_TO_WIN)})   [${difficulty}]`,
            `HP    ${String(Math.max(0, Math.round(playerHealth.hp)))} / ${String(plane.hpPool)}`,
          ]
        : gameMode === 'training'
          ? ['TRENING — strzelnica']
          : []),
      `fps   ${String(fpsValue).padStart(3)}   pociski ${String(pool.activeCount).padStart(3)}`,
      mouseAim.locked
        ? 'mysz: celuj   LPM/Spacja: OGIEŃ   WSAD/QE: stery   LShift/LCtrl: gaz   [Esc] zwolnij'
        : 'KLIKNIJ, by sterować myszą (pointer lock)   LPM/Spacja: ogień   WSAD/QE: stery',
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
