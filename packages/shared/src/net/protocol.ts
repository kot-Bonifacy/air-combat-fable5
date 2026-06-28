import { Quaternion, Vector3 } from 'three';
import { NetError } from '../errors';
import type { DifficultyLevel } from '../ai/difficulty';
import type { LifePhase, PlaneState } from '../physics/state';
import type { MatchMode } from '../world/team';
import { planeTypeFromCode, planeTypeToCode, type PlaneType } from '../planes/plane-type';
import { ZONE_COUNT } from '../combat/damage-model';

// Protokół sieciowy fazy 8 (docs/phases/faza-08.md).
//
// Dwa kanały:
//  - BINARNY (DataView, hot path 30–60 Hz): INPUT klient→serwer, SNAPSHOT serwer→klient.
//    Pierwszy bajt ramki = tag typu. Endianness JAWNIE little-endian wszędzie
//    (pułapka faza-08.md: domyślne zachowanie DataView bywa różne między platformami).
//  - TEKSTOWY/JSON (rzadki: handshake, eventy): hello/welcome/error + zdarzenia.
//    Decyzja fazy 8: EVENT jest JSON-owy (rzadki, poza hot pathem; niezmiennik nr 6
//    zakazuje JSON tylko w pętli gry). Handshake JSON niesie bajt wersji protokołu.
//
// Kwantyzacja (pułapka faza-08.md „kąty jako int16"): orientacja jako 4× int16
// (najprostszy wariant; benchmark zdecydował, że smallest-three nie jest potrzebne —
// patrz memory faza 8), prędkość jako 3× int16 w stałym zakresie, kierunki/wychylenia
// jako int16 w [−1, 1]. Pozycja zostaje pełnym float32 (zakres areny ±10 km i wysokość
// nie mieszczą się wygodnie w jednej skali int16 bez utraty precyzji nisko nad ziemią).

/**
 * Wersja protokołu — niezgodność klient/serwer = czytelny błąd w handshake.
 * v2 (faza 11): INPUT niesie `ackServerTick` zamiast `clientTimeMs`; snapshot
 * encji dokłada bajt HP; doszła binarna ramka EVENT (muzzle/hit/kill).
 * v3 (faza 14): snapshot encji dokłada bajt amunicji (ułamek) — klient online nie
 * symuluje ognia lokalnie, więc HUD czyta amunicję z autorytetu serwera.
 * v4 (faza 19b): snapshot encji dokłada bajt TYPU SAMOLOTU (drugi samolot, Bf 109) — klient
 * dobiera mesh i etykietę HUD per encja, a lokalna predykcja per typ. Lobby: RoomPlayer niesie
 * wybrany typ, wiadomość `selectPlane` go zmienia (deploy front+back RAZEM — niespójna wersja
 * = błąd handshake).
 * v5: snapshot encji dokłada bajt amunicji GRUPY WTÓRNEJ (działko 20 mm MG FF w Bf 109) — HUD
 * pokazuje osobny licznik dla działka. Spitfire (1 grupa) koduje 0 (klient pomija licznik).
 * v6: naziemne stanowiska ogniowe (AA) — nowe binarne zdarzenia EV_AA_FIRE (klient odtwarza
 * tracery ognia z ziemi, by dało się unikać wzrokowo) i EV_AA_DESTROYED; nowy rodzaj śmierci
 * KILL `'flak'` (zestrzelenie przez stanowisko); StandingRow dokłada `groundKills`, StandingsMessage
 * `aaDestroyed` (stan stanowisk dla późno dołączających). Pozycje stanowisk są deterministyczne z
 * seeda terenu (klient liczy je sam) — nie ma ich w snapshocie.
 * v7: snapshot encji dokłada bajt PALIWA (ułamek 0..1). Paliwo było ukrytym stanem fizyki — klient
 * predykował je lokalnie, a reconcile resetował do 1 tylko przy świeżym spawnie. Po wznowieniu sesji
 * (auto-reconnect bez przeładowania) stan klienta rozjeżdżał się z serwerem (pokazywany pusty bak).
 * Teraz paliwo jest autorytatywne jak HP/amunicja: klient predykuje między snapshotami i KORYGUJE do
 * wartości serwera. Deploy front+back RAZEM (niespójna wersja = błąd handshake).
 * v8 (faza 22 cz.3): snapshot encji dokłada u16 STANU USZKODZEŃ (6 stref × 2 bity poziomu 0..3 +
 * bit pożaru; indeks strefy = ZONE_ROLES). Lokalna encja: klient ustawia z tego `SimPlane.damageLevels`
 * i predykuje uszkodzony lot tymi samymi modyfikatorami co serwer (spójny reconcile, jak paliwo po v7,
 * bo skutki liczą się WYŁĄCZNIE z poziomów). Obce: poziomy/pożar zasilą wizualia uszkodzeń (Część 4).
 * SNAPSHOT_ENTITY_BYTES 34→36. Deploy front+back RAZEM.
 */
export const PROTOCOL_VERSION = 8;

/** Tag pierwszego bajtu ramki binarnej: wejście gracza (klient → serwer). */
export const MSG_INPUT = 1;
/** Tag pierwszego bajtu ramki binarnej: snapshot świata (serwer → klient). */
export const MSG_SNAPSHOT = 2;
/** Tag pierwszego bajtu ramki binarnej: paczka zdarzeń walki (serwer → klient, faza 11). */
export const MSG_EVENT = 3;

const I16_MAX = 32767;

/** Zakres kwantyzacji składowej prędkości [m/s] — |v| ponad to jest clampowane. */
export const VELOCITY_QUANT_RANGE_MS = 600;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** −1..1 → int16 (z clampem). Wartości brzegowe ±1 mapują się na ±I16_MAX dokładnie. */
export function quantizeUnit(v: number): number {
  return Math.round(clamp(v, -1, 1) * I16_MAX);
}

/** int16 → −1..1. */
export function dequantizeUnit(q: number): number {
  return q / I16_MAX;
}

function quantizeVelocity(v: number): number {
  return Math.round(clamp(v / VELOCITY_QUANT_RANGE_MS, -1, 1) * I16_MAX);
}

function dequantizeVelocity(q: number): number {
  return (q / I16_MAX) * VELOCITY_QUANT_RANGE_MS;
}

// --- cykl życia jako 2 bity we fladze encji ---

const LIFE_PHASES: readonly LifePhase[] = ['alive', 'dying', 'dead', 'respawning'];

export function lifePhaseToCode(phase: LifePhase): number {
  const i = LIFE_PHASES.indexOf(phase);
  if (i < 0) throw new NetError(`nieznana faza życia: ${phase}`);
  return i;
}

export function lifePhaseFromCode(code: number): LifePhase {
  const phase = LIFE_PHASES[code & 0b11];
  if (!phase) throw new NetError(`nieznany kod fazy życia: ${String(code)}`);
  return phase;
}

// =========================== INPUT (klient → serwer) ===========================

/**
 * Ramka wejścia gracza. „Cel instruktora" to jednostkowy kierunek w świecie,
 * policzony po stronie klienta przez MouseAimCore (renormalizowany względem
 * orientacji z ostatniego snapshotu). Serwer prowadzi nim instruktora.
 */
