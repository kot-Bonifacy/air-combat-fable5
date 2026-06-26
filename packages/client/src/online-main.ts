import {
  PerspectiveCamera,
  PMREMGenerator,
  Quaternion,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import {
  AA_BALLISTICS,
  ARENA_WARNING_DISTANCE_M,
  BULLET_POOL_CAPACITY,
  BulletPool,
  EMPLACEMENT_DISPERSION_MRAD,
  EMPLACEMENT_MUZZLE_HEIGHT_M,
  EMPLACEMENT_POINTS,
  INPUT_HZ,
  MATCH_LIVES,
  MAX_PLAYERS_PER_ROOM,
  MRAD_TO_RAD,
  MS_TO_KMH,
  MouseAimCore,
  PORT,
  DEFAULT_PLANE_TYPE,
  SEA_LEVEL_M,
  SPOT_RANGE_M,
  aimDirectionBody,
  airDensityKgM3,
  allMuzzles,
  applyDispersion,
  createRng,
  createTerrain,
  distanceToArenaEdgeM,
  dynamicPressurePa,
  getForward,
  getRight,
  getUp,
  nAvailG,
  planeConfigOf,
  primaryGroup,
  surfaceHeightM,
  totalAmmo,
  wingspanM,
  type EntitySnapshot,
  type GameEvent,
  type InputFrame,
  type KillCause,
  type LifePhase,
  type MatchEndedMessage,
  type MatchMode,
  type PlaneType,
  type RoomJoinedMessage,
  type RoomPlayer,
  type Snapshot,
  type StandingRow,
  type StandingsMessage,
} from '@air-combat/shared';
import { BulletTracers } from './bullet-tracers';
import { ChaseCamera } from './chase-camera';
import { DownedOverlay } from './downed-overlay';
import { PauseMenu } from './pause-menu';
import { EnemyMarker } from './enemy-marker';
import { Explosions } from './explosion';
import { OrbitCamera } from './orbit-camera';
import { GreyoutOverlay } from './greyout-overlay';
import { Hud, hudRow, fpsHudLine } from './hud';
import { KeyboardInput } from './input';
import { MouseAim, projectDirToScreen } from './mouse-aim';
import { MuzzleFlash } from './muzzle-flash';
import { NetClient, defaultServerUrl } from './net/net-client';
import { SnapshotInterpolator, createInterpolatedState } from './net/interpolation';
import { NetDebugOverlay } from './net/net-debug-overlay';
import { Predictor } from './net/prediction';
import { LobbyUI, type WaitingView } from './net/lobby-ui';
import { ResultsOverlay, ScoreboardOverlay } from './net/match-ui';
import type { NetConditionsPanel } from './net/net-conditions-panel';
import { RosterOverlay, type RosterRow } from './roster-overlay';
import { ZoneBar, type ZoneBarState } from './zone-bar';
import { SmokeTrails, WRECK_TIER, GROUND_FIRE_TIER, damageSmokeTier, type SmokeTier } from './smoke';
import { createPlaneMesh, charPlaneMesh, restorePlaneMesh, type PlaneModel } from './plane-mesh';
import { createWorld } from './world';
import { buildEmplacements, charEmplacement, restoreEmplacement } from './emplacement-mesh';
import { AudioManager } from './audio/audio-manager';
import type { EngineVoice, GunVoice, WindVoice } from './audio/voices';

// Tryb online faza 10 — lobby + pokoje. Klient łączy się LENIWIE (przy pierwszej akcji
// w lobby), dzięki czemu hello niesie aktualny nick. Token sesji z welcome trzymamy w
// localStorage → przy odświeżeniu próbujemy reconnectu do tego samego samolotu. Render +
// input + predykcja działają tylko w fazie 'playing'; w lobby pokazujemy ekrany DOM.
// Predykcja/interpolacja jak w fazie 9. Faza 11: broń online — spust w INPUT, pociski
// autorytatywne na serwerze; klient rysuje smugacze z eventu MUZZLE i pokazuje hit marker /
// kill feed z eventów HIT / KILL (zero hit-detekcji po stronie klienta). Faza 13: pętla
// meczu FFA — scoreboard na Tab (standings), ekran wyników z rewanżem (matchEnded), HUD
// z zegarem i wynikiem; wszystko AUTORYTATYWNE z serwera (klient tylko wyświetla).
// Faza 14: parytet wizualny z SP — wybuchy (KILL), dym uszkodzeń (healthFrac), błysk luf
// (lokalny MUZZLE), markery wrogów ze spottingiem, celownik + znacznik nosa, ostrzeżenie
// granicy areny, lista uczestników i pełny HUD-G (G-LOC/stall/szarzenie + sztuczny horyzont).
// Dane lotu z lokalnej predykcji (Predictor.sim — bez zmiany protokołu); amunicja ze
// snapshotu (protokół v3: +1 bajt) — predykcja nie symuluje ognia.
// Faza 16: kliencka warstwa śmierci (parytet z SP) — zestrzelony gracz STERUJE własnym
// spadającym wrakiem (lokalna predykcja `stepWreckPiloted` dla 'dying', ta sama ścieżka co
// serwer), dym wraku (WRECK_TIER), wybuch dopiero przy uderzeniu w ziemię (dying→dead),
// nakładka decyzji (DownedOverlay: obserwator / tabela / opuść pokój), tryb obserwatora
// (LPM cyklicznie zmienia oglądany samolot) i kamera orbitalna (klawisz C). Brak „pustego
// kadru" po zestrzeleniu. Bez zmian protokołu.

// Lokalny samolot gracza (faza 19b): TYP ujawnia się w pierwszym snapshocie — własna encja niesie
// planeType (protokół v4). Konfiguracja steruje predykcją, HUD-G i amunicją; zmianę typu obsługuje
// setLocalPlane (odbudowa predyktora + błysku luf). Domyślny Spitfire do pierwszego snapshotu.
let localPlaneType: PlaneType = DEFAULT_PLANE_TYPE;
let localPlane = planeConfigOf(localPlaneType);
let localAmmoMax = totalAmmo(localPlane.armament);
/** Pełny zapas amunicji grupy WTÓRNEJ lokalnego samolotu (działko 20 mm Bf 109); 0 = brak grupy. */
let localSecondaryMax = secondaryAmmoMaxOf(localPlane);
const INPUT_DT_S = 1 / INPUT_HZ;
const TOKEN_STORAGE_KEY = 'air-combat:token';
/** Okno automatycznego ponawiania powrotu do meczu po zerwaniu sieci [ms] — w tym czasie serwer
 *  trzyma slot (okno 60 s), a samolot leci w auto-stabilizacji. Po wyczerpaniu → nakładka ręczna. */
const AUTO_RECONNECT_WINDOW_MS = 12_000;
/** Odstęp kolejnych prób wznowienia w oknie [ms]. */
const RECONNECT_RETRY_MS = 1_500;

// Kolory (parytet z SP): gracz złoty; w FFA każdy inny pilot z palety FFA (unikatowo per id);
// w trybie drużynowym (faza 18) sojusznik zielony, wróg czerwony — względem frakcji gracza.
// JEDNO źródło dla markerów i rostera (entityColorHex zna tryb i frakcje z ostatnich standings).
const PLAYER_COLOR = 0xffd24a;
const FRIEND_COLOR = 0x33dd66;
const FOE_COLOR = 0xff3020;
const FFA_FACTION_COLORS = [0xff3b30, 0xff8c1a, 0xff4fd8, 0x32d0ff, 0xa56bff, 0xff6ea0];
const SMOKE_BACK_OFFSET_M = 3; // punkt emisji dymu cofnięty ZA ogon (nie ze środka kadłuba)
const AIR_KILL_FLASH_SCALE = 0.4; // mały błysk przy zestrzeleniu w locie (duży wybuch dopiero o ziemię)
// Tonięcie wraku na wodzie (życzenie usera 2026-06-23): wrak osiada na tafli, po krótkim holdzie
// zanurza się pod wodę i znika — zamiast unoszenia się/natychmiastowego zniknięcia. Całość ~1,5 s.
const WATER_SINK_HOLD_S = 0.6; // wrak leży na tafli, zanim zacznie tonąć
const WATER_SINK_SPEED_MS = 9; // prędkość zanurzania pod taflę [m/s] (po holdzie)
const WATER_SINK_TOTAL_S = 1.5; // po tym czasie mesh jest chowany i wpis usuwany

function cssColor(hex: number): string {
  return `#${hex.toString(16).padStart(6, '0')}`;
}

/** Pełny zapas amunicji grupy WTÓRNEJ samolotu (działko 20 mm Bf 109); 0, gdy ma jedną grupę broni. */
function secondaryAmmoMaxOf(plane: typeof localPlane): number {
  const g = plane.armament.groups[1];
  return g ? g.ammoPerGun * g.muzzles.length : 0;
}

/**
 * Kolor pilota (Three) — JEDNO źródło dla markera HUD i rostera (parytet z SP, displayColorHex):
 * gracz złoty; w trybie drużynowym sojusznik zielony / wróg czerwony (wg frakcji z ostatnich
 * standings); w FFA unikatowy kolor z palety wg id (frakcja = id, więc bez mapy frakcji).
 */
function entityColorHex(id: number, isLocal: boolean): number {
  if (isLocal) return PLAYER_COLOR;
  if (matchMode === 'team') {
    return factionById.get(id) === localFaction ? FRIEND_COLOR : FOE_COLOR;
  }
  return FFA_FACTION_COLORS[id % FFA_FACTION_COLORS.length] ?? FFA_FACTION_COLORS[0]!;
}

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
  // logarithmicDepthBuffer: jak w SP (main.ts) — precyzja głębi kasuje z-fighting
  // brzegu z oceanem; własne shadery świata piszą spójną głębię przez logdepthbuf
  renderer = new WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
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
const chaseCamera = new ChaseCamera(camera, renderer.domElement);
const orbit = new OrbitCamera(camera, renderer.domElement);
let cameraMode: 'pościgowa' | 'orbitalna' = 'pościgowa';

// --- stan śmierci gracza (faza 16, parytet z SP) ---
// 'none' — żyje; 'wreck' — spadający wrak gracza (steruje klawiaturą) lub po jego rozbiciu,
// czeka na respawn (overlay decyzji); 'spectating' — wybrał tryb obserwatora (LPM cyklicznie).
type PlayerDeath = 'none' | 'wreck' | 'spectating';
let playerDeath: PlayerDeath = 'none';
let prevLocalLife: LifePhase = 'alive';
// Czy stan śmierci wiąże się ze STEROWALNYM spadającym wrakiem ('dying'): true dla zestrzelenia/
// kolizji (faza 'dying'), false dla rozbicia prosto w ziemię (alive→dead) — wtedy nie ma czym
// sterować, więc DownedOverlay chowa podpowiedź o wraku. Zob. updateDeathState.
let downedFlyableWreck = true;
// Menu pauzy (Esc, 2026-06-23): zakończenie misji / powrót do poczekalni w trakcie meczu. Świat
// żyje dalej (serwer autorytatywny) — flaga tylko bramkuje ogień/celowanie i zwalnia kursor.
let pauseMenuOpen = false;
// Gracz wycofał się z trwającego meczu, zostając w pokoju (leaveMatch): ogląda poczekalnię, choć
// pokój wciąż 'playing'. Blokuje wciągnięcie z powrotem do gry przez roomUpdate i ekran wyników;
// znika, gdy pokój wróci do 'waiting' (koniec bieżącego meczu) albo przy pełnym wyjściu/nowym meczu.
let withdrawnToWaiting = false;
// Przyczyna ostatniej śmierci LOKALNEGO gracza (z eventu KILL) — dobiera komunikat: ogień wroga →
// ZESTRZELONY, zderzenie z samolotem → KOLIZJA, rozbicie o teren/wodę → ROZBITY. null poza śmiercią.
let localDeathCause: KillCause | null = null;
/** Id obserwowanego pilota po wejściu w tryb obserwatora; null = wybór automatyczny (pierwszy żywy). */
let spectatorTargetId: number | null = null;
// poza obserwowanego (z interpolacji) do kamery — wypełniane w pętli renderu, gdy obserwujemy
const spectatedPos = new Vector3();
const spectatedQuat = new Quaternion();
const spectatedVel = new Vector3();
let spectatedValid = false;

// teren z TYM SAMYM seedem co serwer (TERRAIN_SEED) — świat zgodny po obu stronach
const terrain = createTerrain();
const world = createWorld(scene, terrain);

// Naziemne stanowiska ogniowe (Część 2): meshe statyczne (pozycje z seeda terenu, jak serwer).
// Stan zniszczenia + dym + pozycyjny dźwięk serii MG trzymane równolegle do grup; tracery ognia
// spawnują się z eventów AA_FIRE do `cosmeticPool`. Reset (odbudowa) przy nowym meczu/reconnect.
const emplacementGroups = buildEmplacements(scene, terrain);
const emplacementMuzzles = emplacementGroups.map((g) =>
  g.position.clone().setY(g.position.y + EMPLACEMENT_MUZZLE_HEIGHT_M),
);
const emplacementDestroyed: boolean[] = emplacementGroups.map(() => false);
const emplacementGuns: (GunVoice | null)[] = emplacementGroups.map(() => null);
const emplacementSmokeAccum: number[] = emplacementGroups.map(() => 0);
const scratchEmplacementSmoke = new Vector3();
/** Klucz „właściciela" tracerów AA w `tracerCounter`/`cosmeticPool` — poza zakresem id samolotów. */
const AA_TRACER_KEY_BASE = 1000;

// Dźwięk (faza 21): listener na kamerze (3D pozycyjne obcych z grafu sceny). Sample ładujemy od razu
// (≈180 KB), AudioContext odblokowujemy pierwszym gestem (autoplay policy) — patrz audio-manager.
const audio = new AudioManager(camera, scene);
void audio.load();
const unlockAudio = (): void => audio.unlock();
window.addEventListener('pointerdown', unlockAudio);
window.addEventListener('keydown', unlockAudio);
// delikatny klik UI przy przyciskach lobby (faza 21 „dźwięki UI lobby") — generycznie, bez edycji lobby-ui
window.addEventListener('pointerdown', (e) => {
  if (phase === 'lobby' && e.target instanceof HTMLButtonElement) audio.uiClick();
});
// Pętle silnika/broni per encja (cleanup przy śmierci/usunięciu — pułapka: wiszące źródła = wyciek);
// świst+buffet (proceduralne) tworzony leniwie po załadowaniu sampli/odblokowaniu kontekstu.
interface EntityAudio {
  plane: PlaneType;
  engine: EngineVoice;
  gun: GunVoice;
}
const entityAudioById = new Map<number, EntityAudio>();
let wind: WindVoice | null = null;

/** Tworzy/aktualizuje głosy silnika+broni encji; odbudowa przy zmianie typu samolotu (respawn innym).
 *  `host===undefined` → własny samolot (niepozycyjny); inaczej pozycyjny, podpięty do meshu. */
function ensureEntityAudio(id: number, plane: PlaneType, host: PlaneModel['object'] | undefined): EntityAudio {
  let ea = entityAudioById.get(id);
  if (ea && ea.plane !== plane) {
    disposeEntityAudio(id);
    ea = undefined;
  }
  if (!ea) {
    const local = host === undefined;
    ea = { plane, engine: audio.createEngine(plane, local, host), gun: audio.createGun(plane, local, host) };
    entityAudioById.set(id, ea);
  }
  return ea;
}

function disposeEntityAudio(id: number): void {
  const ea = entityAudioById.get(id);
  if (!ea) return;
  ea.engine.dispose();
  ea.gun.dispose();
  entityAudioById.delete(id);
}

// Światła (ambient + słońce kierunkowe) tworzy createWorld — wspólny SUN_DIR (faza 20).
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
  if (e.button !== 0) return;
  // w trybie obserwatora LPM przełącza oglądany samolot; żywy gracz: spust (po przejęciu
  // pointer locka). Wrak ma kursor wolny (mysz wyłączona) → triggerMouse i tak nie strzela.
  if (isSpectating()) cycleSpectatorTarget(1);
  else triggerMouse = true;
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
  if (pauseMenuOpen) return false; // menu pauzy otwarte — nie strzelaj (kursor klika przyciski)
  return (mouseAim.locked && triggerMouse) || triggerKey;
}

