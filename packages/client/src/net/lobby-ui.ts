import {
  DIFFICULTY_LEVELS,
  MAX_NICK_LENGTH,
  MAX_PLAYERS_PER_ROOM,
  ROOM_CODE_LENGTH,
  ZONE_CAPTURE_SECONDS,
  sanitizeNick,
  type DifficultyLevel,
  type MatchMode,
  type RoomPlayer,
  type RoomState,
  type RoomSummary,
} from '@air-combat/shared';

/** Maks. botów do dołożenia = pojemność pokoju − 1 slot na hosta (zgodnie z serwerem). */
const MAX_BOTS = MAX_PLAYERS_PER_ROOM - 1;

/** Etykiety poziomów trudności dla UI (klucze JSON są bez polskich znaków). */
const DIFFICULTY_LABELS: Record<DifficultyLevel, string> = {
  latwy: 'łatwy',
  normalny: 'normalny',
  trudny: 'trudny',
};

/** Tryby meczu w kolejności wyboru (faza 18) + ich etykiety dla selecta. */
const MODE_OPTIONS: readonly { value: MatchMode; label: string }[] = [
  { value: 'ffa', label: 'FFA (każdy na każdego)' },
  { value: 'team', label: 'Drużynowy (2 drużyny)' },
];

// Sterowanie w wersji ONLINE (onboarding, parytet z ekranem „JAK GRAĆ" w menu.ts SP).
// Źródło prawdy = input.ts + obsługa klawiszy w online-main.ts. Różnice względem SP: BEZ
// „Respawn (R)" (w MP nie ma respawnu graczem), dochodzi „Panel sieci (N)".
const ONLINE_CONTROL_ROWS: readonly (readonly [string, string])[] = [
  ['Celowanie / lot', 'Mysz (kliknij w ekran)'],
  ['Ogień', 'LPM  •  Spacja'],
  ['Nos w górę / w dół', 'S / ↓   •   W / ↑'],
  ['Przechylenie L / P', 'A / ←   •   D / →'],
  ['Ster kierunku L / P', 'Q   •   E'],
  ['Gaz +  /  −', 'L.Shift  /  L.Ctrl'],
  ['Kamera (pościg / orbita)', 'C'],
  ['Tabela wyników', 'Tab (przytrzymaj)'],
  ['Panel sieci', 'N'],
];

/** Klucz localStorage: czy gracz widział już ekran sterowania online (auto-pokaz tylko 1×). */
const HELP_SEEN_KEY = 'air-combat:help-seen-online';

/** Czy onboarding był już pokazany (localStorage bywa niedostępny — wtedy „tak", bez zapętlenia). */
function helpSeenOnline(): boolean {
  try {
    return localStorage.getItem(HELP_SEEN_KEY) === '1';
  } catch {
    return true;
  }
}

function markHelpSeenOnline(): void {
  try {
    localStorage.setItem(HELP_SEEN_KEY, '1');
  } catch {
    /* brak localStorage — trudno; onboarding i tak dostępny pod przyciskiem */
  }
}

// Ekrany lobby (faza 10) jako vanilla DOM nad canvasem (decyzja PLAN.md — Preact dopiero,
// gdy vanilla zaboli). Dwa widoki: 'entry' (nick + szybka gra / utwórz / dołącz kodem +
// lista pokoi) i 'waiting' (poczekalnia: kod pokoju, lista graczy, Start dla hosta) na tle
// grafiki dogfight. Nicki innych graczy trafiają do DOM → ZAWSZE przez textContent / escape
// (XSS). Moduł nie zna sieci: woła callbacki, a online-main spina go z NetClient.

export interface LobbyCallbacks {
  onQuickPlay(): void;
  onCreateRoom(bots: number, difficulty: DifficultyLevel, mode: MatchMode): void;
  onJoinRoom(code: string): void;
  onRefreshList(): void;
  onStartMatch(): void;
  onLeaveRoom(): void;
}

export interface WaitingView {
  code: string;
  state: RoomState;
  players: RoomPlayer[];
  hostId: number;
  youId: number;
}

