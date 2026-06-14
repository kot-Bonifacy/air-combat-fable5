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
  ARENA_WARNING_DISTANCE_M,
  BOT_CONFIG,
  BULLET_POOL_CAPACITY,
  Bot,
  BulletPool,
  FixedStepLoop,
  GRAVITY_MS2,
  MATCH_LIVES,
  MAX_BOTS,
  MS_TO_KMH,
  PHYSICS_HZ,
  PilotControl,
  RESPAWN_DELAY_S,
  SPITFIRE_MK1,
  applyDamage,
  createControlDeflections,
  createTerrain,
  distanceToArenaEdgeM,
  getForward,
  getRight,
  getUp,
  lookaheadSurfaceM,
  matchOutcome,
  pilotStep,
  resetHealth,
  segmentSphereHit,
  selectNearestTarget,
  sumForces,
  surfaceHeightM,
  totalAmmo,
  updateFire,
  updateLifecycle,
  validatePlaneState,
  wrapToArena,
  ZONE_CENTER_X_M,
  ZONE_CENTER_Z_M,
  ZONE_LOITER_ALT_M,
  ZoneControl,
  type DifficultyLevel,
  type MatchMember,
  type PilotTickResult,
  type PlaneState,
  type ZoneOccupant,
} from '@air-combat/shared';
import { BulletTracers } from './bullet-tracers';
import { Combatant, BEACON_HIDDEN } from './combatant';
import { EnemyMarker } from './enemy-marker';
import { GameMenu, type GameModeChoice } from './menu';
import { ChaseCamera } from './chase-camera';
import { ZoneBar, type ZoneBarState } from './zone-bar';
import { Explosions } from './explosion';
import { FlightRecorder } from './flight-recorder';
import { ForceArrows } from './force-arrows';
import { Hud } from './hud';
import { KeyboardInput } from './input';
import { MouseAim, projectDirToScreen } from './mouse-aim';
import { MuzzleFlash } from './muzzle-flash';
import { connectNetStatus } from './net-status';
import { OrbitCamera } from './orbit-camera';
import { createWorld } from './world';

// --- faza 7: tryby multi (FFA i drużynowy) na świecie i sterowaniu z faz 3–6 ---
// Wszyscy uczestnicy (gracz + boty) to jednorodne `Combatant`y w jednej tablicy;
// pętle fizyki/trafień/cyklu życia iterują po niej. Friendly fire jest WŁĄCZONY:
// pocisk rani każdy trafiony samolot poza właścicielem — frakcja decyduje tylko
// o tym, kogo bot bierze za cel. Mecz jest eliminacyjny (MATCH_LIVES żyć).

const SPAWN_ALTITUDE_M = 800;
const SPAWN_SPEED_MS = 120;
/** Tło menu: start nad oceanem na południu, nosem (+Z) na wyspę w centrum. */
const SPAWN_Z_M = -7000;
// Spawny na OBRZEŻACH mapy (faza 7: kontrola strefy — start z dala od góry, lot
// ku centrum po główny cel). 8 km od środka < 9 km, od którego HUD ostrzega o
// przeniesieniu torusa (ARENA_WARNING_DISTANCE_M = 1 km), więc start nie zapala
// alarmu granicy. ~8 km / ~150 m/s ≈ 50 s do strefy.
const EDGE_SPAWN_RADIUS_M = 8000;
/** FFA: rozstawienie na pierścieniu przy krawędzi, nosami do środka (ku strefie) [m]. */
const FFA_RING_RADIUS_M = EDGE_SPAWN_RADIUS_M;
/** Drużynowy: rząd drużyny przy przeciwległej krawędzi w Z (drużyny ~16 km od siebie) [m]. */
const TEAM_SEPARATION_M = EDGE_SPAWN_RADIUS_M;
/** Drużynowy: odstęp samolotów w rzędzie [m]. */
const TEAM_ROW_SPACING_M = 450;
/** Schodkowanie wysokości spawnu — unika natychmiastowego nakładania sylwetek [m]. */
const SPAWN_ALT_STAGGER_M = 120;
/** Kolory beaconów/markerów: wróg czerwony, sojusznik zielony. */
const FOE_COLOR = 0xff3020;
const FRIEND_COLOR = 0x33dd66;
/** Obniżony tick do wizualnej weryfikacji interpolacji (F4). */
const SLOW_PHYSICS_HZ = 10;
const DEG_TO_RAD = Math.PI / 180;
/** Dystanse próbkowania terenu przed botem (omijanie grani). */
const GROUND_LOOKAHEAD_M = [300, 600, 1000, 1500];

const FORWARD_Z = new Vector3(0, 0, 1);
const BACKWARD_Z = new Vector3(0, 0, -1);