// kamera: C przełącza pościgową ↔ orbitalną (parytet z SP). Orbitalna = rozglądanie myszą,
// lot tylko z klawiatury (mysz-celownik wyłączona); pościgowa wraca do celowania myszą,
// gdy gracz żyje. updateMouseAimEnabled spina stan myszy z trybem kamery i stanem śmierci.
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyC' && phase === 'playing' && !pauseMenuOpen) {
    cameraMode = cameraMode === 'pościgowa' ? 'orbitalna' : 'pościgowa';
    updateMouseAimEnabled();
  }
});

// Esc (2026-06-23): menu pauzy w trakcie meczu — zakończenie misji / powrót do poczekalni. Świat
// leci dalej (serwer autorytatywny). Ignorujemy podczas pisania (np. czat poczekalni) i poza grą.
window.addEventListener('keydown', (e) => {
  if (e.code !== 'Escape' || phase !== 'playing' || isEditingText()) return;
  e.preventDefault();
  togglePauseMenu();
});

/** Otwiera/zamyka menu pauzy (Esc). Otwarcie zwalnia pointer lock i gasi celowanie myszą, by
 *  dało się kliknąć przyciski; zamknięcie przywraca stan myszy wg trybu kamery i życia gracza. */
function togglePauseMenu(): void {
  if (phase !== 'playing') return;
  if (pauseMenuOpen) {
    pauseMenuOpen = false;
    pauseMenu.hide();
    updateMouseAimEnabled();
  } else {
    pauseMenuOpen = true;
    pauseMenu.show(otherHumansPresent());
    mouseAim.enabled = false;
    if (document.pointerLockElement) document.exitPointerLock();
  }
}

/** Czy w pokoju jest co najmniej JEDEN inny człowiek (poza nami) — decyduje o trybie zakończenia:
 *  same boty → koniec całego meczu; inni ludzie → powrót do poczekalni bez kończenia im gry. */
function otherHumansPresent(): boolean {
  if (!roomView) return false;
  let humans = 0;
  for (const p of roomView.players) if (!p.isBot) humans++;
  return humans > 1;
}

/**
 * Zakończenie misji wg kontekstu (życzenie usera 2026-06-23): gdy w grze są SAME boty — host kończy
 * cały mecz (endMatch → serwer wraca pokojem do 'waiting' → poczekalnia przez roomUpdate); gdy grają
 * inni ludzie — wycofujemy się z meczu bez kończenia go pozostałym (leaveMatch) i od razu pokazujemy
 * poczekalnię. Wołane z menu pauzy oraz z nakładki po zestrzeleniu (DownedOverlay).
 */
function endMissionContextual(): void {
  pauseMenuOpen = false;
  pauseMenu.hide();
  if (otherHumansPresent()) {
    net?.leaveMatch();
    enterWaitingFromWithdraw();
  } else {
    net?.endMatch(); // przejście do poczekalni zrobi onRoomUpdate (state='waiting' z abortMatch)
  }
}

/** Wycofany gracz przechodzi do poczekalni TEGO pokoju, choć mecz wciąż trwa (state='playing').
 *  Flaga withdrawnToWaiting trzyma go w poczekalni do końca bieżącego meczu (patrz onRoomUpdate). */
function enterWaitingFromWithdraw(): void {
  if (!roomView) return;
  withdrawnToWaiting = true;
  enterWaiting(roomView);
}

/** Mysz-celownik aktywna tylko w kamerze pościgowej, gdy gracz żyje (nie wrak/obserwator) i nie
 *  jest otwarte menu pauzy (Esc zwalnia kursor do kliknięcia przycisków). */
function updateMouseAimEnabled(): void {
  const wantEnabled = cameraMode === 'pościgowa' && playerDeath === 'none' && !pauseMenuOpen;
  mouseAim.enabled = wantEnabled;
  if (!wantEnabled && document.pointerLockElement) document.exitPointerLock();
}

// --- stan sieci/lobby ---
let net: NetClient | null = null;
let phase: Phase = 'lobby';
let attemptingResume = false;
let roomView: WaitingView | null = null;

// --- auto-reconnect po krótkim zerwaniu sieci (powrót do swojego samolotu bez przeładowania strony) ---
/** Trwa automatyczne ponawianie wznowienia sesji (banner „Wznawianie połączenia…"). */
let reconnecting = false;
/** Moment [performance.now ms], po którym rezygnujemy z auto-ponawiania → nakładka ręczna. */
let reconnectDeadlineMs = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
/** Serwer zgłosił zamknięcie (serverShutdown) — nie ma do czego wracać, pomiń auto-reconnect. */
let serverWentAway = false;

// --- predykcja + interpolacja (odtwarzane przy wejściu do nowego meczu) ---
let predictor = new Predictor(localPlane, terrain);
let interpolator = new SnapshotInterpolator();
const interpOut = createInterpolatedState();
const overlay = new NetDebugOverlay();

// --- meshe encji (jeden PlaneModel na id z serwera) ---
const meshes = new Map<number, PlaneModel>();
// typ samolotu per encja z ostatniego snapshotu (faza 19b): dobór mesha, kosmetycznych smugaczy
// (lufy strzelca) i etykiety HUD przy markerze; `meshTypeById` pilnuje, by mesh pasował do typu.
const planeTypeById = new Map<number, PlaneType>();
const meshTypeById = new Map<number, PlaneType>();
const presentIds = new Set<number>();
const remoteScratch: EntitySnapshot[] = [];
let remoteCount = 0;
let extrapolatingCount = 0;