const NICK_STORAGE_KEY = 'air-combat:nick';

export class LobbyUI {
  private readonly root: HTMLDivElement;
  private readonly entry: HTMLDivElement;
  private readonly waiting: HTMLDivElement;
  private readonly help: HTMLDivElement;
  private readonly nickInput: HTMLInputElement;
  private readonly modeSelect: HTMLSelectElement;
  private readonly botCountSelect: HTMLSelectElement;
  private readonly difficultySelect: HTMLSelectElement;
  private readonly codeInput: HTMLInputElement;
  private readonly roomListEl: HTMLDivElement;
  private readonly errorEl: HTMLDivElement;
  private readonly waitingCodeEl: HTMLDivElement;
  private readonly waitingPlayersEl: HTMLDivElement;
  private readonly startBtn: HTMLButtonElement;
  private readonly waitingHintEl: HTMLDivElement;

  constructor(private readonly cb: LobbyCallbacks) {
    injectStyles();
    this.root = el('div', 'lobby-root');

    // --- ekran wejściowy ---
    this.entry = el('div', 'lobby-screen lobby-entry');
    const title = el('div', 'lobby-title');
    title.textContent = 'AIR COMBAT — DOGFIGHT';
    const sub = el('div', 'lobby-sub');
    sub.textContent = 'Spitfire Mk II — multiplayer';

    const nickRow = el('div', 'lobby-row');
    const nickLabel = el('label', 'lobby-label');
    nickLabel.textContent = 'Twój nick';
    this.nickInput = document.createElement('input');
    this.nickInput.className = 'lobby-input';
    this.nickInput.maxLength = MAX_NICK_LENGTH;
    this.nickInput.placeholder = 'Pilot';
    this.nickInput.value = loadNick();
    this.nickInput.addEventListener('change', () => saveNick(this.nickInput.value));
    nickRow.append(nickLabel, this.nickInput);

    const quickBtn = button('Szybka gra', 'lobby-btn lobby-btn-primary', () => {
      this.beforeAction();
      this.cb.onQuickPlay();
    });
    // tryb meczu hosta (faza 18): FFA albo drużynowy. P1: oba eliminacyjne jak SP (bez limitu
    // zestrzeleń i czasu), więc tryb różni się już tylko frakcjami (FFA = każdy osobno).
    const modeRow = el('div', 'lobby-row lobby-bot-row');
    const modeLabel = el('label', 'lobby-label');
    modeLabel.textContent = 'Tryb';
    this.modeSelect = selectEl(
      'lobby-select lobby-select-mode',
      MODE_OPTIONS.map((o) => ({ value: o.value, label: o.label })),
      'ffa',
    );
    modeRow.append(modeLabel, this.modeSelect);

    // konfiguracja botów hosta (faza 12): liczba 0..MAX_BOTS + poziom trudności
    const botRow = el('div', 'lobby-row lobby-bot-row');
    const botLabel = el('label', 'lobby-label');
    botLabel.textContent = 'Boty';
    this.botCountSelect = selectEl(
      'lobby-select lobby-select-bots',
      Array.from({ length: MAX_BOTS + 1 }, (_, i) => ({ value: String(i), label: String(i) })),
      '3',
    );
    const diffLabel = el('label', 'lobby-label');
    diffLabel.textContent = 'poziom';
    this.difficultySelect = selectEl(
      'lobby-select',
      DIFFICULTY_LEVELS.map((lvl) => ({ value: lvl, label: DIFFICULTY_LABELS[lvl] })),
      'normalny',
    );
    botRow.append(botLabel, this.botCountSelect, diffLabel, this.difficultySelect);

    // P1 (2026-06-19): brak wiersza „Mecz do N zestrzeleń" — oba tryby są eliminacyjne jak SP
    // (last-man-standing / ostatnia drużyna + strefa), bez limitu zestrzeleń i czasu.

    const createBtn = button('Utwórz pokój', 'lobby-btn', () => {
      this.beforeAction();
      this.cb.onCreateRoom(this.botCount, this.difficulty, this.mode);
    });

    const joinRow = el('div', 'lobby-row lobby-join-row');
    this.codeInput = document.createElement('input');
    this.codeInput.className = 'lobby-input lobby-code-input';
    this.codeInput.maxLength = ROOM_CODE_LENGTH;
    this.codeInput.placeholder = 'KOD';
    this.codeInput.autocapitalize = 'characters';
    this.codeInput.addEventListener('input', () => {
      this.codeInput.value = this.codeInput.value.toUpperCase();
    });
    const joinBtn = button('Dołącz', 'lobby-btn', () => this.tryJoin());
    this.codeInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.tryJoin();
    });
    joinRow.append(this.codeInput, joinBtn);

    this.errorEl = el('div', 'lobby-error');

    const listHead = el('div', 'lobby-list-head');
    const listTitle = el('span', '');
    listTitle.textContent = 'Otwarte pokoje';
    const refreshBtn = button('Odśwież', 'lobby-btn lobby-btn-small', () => this.cb.onRefreshList());
    listHead.append(listTitle, refreshBtn);
    this.roomListEl = el('div', 'lobby-room-list');

    const helpBtn = button('❔ Jak grać — sterowanie i cel', 'lobby-btn lobby-btn-small', () =>
      this.showHelp(),
    );

    this.entry.append(
      title,
      sub,
      nickRow,
      quickBtn,
      modeRow,
      botRow,
      createBtn,
      joinRow,
      this.errorEl,
      listHead,
      this.roomListEl,
      helpBtn,
      attributionEl(),
    );

    // --- poczekalnia ---
    this.waiting = el('div', 'lobby-screen lobby-waiting');
    const wTitle = el('div', 'lobby-title');
    wTitle.textContent = 'POCZEKALNIA';
    const codeCaption = el('div', 'lobby-label');
    codeCaption.textContent = 'Kod pokoju (podaj znajomym)';
    this.waitingCodeEl = el('div', 'lobby-code');
    this.waitingPlayersEl = el('div', 'lobby-players');
    this.waitingHintEl = el('div', 'lobby-sub');
    this.startBtn = button('Start meczu', 'lobby-btn lobby-btn-primary', () => this.cb.onStartMatch());
    const leaveBtn = button('Wyjdź', 'lobby-btn lobby-btn-small', () => this.cb.onLeaveRoom());
    const panel = el('div', 'lobby-panel');
    panel.append(wTitle, codeCaption, this.waitingCodeEl, this.waitingPlayersEl, this.waitingHintEl, this.startBtn, leaveBtn);
    this.waiting.append(panel);

    // --- nakładka „jak grać" (onboarding, parytet z menu.ts SP) ---
    this.help = el('div', 'lobby-help');
    const helpPanel = el('div', 'lobby-help-panel');
    const hTitle = el('div', 'lobby-title');
    hTitle.textContent = 'JAK GRAĆ';
    const hSub = el('div', 'lobby-sub');
    hSub.textContent = 'Spitfire Mk IIa — kamera pościgowa, celowanie myszą';
    const helpTable = el('table', 'lobby-help-table');
    for (const [action, keys] of ONLINE_CONTROL_ROWS) {
      const tr = document.createElement('tr');
      const actionCell = el('td', 'lobby-help-action');
      actionCell.textContent = action;
      const keysCell = el('td', 'lobby-help-keys');
      keysCell.textContent = keys;
      tr.append(actionCell, keysCell);
      helpTable.append(tr);
    }
    const goal = el('div', 'lobby-help-goal');
    const zoneMin = Math.round(ZONE_CAPTURE_SECONDS / 60);
    goal.textContent =
      `Cel: utrzymaj STREFĘ nad górą przez ${String(zoneMin)} min albo wybij wrogów. ` +
      `Uważaj na ziemię i przeciągnięcie przy ostrym zakręcie.`;
    const helpClose = button('▶ Zaczynamy', 'lobby-btn lobby-btn-primary', () => this.hideHelp());
    helpPanel.append(hTitle, hSub, helpTable, goal, helpClose);
    this.help.append(helpPanel);

    this.root.append(this.entry, this.waiting, this.help);
    document.body.appendChild(this.root);
    this.hide();
  }

  get nick(): string {
    return sanitizeNick(this.nickInput.value);
  }

  private get mode(): MatchMode {
    return this.modeSelect.value === 'team' ? 'team' : 'ffa';
  }

  private get botCount(): number {
    return Number(this.botCountSelect.value) || 0;
  }

  private get difficulty(): DifficultyLevel {
    return this.difficultySelect.value as DifficultyLevel;
  }

  private beforeAction(): void {
    saveNick(this.nickInput.value);
    this.clearError();
  }

  private tryJoin(): void {
    const code = this.codeInput.value.trim().toUpperCase();
    if (code.length !== ROOM_CODE_LENGTH) {
      this.setError(`Kod pokoju ma ${String(ROOM_CODE_LENGTH)} znaki.`);
      return;
    }
    this.beforeAction();
    this.cb.onJoinRoom(code);
  }

  showEntry(): void {
    this.root.classList.add('show');
    this.entry.classList.add('show');
    this.waiting.classList.remove('show');
    // onboarding przy 1. wejściu do lobby (parytet z SP) — potem dostępny pod przyciskiem
    if (!helpSeenOnline()) {
      markHelpSeenOnline();
      this.showHelp();
    }
  }

  /** Nakładka sterowania/celu (onboarding). Auto przy 1. wizycie + ręcznie z przycisku. */
  showHelp(): void {
    this.help.classList.add('show');
  }

  private hideHelp(): void {
    this.help.classList.remove('show');
  }

  setRoomList(rooms: RoomSummary[]): void {
    this.roomListEl.replaceChildren();
    if (rooms.length === 0) {
      const empty = el('div', 'lobby-room-empty');
      empty.textContent = 'Brak otwartych pokoi — utwórz własny.';
      this.roomListEl.append(empty);
      return;
    }
    for (const r of rooms) {
      const row = el('div', 'lobby-room-row');
      const info = el('span', '');
      const stateLabel = r.state === 'waiting' ? 'poczekalnia' : r.state === 'playing' ? 'w grze' : 'koniec';
      const modeLabel = r.mode === 'team' ? 'drużynowy' : 'FFA';
      info.textContent = `${r.code}  ·  ${modeLabel}  ·  ${String(r.playerCount)}/${String(r.maxPlayers)}  ·  ${stateLabel}`;
      const joinBtn = button('Dołącz', 'lobby-btn lobby-btn-small', () => {
        this.beforeAction();
        this.cb.onJoinRoom(r.code);
      });
      row.append(info, joinBtn);
      this.roomListEl.append(row);
    }
  }

  showWaiting(view: WaitingView): void {
    this.root.classList.add('show');
    this.waiting.classList.add('show');
    this.entry.classList.remove('show');
    this.updateWaiting(view);
  }

  updateWaiting(view: WaitingView): void {
    this.waitingCodeEl.textContent = view.code;
    this.waitingPlayersEl.replaceChildren();
    for (const p of view.players) {
      const row = el('div', 'lobby-player-row');
      const tag = el('span', 'lobby-player-tag');
      tag.textContent = p.id === view.hostId ? 'HOST' : p.id === view.youId ? 'TY' : '';
      const name = el('span', 'lobby-player-name');
      name.textContent = p.nick; // textContent → bez interpretacji HTML (XSS)
      row.append(tag, name);
      this.waitingPlayersEl.append(row);
    }
    const isHost = view.youId === view.hostId;
    this.startBtn.style.display = isHost ? '' : 'none';
    this.waitingHintEl.textContent = isHost
      ? 'Jesteś hostem — wystartuj, gdy zbierze się ekipa.'
      : 'Czekaj, aż host wystartuje mecz…';
  }

  setError(message: string): void {
    this.errorEl.textContent = message;
    this.errorEl.classList.add('show');
  }

  clearError(): void {
    this.errorEl.textContent = '';
    this.errorEl.classList.remove('show');
  }

  hide(): void {
    this.root.classList.remove('show');
    this.entry.classList.remove('show');
    this.waiting.classList.remove('show');
    this.help.classList.remove('show');
  }
}