const plane = SPITFIRE_MK1;
// rozpiętość skrzydeł [m] z parametrów fizyki: b = √(AR · S) — bez literału w kodzie
const wingspanM = Math.sqrt(plane.aspectRatio * plane.wingAreaM2);

// --- uczestnicy walki ---
// Gracz to slot 0 (id=0 → ownerId pocisków). Sloty botów tworzone leniwie przy
// pierwszym meczu walki i odtąd reużywane (alokuj raz). `combatants` jest ułożona
// tak, że indeks == id (player, slot0=id1, slot1=id2, …) — combatantById(id).
const player = new Combatant(0, true, plane, wingspanM, 0xc0ffee);
const botSlots: Combatant[] = [];
const combatants: Combatant[] = [player];

// Aliasy gracza dla kodu wejścia/HUD/narzędzi dev (jedno źródło prawdy = player).
const sim = player.sim;
const state = player.state;
const fireControl = player.fire;
const playerHealth = player.health;
const combatRng = player.rng;
const demands = player.demands;
const AMMO_MAX = totalAmmo(plane.armament);

const control = new PilotControl();
const deflections = createControlDeflections();
let lastTick: PilotTickResult | undefined;

// --- walka (pociski wspólne dla wszystkich) ---
const pool = new BulletPool(BULLET_POOL_CAPACITY);

/** Spust gracza: LPM aktywne tylko przy zablokowanej myszy, Spacja zawsze. */
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

function pushKillFeed(text: string): void {
  killFeed.push({ text, ageS: 0 });
  if (killFeed.length > 5) killFeed.shift();
}

// --- tryb gry / mecz ---
type GameMode = 'menu' | 'combat';
type MatchMode = 'ffa' | 'team';
let gameMode: GameMode = 'menu';
let matchMode: MatchMode = 'ffa';
let modeLabel = '';
let matchOver = false;
let playerKills = 0;
let difficulty: DifficultyLevel = 'normalny';
/** Id obserwowanego uczestnika po eliminacji gracza; null = wybór automatyczny (pierwszy żywy). */
let spectatorTargetId: number | null = null;

/** Bufor uczestników dla matchOutcome (Combatant spełnia MatchMember). */
const matchMembers: MatchMember[] = [];
/** Bufor kandydatów na cel (czyszczony per wywołanie — zero alokacji). */
const candidateScratch: PlaneState[] = [];
/** Bufor obserwowalnych uczestników dla cyklicznego przełączania widoku (zero alokacji). */
const spectatorScratch: Combatant[] = [];
const scratchWrapDelta = new Vector3();
const spawnScratchPos = new Vector3();
const spawnScratchDir = new Vector3();

// --- kontrola strefy (główny cel: przeciąganie liny nad górą) ---
const zone = new ZoneControl();
/** Stan strefy z ostatniego ticku (dla HUD i barwy znacznika). */
let zoneControlling: number | null = null;
let zoneOccupied = false;
/** Bufor okupantów strefy — alokowany raz, mutowany co tick (pasuje do liczby slotów). */
const zoneOccupantScratch: ZoneOccupant[] = Array.from({ length: MAX_BOTS + 1 }, () => ({
  faction: 0,
  alive: false,
  xM: 0,
  zM: 0,
}));
/**
 * Waypoint patrolu botów = środek strefy nad szczytem. Bot bez pilnego celu (FSM
 * w stanie patrol) leci do tego punktu → wszyscy ciążą ku strefie i ją kontestują.
 * Współdzielony niemutowalny wektor (Bot tylko go czyta).
 */
const ZONE_WAYPOINTS: readonly Vector3[] = [
  new Vector3(ZONE_CENTER_X_M, ZONE_LOITER_ALT_M, ZONE_CENTER_Z_M),
];

function triggerHeld(): boolean {
  return (mouseAim.locked && triggerMouse) || triggerKey;
}

function combatantById(id: number): Combatant | null {
  return combatants[id] ?? null;
}

/** Kandydaci na cel bota: żywi uczestnicy innej frakcji (FFA → wszyscy poza nim). */
function enemyCandidates(self: Combatant): PlaneState[] {
  candidateScratch.length = 0;
  for (const c of combatants) {
    if (!c.active || c === self) continue;
    if (c.faction === self.faction) continue;
    if (c.state.life !== 'alive') continue;
    candidateScratch.push(c.state);
  }
  return candidateScratch;
}

// --- scena (przed inputem: mysz wymaga elementu canvas) ---

const app = document.getElementById('app');
if (!app) throw new Error('brak elementu #app');

const renderer = new WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
app.appendChild(renderer.domElement);

const keyboard = new KeyboardInput(window);
const mouseAim = new MouseAim(renderer.domElement, control.mouseAim);

