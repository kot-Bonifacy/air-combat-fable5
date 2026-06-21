import {
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
  MATCH_LIVES,
  MAX_BOTS,
  MS_TO_KMH,
  PHYSICS_HZ,
  PilotControl,
  RESPAWN_DELAY_S,
  SPITFIRE_MK2,
  allMuzzles,
  applyDamage,
  buildScoreboard,
  createControlDeflections,
  createTerrain,
  distanceToArenaEdgeM,
  factionsInPlay,
  getForward,
  getRight,
  getUp,
  lookaheadSurfaceM,
  pilotStep,
  planesCollide,
  resetFireControl,
  resetHealth,
  segmentSphereHit,
  selectNearestTarget,
  SPOT_RANGE_M,
  stepWreck,
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
  type ScoreInput,
  type ZoneOccupant,
} from '@air-combat/shared';
import { BulletTracers } from './bullet-tracers';
import { Combatant } from './combatant';
import { EnemyMarker } from './enemy-marker';
import {
  GameMenu,
  type GameModeChoice,
  type ResultData,
  type ResultPilotRow,
  type ResultTeamRow,
} from './menu';
import { StandingsOverlay } from './standings-overlay';
import { RosterOverlay, type RosterRow } from './roster-overlay';
import { ChaseCamera } from './chase-camera';
import { ZoneBar, type ZoneBarState } from './zone-bar';
import { Explosions } from './explosion';
import { SmokeTrails, WRECK_TIER, damageSmokeTier, type SmokeTier } from './smoke';
import { DownedOverlay } from './downed-overlay';
import { GreyoutOverlay } from './greyout-overlay';
import { FlightRecorder } from './flight-recorder';
import { ForceArrows } from './force-arrows';
import { Hud, hudRow, fpsHudLine } from './hud';
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
/** Kolory markerów HUD: wróg czerwony, sojusznik zielony. */
const FOE_COLOR = 0xff3020;
const FRIEND_COLOR = 0x33dd66;
/** Kolor gracza w tabeli wyników (złoty) — odróżnia „Ty" od zielonych sojuszników. */
const PLAYER_COLOR = 0xffd24a;
/**
 * Unikatowe kolory frakcji w FFA (każdy bot to osobna frakcja). Indeks = faction−1
 * (boty mają frakcje 1..MAX_BOTS; gracz = 0 → PLAYER_COLOR). Dobrane na rozróżnialność
 * i z dala od złota gracza i zieleni „sojusznika" z trybu drużynowego.
 */
const FFA_FACTION_COLORS = [0xff3b30, 0xff8c1a, 0xff4fd8, 0x32d0ff, 0xa56bff, 0xff6ea0];
/** Obniżony tick do wizualnej weryfikacji interpolacji (F4). */
const SLOW_PHYSICS_HZ = 10;
/** Dystanse próbkowania terenu przed botem (omijanie grani). */
const GROUND_LOOKAHEAD_M = [300, 600, 1000, 1500];
/** Skala małego błysku w chwili zestrzelenia w powietrzu (duży wybuch dopiero przy ziemi). */
const AIR_KILL_FLASH_SCALE = 0.4;
/** O ile cofnąć punkt emisji dymu ZA samolot (wzdłuż -nos) [m] — smuga wychodzi
 * zza ogona, nie ze środka kadłuba; z rozrzutem profilu daje ~2-4 m od maszyny. */
const SMOKE_BACK_OFFSET_M = 3;

const FORWARD_Z = new Vector3(0, 0, 1);
const BACKWARD_Z = new Vector3(0, 0, -1);

const plane = SPITFIRE_MK2;
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
// pełny zapas grupy WTÓRNEJ (działko 20 mm Bf 109); Spitfire ma jedną grupę → 0 (brak licznika)
const secondaryGroup = plane.armament.groups[1];
const SECONDARY_AMMO_MAX = secondaryGroup ? secondaryGroup.ammoPerGun * secondaryGroup.muzzles.length : 0;

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
let difficulty: DifficultyLevel = 'normalny';
/** Id obserwowanego uczestnika po eliminacji gracza; null = wybór automatyczny (pierwszy żywy). */
let spectatorTargetId: number | null = null;
/**
 * Stan gracza po zestrzeleniu w powietrzu:
 * - 'none'       — żyje (gra normalnie),
 * - 'wreck'      — spadający wrak: steruje nim z klawiatury, overlay oferuje akcje;
 *                  koniec meczu z tytułu jego porażki jest WSTRZYMANY, aż wybierze,
 * - 'spectating' — wybrał tryb obserwatora (ogląda sojuszników).
 */
type PlayerDeath = 'none' | 'wreck' | 'spectating';
let playerDeath: PlayerDeath = 'none';

/** Bufor uczestników dla factionsInPlay (Combatant spełnia MatchMember). */
const matchMembers: MatchMember[] = [];
/** Bufor kandydatów na cel (czyszczony per wywołanie — zero alokacji). */
const candidateScratch: PlaneState[] = [];
/** Bufor obserwowalnych uczestników dla cyklicznego przełączania widoku (zero alokacji). */
const spectatorScratch: Combatant[] = [];
const scratchWrapDelta = new Vector3();
const scratchSmokeDir = new Vector3();
const scratchSmokePos = new Vector3();
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