function loadNick(): string {
  try {
    return localStorage.getItem(NICK_STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

function saveNick(raw: string): void {
  try {
    localStorage.setItem(NICK_STORAGE_KEY, sanitizeNick(raw));
  } catch {
    /* localStorage niedostępny (tryb prywatny) — pomiń */
  }
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function button(label: string, className: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = className;
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

/**
 * Atrybucja modelu 3D na ekranie wejściowym lobby. CC-BY 4.0 wymaga widocznego uznania
 * autorstwa w KAŻDYM wydaniu używającym assetu — publiczny deploy online ładuje ten sam GLB
 * co SP (plane-mesh.ts), więc kredyt jest wymagany licencją (parytet z modelAttribution() w
 * menu.ts). Tekst przez textContent + kontrolowany link (bez innerHTML — bezpieczeństwo).
 */
function attributionEl(): HTMLDivElement {
  const wrap = el('div', 'lobby-attribution');
  wrap.append(document.createTextNode('Model: „Supermarine Spitfire Mk.IIa" — '));
  const a = document.createElement('a');
  a.textContent = 'barking_dogo';
  a.href = 'https://sketchfab.com/barking_dogo';
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  wrap.append(a, document.createTextNode(' (Sketchfab) — licencja CC-BY 4.0'));
  return wrap;
}

function selectEl(
  className: string,
  options: readonly { value: string; label: string }[],
  selected: string,
): HTMLSelectElement {
  const sel = document.createElement('select');
  sel.className = className;
  for (const o of options) {
    const opt = document.createElement('option');
    opt.value = o.value;
    opt.textContent = o.label;
    if (o.value === selected) opt.selected = true;
    sel.append(opt);
  }
  return sel;
}

let stylesInjected = false;
function injectStyles(): void {
  if (stylesInjected) return;
  stylesInjected = true;
  const style = document.createElement('style');
  style.textContent = LOBBY_CSS;
  document.head.appendChild(style);
}

const LOBBY_CSS = `
.lobby-root { position: fixed; inset: 0; z-index: 45; display: none; }
.lobby-root.show { display: block; }
.lobby-screen {
  position: absolute; inset: 0; display: none;
  flex-direction: column; align-items: center; justify-content: center;
  gap: 14px; padding: 24px; box-sizing: border-box;
  font: 16px/1.5 monospace; color: #eaf3ff;
}
.lobby-screen.show { display: flex; }
.lobby-entry {
  background: radial-gradient(circle at 50% 30%, #16314a 0%, #070d15 78%);
}
.lobby-waiting {
  /* tło poczekalni: grafika dogfight (assets/ serwowane pod /) */
  background: #070d15 center/cover no-repeat;
  background-image: linear-gradient(rgba(7,13,21,0.55), rgba(7,13,21,0.78)), url('/dogfight-splash.jpg');
}
.lobby-title { font: 700 30px monospace; letter-spacing: 2px; color: #ffd24a; text-shadow: 0 2px 8px rgba(0,0,0,0.8); }
.lobby-sub { color: #9fc4e6; }
.lobby-row { display: flex; align-items: center; gap: 10px; }
.lobby-join-row { gap: 8px; }
.lobby-label { color: #9fc4e6; font-size: 14px; }
.lobby-input {
  font: 16px monospace; padding: 9px 12px; min-width: 200px;
  color: #eaf3ff; background: rgba(10,20,32,0.9);
  border: 1px solid #345; border-radius: 6px; outline: none;
}
.lobby-input:focus { border-color: #6aa8da; }
.lobby-code-input { min-width: 110px; text-transform: uppercase; letter-spacing: 3px; text-align: center; }
.lobby-bot-row { gap: 8px; }
.lobby-select {
  font: 15px monospace; padding: 8px 10px; cursor: pointer;
  color: #eaf3ff; background: rgba(10,20,32,0.9);
  border: 1px solid #345; border-radius: 6px; outline: none;
}
.lobby-select:focus { border-color: #6aa8da; }
.lobby-select-bots { min-width: 56px; }
.lobby-select-mode { min-width: 200px; }
.lobby-btn {
  font: 600 15px/1 monospace; padding: 11px 22px; cursor: pointer;
  color: #eaf3ff; background: rgba(40,60,80,0.92);
  border: 1px solid #4a6c8c; border-radius: 6px; min-width: 200px;
}
.lobby-btn:hover { background: rgba(56,82,108,0.95); }
.lobby-btn-primary { background: #c8581f; border-color: #e2772f; color: #fff; }
.lobby-btn-primary:hover { background: #db6322; }
.lobby-btn-small { min-width: auto; padding: 8px 14px; font-size: 13px; }
.lobby-error { color: #ff8a6a; min-height: 20px; text-align: center; max-width: 460px; }
.lobby-error.show { margin: 2px 0; }
.lobby-list-head { display: flex; align-items: center; justify-content: space-between; gap: 16px; width: 320px; margin-top: 10px; color: #9fc4e6; }
.lobby-room-list { width: 320px; max-height: 200px; overflow-y: auto; display: flex; flex-direction: column; gap: 6px; }
.lobby-room-row, .lobby-room-empty {
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
  padding: 8px 12px; background: rgba(12,22,34,0.85); border: 1px solid #2a3f54; border-radius: 6px;
}
.lobby-room-empty { justify-content: center; color: #7a93ab; }
.lobby-panel {
  display: flex; flex-direction: column; align-items: center; gap: 12px;
  padding: 28px 36px; border-radius: 12px;
  background: rgba(7,13,21,0.72); border: 1px solid #2a3f54;
  box-shadow: 0 10px 40px rgba(0,0,0,0.5);
}
.lobby-code {
  font: 700 44px monospace; letter-spacing: 10px; color: #ffd24a;
  padding: 6px 18px; text-shadow: 0 2px 8px rgba(0,0,0,0.9);
}
.lobby-players { display: flex; flex-direction: column; gap: 4px; min-width: 240px; }
.lobby-player-row { display: flex; align-items: center; gap: 10px; padding: 5px 10px; background: rgba(12,22,34,0.8); border-radius: 5px; }
.lobby-player-tag { width: 44px; font-size: 12px; font-weight: 700; color: #ffd24a; }
.lobby-player-name { color: #eaf3ff; }
.lobby-attribution { margin-top: 16px; font: 11px/1.4 monospace; color: #5f7488; max-width: 34em; text-align: center; }
.lobby-attribution a { color: #6a93b8; }
.lobby-help {
  position: absolute; inset: 0; z-index: 2; display: none;
  align-items: center; justify-content: center; padding: 24px; box-sizing: border-box;
  background: rgba(4,8,14,0.82);
}
.lobby-help.show { display: flex; }
.lobby-help-panel {
  display: flex; flex-direction: column; align-items: center; gap: 8px;
  padding: 26px 34px; border-radius: 12px; max-width: 90vw; max-height: 90vh; overflow-y: auto;
  background: rgba(8,16,26,0.96); border: 1px solid #2a3f54; box-shadow: 0 10px 40px rgba(0,0,0,0.6);
}
.lobby-help-table { border-collapse: collapse; font: 14px monospace; color: #cde; margin: 8px 0; }
.lobby-help-action { text-align: right; padding: 4px 16px; color: #9ab; }
.lobby-help-keys { text-align: left; padding: 4px 16px; color: #eaf3ff; font-weight: 600; }
.lobby-help-goal { font: 12px/1.5 monospace; color: #9ab; margin: 12px 0 4px; max-width: 34em; text-align: center; }
`;