// PPM nad canvasem nie otwiera menu kontekstowego przeglądarki: w trybie celowania
// tłumił je pointer lock, ale w kamerze orbitalnej (rozglądanie się) locka nie ma,
// a PPM służy do przeciągania orbity — menu by w to wchodziło.
renderer.domElement.addEventListener('contextmenu', (event) => {
  event.preventDefault();
});

// spust: LPM (na canvasie) + Spacja (globalnie). Pierwsze kliknięcie przejmuje
// pointer lock i NIE strzela (triggerHeld bramkuje LPM na mouseAim.locked).
renderer.domElement.addEventListener('mousedown', (event) => {
  if (event.button !== 0) return;
  // po eliminacji LPM przełącza obserwowany samolot zamiast strzelać (wrak nie strzela)
  if (isSpectating()) cycleSpectatorTarget(1);
  else triggerMouse = true;
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

const scratchFwd = new Vector3();
const scratchUp = new Vector3();
const scratchRight = new Vector3();

// --- spawn / respawn (jednorodne dla gracza i botów) ---

/** Ustawia uczestnika w punkcie startu i zapamiętuje go jako jego miejsce respawnu. */
function spawnCombatant(c: Combatant, pos: Vector3, heading: Vector3): void {
  c.spawnPos.copy(pos);
  c.spawnDir.copy(heading);
  c.state.position.copy(pos);
  c.state.velocity.copy(heading).multiplyScalar(SPAWN_SPEED_MS);
  c.state.orientation.setFromUnitVectors(FORWARD_Z, heading);
  c.state.angularRates.pitch = 0;
  c.state.angularRates.roll = 0;
  c.state.angularRates.yaw = 0;
  c.state.throttle = c.isPlayer ? 0.8 : 0.9;
  c.state.iasMs = SPAWN_SPEED_MS;
  c.state.life = 'alive';
  c.state.lifeTimerS = 0;
  c.fire.ammoRemaining = AMMO_MAX;
  c.fire.cooldownS = 0;
  resetHealth(c.health);
  c.bot?.reset(c.state);
  if (c.isPlayer) {
    keyboard.throttle = 0.8;
    control.reset(c.state);
    chaseCamera.reset();
  }
  c.syncPrev();
  c.mesh.visible = true;
}

/** Respawn w zapamiętanym punkcie startu (jak respawn enemy w fazie 6). */
function respawnCombatant(c: Combatant): void {
  spawnCombatant(c, c.spawnPos, c.spawnDir);
}

/** Tworzy (raz) pulę slotów botów i dodaje ich meshe do sceny. */
function ensureBotSlots(): void {
  if (botSlots.length > 0) return;
  for (let i = 0; i < MAX_BOTS; i++) {
    const c = new Combatant(i + 1, false, plane, wingspanM, 0xb0b1e + i * 0x1111);
    botSlots.push(c);
    combatants.push(c);
    scene.add(c.mesh);
  }
}

function makeBot(seed: number): Bot {
  return new Bot(BOT_CONFIG.tuning, BOT_CONFIG.levels[difficulty], seed, ZONE_WAYPOINTS);
}

// --- krok fizyki (cała pętla świata 60 Hz) ---

function physicsStep(dtS: number): void {
  stepPlayer(dtS);
  if (gameMode === 'combat') {
    for (const c of botSlots) if (c.active) stepBot(c, dtS);
  }

  // pociski żyją niezależnie od stanu samolotów
  pool.update(plane.armament.bulletDragK, plane.armament.bulletLifetimeS, dtS);

  if (gameMode === 'combat') {
    resolveCombatHits();
    updateZone(dtS);
  }
}

/**
 * Kontrola strefy w jednym ticku: zbiera okupantów (wszystkie aktywne sloty),
 * akumuluje czas wyłącznej kontroli, aktualizuje barwę znacznika i — przy
 * przejęciu — kończy mecz. Drugi (obok eliminacji) warunek zwycięstwa.
 */
function updateZone(dtS: number): void {
  if (matchOver) return;
  let n = 0;
  for (const c of combatants) {
    if (!c.active) continue;
    const o = zoneOccupantScratch[n++];
    if (!o) break;
    o.faction = c.faction;
    o.alive = c.state.life === 'alive';
    o.xM = c.state.position.x;
    o.zM = c.state.position.z;
  }
  const tick = zone.update(zoneOccupantScratch, dtS, n);
  zoneControlling = tick.controlling;
  zoneOccupied = tick.occupied;
  if (tick.captured !== null) {
    const playerWon = tick.captured === player.faction;
    endMatch(playerWon, playerWon ? 'przejąłeś strefę' : 'wróg przejął strefę');
  }
}

/** Stan paska strefy wg bieżącej kontroli (z perspektywy frakcji gracza). */
function zoneBarState(): ZoneBarState {
  if (zoneControlling === player.faction) return 'own';
  if (zoneControlling !== null) return 'enemy';
  return zoneOccupied ? 'contested' : 'neutral';
}

/** Najwyższy zakumulowany czas kontroli wśród frakcji wroga [s] (dla paska/feedbacku). */
function enemyBestZoneSeconds(): number {
  let best = 0;
  for (const [fac, sec] of zone.secondsByFaction) {
    if (fac !== player.faction && sec > best) best = sec;
  }
  return best;
}

/** Jeden tick gracza: wejście → instruktor → fizyka → ogień → cykl życia. */
function stepPlayer(dtS: number): void {
  player.prevPos.copy(state.position);
  player.prevOrient.copy(state.orientation);

  if (state.life === 'alive') {
    keyboard.update(dtS);
    state.throttle = keyboard.throttle;

    deflections.pitchUp = keyboard.pitchDeflection;
    deflections.rollRight = keyboard.rollDeflection;
    deflections.yawRight = keyboard.yawDeflection;
    // kamera orbitalna wyłącza sterowanie lotem myszą — wtedy zostaje sama klawiatura
    control.update(state, plane, deflections, dtS, demands, cameraMode === 'pościgowa');

    lastTick = pilotStep(sim, plane, demands, dtS);

    // świat-torus: po przekroczeniu krawędzi przenieś na przeciwległą stronę.
    if (wrapToArena(state.position, scratchWrapDelta)) {
      player.prevPos.add(scratchWrapDelta);
      chaseCamera.translate(scratchWrapDelta);
    }

    if (import.meta.env.DEV) {
      validatePlaneState(state, 'tick klienta');
      recorder?.record(state, lastTick, plane, dtS);
    }

    const fired = updateFire(fireControl, plane.armament, state, player.id, combatRng, pool, triggerHeld(), dtS);
    if (fired > 0) pendingMuzzleFlash = true;

    if (updateLifecycle(state, terrain, dtS) === 'crashed') onCombatantDeath(player, null);
  } else {
    // wrak: respawn tylko gdy zostały życia (przy MATCH_LIVES=1 — brak; podgląd do końca)
    if (player.livesLeft > 0 && updateLifecycle(state, terrain, dtS) === 'respawnReady') {
      respawnCombatant(player);
    }
  }
}

/** Jeden tick bota: decyzja (cel z innej frakcji) → instruktor → fizyka → ogień → cykl życia. */
function stepBot(c: Combatant, dtS: number): void {
  c.prevPos.copy(c.state.position);
  c.prevOrient.copy(c.state.orientation);

  if (c.state.life === 'alive') {
    const bot = c.bot;
    if (!bot) return; // slot bota zawsze ma bota; strażnik dla typów
    const surf = lookaheadSurfaceM(
      terrain,
      c.state.position.x,
      c.state.position.z,
      c.state.velocity.x,
      c.state.velocity.z,
      GROUND_LOOKAHEAD_M,
    );
    const target = selectNearestTarget(c.state.position, enemyCandidates(c));
    const out = bot.update(c.state, plane, target, { surfaceHeightM: surf }, dtS, c.demands);
    c.state.throttle = out.throttle;
    pilotStep(c.sim, plane, c.demands, dtS);
    if (wrapToArena(c.state.position, scratchWrapDelta)) c.prevPos.add(scratchWrapDelta);
    if (import.meta.env.DEV) validatePlaneState(c.state, 'tick bota');
    updateFire(c.fire, plane.armament, c.state, c.id, c.rng, pool, out.fire, dtS);
    if (updateLifecycle(c.state, terrain, dtS) === 'crashed') onCombatantDeath(c, null);
  } else if (c.livesLeft > 0 && updateLifecycle(c.state, terrain, dtS) === 'respawnReady') {
    respawnCombatant(c);
  }
}

/**
 * Trafienia pocisków (friendly fire ON): pocisk rani DOWOLNY żywy samolot poza
 * swoim właścicielem, niezależnie od frakcji. Trafia najwyżej jeden samolot.
 */
function resolveCombatHits(): void {
  for (const b of pool.bullets) {
    if (!b.active) continue;
    for (const c of combatants) {
      if (!c.active || c.state.life !== 'alive' || c.id === b.ownerId) continue;
      if (!segmentSphereHit(b.prevPosition, b.position, c.state.position, plane.hitRadiusM)) continue;
      const res = applyDamage(c.health, b.damage);
      b.active = false;
      if (res === 'destroyed') onCombatantDeath(c, b.ownerId);
      else if (res === 'absorbed') onNonLethalHit(b.ownerId);
      break;
    }
  }
}

/** Trafienie niezabijające — krzyżyk tylko gdy to gracz oberwał komuś. */
function onNonLethalHit(ownerId: number): void {
  if (ownerId === player.id && !hitMarkerKill) hitMarkerTimerS = HIT_MARKER_S;
}

/** Śmierć uczestnika (pocisk lub rozbicie): wybuch, −1 życie, kill feed, sprawdzenie meczu. */
function onCombatantDeath(victim: Combatant, killerId: number | null): void {
  explosions.spawn(victim.state.position);
  victim.mesh.visible = false;
  victim.state.life = 'dead';
  victim.state.lifeTimerS = 0;
  victim.livesLeft = Math.max(0, victim.livesLeft - 1);

  const killer = killerId === null ? null : combatantById(killerId);
  if (!killer || killer === victim) {
    pushKillFeed(`✕ ${victim.name} — rozbicie`);
  } else if (killer.faction === victim.faction) {
    pushKillFeed(`✕ ${killer.name} → ${victim.name} (sojusznik!)`);
  } else {
    pushKillFeed(`✕ ${killer.name} → ${victim.name}`);
  }

  // licznik/feedback gracza tylko za zestrzelenie WROGA (teamkill nie nagradzany)
  if (killer && killer.id === player.id && victim.faction !== player.faction) {
    playerKills++;
    hitMarkerTimerS = HIT_MARKER_KILL_S;
    hitMarkerKill = true;
  }

  checkMatchEnd();
}

function checkMatchEnd(): void {
  if (gameMode !== 'combat' || matchOver) return;
  matchMembers.length = 0;
  for (const c of combatants) if (c.active) matchMembers.push(c);
  const outcome = matchOutcome(player.faction, matchMembers);
  if (outcome === 'ongoing') return;
  const won = outcome === 'won';
  endMatch(won, won ? 'wrogowie wyeliminowani' : 'zostałeś wyeliminowany');
}

function endMatch(playerWon: boolean, reason: string): void {
  matchOver = true;
  if (document.pointerLockElement) document.exitPointerLock();
  const summary = `${modeLabel}   •   ${reason}   •   zestrzelenia: ${String(playerKills)}   [${difficulty}]`;
  menu.showResult(playerWon, summary);
}

// --- start meczu / ustawienia trybów ---

function startMatch(choice: GameModeChoice): void {
  matchOver = false;
  playerKills = 0;
  hitMarkerKill = false;
  hitMarkerTimerS = 0;
  spectatorTargetId = null;
  for (const b of pool.bullets) b.active = false; // brak smug z poprzedniego meczu
  for (const c of botSlots) c.deactivate();
  zone.reset();
  zoneControlling = null;
  zoneOccupied = false;

  ensureBotSlots();
  gameMode = 'combat';
  difficulty = choice.difficulty;
  zoneBar.setVisible(true);

  if (choice.mode === 'ffa') setupFfa(choice.botCount);
  else setupTeam(choice.perTeam);
}

/** FFA: gracz + botCount botów, każdy własna frakcja; rozstawienie na pierścieniu. */
function setupFfa(botCount: number): void {
  matchMode = 'ffa';
  modeLabel = `FFA 1v${String(botCount)}`;
  const used: Combatant[] = [player];
  player.configure({ faction: 0, lives: MATCH_LIVES, name: 'Ty', bot: null, beaconColor: BEACON_HIDDEN });
  for (let i = 0; i < botCount; i++) {
    const c = botSlots[i];
    if (!c) break;
    c.configure({
      faction: i + 1,
      lives: MATCH_LIVES,
      name: `Bot ${String(i + 1)}`,
      bot: makeBot(0xb0b1e + i),
      beaconColor: FOE_COLOR,
    });
    used.push(c);
  }
  ringSpawn(used);
}

/** Drużynowy: frakcja 0 = gracz + skrzydłowi, frakcja 1 = wrogowie; dwa rzędy naprzeciw. */
function setupTeam(perTeam: number): void {
  matchMode = 'team';
  modeLabel = `Drużynowy ${String(perTeam)}v${String(perTeam)}`;
  let slot = 0;

  const teamA: Combatant[] = [player];
  player.configure({ faction: 0, lives: MATCH_LIVES, name: 'Ty', bot: null, beaconColor: BEACON_HIDDEN });
  for (let i = 1; i < perTeam; i++) {
    const c = botSlots[slot++];
    if (!c) break;
    c.configure({
      faction: 0,
      lives: MATCH_LIVES,
      name: `Sojusznik ${String(i)}`,
      bot: makeBot(0xa11 + slot),
      beaconColor: FRIEND_COLOR,
    });
    teamA.push(c);
  }

  const teamB: Combatant[] = [];
  for (let i = 0; i < perTeam; i++) {
    const c = botSlots[slot++];
    if (!c) break;
    c.configure({
      faction: 1,
      lives: MATCH_LIVES,
      name: `Wróg ${String(i + 1)}`,
      bot: makeBot(0xe44 + slot),
      beaconColor: FOE_COLOR,
    });
    teamB.push(c);
  }

  rowSpawn(teamA, -TEAM_SEPARATION_M, FORWARD_Z);
  rowSpawn(teamB, TEAM_SEPARATION_M, BACKWARD_Z);
}

/** Rozstawia listę na pierścieniu wokół (0,0), nosami do środka (FFA). */
function ringSpawn(list: Combatant[]): void {
  const n = list.length;
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * Math.PI * 2;
    const px = Math.sin(ang) * FFA_RING_RADIUS_M;
    const pz = Math.cos(ang) * FFA_RING_RADIUS_M;
    spawnScratchPos.set(px, SPAWN_ALTITUDE_M + (i % 3) * SPAWN_ALT_STAGGER_M, pz);
    spawnScratchDir.set(-px, 0, -pz).normalize();
    const c = list[i];
    if (c) spawnCombatant(c, spawnScratchPos, spawnScratchDir);
  }
}

/** Rozstawia rząd drużyny na linii z=zLine, wyśrodkowany w X, nosami `heading`. */
function rowSpawn(list: Combatant[], zLine: number, heading: Vector3): void {
  const n = list.length;
  const x0 = -((n - 1) / 2) * TEAM_ROW_SPACING_M;
  for (let i = 0; i < n; i++) {
    spawnScratchPos.set(x0 + i * TEAM_ROW_SPACING_M, SPAWN_ALTITUDE_M + (i % 3) * SPAWN_ALT_STAGGER_M, zLine);
    const c = list[i];
    if (c) spawnCombatant(c, spawnScratchPos, heading);
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

scene.add(player.mesh);

const terrain = createTerrain();
const world = createWorld(scene, terrain);
const explosions = new Explosions(scene);
const tracers = new BulletTracers(scene, BULLET_POOL_CAPACITY);
const muzzleFlash = new MuzzleFlash(scene, plane.armament.muzzles);

scene.add(new AmbientLight(0xffffff, 0.4));
const sun = new DirectionalLight(0xffffff, 1.2);
sun.position.set(30, 50, 20);
scene.add(sun);

// IBL: bez environment mapy materiały PBR metalu (model Spitfire'a) renderują
// się prawie czarne. RoomEnvironment to tani, neutralny refleks otoczenia.
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
// pula markerów (wróg/sojusznik) — przydzielana co klatkę żywym uczestnikom
const markers = Array.from({ length: MAX_BOTS }, () => new EnemyMarker(document.body));
// pasek przejmowania strefy (główny cel) — u góry ekranu, tylko w trybie walki
const zoneBar = new ZoneBar(document.body);

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
    if (cameraMode === 'pościgowa') {
      // powrót do pościgowej: mysz znów może celować (pointer lock przez klik)
      chaseCamera.reset();
      mouseAim.enabled = true;
    } else {
      // orbitalna = rozglądanie się myszą; lot tylko z klawiatury. Zwolnij pointer
      // lock (kursor wraca do przeciągania orbity) i zablokuj ponowne celowanie.
      mouseAim.enabled = false;
      if (document.pointerLockElement) document.exitPointerLock();
    }
  } else if (event.key === 'r' || event.key === 'R') {
    if (player.state.life === 'alive' || gameMode === 'menu') respawnCombatant(player);
  }
});