export interface InputFrame {
  /** Numer kolejny ramki (u32, monotoniczny) — serwer odsyła ack w snapshocie. */
  sequence: number;
  /**
   * Najnowszy serverTick, jaki klient już otrzymał i zastosował (u32). Serwer liczy
   * z niego opóźnienie strzelca do lag-compensation (faza 11): rewind ≈ (tick bieżący −
   * ackServerTick) + bufor interpolacji. Echo ticku zamiast znacznika czasu — żadnej
   * synchronizacji zegarów między maszynami (RTT klient mierzy osobno mapą sentTimes).
   */
  ackServerTick: number;
  /** Przepustnica 0..1. */
  throttle: number;
  /** Wychylenie steru wysokości −1..1 (+ = nos w górę). */
  pitchUp: number;
  /** Wychylenie lotek −1..1 (+ = w prawo). */
  rollRight: number;
  /** Wychylenie steru kierunku −1..1 (+ = nos w prawo). */
  yawRight: number;
  /** Spust (faza 8: broń online wyłączona — bit przenoszony pod fazę 11). */
  fire: boolean;
  /** Kierunek celu instruktora w świecie (jednostkowy). */
  aimX: number;
  aimY: number;
  aimZ: number;
}

// layout: u8 type | u32 seq | u32 ackServerTick | u16 throttle | i16×3 deflekcje |
//         i16×3 aim | u8 flags(bit0=fire)
const OFF_TYPE = 0;
const OFF_SEQ = 1;
const OFF_ACK_TICK = 5;
const OFF_THROTTLE = 9;
const OFF_PITCH = 11;
const OFF_ROLL = 13;
const OFF_YAW = 15;
const OFF_AIM_X = 17;
const OFF_AIM_Y = 19;
const OFF_AIM_Z = 21;
const OFF_FLAGS = 23;

/** Stały rozmiar ramki INPUT [bajty]. */
export const INPUT_BYTES = 24;

const FIRE_BIT = 0b1;

/** Zapisuje ramkę INPUT do `view` (offset 0). `view` musi mieć ≥ INPUT_BYTES. */
export function encodeInput(view: DataView, frame: InputFrame): void {
  view.setUint8(OFF_TYPE, MSG_INPUT);
  view.setUint32(OFF_SEQ, frame.sequence >>> 0, true);
  view.setUint32(OFF_ACK_TICK, frame.ackServerTick >>> 0, true);
  view.setUint16(OFF_THROTTLE, Math.round(clamp(frame.throttle, 0, 1) * 65535), true);
  view.setInt16(OFF_PITCH, quantizeUnit(frame.pitchUp), true);
  view.setInt16(OFF_ROLL, quantizeUnit(frame.rollRight), true);
  view.setInt16(OFF_YAW, quantizeUnit(frame.yawRight), true);
  view.setInt16(OFF_AIM_X, quantizeUnit(frame.aimX), true);
  view.setInt16(OFF_AIM_Y, quantizeUnit(frame.aimY), true);
  view.setInt16(OFF_AIM_Z, quantizeUnit(frame.aimZ), true);
  view.setUint8(OFF_FLAGS, frame.fire ? FIRE_BIT : 0);
}

/** Alokuje i zwraca bufor z zakodowaną ramką INPUT (do testów / prostego użycia). */
export function encodeInputToBytes(frame: InputFrame): Uint8Array {
  const buf = new Uint8Array(INPUT_BYTES);
  encodeInput(new DataView(buf.buffer), frame);
  return buf;
}

/**
 * Dekoduje ramkę INPUT. Sprawdza rozmiar i tag typu — spreparowany pakiet
 * (zły rozmiar / nie ta ramka) leci jako NetError, który łapie warstwa połączenia.
 */
export function decodeInput(view: DataView): InputFrame {
  if (view.byteLength !== INPUT_BYTES) {
    throw new NetError(`INPUT: zły rozmiar ${String(view.byteLength)} B (oczekiwano ${String(INPUT_BYTES)})`);
  }
  if (view.getUint8(OFF_TYPE) !== MSG_INPUT) {
    throw new NetError(`INPUT: zły tag typu ${String(view.getUint8(OFF_TYPE))}`);
  }
  return {
    sequence: view.getUint32(OFF_SEQ, true),
    ackServerTick: view.getUint32(OFF_ACK_TICK, true),
    throttle: view.getUint16(OFF_THROTTLE, true) / 65535,
    pitchUp: dequantizeUnit(view.getInt16(OFF_PITCH, true)),
    rollRight: dequantizeUnit(view.getInt16(OFF_ROLL, true)),
    yawRight: dequantizeUnit(view.getInt16(OFF_YAW, true)),
    aimX: dequantizeUnit(view.getInt16(OFF_AIM_X, true)),
    aimY: dequantizeUnit(view.getInt16(OFF_AIM_Y, true)),
    aimZ: dequantizeUnit(view.getInt16(OFF_AIM_Z, true)),
    fire: (view.getUint8(OFF_FLAGS) & FIRE_BIT) !== 0,
  };
}

/**
 * Walidacja semantyczna ramki PO dekodowaniu (niezmiennik nr 11): kwantyzacja już
 * ogranicza zakresy, ale wektor celu mógłby wyjść zerowy/zdegenerowany (normalizacja
 * → NaN w instruktorze). Zwraca komunikat błędu albo null, gdy ramka jest poprawna.
 */
export function validateInputFrame(frame: InputFrame): string | null {
  const nums = [
    frame.throttle,
    frame.pitchUp,
    frame.rollRight,
    frame.yawRight,
    frame.aimX,
    frame.aimY,
    frame.aimZ,
  ];
  if (nums.some((n) => !Number.isFinite(n))) return 'pole nie jest skończoną liczbą';
  if (frame.throttle < 0 || frame.throttle > 1) return 'throttle poza [0, 1]';
  if (Math.abs(frame.pitchUp) > 1 || Math.abs(frame.rollRight) > 1 || Math.abs(frame.yawRight) > 1) {
    return 'wychylenie steru poza [−1, 1]';
  }
  const aimLen = Math.hypot(frame.aimX, frame.aimY, frame.aimZ);
  if (aimLen < 0.1) return 'wektor celu zdegenerowany (długość ~0)';
  return null;
}

// =========================== SNAPSHOT (serwer → klient) ===========================

/**
 * Stan uszkodzeń encji po dekodowaniu (protokół v8). `levels` ma długość ZONE_COUNT, indeks =
 * ZONE_ROLES (engine/cockpit/tank/wingL/wingR/tail), wartości 0..3 (0=ok…3=zniszczona). Lokalna
 * encja: klient ustawia z `levels` swój `SimPlane.damageLevels` (spójna predykcja); obce: pod
 * wizualia Części 4 (dym/ogień/brak końcówki skrzydła). `onFire` służy tylko prezentacji (DoT do
 * integralności liczy autorytatywnie serwer).
 */
export interface EntityDamage {
  levels: number[];
  onFire: boolean;
}

