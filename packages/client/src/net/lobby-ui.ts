import {
  DIFFICULTY_LEVELS,
  MAX_CHAT_LENGTH,
  MAX_NICK_LENGTH,
  MAX_PLAYERS_PER_ROOM,
  PLANE_TYPES,
  TEAM_COUNT,
  ZONE_CAPTURE_SECONDS,
  planeLabelOf,
  sanitizeNick,
  type ChatMessage,
  type DifficultyLevel,
  type MatchMode,
  type PlaneType,
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

/** Nazwy drużyn w poczekalni (rozdzielenie drużyna↔samolot 2026-06-25: drużyny nie są już
 *  narodowościami — dowolny samolot w dowolnej drużynie). Indeks = frakcja (0..TEAM_COUNT−1). */
const TEAM_LABELS: readonly string[] = ['Drużyna A', 'Drużyna B'];
/** Klasa CSS koloru drużyny per frakcja (stały kolor w poczekalni; w locie wróg/sojusznik jest
 *  względny do gracza, więc tu używamy własnej, bezwzględnej palety). */
const TEAM_COLOR_CLASS: readonly string[] = ['lobby-team-a', 'lobby-team-b'];

function teamLabel(faction: number): string {
  return TEAM_LABELS[faction] ?? `Drużyna ${String(faction + 1)}`;
}

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

// Ekrany lobby (faza 10) jako vanilla DOM nad canvasem (decyzja PLAN.md — Preact dopiero,
// gdy vanilla zaboli). Dwa widoki: 'entry' (JEDEN prosty ekran: nick + auto-wykryta otwarta
// gra → „Dołącz" albo „Załóż własną grę" + przycisk „Jak grać") i 'waiting' (poczekalnia: kod
// pokoju, lista graczy, ustawienia hosta — tryb/boty/poziom/samolot — Start dla hosta) na tle
// grafiki dogfight. Konfiguracja gry żyje WYŁĄCZNIE w poczekalni, żeby wejście było jednym
// ekranem. Nicki innych graczy trafiają do DOM → ZAWSZE przez textContent / escape (XSS).
// Moduł nie zna sieci: woła callbacki, a online-main spina go z NetClient (lista pokoi do
// auto-wykrycia otwartej gry jest odświeżana cyklicznie przez online-main).

export interface LobbyCallbacks {
  /** Załóż własną grę — domyślne ustawienia, host konfiguruje resztę w poczekalni. */
  onCreateRoom(): void;
  onJoinRoom(code: string): void;
  onStartMatch(): void;
  onLeaveRoom(): void;
  /** Wybór samolotu w poczekalni (faza 19b). W obu trybach wprost wybór płatowca (od 2026-06-25
   *  drużyna i samolot są rozdzielone — dowolny samolot w dowolnej drużynie). */
  onSelectPlane(plane: PlaneType): void;
  /** Wybór drużyny w poczekalni (tryb drużynowy; rozdzielenie drużyna↔samolot 2026-06-25). Pozwala
   *  dwóm graczom celowo grać po tej samej stronie. */
  onSelectTeam(team: number): void;
  /** Host zmienia ustawienia pokoju w poczekalni (tryb / liczba botów / poziom trudności). */
  onUpdateRoom(opts: { mode: MatchMode; bots: number; difficulty: DifficultyLevel }): void;
  /** Wyślij wiadomość na czat pokoju (poczekalnia). */
  onSendChat(text: string): void;
}

export interface WaitingView {
  code: string;
  state: RoomState;
  /** Tryb meczu (faza 18) — render drużyn + sens selektora (drużynowy: wybór samolotu = strona). */
  mode: MatchMode;
  /** Poziom trudności botów pokoju — selektor hosta w poczekalni. */
  difficulty: DifficultyLevel;
  /** Liczba botów w pokoju (z roster) — selektor hosta + podsumowanie dla reszty. */
  botCount: number;
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
  // auto-wykryta otwarta gra (jedyna poczekalnia z wolnym miejscem) — ramka + przycisk „Dołącz"
  private readonly openGameBox: HTMLDivElement;
  private readonly openGameTitle: HTMLDivElement;
  private readonly openGameDetail: HTMLDivElement;
  /** Kod auto-wykrytej otwartej gry (cel przycisku „Dołącz"); null = brak otwartej gry. */
  private openGameCode: string | null = null;
  private readonly errorEl: HTMLDivElement;
  private readonly waitingCodeEl: HTMLDivElement;
  private readonly waitingPlayersEl: HTMLDivElement;
  // kolumny drużyn (tryb drużynowy): gracze pogrupowani po frakcji + kolory drużyn (2026-06-25)
  private readonly teamsEl: HTMLDivElement;
  // wybór drużyny (tryb drużynowy): każdy gracz wybiera swoją stronę niezależnie od samolotu
  private readonly teamRow: HTMLDivElement;
  private readonly teamSelect: HTMLSelectElement;
  private readonly startBtn: HTMLButtonElement;
  private readonly waitingHintEl: HTMLDivElement;
  // wybór samolotu w poczekalni (faza 19b): select w obu trybach — niezależny od drużyny (2026-06-25)
  private readonly planeRow: HTMLDivElement;
  private readonly planeLabel: HTMLLabelElement;
  private readonly planeSelect: HTMLSelectElement;
  // ustawienia pokoju w poczekalni: host steruje selektorami; reszta widzi podsumowanie tekstowe
  private readonly settingsRow: HTMLDivElement;
  private readonly settingsSummary: HTMLDivElement;
  private readonly waitModeSelect: HTMLSelectElement;
  private readonly waitBotsSelect: HTMLSelectElement;
  private readonly waitDiffSelect: HTMLSelectElement;
  // czat poczekalni: log wiadomości + pole wpisywania (treść renderowana przez textContent — XSS)
  private readonly chatLogEl: HTMLDivElement;
  private readonly chatInput: HTMLInputElement;
  /** Id lokalnego gracza (z WaitingView) — do podświetlenia własnych wiadomości czatu. */
  private localId: number | null = null;

  constructor(private readonly cb: LobbyCallbacks) {
    injectStyles();
    this.root = el('div', 'lobby-root');

    // --- ekran wejściowy (JEDEN ekran: nick + auto-wykryta otwarta gra / załóż własną grę) ---
    this.entry = el('div', 'lobby-screen lobby-entry');
    const title = el('div', 'lobby-title');
    title.textContent = 'AIR COMBAT — DOGFIGHT';
    const sub = el('div', 'lobby-sub');
    sub.textContent = 'Spitfire Mk II vs Bf 109 E — multiplayer';

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

    // auto-wykryta otwarta gra: jedyna poczekalnia z wolnym miejscem (setRoomList wybiera ją z
    // listy pokoi odświeżanej cyklicznie przez online-main). Widoczna TYLKO, gdy taka istnieje;
    // „Dołącz" wchodzi prosto do niej. Brak otwartej gry → ramka znika, zostaje „Załóż własną grę".
    this.openGameBox = el('div', 'lobby-open-game');
    this.openGameTitle = el('div', 'lobby-open-title');
    this.openGameDetail = el('div', 'lobby-open-detail');
    const openJoinBtn = button('Dołącz', 'lobby-btn lobby-btn-primary', () => {
      if (this.openGameCode === null) return;
      this.beforeAction();
      this.cb.onJoinRoom(this.openGameCode);
    });
    this.openGameBox.append(this.openGameTitle, this.openGameDetail, openJoinBtn);

    // „Załóż własną grę": tworzy pokój z domyślnymi ustawieniami — tryb/boty/poziom i samolot
    // host konfiguruje już w poczekalni (settingsRow), żeby wejście było jednym prostym ekranem.
    const createBtn = button('Załóż własną grę', 'lobby-btn', () => {
      this.beforeAction();
      this.cb.onCreateRoom();
    });

    this.errorEl = el('div', 'lobby-error');

    const helpBtn = button('❔ Jak grać — sterowanie i cel', 'lobby-btn lobby-btn-small', () =>
      this.showHelp(),
    );

    this.entry.append(
      title,
      sub,
      nickRow,
      this.openGameBox,
      createBtn,
      this.errorEl,
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
    // kolumny drużyn (tryb drużynowy): gracze pogrupowani po frakcji, dwie kolumny obok siebie
    this.teamsEl = el('div', 'lobby-teams');
    // selektor drużyny (tryb drużynowy): każdy wybiera swoją stronę — dwóch ludzi może grać razem
    this.teamRow = el('div', 'lobby-row lobby-bot-row');
    const teamLabelEl = el('label', 'lobby-label');
    teamLabelEl.textContent = 'Twoja drużyna';
    this.teamSelect = selectEl(
      'lobby-select lobby-select-mode',
      Array.from({ length: TEAM_COUNT }, (_, i) => ({ value: String(i), label: teamLabel(i) })),
      '0',
    );
    this.teamSelect.addEventListener('change', () => {
      this.cb.onSelectTeam(Number(this.teamSelect.value) || 0);
    });
    this.teamRow.append(teamLabelEl, this.teamSelect);
    // wybór samolotu (faza 19b): w obu trybach wybór płatowca, niezależny od drużyny (2026-06-25)
    this.planeRow = el('div', 'lobby-row lobby-bot-row');
    this.planeLabel = el('label', 'lobby-label');
    this.planeLabel.textContent = 'Twój samolot';
    this.planeSelect = selectEl(
      'lobby-select lobby-select-mode',
      PLANE_TYPES.map((t) => ({ value: t, label: planeLabelOf(t) })),
      PLANE_TYPES[0] ?? 'spitfire',
    );
    this.planeSelect.addEventListener('change', () => {
      this.cb.onSelectPlane(this.planeSelect.value as PlaneType);
    });
    this.planeRow.append(this.planeLabel, this.planeSelect);

    // --- ustawienia pokoju w poczekalni (host steruje, reszta widzi podsumowanie) ---
    const settingsCaption = el('div', 'lobby-label');
    settingsCaption.textContent = 'Ustawienia pokoju (ustala host — dogadajcie się na czacie)';
    this.settingsRow = el('div', 'lobby-row lobby-bot-row lobby-settings-row');
    this.waitModeSelect = selectEl(
      'lobby-select lobby-select-mode',
      MODE_OPTIONS.map((o) => ({ value: o.value, label: o.label })),
      'team', // domyślnie drużynowy (życzenie usera 2026-06-22); i tak nadpisywany view.mode
    );
    const settingsBotLabel = el('label', 'lobby-label');
    settingsBotLabel.textContent = 'Boty';
    this.waitBotsSelect = selectEl(
      'lobby-select lobby-select-bots',
      Array.from({ length: MAX_BOTS + 1 }, (_, i) => ({ value: String(i), label: String(i) })),
      '0',
    );
    this.waitDiffSelect = selectEl(
      'lobby-select',
      DIFFICULTY_LEVELS.map((lvl) => ({ value: lvl, label: DIFFICULTY_LABELS[lvl] })),
      'normalny',
    );
    for (const sel of [this.waitModeSelect, this.waitBotsSelect, this.waitDiffSelect]) {
      sel.addEventListener('change', () => this.emitSettings());
    }
    this.settingsRow.append(this.waitModeSelect, settingsBotLabel, this.waitBotsSelect, this.waitDiffSelect);
    this.settingsSummary = el('div', 'lobby-sub lobby-settings-summary');

    // --- czat poczekalni ---
    const chatCaption = el('div', 'lobby-label');
    chatCaption.textContent = 'Czat';
    this.chatLogEl = el('div', 'lobby-chat-log');
    const chatRow = el('div', 'lobby-row lobby-chat-row');
    this.chatInput = document.createElement('input');
    this.chatInput.className = 'lobby-input lobby-chat-input';
    this.chatInput.maxLength = MAX_CHAT_LENGTH;
    this.chatInput.placeholder = 'Napisz wiadomość…';
    this.chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.trySendChat();
    });
    const chatSendBtn = button('Wyślij', 'lobby-btn lobby-btn-small', () => this.trySendChat());
    chatRow.append(this.chatInput, chatSendBtn);

    this.waitingHintEl = el('div', 'lobby-sub');
    this.startBtn = button('Start meczu', 'lobby-btn lobby-btn-primary', () => this.cb.onStartMatch());
    const leaveBtn = button('Wyjdź', 'lobby-btn lobby-btn-small', () => this.cb.onLeaveRoom());
    const panel = el('div', 'lobby-panel');
    panel.append(
      wTitle,
      codeCaption,
      this.waitingCodeEl,
      this.waitingPlayersEl,
      this.teamsEl,
      this.teamRow,
      this.planeRow,
      settingsCaption,
      this.settingsRow,
      this.settingsSummary,
      chatCaption,
      this.chatLogEl,
      chatRow,
      this.waitingHintEl,
      this.startBtn,
      leaveBtn,
    );
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

  private beforeAction(): void {
    saveNick(this.nickInput.value);
    this.clearError();
  }

  showEntry(): void {
    this.root.classList.add('show');
    this.entry.classList.add('show');
    this.waiting.classList.remove('show');
  }

  /** Nakładka sterowania/celu — wyłącznie pod przyciskiem „Jak grać" (bez auto-pokazu). */
  showHelp(): void {
    this.help.classList.add('show');
  }

  private hideHelp(): void {
    this.help.classList.remove('show');
  }

  /**
   * Aktualizuje ekran wejściowy z listy pokoi: spośród OTWARTYCH poczekalni z wolnym miejscem
   * wybiera najbliższą startu (najwięcej graczy) jako „Trwa otwarta gra" z przyciskiem „Dołącz".
   * Brak takiej poczekalni → ramka znika i zostaje tylko „Załóż własną grę". (Lista odświeżana
   * cyklicznie przez online-main, więc auto-wykrycie nadąża za zakładaniem/zamykaniem pokoi.)
   */
  setRoomList(rooms: RoomSummary[]): void {
    let best: RoomSummary | null = null;
    for (const r of rooms) {
      if (r.state !== 'waiting' || r.playerCount >= r.maxPlayers) continue;
      if (
        best === null ||
        r.playerCount > best.playerCount ||
        (r.playerCount === best.playerCount && r.code < best.code)
      ) {
        best = r;
      }
    }
    if (best === null) {
      this.openGameCode = null;
      this.openGameBox.classList.remove('show');
      return;
    }
    this.openGameCode = best.code;
    const modeLabel = best.mode === 'team' ? 'Drużynowy' : 'FFA';
    this.openGameTitle.textContent = `Trwa otwarta gra: ${best.code}`;
    this.openGameDetail.textContent = `${modeLabel}  ·  ${String(best.playerCount)}/${String(best.maxPlayers)} graczy`;
    this.openGameBox.classList.add('show');
  }

  showWaiting(view: WaitingView): void {
    this.root.classList.add('show');
    this.waiting.classList.add('show');
    this.entry.classList.remove('show');
    this.updateWaiting(view);
  }

  /** Buduje wiersz gracza (tag TY/HOST/BOT + nick + typ samolotu). textContent → XSS-safe. */
  private buildPlayerRow(p: RoomPlayer, view: WaitingView): HTMLDivElement {
    const row = el('div', 'lobby-player-row');
    const tag = el('span', 'lobby-player-tag');
    tag.textContent = p.isBot ? 'BOT' : p.id === view.hostId ? 'HOST' : p.id === view.youId ? 'TY' : '';
    const name = el('span', 'lobby-player-name');
    name.textContent = p.nick; // textContent → bez interpretacji HTML (XSS)
    // typ samolotu przy nicku (faza 19b: widać, kto czym leci — niezależnie od drużyny)
    const plane = el('span', 'lobby-player-plane');
    plane.textContent = planeLabelOf(p.planeType);
    row.append(tag, name, plane);
    return row;
  }

  updateWaiting(view: WaitingView): void {
    this.localId = view.youId;
    this.waitingCodeEl.textContent = view.code;
    const isTeam = view.mode === 'team';
    // FFA → płaska lista graczy; drużynowy → dwie kolumny drużyn (grupowanie + kolory, 2026-06-25)
    this.waitingPlayersEl.style.display = isTeam ? 'none' : '';
    this.teamsEl.style.display = isTeam ? '' : 'none';
    this.teamRow.style.display = isTeam ? '' : 'none';
    if (isTeam) {
      this.teamsEl.replaceChildren();
      for (let faction = 0; faction < TEAM_COUNT; faction++) {
        const col = el('div', `lobby-team-col ${TEAM_COLOR_CLASS[faction] ?? ''}`);
        const members = view.players.filter((p) => p.faction === faction);
        const head = el('div', 'lobby-team-head');
        head.textContent = `${teamLabel(faction)} (${String(members.length)})`;
        const body = el('div', 'lobby-team-body');
        for (const p of members) body.append(this.buildPlayerRow(p, view));
        col.append(head, body);
        this.teamsEl.append(col);
      }
    } else {
      this.waitingPlayersEl.replaceChildren();
      for (const p of view.players) this.waitingPlayersEl.append(this.buildPlayerRow(p, view));
    }
    // wybór samolotu w OBU trybach niezależny od drużyny (2026-06-25); select ustawiony na MÓJ typ z serwera
    this.planeLabel.textContent = 'Twój samolot';
    const mine = view.players.find((p) => p.id === view.youId);
    if (mine && this.planeSelect.value !== mine.planeType) this.planeSelect.value = mine.planeType;
    // selektor drużyny: ustawiony na MOJĄ frakcję z serwera (drużynowy); każdy gracz wybiera niezależnie
    if (mine && isTeam && this.teamSelect.value !== String(mine.faction)) {
      this.teamSelect.value = String(mine.faction);
    }
    const isHost = view.youId === view.hostId;
    // wycofany gracz ogląda poczekalnię, choć mecz wciąż TRWA (state≠'waiting', leaveMatch 2026-06-23):
    // nie ma czego startować ani ustawiać — chowamy Start/ustawienia i mówimy, że mecz w toku.
    const matchInProgress = view.state !== 'waiting';
    // ustawienia pokoju: host edytuje (selektory), reszta widzi podsumowanie tekstowe (oba tylko w 'waiting')
    this.settingsRow.style.display = isHost && !matchInProgress ? '' : 'none';
    this.settingsSummary.style.display = !isHost && !matchInProgress ? '' : 'none';
    if (isHost) {
      this.waitModeSelect.value = view.mode;
      this.waitBotsSelect.value = String(view.botCount);
      this.waitDiffSelect.value = view.difficulty;
    } else {
      const modeLabel = view.mode === 'team' ? 'Drużynowy' : 'FFA';
      this.settingsSummary.textContent =
        `Tryb: ${modeLabel}  ·  Boty: ${String(view.botCount)} (${DIFFICULTY_LABELS[view.difficulty]})`;
    }
    this.startBtn.style.display = isHost && !matchInProgress ? '' : 'none';
    this.waitingHintEl.textContent = matchInProgress
      ? 'Mecz w toku — dołączysz, gdy host wystartuje kolejny.'
      : isHost
        ? 'Jesteś hostem — ustaw tryb/boty i wystartuj, gdy zbierze się ekipa.'
        : 'Czekaj, aż host wystartuje mecz…';
  }

  /** Host wysłał zmianę ustawień (tryb/boty/poziom) — wszystkie naraz, serwer klampuje. */
  private emitSettings(): void {
    this.cb.onUpdateRoom({
      mode: this.waitModeSelect.value === 'team' ? 'team' : 'ffa',
      bots: Number(this.waitBotsSelect.value) || 0,
      difficulty: this.waitDiffSelect.value as DifficultyLevel,
    });
  }

  private trySendChat(): void {
    const text = this.chatInput.value.trim();
    if (text.length === 0) return;
    this.cb.onSendChat(text);
    this.chatInput.value = '';
  }

  /** Dopisuje wiadomość czatu do logu (textContent → XSS-safe). id=null → komunikat systemowy. */
  appendChat(msg: ChatMessage): void {
    const line = el('div', 'lobby-chat-line');
    if (msg.id === null) {
      line.classList.add('lobby-chat-system');
      line.textContent = msg.text;
    } else {
      const nick = el('span', 'lobby-chat-nick');
      if (msg.id === this.localId) nick.classList.add('lobby-chat-nick-self');
      nick.textContent = msg.nick;
      const body = el('span', 'lobby-chat-text');
      body.textContent = msg.text;
      line.append(nick, document.createTextNode(': '), body);
    }
    // autoscroll tylko gdy już byliśmy na dole (nie wyrywaj czytającemu historii)
    const atBottom =
      this.chatLogEl.scrollHeight - this.chatLogEl.scrollTop - this.chatLogEl.clientHeight < 30;
    this.chatLogEl.append(line);
    while (this.chatLogEl.childElementCount > 100) this.chatLogEl.firstElementChild?.remove();
    if (atBottom) this.chatLogEl.scrollTop = this.chatLogEl.scrollHeight;
  }

  /** Czyści log czatu — woła online-main przy wejściu do NOWEGO pokoju (przed historią z serwera). */
  clearChat(): void {
    this.chatLogEl.replaceChildren();
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
  const link = (label: string, href: string): HTMLAnchorElement => {
    const a = document.createElement('a');
    a.textContent = label;
    a.href = href;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    return a;
  };
  // CC-BY 4.0 wymaga widocznego uznania autorstwa KAŻDEGO użytego modelu (publiczny deploy
  // ładuje oba GLB — Spitfire i Bf 109; faza 19b).
  wrap.append(document.createTextNode('Modele: „Supermarine Spitfire Mk.IIa" — '));
  wrap.append(link('barking_dogo', 'https://sketchfab.com/barking_dogo'));
  wrap.append(document.createTextNode('; „Messerschmitt BF 109" — '));
  wrap.append(link('Jankenstein', 'https://sketchfab.com/Jankenstein'));
  wrap.append(document.createTextNode(' (Sketchfab) — licencja CC-BY 4.0'));
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
/* ramka auto-wykrytej otwartej gry — widoczna tylko, gdy jest do czego dołączyć (.show) */
.lobby-open-game {
  display: none; flex-direction: column; align-items: center; gap: 8px;
  width: 320px; box-sizing: border-box; padding: 14px 16px; margin: 4px 0;
  background: rgba(12,22,34,0.85); border: 1px solid #3a6c4a; border-radius: 8px;
}
.lobby-open-game.show { display: flex; }
.lobby-open-title { font: 700 17px monospace; letter-spacing: 1px; color: #7fd49a; }
.lobby-open-detail { font-size: 13px; color: #9fc4e6; }
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
.lobby-player-plane { margin-left: auto; padding-left: 12px; font-size: 12px; color: #9fc4e6; }
/* kolumny drużyn (tryb drużynowy): dwie strony obok siebie, każda z własnym kolorem (2026-06-25) */
.lobby-teams { display: flex; gap: 14px; align-items: flex-start; flex-wrap: wrap; justify-content: center; }
.lobby-team-col {
  display: flex; flex-direction: column; gap: 6px; min-width: 220px;
  padding: 10px 12px; border-radius: 8px;
  background: rgba(12,22,34,0.7); border: 1px solid #2a3f54; border-top: 3px solid #5a7a96;
}
.lobby-team-head { font: 700 15px monospace; letter-spacing: 1px; }
.lobby-team-body { display: flex; flex-direction: column; gap: 4px; min-height: 24px; }
.lobby-team-a { border-top-color: #4aa3ff; }
.lobby-team-a .lobby-team-head { color: #7cc0ff; }
.lobby-team-b { border-top-color: #ff8c42; }
.lobby-team-b .lobby-team-head { color: #ffac72; }
.lobby-settings-row { flex-wrap: wrap; justify-content: center; }
.lobby-settings-summary { font-size: 13px; color: #cde; }
.lobby-chat-log {
  width: 100%; max-width: 380px; height: 140px; overflow-y: auto;
  display: flex; flex-direction: column; gap: 2px; text-align: left;
  padding: 8px 10px; box-sizing: border-box;
  background: rgba(4,9,16,0.7); border: 1px solid #2a3f54; border-radius: 6px;
  font: 13px/1.4 monospace;
}
.lobby-chat-line { color: #dce8f4; word-break: break-word; }
.lobby-chat-nick { color: #9fc4e6; font-weight: 700; }
.lobby-chat-nick-self { color: #ffd24a; }
.lobby-chat-text { color: #eaf3ff; }
.lobby-chat-system { color: #7fae7f; font-style: italic; }
.lobby-chat-row { width: 100%; max-width: 380px; gap: 8px; }
.lobby-chat-input { flex: 1; min-width: 0; }
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