// --- tryb obserwatora po eliminacji (przełączanie widoku LPM) ---

/** Czy gracz jest wyeliminowany i ogląda walkę (mecz wciąż trwa). */
function isSpectating(): boolean {
  return (
    gameMode === 'combat' && !matchOver && player.state.life !== 'alive' && player.livesLeft <= 0
  );
}

/** Czy gracz ma w tym meczu sojuszników (slot tej samej frakcji) — decyduje o zakresie obserwacji. */
function playerHasTeammates(): boolean {
  for (const c of combatants) {
    if (c.active && c !== player && c.faction === player.faction) return true;
  }
  return false;
}

/**
 * Czy uczestnika można obserwować: musi być żywy i nie być graczem. Zakres wg
 * wyboru gracza — w trybie z sojusznikami tylko ta sama frakcja; w FFA (brak
 * sojuszników) dowolny pozostały przy życiu.
 */
function isSpectatable(c: Combatant): boolean {
  if (!c.active || c === player || c.state.life !== 'alive') return false;
  return playerHasTeammates() ? c.faction === player.faction : true;
}

/** Pierwszy obserwowalny uczestnik w kolejności slotów (fallback, gdy wybrany zginął). */
function firstSpectatable(): Combatant | null {
  for (const c of combatants) if (isSpectatable(c)) return c;
  return null;
}