/** Pokazuje pełnoekranowy komunikat WebGL (brak/utrata kontekstu) zamiast białej strony. */
function showWebglError(): void {
  document.getElementById('webgl-error')?.classList.add('show');
  document.getElementById('loading')?.classList.add('hidden');
}

let renderer: WebGLRenderer;
try {
  // logarithmicDepthBuffer: precyzja głębi w skali symulatora (near 0.5 / far 30 km)
  // — kasuje z-fighting brzegu wyspy z oceanem (własne shadery terenu/wody/nieba
  // mają wpięte chunki logdepthbuf, by pisać spójną głębię)
  renderer = new WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
} catch (err) {
  // brak WebGL2 (stary sprzęt / wyłączona akceleracja) → komunikat zamiast pustej strony
  showWebglError();
  throw err instanceof Error ? err : new Error('inicjalizacja WebGL nie powiodła się');
}
renderer.setPixelRatio(window.devicePixelRatio);
app.appendChild(renderer.domElement);

// Utrata kontekstu GPU w trakcie gry (uśpienie, reset sterownika, zbyt wiele
// kontekstów): preventDefault pozwala przeglądarce go odtworzyć. Pokazujemy
// komunikat zamiast zamrożonego obrazu; po odzyskaniu — chowamy. three odtwarza
// własne zasoby GPU przy 'restored'.
renderer.domElement.addEventListener('webglcontextlost', (event) => {
  event.preventDefault();
  showWebglError();
});
renderer.domElement.addEventListener('webglcontextrestored', () => {
  document.getElementById('webgl-error')?.classList.remove('show');
});

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
  // w trybie obserwatora LPM przełącza obserwowany samolot; strzela tylko żywy gracz
  // (sterowany wrak ma wolny kursor do klikania overlay — nie strzela)
  if (isSpectating()) cycleSpectatorTarget(1);
  else if (state.life === 'alive') triggerMouse = true;
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
  c.state.fuelFrac = 1; // nowe życie = pełny bak
  c.state.iasMs = SPAWN_SPEED_MS;
  c.state.life = 'alive';
  c.state.lifeTimerS = 0;
  resetFireControl(c.fire, plane.armament); // pełny zapas wszystkich grup broni + zerowanie cooldownów
  c.smokeAccumS = 0;
  c.damagedBy.clear(); // nowe życie → czysta lista napastników (kredyt asyst)
  resetHealth(c.health);
  // świeży pilot: pełna rezerwa tolerancji G, brak zaciemnienia (G-LOC)
  c.sim.gLoadMachine.reset();
  c.sim.gLoadEffects.reserve = 1;
  c.sim.gLoadEffects.blackoutFactor = 0;
  c.bot?.reset(c.state);
  if (c.isPlayer) {
    keyboard.throttle = 0.8;
    control.reset(c.state);
    chaseCamera.reset();
    playerDeath = 'none';
    // po (re)spawnie wrak nie blokuje już myszy — celowanie wraca, gdy kamera pościgowa
    mouseAim.enabled = cameraMode === 'pościgowa';
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

  // pociski żyją niezależnie od stanu samolotów (balistyka per pocisk z grupy broni)
  pool.update(dtS);

  if (gameMode === 'combat') {
    resolveCombatHits();
    resolvePlaneCollisions();
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
    // tylko żywe samoloty trzymają strefę — spadający wrak ('dying') jej NIE kontestuje
    o.alive = c.state.life === 'alive';
    o.xM = c.state.position.x;
    o.zM = c.state.position.z;
  }
  const tick = zone.update(zoneOccupantScratch, dtS, n);
  zoneControlling = tick.controlling;
  zoneOccupied = tick.occupied;
  if (tick.captured !== null) {
    const playerWon = tick.captured === player.faction;
    endMatch(playerWon, playerWon ? 'za przejęcie strefy' : 'wróg przejął strefę');
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

    if (updateLifecycle(state, terrain, dtS) === 'crashed') onCombatantDeath(player, null, 'ground');
  } else if (state.life === 'dying') {
    // spadający wrak gracza: silnik martwy (stepWreck wymusza throttle 0), lotki pełne,
    // ster wysokości osłabiony. Sterowanie WYŁĄCZNIE z klawiatury (mouseEnabled=false) —
    // kursor jest wolny, by kliknąć overlay (Tryb obserwatora / Zakończ misję).
    keyboard.update(dtS);
    deflections.pitchUp = keyboard.pitchDeflection;
    deflections.rollRight = keyboard.rollDeflection;
    deflections.yawRight = keyboard.yawDeflection;
    control.update(state, plane, deflections, dtS, demands, false);
    lastTick = stepWreck(sim, plane, demands, dtS);
    if (wrapToArena(state.position, scratchWrapDelta)) {
      player.prevPos.add(scratchWrapDelta);
      chaseCamera.translate(scratchWrapDelta);
    }
    if (import.meta.env.DEV) validatePlaneState(state, 'wrak gracza');
    // wrak wciąż może strzelać — TYLKO Spacją (kursor wolny do nakładki, więc bez LPM);
    // celuje się nosem, sterując wrakiem z klawiatury
    const fired = updateFire(fireControl, plane.armament, state, player.id, combatRng, pool, triggerKey, dtS);
    if (fired > 0) pendingMuzzleFlash = true;
    if (updateLifecycle(state, terrain, dtS) === 'wreckImpact') onWreckImpact(player);
  } else {
    // dead/respawning: respawn tylko gdy zostały życia (przy MATCH_LIVES=1 — brak; podgląd do końca)
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
    const target = selectNearestTarget(c.state.position, enemyCandidates(c), SPOT_RANGE_M);
    const out = bot.update(c.state, plane, target, { surfaceHeightM: surf }, dtS, c.demands);
    c.state.throttle = out.throttle;
    pilotStep(c.sim, plane, c.demands, dtS);
    if (wrapToArena(c.state.position, scratchWrapDelta)) c.prevPos.add(scratchWrapDelta);
    if (import.meta.env.DEV) validatePlaneState(c.state, 'tick bota');
    updateFire(c.fire, plane.armament, c.state, c.id, c.rng, pool, out.fire, dtS);
    if (updateLifecycle(c.state, terrain, dtS) === 'crashed') onCombatantDeath(c, null, 'ground');
  } else if (c.state.life === 'dying') {
    // wrak bota spada balistycznie — bez AI; zerowe żądania = czysty opad (zero roll/yaw)
    c.demands.nDemandG = 1;
    c.demands.rollRateRadS = 0;
    c.demands.yawRateRadS = 0;
    stepWreck(c.sim, plane, c.demands, dtS);
    if (wrapToArena(c.state.position, scratchWrapDelta)) c.prevPos.add(scratchWrapDelta);
    if (import.meta.env.DEV) validatePlaneState(c.state, 'wrak bota');
    if (updateLifecycle(c.state, terrain, dtS) === 'wreckImpact') onWreckImpact(c);
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
      // zapamiętaj napastnika u ofiary — kredyt asysty, jeśli ofiara zginie później
      // (filtr wróg/zabójca w onCombatantDeath). Zabójca też tu trafia, ale go wykluczamy.
      c.damagedBy.add(b.ownerId);
      if (res === 'destroyed') onCombatantDeath(c, b.ownerId, 'air');
      else if (res === 'absorbed') onNonLethalHit(b.ownerId);
      break;
    }
  }
}