// --- walka (faza 11): pociski są autorytatywne na serwerze; klient rysuje WYŁĄCZNIE
//     kosmetyczne smugacze z eventu MUZZLE (z pozy strzelca), a hit marker / kill feed
//     z eventów HIT / KILL. Żadnej hit-detekcji po stronie klienta. ---
// Kosmetyczne smugacze online wychodzą ze WSZYSTKICH luf strzelca (faza 19b: Bf 109 ma 2 grupy —
// nos + skrzydła), z balistyką grupy głównej (event MUZZLE niesie tylko sumę strzałów, nie podział
// na grupy → dokładny łuk MG FF to backlog). Lufy/balistyka dobierane per typ samolotu strzelca.
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
/** Ułamek amunicji własnego samolotu z ostatniego snapshotu (HUD) — ogień liczy serwer (faza 14). */
let localAmmoFrac = 1;
/** Ułamek amunicji grupy WTÓRNEJ (działko 20 mm Bf 109) z ostatniego snapshotu (protokół v5). */
let localAmmoSecondaryFrac = 1;

// --- wizualia walki (faza 14, parytet z SP) ---
const explosions = new Explosions(scene);
const smoke = new SmokeTrails(scene);
// błysk luf własnego samolotu — WSZYSTKIE lufy lokalnego typu (faza 19b); odbudowywany w setLocalPlane
let muzzleFlash = new MuzzleFlash(scene, allMuzzles(localPlane.armament));
const greyoutOverlay = new GreyoutOverlay();
const roster = new RosterOverlay();
// pasek kontroli strefy KotH (faza 17, parytet z SP) — fronty z autorytatywnych standings
const zoneBar = new ZoneBar(document.body);
// markery wrogów (DOM) — pula na maks. liczbę innych pilotów w pokoju
const markers = Array.from({ length: MAX_PLAYERS_PER_ROOM - 1 }, () => new EnemyMarker(document.body));
const hud = new Hud(hudEl, requireEl('stall-warning'), requireEl('horizon-disc'));
const horizonEl = requireEl('horizon');
const reticleEl = requireEl('reticle');
const noseMarkerEl = requireEl('nose-marker');
const alertEl = requireEl('arena-alert');

// ułamek HP / faza życia per encja (do dymu uszkodzeń); akumulator interwału dymu per encja
const healthFracById = new Map<number, number>();
const lifeById = new Map<number, LifePhase>();
const smokeAccumById = new Map<number, number>();
/**
 * Encje rozbite o LĄD — zwęglone wraki ZOSTAJĄ widoczne (zamrożone, lekko dymią) do końca meczu
 * (parytet z SP: Combatant.burningWreck). Uderzenie w wodę tu NIE trafia (mesh znika). Czyszczone
 * przy resecie meczu; pojedynczy respawn (gdyby kiedyś wrócił) przywraca materiały (render loop).
 */
const burningWreckIds = new Set<number>();
/**
 * Encje rozbite o WODĘ — wrak osiada na tafli, po chwili tonie i znika (życzenie usera 2026-06-23).
 * Mapuje id → czas [s] od uderzenia; pętla renderu opuszcza mesh pod wodę i po WATER_SINK_TOTAL_S
 * chowa go (usuwając wpis). Rozłączne z `burningWreckIds` (ląd zostaje, woda znika). Czyszczone
 * przy resecie meczu, respawnie i usunięciu encji ze snapshotu.
 */
const sinkingWrecks = new Map<number, number>();

// scratch (jeden wątek, sekwencyjnie)
const scratchSmokeDir = new Vector3();
const scratchSmokePos = new Vector3();
const scratchFwd = new Vector3();
const scratchUp = new Vector3();
const scratchRight = new Vector3();

function ensureMesh(id: number, type: PlaneType): PlaneModel {
  let m = meshes.get(id);
  if (m && meshTypeById.get(id) !== type) {
    // typ encji się zmienił (respawn innym samolotem — rzadkie) → przebuduj mesh na właściwy
    scene.remove(m.object);
    meshes.delete(id);
    m = undefined;
  }
  if (!m) {
    m = createPlaneMesh(type, wingspanM(planeConfigOf(type)));
    scene.add(m.object);
    meshes.set(id, m);
    meshTypeById.set(id, type);
    // ekran ładowania czeka na model tej encji; `gen` ucina liczenie, gdy mecz się zmienił,
    // zanim asynchroniczne wczytanie .glb zdążyło się domknąć (m.ready domyka się też po błędzie)
    const gen = modelGen;
    modelsTotal++;
    updateLoadingStatus();
    void m.ready.then(() => {
      if (gen !== modelGen) return;
      modelsReady++;
      updateLoadingStatus();
      maybeHideLoading();
    });
  }
  return m;
}

/** Aktualizuje tekst postępu na ekranie ładowania (liczba gotowych modeli / wszystkich). */
function updateLoadingStatus(): void {
  const statusEl = document.getElementById('loading-status');
  if (!statusEl) return;
  statusEl.textContent =
    modelsTotal === 0
      ? 'Wczytywanie świata…'
      : `Wczytywanie modeli samolotów: ${String(modelsReady)} / ${String(modelsTotal)}`;
}

/** Chowa ekran ładowania, gdy świat gotowy: jesteśmy w grze, predykcja ruszyła i wczytały się
 *  modele 3D wszystkich samolotów meczu (inaczej widać bryły zastępcze). Wykonuje się raz. */
function maybeHideLoading(): void {
  if (loadingHidden) return;
  if (phase !== 'playing' || !predictor.ready) return;
  if (modelsTotal === 0 || modelsReady < modelsTotal) return;
  document.getElementById('loading')?.classList.add('hidden');
  loadingHidden = true;
}

function clearMeshes(): void {
  for (const [, m] of meshes) scene.remove(m.object);
  meshes.clear();
  meshTypeById.clear();
  planeTypeById.clear();
  presentIds.clear();
  for (const id of [...entityAudioById.keys()]) disposeEntityAudio(id); // zatrzymaj silniki/broń starego meczu
  // zatrzymaj pozycyjne głosy broni stanowisk (jak głosy encji — wiszące źródła = wyciek)
  for (let i = 0; i < emplacementGuns.length; i++) {
    emplacementGuns[i]?.dispose();
    emplacementGuns[i] = null;
  }
  if (wind) {
    wind.dispose(); // świst opływu własnego samolotu — pętla nie kończy się sama (gra dalej poza meczem)
    wind = null; // render odtworzy leniwie (`wind ??=`) przy następnym meczu
  }
}

/** Świeży stan gry przy wejściu do meczu (nowy mecz / reconnect): zero starych encji. */
function resetGameState(): void {
  clearMeshes();
  // nowy mecz/reconnect: wyzeruj postęp ładowania modeli i unieważnij stare `.then` (modelGen)
  modelGen++;
  modelsReady = 0;
  modelsTotal = 0;
  // świeży lokalny samolot: domyślny typ do pierwszego snapshotu (odbuduje predyktor/błysk/amunicję);
  // własny typ ujawni się w 1. snapshocie i setLocalPlane przestawi go na właściwy (faza 19b)
  setLocalPlane(DEFAULT_PLANE_TYPE);
  interpolator = new SnapshotInterpolator();
  hasPrevLocal = false;
  chaseCamera.reset();
  // czysty stan walki: zgaś smugacze, wybuchy, dym; wyczyść feed/marker (nowy mecz / reconnect)
  for (const b of cosmeticPool.bullets) b.active = false;
  tracerCounter.clear();
  explosions.clear();
  smoke.clear();
  killFeed.length = 0;
  hitMarkerTimerS = 0;
  hitMarkerKill = false;
  localHealthFrac = 1;
  localAmmoFrac = 1;
  localAmmoSecondaryFrac = 1;
  healthFracById.clear();
  lifeById.clear();
  smokeAccumById.clear();
  burningWreckIds.clear(); // nowy mecz/reconnect — żadnych zwęglonych wraków z poprzedniego (meshe i tak czyszczone)
  sinkingWrecks.clear(); // jw. — żadnych tonących wraków z poprzedniego meczu
  // odbuduj stanowiska ogniowe na nowy mecz (zdejmij zwęglenie, wyzeruj dym) — serwer też je resetuje
  for (let i = 0; i < emplacementGroups.length; i++) {
    if (emplacementDestroyed[i]) restoreEmplacement(emplacementGroups[i]!);
    emplacementDestroyed[i] = false;
    emplacementSmokeAccum[i] = 0;
  }
  localDeathCause = null; // nowy mecz — zapomnij przyczynę śmierci z poprzedniego
  latestStandings = null;
  matchMode = 'ffa';
  factionById.clear();
  localFaction = 0;
  // stan śmierci/obserwatora/kamery do wartości startowych (nowy mecz / reconnect / poczekalnia)
  playerDeath = 'none';
  prevLocalLife = 'alive';
  downedFlyableWreck = true;
  spectatorTargetId = null;
  spectatedValid = false;
  cameraMode = 'pościgowa';
  // świeży mecz / wyjście: zamknij menu pauzy i wyczyść stan wycofania (nowy mecz wciąga z powrotem)
  pauseMenuOpen = false;
  pauseMenu.hide();
  withdrawnToWaiting = false;
  updateMouseAimEnabled();
  hideCombatOverlays();
}

/** Chowa nakładki walki (markery, roster, celownik, alert, szarzenie, horyzont) — poza meczem. */
function hideCombatOverlays(): void {
  for (const m of markers) m.hide();
  roster.hide();
  zoneBar.setVisible(false);
  greyoutOverlay.hide();
  downedOverlay.hide();
  reticleEl.style.display = 'none';
  noseMarkerEl.style.display = 'none';
  alertEl.style.opacity = '0';
  horizonEl.style.display = 'none';
}

function handleSnapshot(snap: Snapshot): void {
  if (phase !== 'playing' || !net) return;
  presentIds.clear();
  remoteScratch.length = 0;
  for (const e of snap.entities) {
    presentIds.add(e.id);
    planeTypeById.set(e.id, e.planeType); // typ z autorytetu serwera (mesh/HUD/smugacze)
    ensureMesh(e.id, e.planeType);
    healthFracById.set(e.id, e.healthFrac); // dym uszkodzeń (lokalny i obce) wg HP serwera
    if (e.isLocal) {
      // własny typ ujawnia się tu (FFA: wybór gracza; drużynowy: wg strony) — przestaw lokalny
      // samolot PRZED reconcile, by predykcja od pierwszego kroku liczyła właściwą kopertą osiągów.
      if (e.planeType !== localPlaneType) setLocalPlane(e.planeType);
      predictor.reconcile(e, snap.ackSeq);
      localHealthFrac = e.healthFrac;
      localAmmoFrac = e.ammoFrac;
      localAmmoSecondaryFrac = e.ammoSecondaryFrac;
    } else {
      remoteScratch.push(e);
    }
  }
  interpolator.ingest(snap.serverTick, remoteScratch);
  for (const [id, m] of meshes) {
    if (presentIds.has(id)) continue;
    scene.remove(m.object);
    meshes.delete(id);
    meshTypeById.delete(id);
    planeTypeById.delete(id);
    healthFracById.delete(id);
    lifeById.delete(id);
    smokeAccumById.delete(id);
    burningWreckIds.delete(id);
    sinkingWrecks.delete(id);
    disposeEntityAudio(id); // encja zniknęła z meczu → zatrzymaj jej silnik/broń (cleanup źródeł)
  }
}