/** Liczba obserwowalnych samolotów (>1 ⇒ jest między czym przełączać). */
function spectatableCount(): number {
  let n = 0;
  for (const c of combatants) if (isSpectatable(c)) n++;
  return n;
}

/** Przełącza obserwowany samolot na następny obserwowalny (cyklicznie); dir=-1 = wstecz. */
function cycleSpectatorTarget(dir: 1 | -1): void {
  if (!isSpectating()) return;
  spectatorScratch.length = 0;
  for (const c of combatants) if (isSpectatable(c)) spectatorScratch.push(c);
  const n = spectatorScratch.length;
  if (n === 0) return;
  const cur = spectatorTargetId === null ? -1 : spectatorScratch.findIndex((c) => c.id === spectatorTargetId);
  const next = ((cur < 0 ? (dir === 1 ? 0 : n - 1) : cur + dir) + n) % n;
  spectatorTargetId = spectatorScratch[next]?.id ?? null;
}

/**
 * Uczestnik, za którym podąża kamera: gracz, dopóki żyje lub ma respawn; po
 * eliminacji — obserwowany samolot (wybór LPM trzymany, póki żyje; gdy zginie
 * lub brak wyboru — pierwszy obserwowalny), inaczej gracz.
 */
function currentViewCombatant(): Combatant {
  if (player.state.life === 'alive' || player.livesLeft > 0) return player;
  const chosen = spectatorTargetId === null ? null : combatantById(spectatorTargetId);
  if (chosen && isSpectatable(chosen)) return chosen;
  const next = firstSpectatable();
  spectatorTargetId = next ? next.id : null;
  return next ?? player;
}

