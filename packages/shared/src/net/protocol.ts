import { Quaternion, Vector3 } from 'three';
import { NetError } from '../errors';
import type { DifficultyLevel } from '../ai/difficulty';
import type { LifePhase, PlaneState } from '../physics/state';

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
 */
export const PROTOCOL_VERSION = 2;

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
}

export const SNAPSHOT_HEADER_BYTES = 10; // u8 type | u32 tick | u32 ack | u8 count
export const SNAPSHOT_ENTITY_BYTES = 30; // u8 id | u8 flags | f32×3 pos | i16×4 orient | i16×3 vel | u8 throttle | u8 hp

/** Rozmiar snapshotu [bajty] dla zadanej liczby encji — do budżetu pasma. */
export function snapshotByteLength(entityCount: number): number {
  return SNAPSHOT_HEADER_BYTES + entityCount * SNAPSHOT_ENTITY_BYTES;
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

/** Rodzaj śmierci w zdarzeniu KILL. */
export type KillCause = 'air' | 'ground' | 'collision';
const KILL_CAUSES: readonly KillCause[] = ['air', 'ground', 'collision'];

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
  /** Strzelec (znaczący tylko dla cause='air'; dla ziemi/kolizji bez sprawcy). */
  killerId: number;
  victimId: number;
  cause: KillCause;
}

export type GameEvent = MuzzleEvent | HitEvent | KillEvent;

// rozmiary z bajtem podtypu: muzzle 7, hit 3, kill 4
function eventByteLength(ev: GameEvent): number {
  switch (ev.kind) {
    case 'muzzle':
      return 7;
    case 'hit':
      return 3;
    case 'kill':
      return 4;
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
}

/** Gracz w pokoju (lista poczekalni / scoreboard lobby). */
export interface RoomPlayer {
  id: number;
  nick: string;
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
 *  i limit zestrzeleń meczu FFA (faza 13). */
export interface CreateRoomMessage {
  t: 'createRoom';
  /** Liczba botów do dołożenia (0..MAX_BOTS_PER_ROOM). Brak/poza zakresem → serwer klampuje. */
  bots?: number;
  /** Poziom trudności botów; brak/nieznany → serwerowy domyślny. */
  difficulty?: DifficultyLevel;
  /** Limit zestrzeleń kończący mecz (5/10/20). Brak/poza listą → serwer klampuje (faza 13). */
  scoreLimit?: number;
}

/** Klient → serwer: dołącz do pokoju o podanym kodzie. */
export interface JoinRoomMessage {
  t: 'joinRoom';
  code: string;
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
  players: RoomPlayer[];
}

/** Serwer → klient: zmiana składu/hosta/stanu pokoju (broadcast do członków). */
export interface RoomUpdateMessage {
  t: 'roomUpdate';
  hostId: number;
  state: RoomState;
  players: RoomPlayer[];
}

/** Serwer → klient: mecz wystartował (poczekalnia → gra; klient włącza render). */
export interface MatchStartedMessage {
  t: 'matchStarted';
}

/** Powód zakończenia meczu FFA (faza 13): osiągnięty limit zestrzeleń albo limit czasu. */
export type MatchEndReason = 'score' | 'time';

/** Jeden wiersz tabeli wyników (faza 13) — autorytet serwera; klient tylko wyświetla. */
export interface StandingRow {
  id: number;
  nick: string;
  kills: number;
  deaths: number;
  assists: number;
  /** Szacowany ping [ms] (serwer liczy z echa ticku, bez synchronizacji zegarów); bot = 0. */
  pingMs: number;
  isBot: boolean;
}

/** Serwer → klient: tabela wyników (Tab) + metryki meczu. Rozsyłana ~STANDINGS_BROADCAST_HZ. */
export interface StandingsMessage {
  t: 'standings';
  /** Posortowane rankingiem FFA (najlepszy pierwszy). */
  rows: StandingRow[];
  scoreLimit: number;
  /** Pozostały czas meczu [s] (serwer liczy zegar; klient tylko wyświetla). */
  timeLeftS: number;
}

/** Serwer → klient: koniec meczu — zwycięzca + finalna tabela (ekran wyników, rewanż). */
export interface MatchEndedMessage {
  t: 'matchEnded';
  /** Id zwycięzcy albo null (brak rozstrzygnięcia). */
  winnerId: number | null;
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
  | QuickPlayMessage
  | StartMatchMessage
  | LeaveRoomMessage
  | WelcomeMessage
  | RoomListMessage
  | RoomJoinedMessage
  | RoomUpdateMessage
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
  'quickPlay',
  'startMatch',
  'leaveRoom',
  'welcome',
  'roomList',
  'roomJoined',
  'roomUpdate',
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