/** Stan jednej encji po dekodowaniu snapshotu (po stronie klienta). */
export interface EntitySnapshot {
  id: number;
  life: LifePhase;
  stalled: boolean;
  /** true = to samolot odbierającego klienta (z fazy 9 predykowany lokalnie). */
  isLocal: boolean;
  position: Vector3;
  orientation: Quaternion;
  velocity: Vector3;
  throttle: number;
  /** Ułamek HP 0..1 (faza 11) — HP jest autorytetem serwera; klient tylko pokazuje. */
  healthFrac: number;
  /** Ułamek amunicji 0..1 (faza 14) — ogień liczy serwer; klient tylko pokazuje w HUD. */
  ammoFrac: number;
  /** Ułamek amunicji GRUPY WTÓRNEJ 0..1 (protokół v5; działko 20 mm Bf 109). 0 dla samolotów
   *  z jedną grupą broni (Spitfire) — klient pomija osobny licznik wg konfiguracji typu. */
  ammoSecondaryFrac: number;
  /** Ułamek paliwa 0..1 (protokół v7) — autorytet serwera; klient predykuje lokalnie i koryguje do
   *  tej wartości w reconcile (wcześniej paliwo było ukryte i rozjeżdżało się po auto-reconnekcie). */
  fuelFrac: number;
  /** Typ samolotu encji (faza 19b) — klient dobiera mesh i etykietę HUD; lokalnie też predykcję. */
  planeType: PlaneType;
  /** Stan uszkodzeń stref (protokół v8) — poziomy 0..3 per strefa + pożar (patrz EntityDamage). */
  damage: EntityDamage;
}

export interface Snapshot {
  serverTick: number;
  /** Ostatni numer INPUT przetworzony przez serwer dla TEGO klienta. */
  ackSeq: number;
  entities: EntitySnapshot[];
}

/** Źródło encji do zakodowania snapshotu (referencja do żywego stanu — zero kopii). */
export interface SnapshotEntitySource {
  id: number;
  state: PlaneState;
  /** Żywe HP encji (faza 11) — kodowane jako ułamek hp/maxHp. Struktura zamiast typu
   *  Health, by protokół nie zależał od modułu combat. */
  health: { hp: number; maxHp: number };
  /** Żywy stan ognia (faza 14) — kodujemy ułamek ammoRemaining/ammoMax. Struktura zamiast
   *  typu FireControl, by protokół nie zależał od modułu combat. */
  fire: { ammoRemaining: number };
  /** Pełny zapas amunicji [pociski] — stały per płatowiec (do ułamka amunicji). */
  ammoMax: number;
  /** Żywy stan ognia grupy WTÓRNEJ (protokół v5; działko 20 mm Bf 109) — null, gdy samolot ma
   *  jedną grupę broni (Spitfire). */
  fireSecondary: { ammoRemaining: number } | null;
  /** Pełny zapas amunicji grupy wtórnej [pociski]; 0, gdy brak grupy wtórnej. */
  ammoSecondaryMax: number;
  /** Typ samolotu encji (faza 19b) — kodowany jednym bajtem (snapshot v4). */
  planeType: PlaneType;
  /** Żywe źródło stanu uszkodzeń (faza 22, protokół v8): `levels` to bufor poziomów mutowany co tick
   *  (refreshDamageLevels), `fire.onFire` z żywego DamageState. Struktura (a nie typ DamageState),
   *  by protokół nie zależał od logiki combat — kodujemy tylko kwantyzowane poziomy + bit pożaru. */
  damage: { levels: readonly number[]; fire: { onFire: boolean } };
}

export const SNAPSHOT_HEADER_BYTES = 10; // u8 type | u32 tick | u32 ack | u8 count
export const SNAPSHOT_ENTITY_BYTES = 36; // ...u8 fuel | u16 stan uszkodzeń (v8); reszta jak w v7
// layout encji: u8 id | u8 flags | f32×3 pos | i16×4 orient | i16×3 vel | u8 throttle | u8 hp |
//   u8 ammo | u8 ammoSecondary | u8 planeType | u8 fuel | u16 damage

/** Rozmiar snapshotu [bajty] dla zadanej liczby encji — do budżetu pasma. */
export function snapshotByteLength(entityCount: number): number {
  return SNAPSHOT_HEADER_BYTES + entityCount * SNAPSHOT_ENTITY_BYTES;
}

// --- stan uszkodzeń jako u16 we encji (protokół v8) ---
// 6 stref (ZONE_COUNT) × 2 bity poziomu (0..3) = 12 bitów + bit pożaru (bit 12). Indeks strefy =
// ZONE_ROLES (importowany ZONE_COUNT pilnuje zgodności rozmiaru bez duplikacji liczby).
const DAMAGE_FIRE_BIT = 1 << (ZONE_COUNT * 2);

/** Pakuje poziomy stref (0..3, indeks = ZONE_ROLES, długość ZONE_COUNT) + pożar do u16. */
function packDamage(levels: readonly number[], onFire: boolean): number {
  let v = 0;
  for (let i = 0; i < ZONE_COUNT; i++) {
    const lvl = Math.round(clamp(levels[i] ?? 0, 0, 3));
    v |= lvl << (i * 2);
  }
  if (onFire) v |= DAMAGE_FIRE_BIT;
  return v;
}

/** Rozpakowuje u16 do poziomów (nowa tablica długości ZONE_COUNT) + flagi pożaru. */
function unpackDamage(v: number): EntityDamage {
  const levels = new Array<number>(ZONE_COUNT);
  for (let i = 0; i < ZONE_COUNT; i++) levels[i] = (v >> (i * 2)) & 0b11;
  return { levels, onFire: (v & DAMAGE_FIRE_BIT) !== 0 };
}

const ENTITY_FLAG_STALLED = 0b100;
const ENTITY_FLAG_LOCAL = 0b1000;

/**
 * Zapisuje snapshot do `view` (offset 0) i zwraca liczbę zapisanych bajtów.
 * `localId` oznacza, którą encję oflagować jako „własną" odbiorcy — dzięki temu
 * ten sam zestaw `entities` koduje się per-klient bez przebudowy listy.
 */
export function encodeSnapshot(
  view: DataView,
  serverTick: number,
  ackSeq: number,
  localId: number,
  entities: readonly SnapshotEntitySource[],
): number {
  view.setUint8(0, MSG_SNAPSHOT);
  view.setUint32(1, serverTick >>> 0, true);
  view.setUint32(5, ackSeq >>> 0, true);
  view.setUint8(9, entities.length);
  let o = SNAPSHOT_HEADER_BYTES;
  for (const e of entities) {
    const s = e.state;
    view.setUint8(o, e.id);
    let flags = lifePhaseToCode(s.life);
    if (s.stalled) flags |= ENTITY_FLAG_STALLED;
    if (e.id === localId) flags |= ENTITY_FLAG_LOCAL;
    view.setUint8(o + 1, flags);
    view.setFloat32(o + 2, s.position.x, true);
    view.setFloat32(o + 6, s.position.y, true);
    view.setFloat32(o + 10, s.position.z, true);
    view.setInt16(o + 14, quantizeUnit(s.orientation.x), true);
    view.setInt16(o + 16, quantizeUnit(s.orientation.y), true);
    view.setInt16(o + 18, quantizeUnit(s.orientation.z), true);
    view.setInt16(o + 20, quantizeUnit(s.orientation.w), true);
    view.setInt16(o + 22, quantizeVelocity(s.velocity.x), true);
    view.setInt16(o + 24, quantizeVelocity(s.velocity.y), true);
    view.setInt16(o + 26, quantizeVelocity(s.velocity.z), true);
    view.setUint8(o + 28, Math.round(clamp(s.throttle, 0, 1) * 255));
    const hpFrac = e.health.maxHp > 0 ? e.health.hp / e.health.maxHp : 0;
    view.setUint8(o + 29, Math.round(clamp(hpFrac, 0, 1) * 255));
    const ammoFrac = e.ammoMax > 0 ? e.fire.ammoRemaining / e.ammoMax : 0;
    view.setUint8(o + 30, Math.round(clamp(ammoFrac, 0, 1) * 255));
    const ammoSecFrac =
      e.fireSecondary && e.ammoSecondaryMax > 0 ? e.fireSecondary.ammoRemaining / e.ammoSecondaryMax : 0;
    view.setUint8(o + 31, Math.round(clamp(ammoSecFrac, 0, 1) * 255));
    view.setUint8(o + 32, planeTypeToCode(e.planeType));
    view.setUint8(o + 33, Math.round(clamp(s.fuelFrac, 0, 1) * 255)); // paliwo (v7) — autorytet serwera
    view.setUint16(o + 34, packDamage(e.damage.levels, e.damage.fire.onFire), true); // uszkodzenia (v8)
    o += SNAPSHOT_ENTITY_BYTES;
  }
  return o;
}