/** Linie wyniku w HUD dla bieżącego trybu walki. */
function combatScoreLines(): string[] {
  const hp = `HP    ${String(Math.max(0, Math.round(playerHealth.hp)))} / ${String(plane.hpPool)}`;
  if (matchMode === 'ffa') {
    let enemiesAlive = 0;
    for (const c of combatants) {
      if (!c.active || c.faction === player.faction) continue;
      if (c.state.life === 'alive') enemiesAlive++;
    }
    return [
      `FFA   zestrzelenia ${String(playerKills)}`,
      `WROGOWIE w powietrzu ${String(enemiesAlive)}`,
      hp,
    ];
  }
  let aAlive = 0;
  let bAlive = 0;
  for (const c of combatants) {
    if (!c.active) continue;
    if (c.faction === player.faction) {
      if (c.state.life === 'alive') aAlive++;
    } else if (c.state.life === 'alive') {
      bAlive++;
    }
  }
  return [
    `DRUŻYNY   Ty ${String(aAlive)} : ${String(bAlive)} Wróg (w powietrzu)   zestrzelenia ${String(playerKills)}`,
    hp,
  ];
}


// --- pętla renderu: stały krok fizyki + interpolacja stanem prev/curr ---

setupMenuBackground();
const menu = new GameMenu(startMatch);
menu.showStart();
let lastTimeMs: number | undefined;

