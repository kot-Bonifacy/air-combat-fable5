import {
  DIFFICULTY_LEVELS,
  MAX_CHAT_LENGTH,
  MAX_NICK_LENGTH,
  MAX_PLAYERS_PER_ROOM,
  PLANE_TYPES,
  TEAM_COUNT,
  ZONE_CAPTURE_SECONDS,
  planeCardInfoOf,
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

/** Wartość sentinel selektora modelu nowego bota = „Losowy" (host nie wymusza typu → serwer losuje
 *  z id). Pusty string nie koliduje z żadnym PlaneType, więc bezpiecznie odróżnia „brak wyboru". */
const RANDOM_PLANE_VALUE = '';
/** Opcje selektora modelu przy „+ dodaj bota" (2026-06-27): „Losowy" + konkretne typy samolotów. */
const ADD_BOT_PLANE_OPTIONS: readonly { value: string; label: string }[] = [
  { value: RANDOM_PLANE_VALUE, label: 'Losowy' },
  ...PLANE_TYPES.map((t) => ({ value: t, label: planeLabelOf(t) })),
];

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
  /** Gracz oznacza gotowość do startu (system „Gotów" 2026-06-26). */
  onSetReady(ready: boolean): void;
  /** Host zmienia ustawienia pokoju w poczekalni (tryb / liczba botów / poziom trudności). Pola
   *  opcjonalne — w trybie drużynowym wysyłamy sam `mode` (boty/poziom są per slot, nie globalne). */
  onUpdateRoom(opts: { mode?: MatchMode; bots?: number; difficulty?: DifficultyLevel }): void;
  /** Host: dodaj bota do slotu (lobby slotowe RTS 2026-06-26). `team` w trybie drużynowym; FFA → null.
   *  `difficulty`/`plane` = wybór hosta z kontrolek przy „+ dodaj bota" (brak `plane` → serwer losuje typ). */
  onAddBot(team: number | null, difficulty?: DifficultyLevel, plane?: PlaneType): void;
  /** Host: usuń konkretnego bota ze slotu. */
  onRemoveBot(botId: number): void;
  /** Host: edytuj slot bota — przenieś do drużyny i/lub zmień poziom. */
  onEditBot(botId: number, opts: { team?: number; difficulty?: DifficultyLevel }): void;
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
  // wspólny wiersz: selektor drużyny + ustawienia pokoju obok siebie (zbicie wysokości poczekalni)
  private readonly controlsRow: HTMLDivElement;
  private readonly startBtn: HTMLButtonElement;
  private readonly waitingHintEl: HTMLDivElement;
  // wybór samolotu w poczekalni: KARTY samolotów (2026-06-26) — niezależne od drużyny, klik = wybór
  private readonly planeRow: HTMLDivElement;
  private readonly planeCardsEl: HTMLDivElement;
  /** Karty per typ samolotu — do podświetlenia wybranej wg stanu z serwera. */
  private readonly planeCards = new Map<PlaneType, HTMLDivElement>();
  // gotowość gracza (system „Gotów" 2026-06-26): przycisk dla nie-hosta + wskaźniki w roster
  private readonly readyBtn: HTMLButtonElement;
  /** Bieżąca gotowość lokalnego gracza (z WaitingView) — do etykiety przycisku i toggle. */
  private myReady = false;
  // konfiguracja KOLEJNEGO dodawanego bota (kontrolki przy „+ dodaj bota", host, tryb drużynowy).
  // Zapamiętana między dodaniami: po dodaniu bota następny podpowiada się taki sam (życzenie usera
  // 2026-06-27). Wspólna dla obu drużyn (updateWaiting przerysowuje kolumny → selektory czytają stąd).
  /** Model nowego bota; `null` = „Losowy" (serwer losuje typ z id). Domyślnie losowy. */
  private pendingBotPlane: PlaneType | null = null;
  /** Poziom trudności nowego bota; domyślnie „normalny" (życzenie usera). */
  private pendingBotDifficulty: DifficultyLevel = 'normalny';
  // ustawienia pokoju w poczekalni: host steruje selektorami; reszta widzi podsumowanie tekstowe
  private readonly settingsRow: HTMLDivElement;
  private readonly settingsSummary: HTMLDivElement;
  private readonly waitModeSelect: HTMLSelectElement;
  /** Kontener globalnych botów (liczba + poziom) — widoczny TYLKO w FFA; w trybie drużynowym boty są
   *  per slot (lobby slotowe RTS 2026-06-26), więc globalne selektory są chowane. */
  private readonly ffaBotsBox: HTMLSpanElement;
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
    codeCaption.textContent = 'Kod pokoju (podaj znajomym):';
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
    // wybór samolotu: KARTY (2026-06-26) — w obu trybach wybór płatowca, niezależny od drużyny.
    // Klik w kartę = onSelectPlane; podświetlenie wybranej idzie za stanem z serwera (updateWaiting).
    this.planeRow = el('div', 'lobby-plane-section');
    const planeCaption = el('div', 'lobby-label');
    planeCaption.textContent = 'Twój samolot';
    this.planeCardsEl = el('div', 'lobby-plane-cards');
    for (const type of PLANE_TYPES) {
      const card = this.buildPlaneCard(type);
      this.planeCards.set(type, card);
      this.planeCardsEl.append(card);
    }
    this.planeRow.append(planeCaption, this.planeCardsEl);

    // gotowość (system „Gotów" 2026-06-26): przycisk dla nie-hosta — trafia do paska akcji obok „Wyjdź"
    // (host widzi tam Start; oba są rozłączne), więc nie zajmuje osobnego pełnego wiersza.
    this.readyBtn = button('✔ Gotów', 'lobby-btn lobby-btn-ready', () => {
      this.cb.onSetReady(!this.myReady);
    });

    // --- ustawienia pokoju w poczekalni (host steruje, reszta widzi podsumowanie) ---
    // Bez osobnego pełnowymiarowego podpisu — selektor trybu jest samoopisowy, a rolę hosta
    // tłumaczy podpowiedź na dole. Wiersz ląduje obok selektora drużyny (controlsRow).
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
    // globalne selektory botów (FFA): liczba + poziom. W trybie drużynowym chowane (boty per slot).
    this.ffaBotsBox = document.createElement('span');
    this.ffaBotsBox.className = 'lobby-ffa-bots';
    this.ffaBotsBox.append(settingsBotLabel, this.waitBotsSelect, this.waitDiffSelect);
    for (const sel of [this.waitModeSelect, this.waitBotsSelect, this.waitDiffSelect]) {
      sel.addEventListener('change', () => this.emitSettings());
    }
    this.settingsRow.append(this.waitModeSelect, this.ffaBotsBox);
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

    this.waitingHintEl = el('div', 'lobby-sub lobby-hint');
    this.startBtn = button('Start meczu', 'lobby-btn lobby-btn-primary', () => this.cb.onStartMatch());
    const leaveBtn = button('Wyjdź', 'lobby-btn lobby-btn-small', () => this.cb.onLeaveRoom());

    // kod pokoju w jednym wierszu (podpis + kod) zamiast dwóch pełnowymiarowych wierszy
    const codeRow = el('div', 'lobby-row lobby-code-row');
    codeRow.append(codeCaption, this.waitingCodeEl);

    // selektor drużyny + ustawienia (tryb/boty) obok siebie — host widzi oba, gracz tylko drużynę
    this.controlsRow = el('div', 'lobby-row lobby-controls-row');
    this.controlsRow.append(this.teamRow, this.settingsRow);

    // czat: podpis PO LEWEJ od okna (log + pole w kolumnie obok) zamiast pełnego wiersza nad logiem
    const chatSection = el('div', 'lobby-chat-section');
    const chatBody = el('div', 'lobby-chat-body');
    chatBody.append(this.chatLogEl, chatRow);
    chatSection.append(chatCaption, chatBody);

    // pasek akcji: Start (host) ALBO Gotów (gracz) + Wyjdź — wszystkie w jednym wierszu
    const actionRow = el('div', 'lobby-row lobby-action-row');
    actionRow.append(this.startBtn, this.readyBtn, leaveBtn);

    const panel = el('div', 'lobby-panel');
    panel.append(
      wTitle,
      codeRow,
      this.waitingPlayersEl,
      this.teamsEl,
      this.controlsRow,
      this.settingsSummary,
      this.planeRow,
      chatSection,
      this.waitingHintEl,
      actionRow,
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

  /** Buduje klikalną kartę wyboru samolotu (nazwa, rola, uzbrojenie, opis). Klik = onSelectPlane;
   *  podświetlenie „wybrana" ustawia updateWaiting wg stanu z serwera (a nie od razu po kliknięciu). */
  private buildPlaneCard(type: PlaneType): HTMLDivElement {
    const info = planeCardInfoOf(type);
    const card = el('div', 'lobby-plane-card');
    const glyph = el('div', 'lobby-plane-glyph');
    glyph.textContent = '✈';
    const name = el('div', 'lobby-plane-name');
    name.textContent = info.label;
    const variant = el('div', 'lobby-plane-variant');
    variant.textContent = info.fullName;
    const trait = el('div', 'lobby-plane-trait');
    trait.textContent = `${info.traitIcon} ${info.trait}`;
    const weapons = el('div', 'lobby-plane-weapons');
    weapons.textContent = info.weapons;
    const blurb = el('div', 'lobby-plane-blurb');
    blurb.textContent = info.blurb;
    const pick = el('div', 'lobby-plane-pick');
    pick.textContent = 'wybierz';
    card.append(glyph, name, variant, trait, weapons, blurb, pick);
    card.addEventListener('click', () => this.cb.onSelectPlane(type));
    return card;
  }

  /** Buduje wiersz gracza (tag TY/HOST/BOT + nick + typ samolotu + gotowość). textContent → XSS-safe.
   *  W trybie drużynowym dla HOSTA boty dostają kontrolki slotu (poziom / przenieś / usuń — lobby RTS). */
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

    const isHost = view.youId === view.hostId;
    const inWaiting = view.state === 'waiting';
    if (p.isBot && view.mode === 'team' && isHost && inWaiting) {
      // sloty RTS: host steruje botem (poziom per bot + przeniesienie do drugiej drużyny + usunięcie)
      row.append(this.buildBotControls(p));
    } else {
      // wskaźnik gotowości (system „Gotów") — tylko dla ludzi poza hostem (host steruje startem)
      const ready = el('span', 'lobby-player-ready');
      if (!p.isBot && p.id !== view.hostId) {
        ready.textContent = p.ready ? '✔' : '⏳';
        ready.classList.add(p.ready ? 'is-ready' : 'is-waiting');
        ready.title = p.ready ? 'gotów' : 'czeka';
      }
      row.append(ready);
    }
    return row;
  }

  /** Kontrolki slotu bota dla HOSTA (lobby slotowe RTS 2026-06-26): poziom trudności per bot,
   *  przeniesienie do drugiej drużyny i usunięcie. Wartości waliduje/klampuje serwer (niezm. nr 11). */
  private buildBotControls(p: RoomPlayer): HTMLSpanElement {
    const box = document.createElement('span');
    box.className = 'lobby-bot-controls';
    // poziom trudności tego bota — zmiana wysyła editBot{difficulty}
    const diff = selectEl(
      'lobby-select lobby-bot-diff',
      DIFFICULTY_LEVELS.map((lvl) => ({ value: lvl, label: DIFFICULTY_LABELS[lvl] })),
      p.botDifficulty ?? 'normalny',
    );
    diff.addEventListener('change', () => {
      this.cb.onEditBot(p.id, { difficulty: diff.value as DifficultyLevel });
    });
    // przenieś do drugiej drużyny (TEAM_COUNT=2 → naprzemiennie)
    const otherTeam = (p.faction + 1) % TEAM_COUNT;
    const move = button('⇄', 'lobby-btn lobby-btn-icon', () => this.cb.onEditBot(p.id, { team: otherTeam }));
    move.title = `Przenieś do: ${teamLabel(otherTeam)}`;
    // usuń bota
    const remove = button('✕', 'lobby-btn lobby-btn-icon lobby-btn-danger', () => this.cb.onRemoveBot(p.id));
    remove.title = 'Usuń bota';
    box.append(diff, move, remove);
    return box;
  }

  /** Kontrolki „+ dodaj bota" dla HOSTA (per drużyna, lobby slotowe RTS): selektory modelu samolotu
   *  i poziomu trudności nowego bota + przycisk dodania. Wybór jest WSPÓLNY i zapamiętany
   *  (`pendingBot*`) — po dodaniu bota kolejny podpowiada się taki sam (życzenie usera 2026-06-27).
   *  „Losowy" model → onAddBot bez `plane` (serwer losuje typ z id). Selektory inicjalizowane bieżącym
   *  zapamiętanym wyborem, bo updateWaiting przerysowuje kolumny przy każdym roomUpdate. */
  private buildAddBotRow(faction: number, roomFull: boolean): HTMLDivElement {
    const wrap = el('div', 'lobby-add-bot-box');
    const plane = selectEl(
      'lobby-select lobby-bot-diff',
      ADD_BOT_PLANE_OPTIONS,
      this.pendingBotPlane ?? RANDOM_PLANE_VALUE,
    );
    plane.title = 'Model nowego bota';
    plane.addEventListener('change', () => {
      this.pendingBotPlane = plane.value === RANDOM_PLANE_VALUE ? null : (plane.value as PlaneType);
    });
    const diff = selectEl(
      'lobby-select lobby-bot-diff',
      DIFFICULTY_LEVELS.map((lvl) => ({ value: lvl, label: DIFFICULTY_LABELS[lvl] })),
      this.pendingBotDifficulty,
    );
    diff.title = 'Poziom trudności nowego bota';
    diff.addEventListener('change', () => {
      this.pendingBotDifficulty = diff.value as DifficultyLevel;
    });
    const selectors = el('div', 'lobby-add-bot-selectors');
    selectors.append(plane, diff);
    // brak modelu (Losowy) → onAddBot bez plane (undefined) → serwer losuje typ
    const add = button('+ dodaj bota', 'lobby-btn lobby-btn-small lobby-add-bot', () =>
      this.cb.onAddBot(faction, this.pendingBotDifficulty, this.pendingBotPlane ?? undefined),
    );
    add.disabled = roomFull;
    if (roomFull) add.title = 'Pokój pełny';
    wrap.append(selectors, add);
    return wrap;
  }

  updateWaiting(view: WaitingView): void {
    this.localId = view.youId;
    this.waitingCodeEl.textContent = view.code;
    const isTeam = view.mode === 'team';
    const mine = view.players.find((p) => p.id === view.youId);
    const isHost = view.youId === view.hostId;
    // wycofany gracz ogląda poczekalnię, choć mecz wciąż TRWA (state≠'waiting', leaveMatch 2026-06-23):
    // nie ma czego startować ani ustawiać — chowamy Start/ustawienia/karty/gotowość, mówiąc, że mecz w toku.
    const matchInProgress = view.state !== 'waiting';
    const roomFull = view.players.length >= MAX_PLAYERS_PER_ROOM;

    // FFA → płaska lista graczy; drużynowy → dwie kolumny drużyn (grupowanie + kolory; lobby slotowe RTS:
    // host dorzuca/edytuje boty per drużyna → dowolne składy, np. „2 ludzi vs 6 botów").
    this.waitingPlayersEl.style.display = isTeam ? 'none' : '';
    this.teamsEl.style.display = isTeam ? '' : 'none';
    this.teamRow.style.display = isTeam && !matchInProgress ? '' : 'none';
    // wspólny wiersz selektora drużyny + ustawień: widoczny, gdy jest w nim cokolwiek (drużyna→teamRow,
    // host→settingsRow). Inaczej (gracz w FFA widzi tylko podsumowanie) chowamy, by nie zostawiać pustego gapu.
    this.controlsRow.style.display = !matchInProgress && (isTeam || isHost) ? '' : 'none';
    const teamSizes: number[] = [];
    if (isTeam) {
      this.teamsEl.replaceChildren();
      for (let faction = 0; faction < TEAM_COUNT; faction++) {
        const members = view.players.filter((p) => p.faction === faction);
        teamSizes.push(members.length);
        const col = el('div', `lobby-team-col ${TEAM_COLOR_CLASS[faction] ?? ''}`);
        const head = el('div', 'lobby-team-head');
        head.textContent = `${teamLabel(faction)} (${String(members.length)})`;
        col.append(head);
        // sloty RTS: host dorzuca boty do KONKRETNEJ drużyny (dowolne składy). Kontrolki (model+poziom)
        // i „+ dodaj bota" NAD listą, żeby po dodaniu bota przycisk został pod kursorem (lista rośnie
        // w dół, nie spycha przycisku).
        if (isHost && !matchInProgress) {
          col.append(this.buildAddBotRow(faction, roomFull));
        }
        const body = el('div', 'lobby-team-body');
        for (const p of members) body.append(this.buildPlayerRow(p, view));
        col.append(body);
        this.teamsEl.append(col);
      }
    } else {
      this.waitingPlayersEl.replaceChildren();
      for (const p of view.players) this.waitingPlayersEl.append(this.buildPlayerRow(p, view));
    }

    // KARTY samolotu (2026-06-26): podświetl wybraną wg stanu z serwera (niezależną od drużyny).
    this.planeRow.style.display = matchInProgress ? 'none' : '';
    const myPlane = mine?.planeType ?? null;
    for (const [type, card] of this.planeCards) {
      const selected = type === myPlane;
      card.classList.toggle('selected', selected);
      const pick = card.querySelector('.lobby-plane-pick');
      if (pick) pick.textContent = selected ? '✔ WYBRANY' : 'wybierz';
    }
    // selektor drużyny: ustawiony na MOJĄ frakcję z serwera (drużynowy); każdy gracz wybiera niezależnie
    if (mine && isTeam && this.teamSelect.value !== String(mine.faction)) {
      this.teamSelect.value = String(mine.faction);
    }

    // gotowość (system „Gotów" 2026-06-26): przycisk dla NIE-hosta w poczekalni (host startuje sam)
    this.myReady = mine?.ready ?? false;
    this.readyBtn.style.display = !isHost && !matchInProgress ? '' : 'none';
    this.readyBtn.textContent = this.myReady ? '✔ Gotów — kliknij, by cofnąć' : '✔ Oznacz: jestem gotów';
    this.readyBtn.classList.toggle('is-ready', this.myReady);

    // ustawienia pokoju: host edytuje (selektory), reszta widzi podsumowanie. Globalne boty TYLKO w FFA —
    // w trybie drużynowym boty są per slot (lobby RTS), więc chowamy globalny licznik/poziom.
    this.settingsRow.style.display = isHost && !matchInProgress ? '' : 'none';
    this.settingsSummary.style.display = !isHost && !matchInProgress ? '' : 'none';
    this.ffaBotsBox.style.display = isTeam ? 'none' : '';
    if (isHost) {
      this.waitModeSelect.value = view.mode;
      this.waitBotsSelect.value = String(view.botCount);
      this.waitDiffSelect.value = view.difficulty;
    } else {
      this.settingsSummary.textContent = isTeam
        ? 'Tryb: Drużynowy'
        : `Tryb: FFA  ·  Boty: ${String(view.botCount)} (${DIFFICULTY_LABELS[view.difficulty]})`;
    }

    // Start (host): licznik gotowości + BLOKADA przy pustej drużynie (decyzja usera: „pozwól, ale zablokuj
    // Start + ostrzeż"). Mecz z pustą drużyną nie rozstrzygnąłby się eliminacją (potrzeba ≥2 frakcji w grze).
    const emptyTeam = isTeam && teamSizes.some((n) => n === 0);
    this.startBtn.style.display = isHost && !matchInProgress ? '' : 'none';
    this.startBtn.disabled = emptyTeam;
    const others = view.players.filter((p) => !p.isBot && p.id !== view.hostId);
    const readyCount = others.filter((p) => p.ready).length;
    this.startBtn.textContent = emptyTeam
      ? 'Start — obsadź obie drużyny'
      : others.length > 0
        ? `Start meczu (${String(readyCount)}/${String(others.length)} gotowych)`
        : 'Start meczu';
    this.startBtn.classList.toggle('lobby-btn-wait', !emptyTeam && others.length > 0 && readyCount < others.length);

    // podpowiedź: dla hosta pusta (samoopisowe kontrolki — usunięty nadmiarowy „Jesteś hostem…");
    // ostrzeżenie o pustej drużynie jest nadrzędne i zostaje. Pusty tekst → chowamy wiersz (bez gapu).
    const hint = matchInProgress
      ? 'Mecz w toku — dołączysz, gdy host wystartuje kolejny.'
      : emptyTeam
        ? '⚠ Każda drużyna musi mieć przynajmniej jednego pilota lub bota — obsadź pustą stronę.'
        : isHost
          ? ''
          : 'Wybierz samolot i drużynę, a potem kliknij „Gotów". Host wystartuje mecz.';
    this.waitingHintEl.textContent = hint;
    this.waitingHintEl.style.display = hint ? '' : 'none';
  }

  /** Host wysłał zmianę ustawień. FFA: tryb + globalna liczba/poziom botów. Drużynowy: SAM tryb —
   *  boty są per slot (lobby RTS), więc nie dotykamy ich globalnym selektorem (uniknięcie przebudowy
   *  rosteru, która skasowałaby przypisania drużyn/poziomy per bot). Serwer klampuje wartości. */
  private emitSettings(): void {
    const mode: MatchMode = this.waitModeSelect.value === 'team' ? 'team' : 'ffa';
    if (mode === 'team') {
      this.cb.onUpdateRoom({ mode });
    } else {
      this.cb.onUpdateRoom({
        mode,
        bots: Number(this.waitBotsSelect.value) || 0,
        difficulty: this.waitDiffSelect.value as DifficultyLevel,
      });
    }
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
  display: flex; flex-direction: column; align-items: center; gap: 10px;
  padding: 22px 32px; border-radius: 12px; box-sizing: border-box;
  max-height: calc(100vh - 28px); overflow-y: auto;
  background: rgba(7,13,21,0.72); border: 1px solid #2a3f54;
  box-shadow: 0 10px 40px rgba(0,0,0,0.5);
}
/* kod pokoju: podpis + kod w jednym wierszu (zamiast dwóch pełnowymiarowych wierszy) */
.lobby-code-row { gap: 12px; }
.lobby-code {
  font: 700 34px monospace; letter-spacing: 8px; color: #ffd24a;
  padding: 0 6px; text-shadow: 0 2px 8px rgba(0,0,0,0.9);
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
.lobby-player-ready { width: 20px; text-align: center; font-size: 13px; }
.lobby-player-ready.is-ready { color: #6ee08a; }
.lobby-player-ready.is-waiting { color: #c9a14a; }
/* wybór samolotu — KARTY (2026-06-26): klikalne kafelki, podświetlenie wybranej idzie za serwerem */
.lobby-plane-section { display: flex; flex-direction: row; align-items: center; justify-content: center; gap: 14px; flex-wrap: wrap; }
.lobby-plane-cards { display: flex; gap: 14px; flex-wrap: wrap; justify-content: center; }
.lobby-plane-card {
  display: flex; flex-direction: column; align-items: center; gap: 4px;
  width: 190px; box-sizing: border-box; padding: 12px 14px; cursor: pointer;
  background: rgba(12,22,34,0.85); border: 1px solid #345; border-radius: 10px;
  transition: border-color 0.12s, background 0.12s, transform 0.08s;
}
.lobby-plane-card:hover { border-color: #6aa8da; background: rgba(18,32,48,0.92); }
.lobby-plane-card.selected {
  border-color: #e2772f; background: rgba(46,28,16,0.92);
  box-shadow: 0 0 0 1px #e2772f, 0 6px 20px rgba(0,0,0,0.45);
}
.lobby-plane-glyph { font-size: 30px; line-height: 1; color: #cfe3f6; transform: rotate(-45deg); }
.lobby-plane-card.selected .lobby-plane-glyph { color: #ffd24a; }
.lobby-plane-name { font: 700 18px monospace; letter-spacing: 1px; color: #eaf3ff; }
.lobby-plane-variant { font-size: 12px; color: #9fc4e6; }
.lobby-plane-trait { font-size: 13px; color: #7fd49a; font-weight: 700; }
.lobby-plane-weapons { font-size: 12px; color: #cdd9e6; }
.lobby-plane-blurb { font-size: 11px; line-height: 1.35; color: #8aa6c0; text-align: center; min-height: 30px; }
.lobby-plane-pick {
  margin-top: 4px; font-size: 12px; font-weight: 700; letter-spacing: 1px;
  color: #9fc4e6; text-transform: uppercase;
}
.lobby-plane-card.selected .lobby-plane-pick { color: #ffb060; }
/* gotowość — przycisk dla nie-hosta (w pasku akcji obok „Wyjdź"); po potwierdzeniu zielony */
.lobby-btn-ready { background: rgba(40,60,80,0.92); border-color: #4a6c8c; }
.lobby-btn-ready.is-ready { background: #2f7d46; border-color: #46a35f; color: #fff; }
.lobby-btn-ready.is-ready:hover { background: #36904f; }
/* host: Start z niepełną gotowością — lekko przygaszony, ale wciąż klikalny (AFK nie blokuje) */
.lobby-btn-wait { opacity: 0.85; }
.lobby-btn:disabled { opacity: 0.45; cursor: not-allowed; }
/* lobby slotowe RTS: kontrolki bota po stronie hosta (poziom per bot + przenieś + usuń) */
.lobby-bot-controls { display: inline-flex; align-items: center; gap: 4px; margin-left: auto; padding-left: 8px; }
.lobby-bot-diff { font-size: 12px; padding: 3px 6px; min-width: auto; }
.lobby-btn-icon { min-width: auto; padding: 4px 8px; font-size: 13px; line-height: 1; }
.lobby-btn-danger { border-color: #8c4a4a; color: #ffb0b0; }
.lobby-btn-danger:hover { background: rgba(108,56,56,0.95); }
/* „+ dodaj bota": selektory modelu+poziomu nad przyciskiem (host wybiera, jaki bot dojdzie) */
.lobby-add-bot-box { display: flex; flex-direction: column; gap: 4px; margin-bottom: 2px; }
.lobby-add-bot-selectors { display: flex; gap: 4px; }
.lobby-add-bot-selectors .lobby-select { flex: 1 1 0; min-width: 0; }
.lobby-add-bot { margin: 0; align-self: stretch; }
.lobby-ffa-bots { display: inline-flex; align-items: center; gap: 8px; }
.lobby-settings-row { flex-wrap: wrap; justify-content: center; }
.lobby-settings-summary { font-size: 13px; color: #cde; }
.lobby-hint { font-size: 13px; text-align: center; max-width: 42em; }
/* selektor drużyny + ustawienia pokoju obok siebie (zbicie wysokości poczekalni) */
.lobby-controls-row { flex-wrap: wrap; justify-content: center; gap: 18px; }
/* pasek akcji: Start/Gotów + Wyjdź w jednym wierszu zamiast osobnych pełnych wierszy */
.lobby-action-row { gap: 12px; justify-content: center; flex-wrap: wrap; margin-top: 2px; }
/* czat w zwartej sekcji: podpis PO LEWEJ od okna; log + pole w kolumnie obok — zamiast pełnego wiersza */
.lobby-chat-section { display: flex; flex-direction: row; align-items: flex-start; justify-content: center; gap: 10px; width: 100%; max-width: 460px; }
.lobby-chat-section .lobby-label { text-align: right; padding-top: 6px; }
.lobby-chat-body { display: flex; flex-direction: column; gap: 4px; }
.lobby-chat-log {
  width: 100%; max-width: 380px; height: 108px; overflow-y: auto;
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