/** Dekoduje snapshot. Kwaternion jest renormalizowany (kwantyzacja zaburza |q|=1). */
export function decodeSnapshot(view: DataView): Snapshot {
  if (view.byteLength < SNAPSHOT_HEADER_BYTES) {
    throw new NetError(`SNAPSHOT: zbyt krótki (${String(view.byteLength)} B)`);
  }
  if (view.getUint8(0) !== MSG_SNAPSHOT) {
    throw new NetError(`SNAPSHOT: zły tag typu ${String(view.getUint8(0))}`);
  }
  const serverTick = view.getUint32(1, true);
  const ackSeq = view.getUint32(5, true);
  const count = view.getUint8(9);
  if (view.byteLength < snapshotByteLength(count)) {
    throw new NetError(`SNAPSHOT: rozmiar ${String(view.byteLength)} B nie mieści ${String(count)} encji`);
  }
  const entities: EntitySnapshot[] = [];
  let o = SNAPSHOT_HEADER_BYTES;
  for (let i = 0; i < count; i++) {
    const id = view.getUint8(o);
    const flags = view.getUint8(o + 1);
    const position = new Vector3(
      view.getFloat32(o + 2, true),
      view.getFloat32(o + 6, true),
      view.getFloat32(o + 10, true),
    );
    const orientation = new Quaternion(
      dequantizeUnit(view.getInt16(o + 14, true)),
      dequantizeUnit(view.getInt16(o + 16, true)),
      dequantizeUnit(view.getInt16(o + 18, true)),
      dequantizeUnit(view.getInt16(o + 20, true)),
    ).normalize();
    const velocity = new Vector3(
      dequantizeVelocity(view.getInt16(o + 22, true)),
      dequantizeVelocity(view.getInt16(o + 24, true)),
      dequantizeVelocity(view.getInt16(o + 26, true)),
    );
    const throttle = view.getUint8(o + 28) / 255;
    const healthFrac = view.getUint8(o + 29) / 255;
    const ammoFrac = view.getUint8(o + 30) / 255;
    const ammoSecondaryFrac = view.getUint8(o + 31) / 255;
    const planeType = planeTypeFromCode(view.getUint8(o + 32));
    const fuelFrac = view.getUint8(o + 33) / 255;
    const damage = unpackDamage(view.getUint16(o + 34, true));
    entities.push({
      id,
      life: lifePhaseFromCode(flags),
      stalled: (flags & ENTITY_FLAG_STALLED) !== 0,
      isLocal: (flags & ENTITY_FLAG_LOCAL) !== 0,
      position,
      orientation,
      velocity,
      throttle,
      healthFrac,
      ammoFrac,
      ammoSecondaryFrac,
      fuelFrac,
      planeType,
      damage,
    });
    o += SNAPSHOT_ENTITY_BYTES;
  }
  return { serverTick, ackSeq, entities };
}

// =========================== EVENTY WALKI (serwer → klient, binarne) ===========================
//
// Faza 11: zdarzenia walki są BINARNE (niezmiennik nr 6 — strzał z kadencją to hot path,
// nie „rzadki event JSON" jak w fazie 8). Jedna ramka MSG_EVENT pakuje wiele zdarzeń z
// jednego interwału snapshotu (count). Zdarzenia są BROADCASTOWE (jeden bufor dla całego
// pokoju) — klient sam filtruje po id (czy to ja strzelam / ja oberwałem).
//
//  - MUZZLE: błysk wylotu — klient renderuje WŁASNE, kosmetyczne smugacze od pozy danej
//    encji (pociski autorytatywne lecą tylko na serwerze; snapshot ich NIE niesie —
//    pułapka faza-11.md „eksplozja rozmiaru”). `seed` deterministyzuje rozrzut wizualny.
//  - HIT: trafienie niezabijające — hit marker u strzelca, błysk u ofiary.
//  - KILL: zestrzelenie — kill feed; rodzaj śmierci rozróżnia źródło (pocisk/ziemia/kolizja).

/** Tag podtypu zdarzenia w ramce MSG_EVENT. */
export const EV_MUZZLE = 1;
export const EV_HIT = 2;
export const EV_KILL = 3;
/** Salwa naziemnego stanowiska ogniowego (v6) — klient odtwarza tracery z ziemi. */
export const EV_AA_FIRE = 4;
/** Zniszczenie naziemnego stanowiska ogniowego (v6) — klient czerni je i dymi. */
export const EV_AA_DESTROYED = 5;

/** Rodzaj śmierci w zdarzeniu KILL (`'flak'` = zestrzelenie przez naziemne stanowisko, v6). */
export type KillCause = 'air' | 'ground' | 'collision' | 'flak';
const KILL_CAUSES: readonly KillCause[] = ['air', 'ground', 'collision', 'flak'];

export interface MuzzleEvent {
  kind: 'muzzle';
  /** Id strzelca. */
  ownerId: number;
  /** Seed rozrzutu wizualnego (deterministyczny strumień smugaczy u klienta). */
  seed: number;
  /** Liczba pocisków wystrzelonych w tym ticku (do odtworzenia salwy kosmetycznie). */
  shots: number;
}

export interface HitEvent {
  kind: 'hit';
  shooterId: number;
  victimId: number;
}

export interface KillEvent {
  kind: 'kill';
  /** Strzelec (znaczący tylko dla cause='air'; dla ziemi/kolizji/flaku bez sprawcy). */
  killerId: number;
  victimId: number;
  cause: KillCause;
}

/**
 * Salwa naziemnego stanowiska ogniowego (v6). Pozycja stanowiska jest stała (klient zna ją z seeda
 * terenu po `index`), więc niesiemy tylko kierunek bazowy salwy + liczbę pocisków + seed rozrzutu —
 * klient odtwarza kosmetyczne tracery od wylotu danego stanowiska (jak MUZZLE dla samolotów).
 */
export interface AaFireEvent {
  kind: 'aaFire';
  /** Indeks stanowiska (0..EMPLACEMENT_COUNT−1). */
  index: number;
  /** Seed rozrzutu wizualnego (deterministyczny strumień tracerów u klienta). */
  seed: number;
  /** Liczba pocisków w tej salwie. */
  shots: number;
  /** Jednostkowy kierunek bazowy salwy (klient dokłada własny rozrzut). */
  dir: Vector3;
}