/** Statyczne tło pod menu: gracz nad oceanem (fizyka stoi w gameMode 'menu'). */
function setupMenuBackground(): void {
  player.configure({ faction: 0, lives: 1, name: 'Ty', bot: null, beaconColor: BEACON_HIDDEN });
  spawnCombatant(player, spawnScratchPos.set(0, SPAWN_ALTITUDE_M, SPAWN_Z_M), FORWARD_Z);
}

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

  // render wszystkich uczestników (gracz + aktywne boty) tym samym wzorem interpolacji
  for (const c of combatants) if (c.active) c.render(alpha, frameDtS);

  const viewC = currentViewCombatant();
  const viewMesh = viewC.mesh;
  const buffet = viewC === player && lastTick ? lastTick.stall.buffetIntensity : 0;
  if (cameraMode === 'pościgowa') {
    chaseCamera.update(frameDtS, viewMesh.position, viewMesh.quaternion, viewC.state.velocity, buffet);
  } else {
    orbit.update(viewMesh.position);
  }

  // kamera nigdy pod powierzchnią (kraksa na zboczu wbijała ją w teren)
  const cameraFloorM = surfaceHeightM(terrain, camera.position.x, camera.position.z) + 3;
  if (camera.position.y < cameraFloorM) camera.position.y = cameraFloorM;

  world.update(camera.position);
  explosions.update(frameDtS);

  // smugacze (interpolacja prev→curr alfą) + błysk luf na każdej oddanej salwie gracza
  tracers.update(pool.bullets, alpha);
  if (pendingMuzzleFlash) {
    muzzleFlash.flash();
    pendingMuzzleFlash = false;
  }
  muzzleFlash.update(player.mesh.position, player.mesh.quaternion, camera.position, frameDtS);

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
    arrows.update(player.mesh.position, [
      ...lastTick.contributions,
      { name: 'wypadkowa', force: sumForces(lastTick.contributions) },
    ]);
  }

  // celownik (mysz) + znacznik nosa — celowo NIE sprzężone z kamerą 1:1
  const w = (app as HTMLElement).clientWidth;
  const h = (app as HTMLElement).clientHeight;

  // markery samolotów: wszyscy żywi uczestnicy poza graczem (wróg czerwony, sojusznik zielony)
  if (gameMode === 'combat') {
    let mi = 0;
    for (const c of combatants) {
      if (mi >= markers.length) break;
      if (!c.active || c === player || c.state.life !== 'alive') continue;
      const marker = markers[mi++];
      if (!marker) break;
      marker.setFoe(c.faction !== player.faction);
      marker.update(c.mesh.position, viewMesh.position, camera, w, h);
    }
    for (; mi < markers.length; mi++) markers[mi]?.hide();
  } else {
    for (const m of markers) m.hide();
  }

  // pasek przejmowania strefy — widoczny tylko w aktywnej walce
  if (gameMode === 'combat' && !matchOver) {
    zoneBar.setVisible(true);
    zoneBar.update(zoneBarState(), zone.seconds(player.faction), enemyBestZoneSeconds());
  } else {
    zoneBar.setVisible(false);
  }

  const reticlePos =
    mouseAim.locked && state.life === 'alive'
      ? mouseAim.reticleScreenPos(player.mesh.position, camera, w, h)
      : null;
  if (reticlePos && control.mode !== 'klawiatura') {
    reticleEl.style.display = 'block';
    reticleEl.style.left = `${reticlePos.x.toFixed(0)}px`;
    reticleEl.style.top = `${reticlePos.y.toFixed(0)}px`;
  } else {
    reticleEl.style.display = 'none';
  }
  getForward(state.orientation, scratchFwd);
  const nosePos = projectDirToScreen(scratchFwd, player.mesh.position, camera, w, h);
  if (nosePos && mouseAim.locked && state.life === 'alive') {
    noseMarkerEl.style.display = 'block';
    noseMarkerEl.style.left = `${nosePos.x.toFixed(0)}px`;
    noseMarkerEl.style.top = `${nosePos.y.toFixed(0)}px`;
  } else {
    noseMarkerEl.style.display = 'none';
  }

  // alert pełnoekranowy: rozbicie/eliminacja > ostrzeżenie o granicy
  const edgeM = distanceToArenaEdgeM(state.position.x, state.position.z);
  if (state.life !== 'alive') {
    if (gameMode === 'combat' && player.livesLeft <= 0) {
      alertEl.textContent =
        spectatableCount() > 1
          ? 'WYELIMINOWANY — obserwujesz   [LPM] zmień samolot'
          : 'WYELIMINOWANY — obserwujesz';
    } else {
      const leftS = Math.max(0, RESPAWN_DELAY_S - state.lifeTimerS);
      alertEl.textContent = `ROZBICIE — respawn za ${leftS.toFixed(1)} s`;
    }
    alertEl.className = 'crash';
    alertEl.style.opacity = '1';
  } else if (edgeM <= ARENA_WARNING_DISTANCE_M) {
    alertEl.textContent = `KONIEC MAPY ZA ${Math.max(0, edgeM).toFixed(0)} m — NASTĄPI PRZENIESIENIE`;
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
    buffetIntensity: viewC === player ? buffet : 0,
    bankRad: Math.atan2(-scratchRight.y, scratchUp.y),
    pitchRad: Math.asin(Math.min(1, Math.max(-1, scratchFwd.y))),
    controlMode: control.mode,
    ammo: fireControl.ammoRemaining,
    ammoMax: AMMO_MAX,
    extraLines: [
      '',
      ...(gameMode === 'combat' ? combatScoreLines() : []),
      ...(viewC !== player ? [`OBSERWUJESZ: ${viewC.name}`] : []),
      `fps   ${String(fpsValue).padStart(3)}   pociski ${String(pool.activeCount).padStart(3)}`,
      isSpectating()
        ? `TRYB OBSERWATORA${spectatableCount() > 1 ? '   [LPM] następny samolot' : ''}   [C] zmień kamerę`
        : cameraMode === 'orbitalna'
          ? 'KAMERA ORBITALNA: przeciągnij myszą = rozglądanie   lot: WSAD/QE   gaz: LShift/LCtrl   Spacja: OGIEŃ   [C] powrót'
          : mouseAim.locked
            ? 'mysz: celuj   LPM/Spacja: OGIEŃ   WSAD/QE: stery   LShift/LCtrl: gaz   [Esc] zwolnij'
            : 'KLIKNIJ, by sterować myszą (pointer lock)   LPM/Spacja: ogień   WSAD/QE: stery',
      `[C] kamera: ${cameraMode}   [F3] siły: ${arrowsVisible ? 'ON' : 'OFF'}   [F4] tick ${String(physicsHz)} Hz${physicsHz !== PHYSICS_HZ ? ' ← SPOWOLNIONY' : ''}   [R] reset`,
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