/**
 * Zderzenia samolot↔samolot (faza 7): para żywych płatowców, których sfery kolizji
 * (collisionRadiusM) zetkną się w trakcie ticku, ulega NATYCHMIASTOWEMU zniszczeniu
 * — oba bez zaliczenia (jak „rozbicie" o ziemię). Friendly fire jest ON, więc
 * zderzają się też maszyny tej samej frakcji. Test zamiatany (planesCollide) łapie
 * lot czołowy mimo dużej prędkości zbliżania. Pary liczone raz (i<j); gdy `a`
 * zginie, przerywamy pętlę wewnętrzną — martwy płatowiec nie zderza się dalej.
 */
function resolvePlaneCollisions(): void {
  for (let i = 0; i < combatants.length; i++) {
    const a = combatants[i];
    if (!a || !a.active || a.state.life !== 'alive') continue;
    for (let j = i + 1; j < combatants.length; j++) {
      const b = combatants[j];
      if (!b || !b.active || b.state.life !== 'alive') continue;
      if (
        !planesCollide(
          a.prevPos,
          a.state.position,
          plane.collisionRadiusM,
          b.prevPos,
          b.state.position,
          plane.collisionRadiusM,
        )
      ) {
        continue;
      }
      onCombatantDeath(a, null, 'air');
      onCombatantDeath(b, null, 'air');
      break;
    }
  }
}

/** Trafienie niezabijające — krzyżyk tylko gdy to gracz oberwał komuś. */
function onNonLethalHit(ownerId: number): void {
  if (ownerId === player.id && !hitMarkerKill) hitMarkerTimerS = HIT_MARKER_S;
}

/**
 * Śmierć uczestnika. `cause`:
 * - 'air'    — zestrzelenie w POWIETRZU (pocisk/kolizja): samolot staje się spadającym
 *              wrakiem ('dying') — silnik gaśnie, śmigło staje, ciągnie dym; mały błysk
 *              teraz, duży wybuch dopiero przy uderzeniu w ziemię (onWreckImpact),
 * - 'ground' — rozbicie o teren: natychmiastowy duży wybuch i 'dead'.
 * Buchalteria (−1 życie, kill feed, kredyt, sprawdzenie meczu) jest wspólna i robiona
 * TERAZ, w chwili zestrzelenia (strzelec zasłużył wtedy) — uderzenie wraku nic nie liczy.
 */