/** Zniszczenie stanowiska ogniowego (v6) — klient czerni mesh i włącza dym; `killerId` do feedu. */
export interface AaDestroyedEvent {
  kind: 'aaDestroyed';
  index: number;
  killerId: number;
}

export type GameEvent = MuzzleEvent | HitEvent | KillEvent | AaFireEvent | AaDestroyedEvent;

// rozmiary z bajtem podtypu: muzzle 7, hit 3, kill 4, aaFire 13 (u8 idx + u8 shots + u32 seed +
// i16×3 dir), aaDestroyed 3
function eventByteLength(ev: GameEvent): number {
  switch (ev.kind) {
    case 'muzzle':
      return 7;
    case 'hit':
      return 3;
    case 'kill':
      return 4;
    case 'aaFire':
      return 13;
    case 'aaDestroyed':
      return 3;
  }
}

/** Maksymalna liczba zdarzeń w jednej ramce (count to u8). */
export const MAX_EVENTS_PER_FRAME = 255;

/** Rozmiar ramki EVENT [bajty] dla danej listy zdarzeń (nagłówek u8 type + u8 count). */
export function eventsByteLength(events: readonly GameEvent[]): number {
  let n = 2;
  for (const ev of events) n += eventByteLength(ev);
  return n;
}

/**
 * Zapisuje paczkę zdarzeń do `view` (offset 0) i zwraca liczbę zapisanych bajtów.
 * `events.length` musi być ≤ MAX_EVENTS_PER_FRAME (caller dzieli na ramki, gdy więcej).
 */
export function encodeEvents(view: DataView, events: readonly GameEvent[]): number {
  if (events.length > MAX_EVENTS_PER_FRAME) {
    throw new NetError(`EVENT: za dużo zdarzeń w ramce (${String(events.length)})`);
  }
  view.setUint8(0, MSG_EVENT);
  view.setUint8(1, events.length);
  let o = 2;
  for (const ev of events) {
    switch (ev.kind) {
      case 'muzzle':
        view.setUint8(o, EV_MUZZLE);
        view.setUint8(o + 1, ev.ownerId & 0xff);
        view.setUint32(o + 2, ev.seed >>> 0, true);
        view.setUint8(o + 6, clamp(ev.shots, 0, 255));
        o += 7;
        break;
      case 'hit':
        view.setUint8(o, EV_HIT);
        view.setUint8(o + 1, ev.shooterId & 0xff);
        view.setUint8(o + 2, ev.victimId & 0xff);
        o += 3;
        break;
      case 'kill':
        view.setUint8(o, EV_KILL);
        view.setUint8(o + 1, ev.killerId & 0xff);
        view.setUint8(o + 2, ev.victimId & 0xff);
        view.setUint8(o + 3, KILL_CAUSES.indexOf(ev.cause));
        o += 4;
        break;
      case 'aaFire':
        view.setUint8(o, EV_AA_FIRE);
        view.setUint8(o + 1, ev.index & 0xff);
        view.setUint8(o + 2, clamp(ev.shots, 0, 255));
        view.setUint32(o + 3, ev.seed >>> 0, true);
        view.setInt16(o + 7, quantizeUnit(ev.dir.x), true);
        view.setInt16(o + 9, quantizeUnit(ev.dir.y), true);
        view.setInt16(o + 11, quantizeUnit(ev.dir.z), true);
        o += 13;
        break;
      case 'aaDestroyed':
        view.setUint8(o, EV_AA_DESTROYED);
        view.setUint8(o + 1, ev.index & 0xff);
        view.setUint8(o + 2, ev.killerId & 0xff);
        o += 3;
        break;
    }
  }
  return o;
}

/** Dekoduje paczkę zdarzeń. Rzuca NetError przy złym tagu/obciętej ramce. */
export function decodeEvents(view: DataView): GameEvent[] {
  if (view.byteLength < 2) throw new NetError(`EVENT: zbyt krótki (${String(view.byteLength)} B)`);
  if (view.getUint8(0) !== MSG_EVENT) throw new NetError(`EVENT: zły tag typu ${String(view.getUint8(0))}`);
  const count = view.getUint8(1);
  const events: GameEvent[] = [];
  let o = 2;
  for (let i = 0; i < count; i++) {
    if (o >= view.byteLength) throw new NetError('EVENT: ramka obcięta');
    const evType = view.getUint8(o);
    switch (evType) {
      case EV_MUZZLE:
        if (o + 7 > view.byteLength) throw new NetError('EVENT: MUZZLE obcięty');
        events.push({
          kind: 'muzzle',
          ownerId: view.getUint8(o + 1),
          seed: view.getUint32(o + 2, true),
          shots: view.getUint8(o + 6),
        });
        o += 7;
        break;
      case EV_HIT:
        if (o + 3 > view.byteLength) throw new NetError('EVENT: HIT obcięty');
        events.push({ kind: 'hit', shooterId: view.getUint8(o + 1), victimId: view.getUint8(o + 2) });
        o += 3;
        break;
      case EV_KILL: {
        if (o + 4 > view.byteLength) throw new NetError('EVENT: KILL obcięty');
        const cause = KILL_CAUSES[view.getUint8(o + 3)];
        if (!cause) throw new NetError(`EVENT: nieznany cause ${String(view.getUint8(o + 3))}`);
        events.push({ kind: 'kill', killerId: view.getUint8(o + 1), victimId: view.getUint8(o + 2), cause });
        o += 4;
        break;
      }
      case EV_AA_FIRE: {
        if (o + 13 > view.byteLength) throw new NetError('EVENT: AA_FIRE obcięty');
        const dir = new Vector3(
          dequantizeUnit(view.getInt16(o + 7, true)),
          dequantizeUnit(view.getInt16(o + 9, true)),
          dequantizeUnit(view.getInt16(o + 11, true)),
        ).normalize();
        events.push({
          kind: 'aaFire',
          index: view.getUint8(o + 1),
          shots: view.getUint8(o + 2),
          seed: view.getUint32(o + 3, true),
          dir,
        });
        o += 13;
        break;
      }
      case EV_AA_DESTROYED:
        if (o + 3 > view.byteLength) throw new NetError('EVENT: AA_DESTROYED obcięty');
        events.push({ kind: 'aaDestroyed', index: view.getUint8(o + 1), killerId: view.getUint8(o + 2) });
        o += 3;
        break;
      default:
        throw new NetError(`EVENT: nieznany podtyp ${String(evType)}`);
    }
  }
  return events;
}

// =========================== HANDSHAKE / EVENTY / LOBBY (JSON, tekst) ===========================
//
// Lobby (faza 10, docs/phases/faza-10.md): kanał tekstowy/JSON poza hot pathem
// (niezmiennik nr 6). Handshake przyjmuje gracza do LOBBY (nie od razu do gry);
// dalej gracz tworzy/dołącza do pokoju jawnymi wiadomościami. Render i ramki binarne
// INPUT/SNAPSHOT ruszają dopiero w stanie pokoju 'playing'.