/**
 * Przestawia lokalny samolot na nowy typ (faza 19b): świeży predyktor (kolejny reconcile ustawi
 * autorytet), zaktualizowany zapas amunicji do HUD i błysk luf z luf nowego typu. Wołane z
 * handleSnapshot, gdy własna encja zmienia typ (start meczu / zmiana wyboru).
 */
function setLocalPlane(type: PlaneType): void {
  localPlaneType = type;
  localPlane = planeConfigOf(type);
  localAmmoMax = totalAmmo(localPlane.armament);
  localSecondaryMax = secondaryAmmoMaxOf(localPlane);
  predictor = new Predictor(localPlane, terrain);
  muzzleFlash.dispose();
  muzzleFlash = new MuzzleFlash(scene, allMuzzles(localPlane.armament));
}

// --- zdarzenia walki (faza 11): MUZZLE → smugacze, HIT → marker, KILL → feed/marker ---
function handleEvents(events: GameEvent[]): void {
  if (phase !== 'playing') return;
  const localId = net?.localPlayerId ?? null;
  for (const ev of events) {
    if (ev.kind === 'muzzle') {
      spawnCosmeticVolley(ev.ownerId, ev.seed, ev.shots);
      if (ev.ownerId === localId) muzzleFlash.flash(); // błysk luf tylko dla własnego samolotu (jak SP)
      entityAudioById.get(ev.ownerId)?.gun.note(); // grzechot broni (per typ; Bf 109 dokłada działko)
    } else if (ev.kind === 'hit') {
      // hit marker dopiero z potwierdzenia serwera (uczciwość > responsywność) — gdy to JA trafiłem
      if (ev.shooterId === localId && !hitMarkerKill) hitMarkerTimerS = HIT_MARKER_S;
      // dźwięk: oberwałem → metaliczny łomot w kadłub; trafiłem wroga → cichy „ding" potwierdzenia
      if (ev.victimId === localId) audio.play('hit-metal', 0.85);
      else if (ev.shooterId === localId) audio.hitConfirm();
    } else if (ev.kind === 'kill') {
      onKill(ev.killerId, ev.victimId, ev.cause, localId);
    } else if (ev.kind === 'aaFire') {
      spawnAaCosmeticVolley(ev.index, ev.seed, ev.shots, ev.dir);
      noteAaGun(ev.index); // pozycyjny grzechot serii MG ze stanowiska
    } else if (ev.kind === 'aaDestroyed') {
      setEmplacementDestroyed(ev.index, true);
      if (ev.killerId === localId) pushKillFeed(`✕ stanowisko ogniowe  +${String(EMPLACEMENT_POINTS)}`);
    }
  }
}

/**
 * Kosmetyczne tracery salwy stanowiska naziemnego (AA). Pociski autorytatywne liczy serwer; te tu
 * tylko świecą (damage 0) i gasną po czasie życia — żeby pilot WIDZIAŁ ogień z ziemi i mógł unikać.
 * Odtwarzane z pozy WYLOTU stanowiska (stała) + bazowy kierunek z eventu + rozrzut z seeda (jak MUZZLE).
 */
function spawnAaCosmeticVolley(index: number, seed: number, shots: number, dir: Vector3): void {
  const muzzle = emplacementMuzzles[index];
  if (!muzzle) return;
  const rng = createRng(seed);
  const dispersionRad = EMPLACEMENT_DISPERSION_MRAD * MRAD_TO_RAD;
  const key = AA_TRACER_KEY_BASE + index;
  let counter = tracerCounter.get(key) ?? 0;
  for (let i = 0; i < shots; i++) {
    cosmDir.copy(dir);
    applyDispersion(cosmDir, dispersionRad, rng);
    cosmVel.copy(cosmDir).multiplyScalar(AA_BALLISTICS.muzzleVelocityMs);
    const tracer = counter % 3 === 0;
    counter++;
    cosmeticPool.spawn(muzzle, cosmVel, 0, key, tracer, AA_BALLISTICS.bulletDragK, AA_BALLISTICS.bulletLifetimeS);
  }
  tracerCounter.set(key, counter);
}

/** Pozycyjny grzechot serii MG ze stanowiska (ten sam sampel co Spitfire); pętla tworzona leniwie. */
function noteAaGun(index: number): void {
  if (!audio.ready) return;
  const group = emplacementGroups[index];
  if (!group) return;
  let g = emplacementGuns[index];
  if (!g) {
    g = audio.createGun('spitfire', false, group); // .303, pozycyjny (host = mesh stanowiska)
    emplacementGuns[index] = g;
  }
  g.note();
}

/** Ustawia stan zniszczenia stanowiska: zwęglenie + cisza broni (zniszczone) lub odbudowa. Idempotentne. */
function setEmplacementDestroyed(index: number, destroyed: boolean): void {
  const group = emplacementGroups[index];
  if (!group || emplacementDestroyed[index] === destroyed) return;
  emplacementDestroyed[index] = destroyed;
  if (destroyed) {
    charEmplacement(group);
    emplacementGuns[index]?.dispose();
    emplacementGuns[index] = null;
  } else {
    restoreEmplacement(group);
    emplacementSmokeAccum[index] = 0;
  }
}