function onCombatantDeath(
  victim: Combatant,
  killerId: number | null,
  cause: 'air' | 'ground',
): void {
  if (cause === 'air') {
    explosions.spawn(victim.state.position, AIR_KILL_FLASH_SCALE); // mały błysk w locie
    victim.state.life = 'dying'; // mesh zostaje widoczny — render() pokazuje spadający wrak
    victim.state.lifeTimerS = 0;
    victim.smokeAccumS = 0;
    if (victim === player) enterPlayerWreck();
  } else {
    explosions.spawn(victim.state.position); // pełny wybuch o ziemię
    victim.mesh.visible = false;
    victim.state.life = 'dead';
    victim.state.lifeTimerS = 0;
  }
  victim.livesLeft = Math.max(0, victim.livesLeft - 1);

  const killer = killerId === null ? null : combatantById(killerId);
  if (!killer || killer === victim) {
    pushKillFeed(`✕ ${victim.name} — rozbicie`);
  } else if (killer.faction === victim.faction) {
    pushKillFeed(`✕ ${killer.name} → ${victim.name} (sojusznik!)`);
  } else {
    pushKillFeed(`✕ ${killer.name} → ${victim.name}`);
  }

  // kredyt za zestrzelenie WROGA dowolnemu strzelcowi (teamkill/samobójstwo bez punktu);
  // marker trafienia tylko dla gracza
  if (killer && killer.faction !== victim.faction) {
    killer.kills++;
    if (killer.id === player.id) {
      hitMarkerTimerS = HIT_MARKER_KILL_S;
      hitMarkerKill = true;
    }
  }

  // asysty: każdy WRÓG (≠ frakcja ofiary), który wcześniej ją trafił, dostaje asystę —
  // poza zabójcą (ten ma już zestrzelenie). Dotyczy też śmierci bez zabójcy (kolizja,
  // rozbicie o ziemię): killerId = null, więc wszyscy wcześniejsi napastnicy-wrogowie liczą się.
  for (const attackerId of victim.damagedBy) {
    if (attackerId === killerId) continue;
    const attacker = combatantById(attackerId);
    if (attacker && attacker !== victim && attacker.faction !== victim.faction) attacker.assists++;
  }
  victim.damagedBy.clear();

  checkMatchEnd();
}

/** Gracz zestrzelony w powietrzu: tryb spadającego wraku + overlay decyzji. */
function enterPlayerWreck(): void {
  playerDeath = 'wreck';
  // zwolnij pointer lock i wyłącz celowanie myszą — kursor wolny do kliknięcia overlay;
  // wrakiem steruje się klawiaturą (WSAD/QE)
  mouseAim.enabled = false;
  if (document.pointerLockElement) document.exitPointerLock();
}

/** Wrak ('dying') uderzył w ziemię: duży wybuch i znika. Buchalteria była już zrobiona. */
function onWreckImpact(c: Combatant): void {
  explosions.spawn(c.state.position); // duży wybuch przy ziemi
  c.mesh.visible = false;
  // life jest już 'dead' (ustawione w updateLifecycle); overlay gracza zostaje do decyzji
}

function checkMatchEnd(): void {
  if (gameMode !== 'combat' || matchOver) return;
  matchMembers.length = 0;
  for (const c of combatants) if (c.active) matchMembers.push(c);
  const inPlay = factionsInPlay(matchMembers);
  // Mecz rozstrzygnięty GLOBALNIE dopiero, gdy została ≤1 frakcja z życiami → ekran wyniku.
  // Gracz wygrywa, jeśli to jego frakcja jest tą ostatnią.
  if (inPlay.size <= 1) {
    const won = inPlay.has(player.faction);
    endMatch(won, won ? 'za wyeliminowanie wrogów' : 'zostałeś wyeliminowany');
    return;
  }
  // ≥2 frakcje wciąż walczą. Jeśli frakcja gracza gra dalej — nic (mecz w toku). Jeśli
  // gracz wypadł (FFA: każdy sam za siebie), mecz toczy się dla pozostałych: gracz może
  // oglądać (obserwator) i podglądać tabelę wyników; o swoim wyjściu decyduje sam.
}

function endMatch(playerWon: boolean, reason: string): void {
  matchOver = true;
  playerDeath = 'none';
  downedOverlay.hide();
  standingsOverlay.hide();
  // mecz zamraża fizykę (playing=false) → spadające wraki nie dolecą do ziemi;
  // „domknij" każdy wybuchem, żeby ekran nie zastygał z wrakiem wiszącym w powietrzu
  for (const c of combatants) {
    if (c.active && c.state.life === 'dying') {
      explosions.spawn(c.state.position);
      c.state.life = 'dead';
      c.mesh.visible = false;
    }
  }
  if (document.pointerLockElement) document.exitPointerLock();
  menu.showResult(buildResultData(playerWon, reason));
}

/** #rrggbb z liczby koloru Three (markery/beacony są liczbami). */
function cssColor(hex: number): string {
  return `#${hex.toString(16).padStart(6, '0')}`;
}

/**
 * Kolor frakcji (liczba Three) — JEDNO źródło dla markera HUD i kropki w tabeli:
 * gracz złoty; w FFA każda frakcja z palety (unikatowo); w drużynowym sojusznik zielony,
 * wróg czerwony (względem frakcji gracza).
 */