/** Maksymalna długość nicka (znaki po sanityzacji). */
export const MAX_NICK_LENGTH = 16;
/** Maksymalna długość pojedynczej wiadomości czatu (znaki po sanityzacji). */
export const MAX_CHAT_LENGTH = 200;
/** Maksymalna liczba graczy w jednym pokoju (budżet snapshotu fazy 8). */
export const MAX_PLAYERS_PER_ROOM = 8;
/** Długość kodu pokoju (4 litery — dyktowane przez Discord). */
export const ROOM_CODE_LENGTH = 4;
/** Alfabet kodu pokoju bez mylących par O/0 oraz I/1 (pułapka faza-10.md). */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
/** Okno reconnectu po rozłączeniu [ms] — slot gracza czeka na ten sam token sesji. */
export const RECONNECT_WINDOW_MS = 60_000;

const NICK_FALLBACK = 'Pilot';
// whitelist znaków nicka: nick trafia do DOM innych graczy → żadnego HTML (XSS!).
// Litery (też z diakrytykami), cyfry, spacja i kilka bezpiecznych znaków.
const NICK_ALLOWED = /[\p{L}\p{N} ._-]/u;

/**
 * Sanityzuje nick z sieci/wejścia: whitelist znaków, zwinięcie spacji, limit długości.
 * Zwraca NICK_FALLBACK, gdy po oczyszczeniu nic nie zostało. NIGDY nie przepuszcza HTML.
 */
export function sanitizeNick(raw: unknown): string {
  if (typeof raw !== 'string') return NICK_FALLBACK;
  let out = '';
  for (const ch of raw.normalize('NFC')) {
    if (NICK_ALLOWED.test(ch)) out += ch;
    if (out.length >= MAX_NICK_LENGTH) break;
  }
  out = out.replace(/\s+/g, ' ').trim();
  return out.length > 0 ? out.slice(0, MAX_NICK_LENGTH) : NICK_FALLBACK;
}

/**
 * Sanityzuje treść czatu z sieci: wycina znaki sterujące, zwija białe znaki i przycina długość.
 * Bezpieczeństwo XSS NIE polega na whiteliście (czat dopuszcza interpunkcję/emoji) — treść trafia
 * do DOM WYŁĄCZNIE przez textContent (zob. lobby-ui). Pusty wynik = wiadomość do odrzucenia.
 */
export function sanitizeChat(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  let out = '';
  for (const ch of raw.normalize('NFC')) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) continue; // znaki sterujące (w tym nowe linie)
    out += ch;
    if (out.length >= MAX_CHAT_LENGTH) break;
  }
  return out.replace(/\s+/g, ' ').trim();
}

/** Czy `code` to poprawny kod pokoju (wielkie litery z alfabetu, właściwa długość). */
export function isValidRoomCode(code: unknown): code is string {
  if (typeof code !== 'string' || code.length !== ROOM_CODE_LENGTH) return false;
  for (const ch of code) {
    if (!ROOM_CODE_ALPHABET.includes(ch)) return false;
  }
  return true;
}

/** Stan pokoju: poczekalnia → gra → zakończony mecz. */
export type RoomState = 'waiting' | 'playing' | 'ended';

/** Skrót pokoju na liście otwartych pokoi. */
export interface RoomSummary {
  code: string;
  playerCount: number;
  maxPlayers: number;
  state: RoomState;
  /** Tryb meczu pokoju (faza 18): FFA albo drużynowy — lobby pokazuje go na liście. */
  mode: MatchMode;
}

/** Gracz w pokoju (lista poczekalni / scoreboard lobby). */
export interface RoomPlayer {
  id: number;
  nick: string;
  /** Wybrany typ samolotu (faza 19b) — w OBU trybach wprost wybór gracza (od 2026-06-25 drużyna
   *  i samolot są rozdzielone: dowolny samolot w dowolnej drużynie). */
  planeType: PlaneType;
  /** Frakcja/drużyna (faza 18): FFA → = id (każdy osobno); drużynowy → 0..TEAM_COUNT−1. Poczekalnia
   *  grupuje graczy po drużynach i koloruje wg tej wartości (rozdzielenie drużyna↔samolot 2026-06-25). */
  faction: number;
  /** Czy to bot (poczekalnia: tag [BOT] + ustalanie liczby botów po stronie hosta). */
  isBot: boolean;
  /** Gotowość gracza do startu (system „Gotów" 2026-06-26): host widzi, kto potwierdził skład, i
   *  startuje świadomie. Boty zawsze gotowe (true). Zmiana samolotu/drużyny zeruje gotowość — gracz
   *  potwierdza AKTUALNY wybór tuż przed grą. Pole addytywne JSON — bez bumpu protokołu. */
  ready: boolean;
  /** Poziom trudności TEGO bota (lobby slotowe RTS 2026-06-26): host edytuje go per slot, więc każdy
   *  bot może mieć inny poziom (np. 1 trudny + 5 łatwych). Obecne TYLKO dla botów (isBot=true);
   *  dla ludzi nieobecne/ignorowane. Pole addytywne JSON — bez bumpu protokołu. */
  botDifficulty?: DifficultyLevel;
}

// --- klient → serwer ---

/** Klient → serwer: zgłoszenie z wersją protokołu, nickiem i (opcjonalnie) tokenem reconnectu. */
export interface HelloMessage {
  t: 'hello';
  v: number;
  nick?: string;
  /** Token sesji z poprzedniego połączenia (localStorage) — próba reconnectu. */
  token?: string;
}

/** Klient → serwer: poproś o listę otwartych pokoi. */
export interface ListRoomsMessage {
  t: 'listRooms';
}

/** Klient → serwer: utwórz nowy pokój (zostajesz hostem). Host konfiguruje boty (faza 12)
 *  i tryb meczu (faza 18). */
export interface CreateRoomMessage {
  t: 'createRoom';
  /** Liczba botów do dołożenia (0..MAX_BOTS_PER_ROOM). Brak/poza zakresem → serwer klampuje. */
  bots?: number;
  /** Poziom trudności botów; brak/nieznany → serwerowy domyślny. */
  difficulty?: DifficultyLevel;
  /** Tryb meczu (faza 18): 'ffa' albo 'team'. Oba eliminacyjne jak SP (P1 2026-06-19: bez limitu
   *  zestrzeleń i czasu). Brak/nieznany → serwer klampuje do 'ffa' (clampMatchMode, niezm. nr 11). */
  mode?: MatchMode;
}

/** Klient → serwer: dołącz do pokoju o podanym kodzie. */
export interface JoinRoomMessage {
  t: 'joinRoom';
  code: string;
}

/** Klient → serwer: wybór typu samolotu (faza 19b). W OBU trybach wprost wybór płatowca (od
 *  2026-06-25 drużyna i samolot są rozdzielone — dowolny samolot w dowolnej drużynie). Serwer
 *  klampuje (clampPlaneType, niezm. nr 11) i stosuje przy najbliższym (re)spawnie. */
export interface SelectPlaneMessage {
  t: 'selectPlane';
  plane: PlaneType;
}

/** Klient → serwer: wybór drużyny w trybie drużynowym (rozdzielenie drużyna↔samolot 2026-06-25).
 *  Pozwala dwóm graczom celowo grać po tej samej stronie. Serwer klampuje `team` do [0,TEAM_COUNT)
 *  (niezm. nr 11) i przydziela frakcję od razu (wolny wybór — bez wymuszania balansu; boty wyrównują).
 *  Poza trybem drużynowym / poza pokojem ignorowany. Wartość addytywna JSON — bez bumpu protokołu. */