/** Pętla renderu: decay/pozycja głosów broni stanowisk + lekki dym zniszczonych (GROUND_FIRE_TIER). */
function updateEmplacements(frameDtS: number): void {
  for (let i = 0; i < emplacementGroups.length; i++) {
    emplacementGuns[i]?.update(frameDtS, emplacementMuzzles[i]!);
    if (!emplacementDestroyed[i]) continue;
    let acc = (emplacementSmokeAccum[i] ?? 0) + frameDtS;
    while (acc >= GROUND_FIRE_TIER.intervalS) {
      acc -= GROUND_FIRE_TIER.intervalS;
      scratchEmplacementSmoke.copy(emplacementGroups[i]!.position).y += 1.0; // dym znad szczątków
      smoke.emit(scratchEmplacementSmoke, GROUND_FIRE_TIER.profile);
    }
    emplacementSmokeAccum[i] = acc;
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
  // lufy i balistyka wg TYPU strzelca (faza 19b): smugacze z wszystkich luf, łuk grupy głównej
  const cfg = planeConfigOf(planeTypeById.get(ownerId) ?? DEFAULT_PLANE_TYPE);
  const arm = primaryGroup(cfg.armament);
  const muz = allMuzzles(cfg.armament);
  const rng = createRng(seed);
  const dispersionRad = arm.dispersionMrad * MRAD_TO_RAD;
  let counter = tracerCounter.get(ownerId) ?? 0;
  const pos = mesh.object.position;
  const quat = mesh.object.quaternion;
  for (let i = 0; i < shots; i++) {
    const m = muz[i % muz.length]!;
    cosmMuzzle.set(m[0], m[1], m[2]);
    aimDirectionBody(cosmMuzzle, arm.convergenceM, arm.convergenceRiseM, cosmDir);
    applyDispersion(cosmDir, dispersionRad, rng);
    cosmDir.applyQuaternion(quat);
    cosmMuzzle.applyQuaternion(quat).add(pos);
    cosmVel.copy(cosmDir).multiplyScalar(arm.muzzleVelocityMs);
    const tracer = counter % 3 === 0;
    counter++;
    cosmeticPool.spawn(cosmMuzzle, cosmVel, 0, ownerId, tracer, arm.bulletDragK, arm.bulletLifetimeS);
  }
  tracerCounter.set(ownerId, counter);
}

function onKill(killerId: number, victimId: number, cause: KillCause, localId: number | null): void {
  const victim = playerName(victimId);
  // przyczyna WŁASNEJ śmierci → komunikat (ZESTRZELONY/KOLIZJA/ROZBITY) w nakładce wraku i alercie
  if (victimId === localId) localDeathCause = cause;
  if (cause === 'air') {
    // teamkill (friendly fire ON w drużynowym) — serwer NIE kredytuje, więc oznaczamy w feedzie
    // „(sojusznik!)" i NIE pokazujemy złotego markera zestrzelenia (parytet z SP).
    const teamkill = matchMode === 'team' && factionById.get(killerId) === factionById.get(victimId);
    pushKillFeed(`✕ ${playerName(killerId)} → ${victim}${teamkill ? ' (sojusznik!)' : ''}`);
    if (killerId === localId && !teamkill) {
      hitMarkerTimerS = HIT_MARKER_KILL_S;
      hitMarkerKill = true;
    }
  } else {
    const reason = cause === 'collision' ? 'kolizja' : cause === 'flak' ? 'ostrzał z ziemi' : 'rozbicie';
    pushKillFeed(`✕ ${victim} — ${reason}`);
  }
  // efekt śmierci (parytet z SP, faza 15/16): zestrzelenie w locie / kolizja → ofiara staje się
  // spadającym wrakiem ('dying'), więc TERAZ tylko mały błysk; UDERZENIE w powierzchnię (plusk wody
  // / wybuch + zwęglony wrak na lądzie) obsługuje pętla renderu (handleSurfaceImpact) po przejściu
  // →'dead'. Rozbicie o teren ('ground') idzie od razu alive→dead, więc całość efektu robi tamta
  // ścieżka — tutaj BEZ błysku, by nie dublować.
  const victimMesh = meshes.get(victimId);
  if (victimMesh && cause !== 'ground') {
    explosions.spawn(victimMesh.object.position, AIR_KILL_FLASH_SCALE);
  }
}

/**
 * Uderzenie encji (lub spadającego wraku) w powierzchnię — wołane po przejściu w 'dead' (parytet z
 * SP: applySurfaceImpact). Woda → jasny plusk, wrak osiada na tafli i po chwili tonie/znika
 * (sinkingWrecks, życzenie usera 2026-06-23); ląd (wyspa) → ognisty wybuch i ZWĘGLONY wrak ZOSTAJE
 * na ziemi, lekko dymiąc do końca meczu. O wodzie/lądzie decyduje wysokość terenu (ten sam seed co
 * serwer) w punkcie uderzenia — bez zmiany protokołu.
 */
function handleSurfaceImpact(id: number, m: PlaneModel): void {
  const p = m.object.position;
  if (terrain.heightAt(p.x, p.z) > SEA_LEVEL_M) {
    explosions.spawn(p, 1); // krótki ognisty wybuch przy zderzeniu
    audio.playAt('explosion', p, 1); // huk rozbicia (pozycyjny — tłumiony odległością)
    charPlaneMesh(m.object); // zwęglone materiały
    burningWreckIds.add(id); // render trzyma mesh widoczny; pętla dymu emituje GROUND_FIRE_TIER
    m.object.visible = true;
  } else {
    explosions.splash(p); // plusk wody
    audio.playAt('explosion', p, 0.45, 1.35); // głuchy, wyższy plusk (brak osobnego sampla wody)
    sinkingWrecks.set(id, 0); // wrak zostaje chwilę widoczny, potem tonie i znika (pętla renderu)
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

/**
 * Komunikat śmierci LOKALNEGO gracza wg przyczyny z eventu KILL (życzenie usera 2026-06-23:
 * „ZESTRZELONY" tylko, gdy padł od ognia). Zderzenie z samolotem → KOLIZJA, rozbicie o teren/wodę
 * → ROZBITY. Domyślnie (przyczyna nieznana, np. świeże zestrzelenie zanim dotrze event) → ZESTRZELONY.
 */
function deathLabel(cause: KillCause | null): string {
  if (cause === 'collision') return 'KOLIZJA';
  if (cause === 'ground') return 'ROZBITY';
  return 'ZESTRZELONY';
}

// --- lobby UI + sieć ---
const lobby = new LobbyUI({
  // „Załóż własną grę": pokój domyślnie DRUŻYNOWY (życzenie usera 2026-06-22) — host i tak może
  // zmienić tryb/boty/poziom/samolot w poczekalni (jeden prosty ekran wejściowy)
  onCreateRoom: () => withConnection((c) => c.createRoom(0, undefined, 'team')),
  onJoinRoom: (code) => withConnection((c) => c.joinRoom(code)),
  onStartMatch: () => net?.startMatch(),
  onLeaveRoom: () => {
    net?.leaveRoom();
    enterLobby();
  },
  onSelectPlane: (plane) => net?.selectPlane(plane), // faza 19b: wybór samolotu w poczekalni
  onSelectTeam: (team) => net?.selectTeam(team), // wybór drużyny (rozdzielenie drużyna↔samolot 2026-06-25)
  onSetReady: (ready) => net?.setReady(ready), // gotowość do startu (system „Gotów" 2026-06-26)
  onUpdateRoom: (opts) => net?.updateRoom(opts), // host: zmiana trybu/botów/poziomu w poczekalni
  onAddBot: (team, difficulty) => net?.addBot(team ?? undefined, difficulty), // host: dodaj bota do slotu (lobby RTS)
  onRemoveBot: (botId) => net?.removeBot(botId), // host: usuń bota ze slotu
  onEditBot: (botId, opts) => net?.editBot(botId, opts), // host: przenieś bota / zmień jego poziom
  onSendChat: (text) => net?.sendChat(text), // czat poczekalni
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

// --- tryb meczu + frakcje (faza 18 cz.2): serwer NIE niesie frakcji w snapshocie binarnym
//     (bez bumpu protokołu), więc czytamy je z tabeli wyników (standings, JSON 2 Hz). Kolory
//     markerów/rostera, kill-feed teamkill, status strefy i zakres obserwatora zależą od trybu. ---
let matchMode: MatchMode = 'ffa';
/** Frakcja per id z ostatnich standings (FFA: frakcja = id; drużynowy: 0/1). */
const factionById = new Map<number, number>();
/** Frakcja własnego samolotu (z wiersza standings o własnym id). FFA: = własne id. */
let localFaction = 0;

/** Przebudowuje mapę frakcji i własną frakcję z wierszy tabeli wyników (każdy broadcast). */
function rebuildFactions(rows: readonly StandingRow[]): void {
  factionById.clear();
  const localId = net?.localPlayerId ?? null;
  localFaction = 0;
  for (const r of rows) {
    factionById.set(r.id, r.faction);
    if (r.id === localId) localFaction = r.faction;
  }
}

/** Czy gracz ma w tym meczu sojuszników (slot tej samej frakcji) — tylko tryb drużynowy. */
function playerHasTeammates(): boolean {
  if (matchMode !== 'team') return false;
  const localId = net?.localPlayerId ?? null;
  for (const [id, fac] of factionById) {
    if (id !== localId && fac === localFaction) return true;
  }
  return false;
}

// --- warstwa śmierci gracza (faza 16): nakładka decyzji + tryb obserwatora ---
const downedOverlay = new DownedOverlay(
  () => choosePlayerSpectate(), // tryb obserwatora (gdy jest kogo oglądać)
  () => scoreboard.toggle(), // tabela wyników (poza tym też na Tab)
  () => endMissionContextual(), // „zakończ misję" = koniec meczu (same boty) lub powrót do poczekalni (są ludzie)
);

// menu pauzy (Esc): te same akcje kontekstowe co DownedOverlay, dostępne w dowolnym momencie meczu
const pauseMenu = new PauseMenu(
  () => togglePauseMenu(), // „wróć do gry" — menu jest otwarte, więc toggle je zamyka
  () => endMissionContextual(),
);
// suwak głośności + wycisz w menu pauzy (faza 21); klawisz M przełącza mute w dowolnym momencie
pauseMenu.mount(audio.createSettingsPanel());
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyM' && !isEditingText()) audio.toggleMute();
});

/** Wejście w stan śmierci gracza. `flyableWreck` = true dla zestrzelenia/kolizji (steruje spadającym
 *  wrakiem, lokalna predykcja 'dying'); false dla rozbicia prosto w ziemię (alive→dead, brak wraku do
 *  sterowania). W obu wypadkach pokazujemy nakładkę z trybem obserwatora i zakończeniem misji. */
function enterPlayerWreck(flyableWreck: boolean): void {
  playerDeath = 'wreck';
  downedFlyableWreck = flyableWreck;
  spectatorTargetId = null;
  updateMouseAimEnabled(); // kursor wolny do nakładki, ster (wrak) z klawiatury
}

/** Respawn gracza (serwer dał 'alive' po cyklu wraku): powrót do normalnej gry. */
function onLocalRespawn(): void {
  playerDeath = 'none';
  spectatorTargetId = null;
  localDeathCause = null; // świeże życie — zapomnij przyczynę poprzedniej śmierci
  downedOverlay.hide();
  updateMouseAimEnabled();
}

/** Gracz (wrak / po rozbiciu) wybiera tryb obserwatora — ogląda pozostałych przy życiu. */
function choosePlayerSpectate(): void {
  if (playerDeath !== 'wreck') return;
  playerDeath = 'spectating';
  spectatorTargetId = firstSpectatable();
  downedOverlay.hide();
}

function isSpectating(): boolean {
  return phase === 'playing' && playerDeath === 'spectating';
}

/**
 * Czy encję można obserwować: obca (nie własna) i żywa. W trybie drużynowym z sojusznikami
 * zakres zawęża się do żywych SOJUSZNIKÓW (ta sama frakcja) — parytet z SP (isSpectatable).
 */
function isSpectatable(id: number): boolean {
  const localId = net?.localPlayerId ?? null;
  if (id === localId || !meshes.has(id) || lifeById.get(id) !== 'alive') return false;
  return playerHasTeammates() ? factionById.get(id) === localFaction : true;
}

function firstSpectatable(): number | null {
  for (const [id] of meshes) if (isSpectatable(id)) return id;
  return null;
}

function spectatableCount(): number {
  let n = 0;
  for (const [id] of meshes) if (isSpectatable(id)) n++;
  return n;
}

function canSpectate(): boolean {
  return spectatableCount() > 0;
}

/** Obecnie obserwowany id (wybrany, póki żywy; inaczej pierwszy obserwowalny — fallback). */
function currentSpectateId(): number | null {
  if (spectatorTargetId !== null && isSpectatable(spectatorTargetId)) return spectatorTargetId;
  spectatorTargetId = firstSpectatable();
  return spectatorTargetId;
}

/** Przełącza oglądany samolot na następny obserwowalny (cyklicznie, stała kolejność wg id). */
function cycleSpectatorTarget(dir: 1 | -1): void {
  if (!isSpectating()) return;
  const ids: number[] = [];
  for (const [id] of meshes) if (isSpectatable(id)) ids.push(id);
  if (ids.length === 0) {
    spectatorTargetId = null;
    return;
  }
  ids.sort((a, b) => a - b);
  const cur = spectatorTargetId === null ? -1 : ids.indexOf(spectatorTargetId);
  const next = ((cur < 0 ? (dir === 1 ? 0 : ids.length - 1) : cur + dir) + ids.length) % ids.length;
  spectatorTargetId = ids[next] ?? null;
}

/** Maszyna stanu śmierci gracza (co klatkę): wykrywa zestrzelenie i respawn po lokalnym życiu. */
function updateDeathState(): void {
  if (!predictor.ready) return;
  const life = predictor.sim.state.life;
  // alive→dying: zestrzelenie/kolizja → sterowalny spadający wrak. alive→dead (z pominięciem 'dying'):
  // rozbicie prosto o teren/wodę → brak wraku do sterowania, ale wciąż dajemy obserwatora/zakończenie
  // (bez tej gałęzi gracz po rozbiciu zostawał „uwięziony" na ekranie ROZBITY — życzenie usera 2026-06-23).
  if (prevLocalLife === 'alive' && life === 'dying') enterPlayerWreck(true);
  else if (prevLocalLife === 'alive' && life === 'dead') enterPlayerWreck(false);
  else if (life === 'alive' && prevLocalLife !== 'alive') onLocalRespawn();
  prevLocalLife = life;
}

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
    // świeże połączenie (nie reconnect) → zapisz token i pokaż lobby. Podczas wznawiania sesji NIE
    // nadpisujemy zapisanego tokenu: udany resume zwraca ten sam token (więc zapis zbędny), a gdyby
    // serwer wyjątkowo zepchnął nas do lobby ze ŚWIEŻYM tokenem, zapisanie go „zatrułoby" kolejne
    // próby (token lobby nie wskazuje już slotu w pokoju) → pętla wznawiania.
    if (!attemptingResume) {
      saveToken(msg.sessionToken);
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
  c.onChat = (msg) => lobby.appendChat(msg); // czat poczekalni (historia + broadcast)
  c.onRoomUpdate = (msg) => {
    if (!roomView) return;
    roomView = {
      ...roomView,
      state: msg.state,
      mode: msg.mode,
      difficulty: msg.difficulty,
      botCount: countBots(msg.players),
      players: msg.players,
      hostId: msg.hostId,
    };
    if (msg.state === 'playing') {
      // wycofany gracz CZEKA w poczekalni mimo trwającego meczu (np. inny gracz się rozłączył →
      // roomUpdate 'playing'); NIE wciągaj go z powrotem do gry — odśwież tylko poczekalnię.
      if (withdrawnToWaiting && phase === 'lobby') lobby.updateWaiting(roomView);
      else if (phase !== 'playing') enterPlaying();
    } else if (msg.state === 'waiting') {
      // bieżący mecz się skończył (też dla wycofanego) → znów normalny uczestnik poczekalni
      withdrawnToWaiting = false;
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
    matchMode = msg.mode;
    rebuildFactions(msg.rows);
    scoreboard.update(msg.rows, msg.mode, localFaction);
    // synchronizacja stanu stanowisk (v6) — dla późno dołączających i na wypadek zgubionego eventu
    for (let i = 0; i < msg.aaDestroyed.length; i++) setEmplacementDestroyed(i, msg.aaDestroyed[i] ?? false);
  };
  c.onMatchEnded = (msg) => onMatchEnded(msg);
  c.onServerShutdown = () => {
    // serwer się zamyka — auto-reconnect nie ma do czego wracać; pokaż komunikat (nie banner wznawiania)
    serverWentAway = true;
    stopAutoReconnect();
    // status 'error' (ustawiony w NetClient) wyświetli komunikat zamiast spinnera;
    // chowamy nakładki meczu, żeby nie zasłaniały
    scoreboard.hide();
    results.hide();
  };
  c.onLobbyError = (_code, message) => lobby.setError(message);
  c.onClose = () => handleUnexpectedClose(); // niezamierzone zerwanie → spróbuj wznowić w trakcie meczu
  return c;
}

// --- auto-reconnect: po niezamierzonym zerwaniu w trakcie meczu wznawiamy sesję tokenem BEZ
// przeładowania strony (świat/modele zostają w pamięci). Serwer trzyma slot (okno 60 s) i leci
// samolotem w auto-stabilizacji, więc gracz wraca do TEJ SAMEJ maszyny. Ponawiamy przez
// AUTO_RECONNECT_WINDOW_MS; potem zostaje nakładka ręczna („Połącz ponownie" = reload). ---

/** Wywoływane przez NetClient przy niezamierzonym `close`. Startuje auto-ponawianie tylko w trakcie
 *  meczu (poczekalnia/lobby → istniejąca nakładka ręczna). Próby reconnectu, które padają, NIE
 *  retriggerują tego — pętlę napędza watchdog (reconnectTimer). */
function handleUnexpectedClose(): void {
  if (serverWentAway) return; // serwer zgłosił zamknięcie — nie ma do czego wracać
  if (reconnecting) return; // próba w toku — watchdog ponowi
  if (phase !== 'playing') return; // auto-powrót tylko z trwającego meczu
  if (!loadToken()) return; // bez tokenu reconnect i tak nie zadziała → nakładka ręczna
  startAutoReconnect();
}

function startAutoReconnect(): void {
  if (reconnecting) return;
  reconnecting = true;
  reconnectDeadlineMs = performance.now() + AUTO_RECONNECT_WINDOW_MS;
  tryReconnectOnce();
}

function tryReconnectOnce(): void {
  clearReconnectTimer();
  if (!reconnecting) return;
  if (performance.now() >= reconnectDeadlineMs) {
    // wyczerpane okno: zostaw ostatnią (nieudaną) próbę domkniętą → updateConnOverlay pokaże „Rozłączono"
    reconnecting = false;
    attemptingResume = false;
    if (net && net.status !== 'connected') net.close();
    return;
  }
  attemptingResume = true; // onWelcome nie wciągnie do lobby; czekamy na roomJoined ze slotem
  if (net) net.close(); // zamknij poprzednią próbę (deliberate → bez onClose) przed nową
  net = createNet(connectedNick, loadToken());
  reconnectTimer = setTimeout(tryReconnectOnce, RECONNECT_RETRY_MS);
}

/** Sukces wznowienia — wołane z onRoomJoined, gdy wróciliśmy do pokoju w trakcie auto-reconnectu. */
function finishAutoReconnect(): void {
  reconnecting = false;
  clearReconnectTimer();
}

/** Przerywa auto-ponawianie (serwer odpadł / sprzątanie) bez zamykania bieżącego połączenia. */
function stopAutoReconnect(): void {
  reconnecting = false;
  clearReconnectTimer();
}

function clearReconnectTimer(): void {
  if (reconnectTimer !== null) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function onMatchEnded(msg: MatchEndedMessage): void {
  if (!roomView) return;
  // wycofany do poczekalni gracz (phase 'lobby') NIE dostaje ekranu wyników — jest już w poczekalni
  // i nie przerywamy mu tego widoku; po powrocie pokoju do 'waiting' wróci normalnym uczestnikiem.
  if (phase !== 'playing') return;
  pauseMenuOpen = false;
  pauseMenu.hide(); // gdyby gracz trzymał otwarte menu pauzy w chwili naturalnego końca meczu
  scoreboard.hide();
  matchResultsShown = true;
  const isHost = roomView.youId === roomView.hostId;
  const localId = net?.localPlayerId ?? null;
  // własna frakcja z finalnej tabeli (robustnie — gdyby standings nie dotarły tuż przed końcem)
  const localFac = msg.rows.find((r) => r.id === localId)?.faction ?? localFaction;
  results.show(msg, localId, localFac, isHost);
}

function onRoomJoined(msg: RoomJoinedMessage): void {
  roomView = {
    code: msg.code,
    state: msg.state,
    mode: msg.mode, // render poczekalni: drużynowy pokazuje selektor drużyny (samolot wybierany niezależnie)
    difficulty: msg.difficulty,
    botCount: countBots(msg.players),
    players: msg.players,
    hostId: msg.hostId,
    youId: msg.youId,
  };
  scoreboard.setLocalId(msg.youId);
  lobby.clearChat(); // świeży pokój — czyść log PRZED historią z serwera (przychodzi tuż po roomJoined)
  const wasReconnecting = reconnecting;
  if (wasReconnecting) finishAutoReconnect(); // wróciliśmy do swojego slotu — koniec ponawiania
  if (msg.state === 'playing') {
    // wznowienie w trakcie meczu: phase jest już 'playing' (nigdy nie wyszliśmy), więc enterPlaying
    // miałby early-return. Wymuś pełne wejście (świeży predyktor/interpolator/meshe), by stan po
    // przerwie zsynchronizował się od zera — modele są w cache, ekran ładowania mignie krótko.
    if (wasReconnecting) phase = 'lobby';
    enterPlaying();
  } else {
    enterWaiting(roomView);
  }
}

/** Liczba botów w roster (do selektora hosta + podsumowania w poczekalni). */
function countBots(players: readonly RoomPlayer[]): number {
  let n = 0;
  for (const p of players) if (p.isBot) n++;
  return n;
}

// Odświeżanie listy pokoi na ekranie wejściowym: serwer nie pushuje listy, więc odpytujemy ją
// cyklicznie, żeby auto-wykryta otwarta gra (ekran wejściowy) nadążała za zakładaniem/zamykaniem
// pokoi. Polling żyje TYLKO na ekranie wejściowym (nie w poczekalni / grze).
const ROOM_POLL_INTERVAL_MS = 3000;
let roomPollTimer: ReturnType<typeof setInterval> | null = null;
function startRoomPolling(): void {
  if (roomPollTimer !== null) return;
  net?.requestRoomList();
  roomPollTimer = setInterval(() => {
    if (phase === 'lobby' && !roomView) net?.requestRoomList();
    else stopRoomPolling();
  }, ROOM_POLL_INTERVAL_MS);
}
function stopRoomPolling(): void {
  if (roomPollTimer === null) return;
  clearInterval(roomPollTimer);
  roomPollTimer = null;
}

function enterLobby(): void {
  phase = 'lobby';
  roomView = null;
  matchResultsShown = false;
  resetGameState();
  scoreboard.hide();
  results.hide();
  lobby.showEntry();
  startRoomPolling(); // auto-wykryta otwarta gra na ekranie wejściowym
  document.getElementById('loading')?.classList.add('hidden');
}

function enterWaiting(view: WaitingView): void {
  phase = 'lobby';
  matchResultsShown = false;
  stopRoomPolling(); // jesteśmy już w pokoju — przestań odpytywać listę otwartych gier
  // z meczu do poczekalni („zakończ misję"/wycofanie): usuń encje i ZATRZYMAJ ich silniki/świst — inaczej
  // pętle audio grają dalej w poczekalni (render bramkuje audio przez phase==='playing', ale pętle żyją same).
  // NIE wołamy pełnego resetGameState (zeruje withdrawnToWaiting, ustawiane przed enterWaiting w wycofaniu).
  clearMeshes();
  scoreboard.hide();
  results.hide();
  hideCombatOverlays(); // z meczu do poczekalni: zgaś markery/roster/horyzont/alert (render staje)
  lobby.showWaiting(view);
  document.getElementById('loading')?.classList.add('hidden');
}

function enterPlaying(): void {
  if (phase === 'playing') return;
  phase = 'playing';
  matchResultsShown = false;
  serverWentAway = false; // świeże wejście do meczu — pozwól na auto-reconnect przy ewentualnym zerwaniu
  stopRoomPolling();
  // Parytet z SP (P5.1): spawnCombatant resetuje gaz do 0.8 przy każdym wejściu do gry —
  // bez tego rewanż dziedziczyłby ostatni gaz gracza zamiast startować na połowie mocy.
  keyboard.throttle = 0.8;
  resetGameState();
  scoreboard.hide();
  results.hide();
  lobby.hide();
  // pokaż ekran ładowania na czas pobierania modeli 3D (znika w maybeHideLoading, gdy wszystkie gotowe)
  loadingHidden = false;
  document.getElementById('loading')?.classList.remove('hidden');
  updateLoadingStatus();
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
// Pełny HUD-G jak w SP (faza 14): dane lotu z lokalnej predykcji (Predictor.sim — bez zmiany
// protokołu), amunicja ze snapshotu. Sztuczny horyzont + ostrzeżenia stall/buffet/szarzenie
// renderuje klasa Hud; tu tylko zbieramy pola. Greyout (G-LOC) tylko gdy żyjemy.
function updateHud(): void {
  if (!predictor.ready) return; // przed pierwszym snapshotem — ekran ładowania
  const s = predictor.sim.state;
  const gLoad = predictor.sim.gLoadEffects;
  const stall = predictor.sim.stallEffects;
  const tasMs = s.velocity.length();
  const qPa = dynamicPressurePa(airDensityKgM3(s.position.y), tasMs);
  const localAlive = s.life === 'alive';

  horizonEl.style.display = 'block';
  getUp(s.orientation, scratchUp);
  getRight(s.orientation, scratchRight);
  getForward(s.orientation, scratchFwd);

  hud.update({
    iasKmh: s.iasMs * MS_TO_KMH,
    tasKmh: tasMs * MS_TO_KMH,
    altM: s.position.y,
    throttle01: s.throttle,
    nG: s.loadFactor,
    nAvailG: nAvailG(qPa, localPlane),
    gLimitG: gLoad.gLimitG,
    blackoutFactor: localAlive ? gLoad.blackoutFactor : 0,
    stallPhase: stall.phase,
    // buffet/blackout tylko z perspektywy własnego samolotu (parytet z SP: viewC !== player → 0).
    // Przy obserwacji cudzego predictor.sim to nasz wrak — zeruj, by HUD nie migał resztkami.
    buffetIntensity: isSpectating() ? 0 : stall.buffetIntensity,
    bankRad: Math.atan2(-scratchRight.y, scratchUp.y),
    pitchRad: Math.asin(Math.min(1, Math.max(-1, scratchFwd.y))),
    controlMode: mouseAim.locked ? 'mysz' : 'klawiatura',
    // ostrzeżenie „pusty bak" tylko w locie — wrak/obserwator nie ma silnika do zgaszenia
    fuel01: localAlive ? s.fuelFrac : 1,
    ammo: Math.round(localAmmoFrac * localAmmoMax),
    ammoMax: localAmmoMax,
    // osobny licznik działka 20 mm — tylko dla samolotów z grupą wtórną (Bf 109); HUD domyśla się „20 mm"
    secondaryAmmo: localSecondaryMax > 0 ? Math.round(localAmmoSecondaryFrac * localSecondaryMax) : undefined,
    secondaryAmmoMax: localSecondaryMax > 0 ? localSecondaryMax : undefined,
    extraLines: hudExtraLines(),
  });
}

/** Wiersze dodatkowe HUD online: HP, ping, FPS.
 *  Kod pokoju celowo NIEpokazywany w HUD (życzenie usera) — widnieje w poczekalni.
 *  Licznik zestrzeleń też NIEpokazywany — widnieje już przy nicku gracza w liście
 *  uczestników (lewy górny róg, `RosterOverlay`); redundancja usunięta na życzenie usera. */
function hudExtraLines(): string[] {
  const lines: string[] = [''];
  // klawiszologia żyje w ekranie „Jak grać" (lobby); status celowania pokazuje już wiersz „ster"
  lines.push(
    hudRow('HP', (localHealthFrac * 100).toFixed(0), '%'),
    hudRow('ping', String(displayedPingMs), 'ms'),
    fpsHudLine(fpsValue),
  );
  return lines;
}

function updateConnOverlay(): void {
  if (reconnecting) {
    // auto-powrót do meczu w toku: banner z odliczaniem zamiast twardej nakładki „Rozłączono"
    const leftS = Math.max(0, Math.ceil((reconnectDeadlineMs - performance.now()) / 1000));
    connEl.classList.add('show');
    connEl.innerHTML = `<div class="head">Wznawianie połączenia…</div><div class="msg">powrót do gry (${String(leftS)} s)</div>`;
    return;
  }
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
  cosmeticPool.update(frameDtS); // balistyka per pocisk (dragK/lifetime z grupy przy spawnie)
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

// --- render wizualiów świata (faza 14): wybuchy, dym uszkodzeń, błysk luf własnego samolotu ---
function updateWorldVisuals(frameDtS: number): void {
  explosions.update(frameDtS);

  // dym: spadający wrak ('dying') ciągnie gęstą czarną smugę (WRECK_TIER); żywa, trafiona
  // maszyna dymi tym mocniej/ciemniej, im mniej HP (próg w damageSmokeTier). healthFrac jest
  // ułamkiem 0..1, więc maxHp = 1. Punkt emisji cofnięty ZA ogon (mesh już zinterpolowany).
  for (const [id, m] of meshes) {
    const life = lifeById.get(id);
    let tier: SmokeTier | null = null;
    if (life === 'dying') tier = WRECK_TIER;
    else if (life === 'alive') tier = damageSmokeTier(healthFracById.get(id) ?? 1, 1);
    else if (burningWreckIds.has(id)) tier = GROUND_FIRE_TIER; // zwęglony wrak na lądzie — lekki, stały dym
    if (tier === null) {
      smokeAccumById.set(id, 0); // nieuszkodzony — nie kumuluj długu do kolejnego trafienia
      continue;
    }
    let acc = (smokeAccumById.get(id) ?? 0) + frameDtS;
    if (acc < tier.intervalS) {
      smokeAccumById.set(id, acc);
      continue;
    }
    getForward(m.object.quaternion, scratchSmokeDir).multiplyScalar(-SMOKE_BACK_OFFSET_M);
    scratchSmokePos.copy(m.object.position).add(scratchSmokeDir);
    while (acc >= tier.intervalS) {
      acc -= tier.intervalS;
      smoke.emit(scratchSmokePos, tier.profile);
    }
    smokeAccumById.set(id, acc);
  }
  smoke.update(frameDtS);

  // błysk luf tylko dla własnego samolotu (jak SP) — wyzwalany lokalnym eventem MUZZLE
  if (predictor.ready) {
    muzzleFlash.update(predictor.renderPosition, predictor.renderOrientation, camera.position, frameDtS);
  }
}

// --- nakładki HUD (faza 14): markery+spotting, celownik/nos, alert granicy, szarzenie, roster ---
function updateHudOverlays(): void {
  if (!predictor.ready) return;
  const w = app.clientWidth;
  const h = app.clientHeight;
  const localId = net?.localPlayerId ?? null;
  const s = predictor.sim.state;
  const localAlive = s.life === 'alive';
  const wreck = s.life === 'dying'; // własny spadający wrak (steruje nim gracz)
  // perspektywa, z której patrzymy: obserwowany samolot albo własny (żywy / wrak / katastrofa)
  const spectate = isSpectating() && spectatedValid;
  const viewPos = spectate ? spectatedPos : predictor.renderPosition;
  const viewId = spectate ? currentSpectateId() : localId;

  // markery wrogów: TYLKO żywe, obce względem obserwowanej maszyny, w zasięgu (≤ SPOT_RANGE_M).
  // Poza zasięgiem widać goły mesh — trzeba wypatrzyć wroga, nie lecieć na gotowy znacznik (jak SP).
  const spotSqM = SPOT_RANGE_M * SPOT_RANGE_M;
  let mi = 0;
  for (const [id, m] of meshes) {
    if (id === viewId || lifeById.get(id) !== 'alive') continue;
    if (m.object.position.distanceToSquared(viewPos) > spotSqM || mi >= markers.length) continue;
    const marker = markers[mi]!;
    mi++;
    // drużynowy: czerwony wróg / zielony sojusznik (paleta foe/friend); FFA: unikatowy kolor per id
    if (matchMode === 'team') marker.setFoe(factionById.get(id) !== localFaction);
    else marker.setColorHex(entityColorHex(id, false));
    marker.update(m.object.position, viewPos, camera, w, h);
    // cel schowany w chmurze → znacznik przygasa (faza 20: taktyczne krycie się)
    marker.setOpacity(1 - 0.8 * world.cloudCoverAt(m.object.position));
  }
  for (; mi < markers.length; mi++) markers[mi]!.hide();

  // celownik myszy — tylko żywy gracz z aktywną myszą (wrak strzela Spacją, bez celownika myszy)
  const reticlePos = mouseAim.locked && localAlive ? mouseAim.reticleScreenPos(viewPos, camera, w, h) : null;
  if (reticlePos) {
    reticleEl.style.display = 'block';
    reticleEl.style.left = `${reticlePos.x.toFixed(0)}px`;
    reticleEl.style.top = `${reticlePos.y.toFixed(0)}px`;
  } else {
    reticleEl.style.display = 'none';
  }
  // znacznik nosa: żywy gracz z myszą ORAZ spadający wrak (celuje nosem, ogień Spacją) — jak SP.
  // Wrak rysujemy z własnej pozy (predictor), nie z obserwowanej.
  getForward(s.orientation, scratchFwd);
  const showNose = wreck || (mouseAim.locked && localAlive);
  const nosePos = showNose ? projectDirToScreen(scratchFwd, predictor.renderPosition, camera, w, h) : null;
  if (nosePos) {
    noseMarkerEl.style.display = 'block';
    noseMarkerEl.style.left = `${nosePos.x.toFixed(0)}px`;
    noseMarkerEl.style.top = `${nosePos.y.toFixed(0)}px`;
  } else {
    noseMarkerEl.style.display = 'none';
  }

  // alert pełnoekranowy: obserwator / wrak (środek czysty — sterowanie + nakładka) / zestrzelony
  // (P1: brak respawnu — overlay daje obserwatora/wyjście) > ostrzeżenie o granicy (tylko żywy gracz)
  if (playerDeath === 'spectating') {
    alertEl.textContent = spectatableCount() > 1 ? 'OBSERWUJESZ   [LPM] zmień samolot' : 'OBSERWUJESZ';
    alertEl.className = 'crash';
    alertEl.style.opacity = '1';
  } else if (wreck) {
    alertEl.style.opacity = '0'; // komunikat i akcje są w nakładce u dołu
  } else if (!localAlive) {
    alertEl.textContent = deathLabel(localDeathCause); // ZESTRZELONY tylko od ognia; inaczej KOLIZJA/ROZBITY
    alertEl.className = 'crash';
    alertEl.style.opacity = '1';
  } else {
    const edgeM = distanceToArenaEdgeM(s.position.x, s.position.z);
    if (edgeM <= ARENA_WARNING_DISTANCE_M) {
      alertEl.textContent = `KONIEC MAPY ZA ${Math.max(0, edgeM).toFixed(0)} m — NASTĄPI PRZENIESIENIE`;
      alertEl.className = 'warning';
      alertEl.style.opacity = '1';
    } else {
      alertEl.style.opacity = '0';
    }
  }

  // nakładka decyzji po zestrzeleniu (steruj wrakiem / obserwator / tabela / opuść pokój) —
  // dopóki gracz nie wrócił do gry (wrak lub czeka na respawn) i nie ogląda tabeli/wyników
  if (playerDeath === 'wreck' && !scoreboard.visible && !matchResultsShown && !pauseMenuOpen) {
    downedOverlay.show(canSpectate(), deathLabel(localDeathCause), downedFlyableWreck);
  } else {
    downedOverlay.hide();
  }

  // wygaszanie obrazu przy przeciążeniu (G-LOC) — tylko żywy gracz (patrząc z własnego)
  greyoutOverlay.update(localAlive && !spectate ? predictor.sim.gLoadEffects.blackoutFactor : 0);

  // lista uczestników (kille/asysty) z tabeli wyników serwera, kolory spójne z markerami
  roster.update(rosterRows());

  // pasek kontroli strefy KotH (faza 17): status z bieżącej okupacji, fronty z czasu kontroli
  updateZoneBar();
}

/**
 * Pasek kontroli strefy KotH (faza 17, parytet z SP). Fronty = czas WYŁĄCZNEJ kontroli z
 * autorytatywnej tabeli (standings.rows.zoneSeconds): własny vs najlepszy wróg; status
 * (przejmujesz/wróg/sporna/wolna) z bieżącej okupacji (standings.zone). Ukryty na ekranie
 * wyników (zasłoniłby go modal) i poza meczem (standings null).
 */
function updateZoneBar(): void {
  const zoneStatus = latestStandings?.zone;
  if (!zoneStatus || matchResultsShown) {
    zoneBar.setVisible(false);
    return;
  }
  // fronty po FRAKCJI: własna drużyna vs najlepsza wroga (drużynowy: skrzydłowi współdzielą
  // czas strefy; FFA: frakcja = id, więc redukuje się do „własny vs najlepszy wróg" jak w f17).
  let mySec = 0;
  let enemySec = 0;
  for (const r of latestStandings!.rows) {
    if (r.faction === localFaction) mySec = Math.max(mySec, r.zoneSeconds);
    else if (r.zoneSeconds > enemySec) enemySec = r.zoneSeconds;
  }
  const state: ZoneBarState =
    zoneStatus.controlling === null
      ? zoneStatus.occupied
        ? 'contested'
        : 'neutral'
      : zoneStatus.controlling === localFaction
        ? 'own'
        : 'enemy';
  zoneBar.setVisible(true);
  zoneBar.update(state, mySec, enemySec);
}

/** Wiersze listy uczestników z autorytatywnej tabeli wyników (standings) serwera. */
function rosterRows(): readonly RosterRow[] {
  if (!latestStandings) return [];
  const localId = net?.localPlayerId ?? null;
  return latestStandings.rows.map((r: StandingRow): RosterRow => {
    const isPlayer = r.id === localId;
    // P1 (2026-06-19): OBA tryby eliminacyjne → wyeliminowany = wyczerpał życia (MATCH_LIVES) i nie
    // żyje ani nie spada (wrak = wciąż w walce, jak SP). Fazę życia bierzemy z renderowanego stanu
    // encji (lifeById; snapshot binarny nie niesie liczby żyć), niezależnie od trybu.
    const life = lifeById.get(r.id);
    const isLost = r.deaths >= MATCH_LIVES && life !== 'alive' && life !== 'dying';
    return {
      name: r.nick,
      kills: r.kills,
      assists: r.assists,
      colorCss: cssColor(entityColorHex(r.id, isPlayer)),
      isPlayer,
      isLost,
    };
  });
}

// --- przełączniki debug: [N] overlay sieci, [P] panel symulatora (tylko dev) ---
let conditionsPanel: NetConditionsPanel | undefined;
let panelLoading = false;
/** Czy fokus jest w polu edycji tekstu (input/textarea/select/contentEditable) — np. czat poczekalni. */
function isEditingText(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (el as HTMLElement).isContentEditable;
}

window.addEventListener('keydown', (event) => {
  // nie przechwytuj skrótów, gdy gracz pisze w polu tekstowym (np. czat poczekalni) —
  // inaczej każde „n" przełączałoby panel sieci, „p" panel warunków sieci itd.
  if (isEditingText()) return;
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
// ping w HUD odświeżany rzadko (mniej migotania liczby) — wartość pokazywana, nie surowy net.rttMs
const PING_REFRESH_S = 1;
let displayedPingMs = 0;
let pingRefreshAccumS = PING_REFRESH_S; // pierwsza klatka od razu ustawia świeżą wartość
// ekran ładowania (decyzja użytkownika 2026-06-21): trzyma się, aż wczytają się modele 3D
// WSZYSTKICH samolotów meczu (teren generuje się natychmiast; sekundy zajmuje pobranie .glb,
// stąd „bryły zastępcze"). Liczniki gotowości; `modelGen` ucina zliczanie starych meczów.
let modelsReady = 0;
let modelsTotal = 0;
let modelGen = 0;
const prevLocalPos = new Vector3();
let hasPrevLocal = false;
const TELEPORT_JUMP_M = 1000;

// licznik FPS do HUD (jak w SP main.ts): średnia z okna ~0,5 s, niezależna od fps fizyki
let fpsFrames = 0;
let fpsWindowS = 0;
let fpsValue = 0;

renderer.setAnimationLoop(() => {
  const now = performance.now();
  const frameDtS = Math.min(0.1, (now - lastMs) / 1000);
  lastMs = now;

  fpsFrames++;
  fpsWindowS += frameDtS;
  if (fpsWindowS >= 0.5) {
    fpsValue = Math.round(fpsFrames / fpsWindowS);
    fpsFrames = 0;
    fpsWindowS = 0;
  }

  if (phase === 'playing') {
    inputAccumS = Math.min(inputAccumS + frameDtS, 0.25);
    while (inputAccumS >= INPUT_DT_S) {
      sendInputTick(INPUT_DT_S);
      inputAccumS -= INPUT_DT_S;
    }

    // alpha = ułamek niewykorzystanego akumulatora inputu → interpolacja pozy lokalnego gracza
    // między tickami fizyki (bez tego mesh „schodkuje" przy fps > 60 Hz; obce już interpoluje buffer)
    predictor.updateRender(frameDtS, inputAccumS / INPUT_DT_S);
    interpolator.update(frameDtS);

    remoteCount = 0;
    extrapolatingCount = 0;
    const localId = net?.localPlayerId ?? null;
    const spectateId = isSpectating() ? currentSpectateId() : null;
    spectatedValid = false;
    for (const [id, m] of meshes) {
      let newLife: LifePhase;
      let aThrottle: number; // gaz i prędkość do dźwięku silnika (źródło zależne od gałęzi local/obcy)
      let aSpeed: number;
      if (id === localId) {
        if (!predictor.ready) continue;
        const s = predictor.sim.state;
        m.object.position.copy(predictor.renderPosition);
        m.object.quaternion.copy(predictor.renderOrientation);
        newLife = s.life;
        // zwęglony wrak na lądzie ('dead' + burningWreck) zostaje widoczny, zamrożony w miejscu
        m.object.visible = newLife !== 'dead' || burningWreckIds.has(id) || sinkingWrecks.has(id);
        m.update(frameDtS, s.throttle, newLife === 'alive');
        aThrottle = s.throttle;
        aSpeed = s.velocity.length();
      } else if (interpolator.sample(id, interpOut)) {
        remoteCount++;
        if (interpOut.extrapolated) extrapolatingCount++;
        m.object.position.copy(interpOut.position);
        m.object.quaternion.copy(interpOut.orientation);
        newLife = interpOut.life;
        m.object.visible = newLife !== 'dead' || burningWreckIds.has(id) || sinkingWrecks.has(id);
        m.update(frameDtS, interpOut.throttle, newLife === 'alive');
        aThrottle = interpOut.throttle;
        aSpeed = interpOut.velocity.length();
        if (id === spectateId) {
          spectatedPos.copy(interpOut.position);
          spectatedQuat.copy(interpOut.orientation);
          spectatedVel.copy(interpOut.velocity);
          spectatedValid = true;
        }
      } else {
        continue;
      }
      // przejście w 'dead' (uderzenie wraku w powierzchnię ALBO bezpośrednie rozbicie alive→dead) →
      // efekt zależny od podłoża: plusk wody / ognisty wybuch + zwęglony wrak na lądzie (parytet z SP).
      const prevLife = lifeById.get(id);
      if (newLife === 'dead' && prevLife !== undefined && prevLife !== 'dead') {
        handleSurfaceImpact(id, m);
      } else if (newLife === 'alive' && (burningWreckIds.has(id) || sinkingWrecks.has(id))) {
        // (gdyby wrócił respawn) świeże życie zdejmuje zwęglenie/tonięcie — przywróć barwy i widoczność
        if (burningWreckIds.has(id)) restorePlaneMesh(m.object);
        burningWreckIds.delete(id);
        sinkingWrecks.delete(id);
      }
      // dźwięk silnika+broni encji (faza 21): pętla pozycyjna dla obcych (host=mesh), centralna dla
      // własnego. Martwy/wrak → cisza silnika (eksplozję/łomot robią osobne ścieżki). Broń gra, gdy
      // świeże eventy MUZZLE odświeżają licznik (gun.note); tu tylko decay i ew. dudnienie działka.
      if (audio.ready) {
        const plane = planeTypeById.get(id) ?? DEFAULT_PLANE_TYPE;
        if (newLife === 'alive') {
          const ea = ensureEntityAudio(id, plane, id === localId ? undefined : m.object);
          // paliwo gasi silnik tylko lokalnie (zdalnych nie ma w snapshocie — grają, póki żyją)
          const engineOn = id === localId ? predictor.sim.state.fuelFrac > 0.001 : true;
          ea.engine.update(frameDtS, aThrottle, aSpeed, engineOn);
          ea.gun.update(frameDtS, m.object.position);
        } else {
          disposeEntityAudio(id);
        }
      }
      // tonięcie wraku na wodzie: po krótkim holdzie opuszczaj mesh pod taflę, po WATER_SINK_TOTAL_S znika
      const sinkAge = sinkingWrecks.get(id);
      if (sinkAge !== undefined) {
        const t = sinkAge + frameDtS;
        if (t >= WATER_SINK_TOTAL_S) {
          sinkingWrecks.delete(id);
          m.object.visible = false;
        } else {
          sinkingWrecks.set(id, t);
          m.object.visible = true;
          m.object.position.y -= Math.max(0, t - WATER_SINK_HOLD_S) * WATER_SINK_SPEED_MS;
        }
      }
      lifeById.set(id, newLife);
    }
    updateDeathState();

    if (predictor.ready) {
      const s = predictor.sim.state;
      // źródło widoku: obserwowany samolot (po wyborze trybu obserwatora), inaczej własny
      // (żywy / spadający wrak / miejsce katastrofy). Bufory spectated* wypełnia pętla meshy.
      const spectate = isSpectating() && spectatedValid;
      const viewPos = spectate ? spectatedPos : predictor.renderPosition;
      const viewQuat = spectate ? spectatedQuat : predictor.renderOrientation;
      const viewVel = spectate ? spectatedVel : s.velocity;
      // zawinięcie torusa / przeskok na innego obserwowanego = teleport → reset kamery (bez smużenia)
      if (hasPrevLocal && prevLocalPos.distanceTo(viewPos) > TELEPORT_JUMP_M) chaseCamera.reset();
      prevLocalPos.copy(viewPos);
      hasPrevLocal = true;
      if (cameraMode === 'orbitalna') orbit.update(viewPos);
      else {
        // trzęsienie kamery przy buffecie tylko z perspektywy własnego samolotu (parytet z SP —
        // main.ts: viewC === player ? buffet : 0); przy obserwacji cudzego = 0. Dane lokalne
        // z predykcji (predictor.sim), więc zero-koszt i bez zmiany protokołu.
        const buffet = spectate ? 0 : predictor.sim.stallEffects.buffetIntensity;
        chaseCamera.update(frameDtS, viewPos, viewQuat, viewVel, buffet);
      }
      // kamera nigdy pod powierzchnią (wrak/orbita nisko nad ziemią wbijały ją w teren)
      const cameraFloorM = surfaceHeightM(terrain, camera.position.x, camera.position.z) + 3;
      if (camera.position.y < cameraFloorM) camera.position.y = cameraFloorM;
      maybeHideLoading(); // znika dopiero, gdy wczytają się modele wszystkich samolotów
      // świst opływu (rośnie z IAS) + buffet przeciągnięcia — z WŁASNej maszyny (obserwacja/wrak → gaśnie)
      if (audio.ready) {
        wind ??= audio.createWind();
        const ownActive = !isSpectating() && s.life === 'alive';
        wind.update(s.iasMs, predictor.sim.stallEffects.buffetIntensity, ownActive);
      }
    }
    // ping w HUD odświeżany co ~1 s (decyzja użytkownika 2026-06-21 — był aktualizowany co klatkę)
    pingRefreshAccumS += frameDtS;
    if (pingRefreshAccumS >= PING_REFRESH_S) {
      pingRefreshAccumS = 0;
      displayedPingMs = net?.rttMs ?? 0;
    }
    updateCombatVisuals(frameDtS);
    updateWorldVisuals(frameDtS);
    updateEmplacements(frameDtS); // stanowiska naziemne: głosy broni + dym zniszczonych
    updateHud();
    updateHudOverlays();
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
  // gdyby reconnect nie zwrócił pokoju (token wygasł), po chwili pokaż lobby (z pollingiem listy)
  setTimeout(() => {
    if (phase === 'lobby' && !roomView) enterLobby();
  }, 1500);
} else {
  // brak tokenu: pokaż ekran wejściowy od razu (bez przebłysku pustki), a w tle połącz się, by
  // pobrać listę pokoi i pokazać auto-wykrytą otwartą grę (onWelcome → enterLobby startuje polling).
  // Nick z hello jest aktualny; gdy gracz go zmieni przed akcją, withConnection łączy ponownie.
  lobby.showEntry();
  withConnection((c) => c.requestRoomList());
}
document.getElementById('loading')?.classList.add('hidden');