function displayColorHex(isPlayer: boolean, faction: number): number {
  if (isPlayer) return PLAYER_COLOR;
  if (matchMode === 'ffa') {
    return FFA_FACTION_COLORS[(faction - 1) % FFA_FACTION_COLORS.length] ?? FOE_COLOR;
  }
  return faction === player.faction ? FRIEND_COLOR : FOE_COLOR;
}

/** Kolor kropki pilota w tabeli wyników (CSS). */
function pilotColor(isPlayer: boolean, faction: number): string {
  return cssColor(displayColorHex(isPlayer, faction));
}

/** Sekundy strefy → „m:ss"; poniżej 1 s pokazujemy „—" (frakcja nigdy nie weszła wyłącznie). */
function formatZoneTime(seconds: number): string {
  if (seconds < 1) return '—';
  const s = Math.floor(seconds);
  return `${String(Math.floor(s / 60))}:${String(s % 60).padStart(2, '0')}`;
}

/** Wiersze tabeli (piloci + drużyny) z aktywnych uczestników + akumulatora strefy. */
function buildScoreRows(): { pilots: ResultPilotRow[]; teams: ResultTeamRow[] } {
  const inputs: ScoreInput[] = [];
  for (const c of combatants) {
    if (!c.active) continue;
    inputs.push({
      id: c.id,
      name: c.name,
      faction: c.faction,
      isPlayer: c.isPlayer,
      kills: c.kills,
      assists: c.assists,
    });
  }
  const board = buildScoreboard(inputs, zone.secondsByFaction);

  const pilots: ResultPilotRow[] = board.pilots.map((p) => ({
    rank: p.rank,
    name: p.name,
    color: pilotColor(p.isPlayer, p.faction),
    kills: p.kills,
    assists: p.assists,
    zoneLabel: formatZoneTime(p.zoneSeconds),
    points: Math.round(p.points),
    isPlayer: p.isPlayer,
  }));

  // wynik drużyn tylko w trybie drużynowym (w FFA frakcja == pilot → redundancja)
  const teams: ResultTeamRow[] =
    matchMode === 'team'
      ? board.teams.map((t) => ({
          name: t.isPlayerTeam ? 'Twoja drużyna' : 'Wrogowie',
          color: cssColor(t.isPlayerTeam ? FRIEND_COLOR : FOE_COLOR),
          kills: t.kills,
          assists: t.assists,
          zoneLabel: formatZoneTime(t.zoneSeconds),
          points: Math.round(t.points),
          isPlayerTeam: t.isPlayerTeam,
        }))
      : [];

  return { pilots, teams };
}

/** Pełne dane ekranu wyniku (werdykt + wiersze) — terminalny ekran po końcu meczu. */
function buildResultData(playerWon: boolean, reason: string): ResultData {
  const { pilots, teams } = buildScoreRows();
  return { playerWon, headline: reason, modeLabel, difficulty, pilots, teams };
}

/** Czy gracz jest wyeliminowany, a mecz wciąż trwa — wtedy przełącza tabelę ↔ obserwatora. */
function canToggleStandings(): boolean {
  return gameMode === 'combat' && !matchOver && playerDeath !== 'none';
}

/** Otwiera żywą tabelę wyników (dane bieżące); mecz toczy się dalej pod spodem. */
function openStandings(): void {
  if (!canToggleStandings()) return;
  const { pilots, teams } = buildScoreRows();
  standingsOverlay.show(pilots, teams);
}

function closeStandings(): void {
  standingsOverlay.hide();
}

/** Tab w stanie zestrzelenia: przełącza między żywą tabelą a widokiem obserwatora/wraku. */
function toggleStandings(): void {
  if (standingsOverlay.isOpen) closeStandings();
  else openStandings();
}

/** Gracz (wrak) wybiera tryb obserwatora — ogląda żyjących sojuszników. */
function choosePlayerSpectate(): void {
  if (playerDeath !== 'wreck') return;
  playerDeath = 'spectating';
  spectatorTargetId = firstSpectatable()?.id ?? null;
  downedOverlay.hide();
}

/** Gracz (wrak) kończy misję — był zestrzelony, więc to porażka. */
function choosePlayerEndMission(): void {
  if (playerDeath !== 'wreck') return;
  endMatch(false, 'zestrzelony — koniec misji');
}

// --- start meczu / ustawienia trybów ---