export interface SelectTeamMessage {
  t: 'selectTeam';
  team: number;
}

/** Klient → serwer: gracz oznacza GOTOWOŚĆ do startu (system „Gotów" 2026-06-26). Host widzi licznik
 *  gotowych i startuje świadomie (nie czeka na wszystkich — uniknięcie zakleszczenia przez AFK).
 *  Serwer zeruje gotowość przy zmianie samolotu/drużyny i na starcie meczu. Pole addytywne JSON. */
export interface SetReadyMessage {
  t: 'setReady';
  ready: boolean;
}

/**
 * Klient → serwer: HOST zmienia ustawienia pokoju w poczekalni (tryb / liczba botów / poziom).
 * Wspólne ustalanie odbywa się przez czat; zastosowanie ustawień jest po stronie hosta. Pola
 * opcjonalne — zmieniane tylko te podane. Serwer egzekwuje: tylko host i tylko w stanie 'waiting'
 * (poza meczem), klampuje wartości (niezm. nr 11). Zmiana liczby/poziomu botów = przebudowa botów.
 */
export interface UpdateRoomMessage {
  t: 'updateRoom';
  mode?: MatchMode;
  bots?: number;
  difficulty?: DifficultyLevel;
}

/**
 * Klient → serwer: HOST dodaje pojedynczego bota (lobby slotowe RTS 2026-06-26). W trybie drużynowym
 * trafia do wskazanej `team` (dowolne konfiguracje drużyn, np. „2 ludzi vs 6 botów"); w FFA `team`
 * pomijane. `difficulty` ustala poziom nowego bota (brak → serwerowy domyślny). Serwer egzekwuje:
 * tylko host, tylko w 'waiting', klampuje wartości i pojemność pokoju (niezm. nr 11). Addytywne JSON.
 */
export interface AddBotMessage {
  t: 'addBot';
  /** Drużyna dla nowego bota (tryb drużynowy): 0..TEAM_COUNT−1; poza zakresem/brak → auto-balans. */
  team?: number;
  /** Poziom nowego bota; brak/nieznany → serwerowy domyślny. */
  difficulty?: DifficultyLevel;
  /** Samolot nowego bota (host wybiera przy „+ dodaj bota"); brak → serwer losuje typ z id (jak dotąd). */
  plane?: PlaneType;
}

/** Klient → serwer: HOST usuwa konkretnego bota ze slotu (lobby slotowe RTS 2026-06-26). Tylko host
 *  i tylko w 'waiting'; serwer ignoruje, gdy `botId` nie wskazuje bota. Addytywne JSON. */
export interface RemoveBotMessage {
  t: 'removeBot';
  botId: number;
}

/**
 * Klient → serwer: HOST edytuje slot bota (lobby slotowe RTS 2026-06-26) — przenosi go do innej
 * drużyny (`team`, tylko tryb drużynowy) i/lub zmienia poziom (`difficulty`). Oba pola opcjonalne —
 * zmieniane tylko podane. Tylko host, tylko 'waiting'; serwer klampuje (niezm. nr 11). Addytywne JSON.
 */
export interface EditBotMessage {
  t: 'editBot';
  botId: number;
  team?: number;
  difficulty?: DifficultyLevel;
}

/** Klient → serwer: wyślij wiadomość na czat bieżącego pokoju (poczekalnia). Serwer sanityzuje
 *  (sanitizeChat), opatruje nadawcą i rozsyła do członków pokoju jako ChatMessage. */
export interface ChatSendMessage {
  t: 'chatSend';
  text: string;
}

/** Klient → serwer: szybka gra — dołącz do publicznego pokoju albo utwórz go. */
export interface QuickPlayMessage {
  t: 'quickPlay';
}

/** Klient → serwer: host startuje mecz (poczekalnia → gra). */
export interface StartMatchMessage {
  t: 'startMatch';
}

/** Klient → serwer: opuść bieżący pokój (powrót do lobby). */
export interface LeaveRoomMessage {
  t: 'leaveRoom';
}

/**
 * Klient → serwer: zakończ CAŁY mecz i wróć do poczekalni (gdy w grze są SAME boty — host kończy
 * misję). Serwer egzekwuje: tylko host i tylko gdy nie ma innych ludzi (humanCount ≤ 1) — inaczej
 * ignoruje, bo nie przerywamy gry pozostałym graczom (ci wychodzą przez leaveMatch). Bez bumpu wersji.
 */
export interface EndMatchMessage {
  t: 'endMatch';
}

/**
 * Klient → serwer: wycofaj się z trwającego meczu, ale ZOSTAŃ w pokoju (powrót do poczekalni bez
 * kończenia meczu — gdy grają jeszcze inni ludzie). Samolot natychmiast wypada z walki (martwy, bez
 * respawnu) i wraca do gry dopiero przy następnym starcie meczu. Bez bumpu wersji.
 */
export interface LeaveMatchMessage {
  t: 'leaveMatch';
}

/**
 * Klient → serwer: gracz zamknął tabelę wyników i wraca do poczekalni (2026-06-27). Tabela NIE znika
 * sama — każdy gracz zamyka ją własnym przyciskiem. Serwer: 'ended' → 'waiting' (idempotentne, dowolny
 * członek „budzi" pokój → znów dołączalny). No-op poza 'ended'. Bez bumpu wersji (addytywna wiadomość).
 */
export interface ReturnToWaitingMessage {
  t: 'returnToWaiting';
}

// --- serwer → klient ---

/** Serwer → klient: przyjęcie do lobby, parametry symulacji + token sesji do reconnectu.
 *  Id gracza jest per-pokój i przychodzi dopiero w RoomJoinedMessage.youId. */
export interface WelcomeMessage {
  t: 'welcome';
  protocolVersion: number;
  physicsHz: number;
  snapshotHz: number;
  /** Token sesji — klient zapisuje w localStorage i odsyła w hello przy reconnect. */
  sessionToken: string;
}

/** Serwer → klient: lista otwartych pokoi. */
export interface RoomListMessage {
  t: 'roomList';
  rooms: RoomSummary[];
}

/** Serwer → klient: potwierdzenie wejścia do pokoju (po create/join/quickPlay/reconnect). */
export interface RoomJoinedMessage {
  t: 'roomJoined';
  code: string;
  /** Id TEGO gracza w pokoju (= playerId encji w snapshocie). */
  youId: number;
  hostId: number;
  state: RoomState;
  /** Tryb meczu pokoju (faza 18) — render poczekalni: drużynowy pokazuje dodatkowo selektor
   *  drużyny (rozdzielenie drużyna↔samolot 2026-06-25); samolot wybierany niezależnie w obu trybach. */
  mode: MatchMode;
  /** Poziom trudności botów pokoju — poczekalnia odświeża selektor hosta (ustawienia na żywo). */
  difficulty: DifficultyLevel;
  players: RoomPlayer[];
}

/** Serwer → klient: zmiana składu/hosta/stanu/ustawień pokoju (broadcast do członków). */
export interface RoomUpdateMessage {
  t: 'roomUpdate';
  hostId: number;
  state: RoomState;
  /** Tryb meczu pokoju (faza 19b) — jak w RoomJoinedMessage (poczekalnia pokazuje selektor
   *  drużyny w trybie drużynowym; samolot wybierany niezależnie). */
  mode: MatchMode;
  /** Poziom trudności botów pokoju — poczekalnia odświeża selektor hosta (ustawienia na żywo). */
  difficulty: DifficultyLevel;
  players: RoomPlayer[];
}

/**
 * Serwer → klient: wiadomość czatu pokoju (broadcast). Treść już zsanityzowana po stronie serwera
 * (sanitizeChat) — klient i tak renderuje WYŁĄCZNIE przez textContent (XSS). `id`=null → komunikat
 * systemowy (np. zmiana ustawień przez hosta), inaczej id nadawcy (do podświetlenia własnych).
 */
export interface ChatMessage {
  t: 'chat';
  id: number | null;
  nick: string;
  text: string;
}

/** Serwer → klient: mecz wystartował (poczekalnia → gra; klient włącza render). */
export interface MatchStartedMessage {
  t: 'matchStarted';
}

/**
 * Powód zakończenia meczu: eliminacja (`'score'` — ostatni ocalały w FFA / ostatnia drużyna)
 * albo przejęcie strefy kontroli (`'zone'`, faza 17 — KotH jako dodatkowy warunek zwycięstwa).
 * P1 (2026-06-19): oba tryby eliminacyjne jak SP → BRAK limitu czasu (`'time'` usunięty);
 * klient rozróżnia FFA↔drużynowy po `mode`.
 */
export type MatchEndReason = 'score' | 'zone';

/** Jeden wiersz tabeli wyników (faza 13) — autorytet serwera; klient tylko wyświetla. */
export interface StandingRow {
  id: number;
  nick: string;
  /** Frakcja/drużyna gracza (faza 18). FFA: frakcja = id (każdy osobno). Drużynowy: 0/1 (drużyna).
   *  Klient koloruje markery wróg/sojusznik i grupuje scoreboard drużynowy po tym polu. */
  faction: number;
  kills: number;
  deaths: number;
  assists: number;
  /** Zniszczone naziemne stanowiska ogniowe (po EMPLACEMENT_POINTS pkt; v6). */
  groundKills: number;
  /** Szacowany ping [ms] (serwer liczy z echa ticku, bez synchronizacji zegarów); bot = 0. */
  pingMs: number;
  isBot: boolean;
  /** Zakumulowane sekundy WYŁĄCZNEJ kontroli strefy przez frakcję tego gracza (faza 17;
   *  FFA: frakcja = id gracza). Serwer liczy autorytatywnie — klient tylko wyświetla. */
  zoneSeconds: number;
}

/**
 * Bieżąca okupacja strefy kontroli (faza 17) — do statusu paska ZoneBar. Perspektywa-niezależna:
 * klient porównuje `controlling` ze swoim id (FFA: frakcja = id) i liczy fronty z `zoneSeconds`
 * wierszy. Sporna strefa → controlling=null, occupied=true (pauza ≠ pusta).
 */
export interface ZoneStatus {
  /** Frakcja kontrolująca strefę teraz albo null (pusta LUB sporna). */
  controlling: number | null;
  /** Czy w strefie jest co najmniej jeden żywy samolot (rozróżnia pauzę spornej od pustej). */
  occupied: boolean;
}

/** Serwer → klient: tabela wyników (Tab) + metryki meczu. Rozsyłana ~STANDINGS_BROADCAST_HZ. */
export interface StandingsMessage {
  t: 'standings';
  /** Tryb meczu (faza 18) — klient przełącza render FFA↔drużynowy (kolory markerów, scoreboard). */
  mode: MatchMode;
  /** Posortowane rankingiem FFA (najlepszy pierwszy). */
  rows: StandingRow[];
  /** Bieżąca okupacja strefy kontroli (faza 17) — status paska ZoneBar. Frakcja = drużyna w team. */
  zone: ZoneStatus;
  /** Stan naziemnych stanowisk ogniowych (v6): true = zniszczone. Indeks = EMPLACEMENT index. Dla
   *  późno dołączających, by od razu pokazać już zniszczone stanowiska (czarne, dymiące). */
  aaDestroyed: boolean[];
}

/** Serwer → klient: koniec meczu — zwycięzca + finalna tabela (ekran wyników, rewanż). */
export interface MatchEndedMessage {
  t: 'matchEnded';
  /** Tryb zakończonego meczu (faza 18) — klient renderuje ekran wyników FFA albo drużynowy. */
  mode: MatchMode;
  /** Id zwycięzcy (FFA: lider; drużynowy: najlepszy gracz zwycięskiej drużyny) albo null. */
  winnerId: number | null;
  /** Zwycięska frakcja/drużyna (faza 18) — null w FFA i przy remisie (obustronna eliminacja). */
  winningFaction: number | null;
  reason: MatchEndReason;
  rows: StandingRow[];
}

/** Serwer → klient: serwer się zamyka (SIGTERM/restart) — klient pokazuje komunikat, nie spinner. */
export interface ServerShutdownMessage {
  t: 'serverShutdown';
  message: string;
}

/** Serwer → klient: odrzucenie/błąd. Część kodów zamyka połączenie, część zostaje w lobby. */
export interface ErrorMessage {
  t: 'error';
  code: 'version' | 'malformed' | 'full' | 'internal' | 'badCode' | 'notHost' | 'notInRoom';
  message: string;
}

export type ControlMessage =
  | HelloMessage
  | ListRoomsMessage
  | CreateRoomMessage
  | JoinRoomMessage
  | SelectPlaneMessage
  | SelectTeamMessage
  | SetReadyMessage
  | UpdateRoomMessage
  | AddBotMessage
  | RemoveBotMessage
  | EditBotMessage
  | ChatSendMessage
  | QuickPlayMessage
  | StartMatchMessage
  | LeaveRoomMessage
  | EndMatchMessage
  | LeaveMatchMessage
  | ReturnToWaitingMessage
  | WelcomeMessage
  | RoomListMessage
  | RoomJoinedMessage
  | RoomUpdateMessage
  | ChatMessage
  | MatchStartedMessage
  | StandingsMessage
  | MatchEndedMessage
  | ServerShutdownMessage
  | ErrorMessage;

const CONTROL_TAGS: ReadonlySet<string> = new Set([
  'hello',
  'listRooms',
  'createRoom',
  'joinRoom',
  'selectPlane',
  'selectTeam',
  'setReady',
  'updateRoom',
  'addBot',
  'removeBot',
  'editBot',
  'chatSend',
  'quickPlay',
  'startMatch',
  'leaveRoom',
  'endMatch',
  'leaveMatch',
  'returnToWaiting',
  'welcome',
  'roomList',
  'roomJoined',
  'roomUpdate',
  'chat',
  'matchStarted',
  'standings',
  'matchEnded',
  'serverShutdown',
  'error',
]);

/** Parsuje ramkę tekstową na wiadomość kontrolną. Zwraca null, gdy to nie nasz JSON. */
export function parseControlMessage(text: string): ControlMessage | null {
  let obj: unknown;
  try {
    obj = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof obj !== 'object' || obj === null) return null;
  const t = (obj as { t?: unknown }).t;
  if (typeof t === 'string' && CONTROL_TAGS.has(t)) {
    return obj as ControlMessage;
  }
  return null;
}