function startMatch(choice: GameModeChoice): void {
  matchOver = false;
  hitMarkerKill = false;
  hitMarkerTimerS = 0;
  spectatorTargetId = null;
  playerDeath = 'none';
  downedOverlay.hide();
  standingsOverlay.hide();
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
  player.configure({ faction: 0, lives: MATCH_LIVES, name: 'Ty', bot: null });
  for (let i = 0; i < botCount; i++) {
    const c = botSlots[i];
    if (!c) break;
    c.configure({
      faction: i + 1,
      lives: MATCH_LIVES,
      name: `Bot ${String(i + 1)}`,
      bot: makeBot(0xb0b1e + i),
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
  player.configure({ faction: 0, lives: MATCH_LIVES, name: 'Ty', bot: null });
  for (let i = 1; i < perTeam; i++) {
    const c = botSlots[slot++];
    if (!c) break;
    c.configure({
      faction: 0,
      lives: MATCH_LIVES,
      name: `Sojusznik ${String(i)}`,
      bot: makeBot(0xa11 + slot),
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
const smoke = new SmokeTrails(scene);
const tracers = new BulletTracers(scene, BULLET_POOL_CAPACITY);
const muzzleFlash = new MuzzleFlash(scene, allMuzzles(plane.armament));

// Światła (ambient + słońce kierunkowe) tworzy createWorld — jeden kierunek SUN_DIR
// wspólny dla cieniowania, glow nieba i lens flare (faza 20, złota godzina).

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
const roster = new RosterOverlay();
const reticleEl = requireEl('reticle');
const noseMarkerEl = requireEl('nose-marker');
const alertEl = requireEl('arena-alert');
const hitMarkerEl = requireEl('hit-marker');
const killFeedEl = requireEl('kill-feed');
// pula markerów (wróg/sojusznik) — przydzielana co klatkę żywym uczestnikom
const markers = Array.from({ length: MAX_BOTS }, () => new EnemyMarker(document.body));
// pasek przejmowania strefy (główny cel) — u góry ekranu, tylko w trybie walki
const zoneBar = new ZoneBar(document.body);
// wygaszanie obrazu przy przeciążeniu (G-LOC) — tylko dla widoku gracza w locie
const greyoutOverlay = new GreyoutOverlay();
// nakładka decyzji po zestrzeleniu (tryb obserwatora / zakończ misję) — u dołu
const downedOverlay = new DownedOverlay(
  () => choosePlayerSpectate(),
  () => openStandings(),
  () => choosePlayerEndMission(),
);
// żywa tabela wyników (mecz trwa) — „Wróć" chowa, „Zakończ misję" kończy terminalnie
const standingsOverlay = new StandingsOverlay(
  () => closeStandings(),
  () => choosePlayerEndMission(),
);

function resize(): void {
  const { clientWidth, clientHeight } = app as HTMLElement;
  renderer.setSize(clientWidth, clientHeight);
  camera.aspect = clientWidth / clientHeight;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// --- sterowanie debug ---

window.addEventListener('keydown', (event) => {
  if (event.key === 'F3') {
    event.preventDefault(); // F3 = "znajdź" w przeglądarce
    arrows.toggle();
  } else if (event.key === 'F4') {
    event.preventDefault();
    physicsHz = physicsHz === PHYSICS_HZ ? SLOW_PHYSICS_HZ : PHYSICS_HZ;
    loop = new FixedStepLoop(1 / physicsHz, physicsStep);
  } else if (event.code === 'KeyC') {
    cameraMode = cameraMode === 'pościgowa' ? 'orbitalna' : 'pościgowa';
    if (cameraMode === 'pościgowa') {
      // powrót do pościgowej: mysz znów może celować (pointer lock przez klik) — ale tylko
      // gdy gracz żyje; wrak/obserwator trzymają kursor wolny (sterowanie/przełączanie LPM)
      chaseCamera.reset();
      mouseAim.enabled = playerDeath === 'none';
    } else {
      // orbitalna = rozglądanie się myszą; lot tylko z klawiatury. Zwolnij pointer
      // lock (kursor wraca do przeciągania orbity) i zablokuj ponowne celowanie.
      mouseAim.enabled = false;
      if (document.pointerLockElement) document.exitPointerLock();
    }
  } else if (event.key === 'r' || event.key === 'R') {
    if (player.state.life === 'alive' || gameMode === 'menu') respawnCombatant(player);
  } else if (event.code === 'Tab') {
    // tylko gdy gracz zestrzelony, a mecz trwa: przełącz żywą tabelę ↔ obserwatora
    if (canToggleStandings()) {
      event.preventDefault(); // Tab domyślnie przenosi fokus DOM
      toggleStandings();
    }
  }
});

// --- tryb obserwatora po eliminacji (przełączanie widoku LPM) ---

/** Czy gracz wybrał tryb obserwatora po zestrzeleniu (mecz wciąż trwa). */
function isSpectating(): boolean {
  return gameMode === 'combat' && !matchOver && playerDeath === 'spectating';
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

/**
 * Czy jest kogo obserwować (warunek przycisku „Tryb obserwatora"). Zakres ustala
 * isSpectatable: w drużynowym tylko żywi sojusznicy, w FFA dowolny pozostały samolot
 * — dzięki temu zestrzelony gracz FFA też może oglądać dalszą walkę.
 */
function canSpectate(): boolean {
  return spectatableCount() > 0;
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
  // dopóki gracz steruje wrakiem (i nie przeszedł w obserwatora) — kamera trzyma się go,
  // żeby widział własny upadek i mógł nim kierować, a po rozbiciu — miejsce katastrofy
  if (playerDeath === 'wreck') return player;
  if (player.state.life === 'alive' || player.livesLeft > 0) return player;
  const chosen = spectatorTargetId === null ? null : combatantById(spectatorTargetId);
  if (chosen && isSpectatable(chosen)) return chosen;
  const next = firstSpectatable();
  spectatorTargetId = next ? next.id : null;
  return next ?? player;
}

/** Linie wyniku w HUD dla bieżącego trybu walki. */
// Linie walki w HUD: obecnie tylko HP gracza. Zestrzelenia i stan „w powietrzu"
// przeniesione na listę samolotów (roster) — tu byłyby redundancją.
function combatScoreLines(): string[] {
  const hp = String(Math.max(0, Math.round(playerHealth.hp)));
  return [hudRow('HP', hp, `/ ${String(plane.hpPool)}`)];
}


/**
 * Wiersze listy samolotów (lewy górny róg). Stała kolejność slotów (gracz, potem
 * boty) → lista nie skacze, gdy ktoś ginie. Status binarny: „stracony" dopiero gdy
 * pilot wyczerpał życia i nie żyje ani nie spada (wrak/respawn = wciąż „w walce").
 */
function rosterRows(): RosterRow[] {
  const rows: RosterRow[] = [];
  for (const c of combatants) {
    if (!c.active) continue;
    const lost =
      c.livesLeft <= 0 && c.state.life !== 'alive' && c.state.life !== 'dying';
    rows.push({
      name: c.name,
      kills: c.kills,
      assists: c.assists,
      colorCss: pilotColor(c.isPlayer, c.faction),
      isPlayer: c.isPlayer,
      isLost: lost,
    });
  }
  return rows;
}

// --- pętla renderu: stały krok fizyki + interpolacja stanem prev/curr ---

setupMenuBackground();
const menu = new GameMenu(startMatch);
menu.showStart();
let lastTimeMs: number | undefined;

/** Statyczne tło pod menu: gracz nad oceanem (fizyka stoi w gameMode 'menu'). */
function setupMenuBackground(): void {
  player.configure({ faction: 0, lives: 1, name: 'Ty', bot: null });
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

  // wygaszanie obrazu przy przeciążeniu (G-LOC) — tylko gdy patrzymy z własnego,
  // żywego samolotu; obserwacja cudzego / wrak / menu = czysty obraz
  greyoutOverlay.update(
    viewC === player && lastTick && player.state.life === 'alive' ? lastTick.gLoad.blackoutFactor : 0,
  );

  // kamera nigdy pod powierzchnią (kraksa na zboczu wbijała ją w teren)
  const cameraFloorM = surfaceHeightM(terrain, camera.position.x, camera.position.z) + 3;
  if (camera.position.y < cameraFloorM) camera.position.y = cameraFloorM;

  world.update(camera.position);
  explosions.update(frameDtS);

  // dym: spadające wraki ciągną gęstą czarną smugę; trafione, ale żywe maszyny dymią
  // słabiej i jaśniej im więcej HP (biały→szary→ciemny), nic poniżej progu uszkodzeń.
  // Punkt emisji cofnięty ZA samolot (mesh już zinterpolowany w render()), żeby smuga
  // wychodziła zza ogona, nie ze środka kadłuba. update() starzeje kłęby po zniknięciu.
  for (const c of combatants) {
    if (!c.active) continue;
    let tier: SmokeTier | null = null;
    if (c.state.life === 'dying') tier = WRECK_TIER;
    else if (c.state.life === 'alive') tier = damageSmokeTier(c.health.hp, c.health.maxHp);
    if (tier === null) {
      c.smokeAccumS = 0; // mało/nieuszkodzony — nie kumuluj długu czasowego do kolejnego trafienia
      continue;
    }
    c.smokeAccumS += frameDtS;
    if (c.smokeAccumS < tier.intervalS) continue;
    getForward(c.mesh.quaternion, scratchSmokeDir).multiplyScalar(-SMOKE_BACK_OFFSET_M);
    scratchSmokePos.copy(c.mesh.position).add(scratchSmokeDir);
    while (c.smokeAccumS >= tier.intervalS) {
      c.smokeAccumS -= tier.intervalS;
      smoke.emit(scratchSmokePos, tier.profile);
    }
  }
  smoke.update(frameDtS);

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

  // markery HUD samolotów: TYLKO w zasięgu wykrycia (≤ SPOT_RANGE_M). Dalej widać
  // goły mesh — gracz musi wypatrzyć wroga na horyzoncie, zamiast lecieć na gotowy znacznik.
  if (gameMode === 'combat') {
    const spotSqM = SPOT_RANGE_M * SPOT_RANGE_M;
    let mi = 0;
    for (const c of combatants) {
      const spotted =
        c.active &&
        c !== player &&
        c.state.life === 'alive' &&
        c.mesh.position.distanceToSquared(viewMesh.position) <= spotSqM;
      if (!spotted || mi >= markers.length) continue;
      const marker = markers[mi];
      if (!marker) continue;
      mi++;
      // FFA: unikatowy kolor frakcji; drużynowy: czerwony wróg / zielony sojusznik
      if (matchMode === 'ffa') marker.setColorHex(displayColorHex(false, c.faction));
      else marker.setFoe(c.faction !== player.faction);
      marker.update(c.mesh.position, viewMesh.position, camera, w, h);
      // cel schowany w chmurze → znacznik przygasa (faza 20: taktyczne krycie się)
      marker.setOpacity(1 - 0.8 * world.cloudCoverAt(c.mesh.position));
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

  // nakładka decyzji po zestrzeleniu (steruj wrakiem / obserwator / tabela / koniec misji);
  // chowana, gdy otwarta jest pełnoekranowa tabela wyników (nie nakładać dwóch nakładek)
  if (gameMode === 'combat' && !matchOver && playerDeath === 'wreck' && !standingsOverlay.isOpen) {
    downedOverlay.show(canSpectate());
  } else {
    downedOverlay.hide();
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
  // znacznik nosa: celownik żywego gracza (mysz) ORAZ wraku (kieruje ogniem ze Spacji)
  if (nosePos && (state.life === 'dying' || (mouseAim.locked && state.life === 'alive'))) {
    noseMarkerEl.style.display = 'block';
    noseMarkerEl.style.left = `${nosePos.x.toFixed(0)}px`;
    noseMarkerEl.style.top = `${nosePos.y.toFixed(0)}px`;
  } else {
    noseMarkerEl.style.display = 'none';
  }

  // alert pełnoekranowy: rozbicie/eliminacja > ostrzeżenie o granicy
  const edgeM = distanceToArenaEdgeM(state.position.x, state.position.z);
  if (playerDeath === 'wreck') {
    // komunikat i akcje są w nakładce u dołu — środek ekranu czysty do sterowania wrakiem
    alertEl.style.opacity = '0';
  } else if (state.life !== 'alive') {
    if (playerDeath === 'spectating') {
      alertEl.textContent =
        spectatableCount() > 1 ? 'OBSERWUJESZ   [LPM] zmień samolot' : 'OBSERWUJESZ';
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
  getUp(state.orientation, scratchUp);
  getRight(state.orientation, scratchRight);
  hud.update({
    iasKmh: state.iasMs * MS_TO_KMH,
    tasKmh: tas * MS_TO_KMH,
    altM: state.position.y,
    throttle01: state.throttle,
    nG: state.loadFactor,
    nAvailG: lastTick ? lastTick.nAvailG : 0,
    gLimitG: lastTick ? lastTick.gLoad.gLimitG : 0,
    blackoutFactor: viewC === player && lastTick ? lastTick.gLoad.blackoutFactor : 0,
    stallPhase: lastTick ? lastTick.stall.phase : 'normal',
    buffetIntensity: viewC === player ? buffet : 0,
    bankRad: Math.atan2(-scratchRight.y, scratchUp.y),
    pitchRad: Math.asin(Math.min(1, Math.max(-1, scratchFwd.y))),
    controlMode: control.mode,
    // ostrzeżenie „pusty bak" tylko w locie — wrak/martwy nie ma już silnika do zgaszenia
    fuel01: state.life === 'alive' ? state.fuelFrac : 1,
    ammo: fireControl.ammoRemaining,
    ammoMax: AMMO_MAX,
    secondaryAmmo: SECONDARY_AMMO_MAX > 0 ? (fireControl.groups[1]?.ammoRemaining ?? 0) : undefined,
    secondaryAmmoMax: SECONDARY_AMMO_MAX > 0 ? SECONDARY_AMMO_MAX : undefined,
    extraLines: [
      '',
      ...(gameMode === 'combat' ? combatScoreLines() : []),
      ...(viewC !== player ? [`OBSERWUJESZ: ${viewC.name}`] : []),
      fpsHudLine(fpsValue),
      hudRow('pociski', String(pool.activeCount)),
    ],
  });

  if (gameMode === 'combat') roster.update(rosterRows());
  else roster.hide();

  renderer.render(scene, camera);
});

// Ekran ładowania znika, gdy model gracza jest gotowy (sukces lub błąd → bryła
// zastępcza), albo po awaryjnym timeoutcie, gdyby pobranie 14 MB modelu zawisło —
// menu pokazuje się wtedy z gotowym Spitfire'em zamiast nad czarną stroną.
const loadingEl = document.getElementById('loading');
const hideLoading = (): void => loadingEl?.classList.add('hidden');
const loadTimeoutId = setTimeout(hideLoading, 8000);
void player.model.ready.then(() => {
  clearTimeout(loadTimeoutId);
  hideLoading();
});

const statusEl = document.getElementById('net-status');
if (!statusEl) throw new Error('brak elementu #net-status');
// Demo fazy 7 jest w 100% statyczne — brak backendu. Wskaźnik ping/pong ma sens
// tylko w devie (lokalny serwer WS na localhost); w produkcji łączenie z
// ws://localhost byłoby mixed-contentem na https i wisiałoby na „rozłączono".
// Sieć (i ten wskaźnik) wracają w fazie 13.
if (import.meta.env.DEV) {
  connectNetStatus(statusEl);
} else {
  statusEl.style.display = 'none';
}

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
