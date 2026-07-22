// Lokalizacja interfejsu (PL/EN) — WYŁĄCZNIE po stronie klienta (zakres „widoczności gracza").
// Domyślny język to polski; gracz przełącza na angielski w pierwszym oknie (wybór nicku). Wybór
// zapisujemy w localStorage (jak nick) — bez wpływu na protokół czy serwer.
//
// Zasady zakresu (decyzje usera 2026-07-22):
//  • tłumaczymy WSZYSTKO widoczne dla gracza: pierwsze okno, poczekalnię, HUD, tabelę wyników,
//    killfeed, komunikaty śmierci, menu pauzy, pasek strefy, ekrany ładowania/błędów;
//  • tłumaczymy ETYKIETY, ale nazwy własne ZOSTAJĄ (Spitfire/Bf 109/Zero, nicki graczy, kalibry
//    broni, nazwy wariantów). Poziomy trudności i etykiety wartości tłumaczymy („trudny"→„hard").
//
// Poza zakresem (świadomie): panele diagnostyczne DEV (net-debug-overlay, net-conditions-panel) —
// to narzędzia techniczne, nie elementy rozgrywki.
//
// Retranslacja w locie: moduły z tekstami ustawianymi RAZ (w konstruktorze) rejestrują się przez
// `onLangChange` i odświeżają etykiety, gdy gracz przełączy język. Elementy rysowane co klatkę
// (HUD, pasek strefy, killfeed, tabela na żywo) po prostu wołają `t()` przy każdym renderze.

export type Lang = 'pl' | 'en';

const LANG_STORAGE_KEY = 'air-combat:lang';
const DEFAULT_LANG: Lang = 'pl';

/** Wartości interpolacji: `{klucz}` w tekście podmieniamy na wartość z tego obiektu. */
export type MsgParams = Record<string, string | number>;

// === SŁOWNIK POLSKI (źródło kluczy) ===
// Klucze wywodzimy z tego obiektu (`keyof typeof pl`), a słownik EN MUSI mieć te same klucze —
// brak klucza w EN = błąd kompilacji (Record<MessageKey, string>). Zachowane wiodące spacje w
// ostrzeżeniach HUD są istotne (doklejane do wiersza monospace).
const pl = {
  // --- przełącznik języka / pierwsze okno ---
  'lang.label': 'Język',
  'entry.nick': 'Twój nick',
  'entry.join': 'Dołącz',
  'entry.create': 'Załóż własną grę',
  'entry.help': '❔ Jak grać — sterowanie i cel',
  'entry.openGameTitle': 'Trwa otwarta gra: {code}',
  'entry.openGameDetail': '{mode}  ·  {count}/{max} graczy',

  // --- tryby meczu ---
  'mode.ffa': 'FFA (każdy na każdego)',
  'mode.team': 'Drużynowy (2 drużyny)',
  'mode.ffa.short': 'FFA',
  'mode.team.short': 'Drużynowy',

  // --- poczekalnia ---
  'waiting.title': 'POCZEKALNIA',
  'waiting.codeCaption': 'Kod pokoju (podaj znajomym):',
  'waiting.yourTeam': 'Twoja drużyna',
  'waiting.yourPlane': 'Twój samolot',
  'waiting.chat': 'Czat',
  'waiting.chatPlaceholder': 'Napisz wiadomość…',
  'waiting.send': 'Wyślij',
  'waiting.start': 'Start meczu',
  'waiting.startCount': 'Start meczu ({ready}/{total} gotowych)',
  'waiting.startEmptyTeam': 'Start — obsadź obie drużyny',
  'waiting.leave': 'Wyjdź',
  'waiting.readyOn': '✔ Gotów — kliknij, by cofnąć',
  'waiting.readyOff': '✔ Oznacz: jestem gotów',
  'waiting.readyBtn': '✔ Gotów',
  'waiting.tag.you': 'TY',
  'waiting.disconnected': '(rozłączony)',
  'waiting.ready.tip.ready': 'gotów',
  'waiting.ready.tip.waiting': 'czeka',
  'waiting.summaryTeam': 'Tryb: Drużynowy',
  'waiting.summaryFfa': 'Tryb: FFA  ·  Boty: {count}',
  'waiting.teamHead': '{team} ({count})',
  'waiting.addBot': '+ dodaj bota',
  'waiting.addBot.roomFull': 'Pokój pełny',
  'waiting.botRandom': 'Losowy',
  'waiting.botModel.tip': 'Model nowego bota',
  'waiting.botDiff.tip': 'Poziom trudności nowego bota',
  'waiting.moveTo': 'Przenieś do: {team}',
  'waiting.removeBot': 'Usuń bota',
  'waiting.matchInProgress': 'Mecz w toku — dołączysz, gdy host wystartuje kolejny.',
  'waiting.emptyTeamWarn': '⚠ Każda drużyna musi mieć przynajmniej jednego pilota lub bota — obsadź pustą stronę.',
  'waiting.hintPlayer': 'Wybierz samolot i drużynę, a potem kliknij „Gotów". Host wystartuje mecz.',
  'waiting.arrowsHelp': 'Strzałki wskazujące inne samoloty poza ekranem (dla początkujących)',

  // --- drużyny ---
  'team.a': 'Drużyna A',
  'team.b': 'Drużyna B',
  'team.n': 'Drużyna {n}',
  'team.own': 'Twoja drużyna',
  'team.enemies': 'Wrogowie',

  // --- poziomy trudności botów ---
  'diff.latwy': 'łatwy',
  'diff.normalny': 'normalny',
  'diff.trudny': 'trudny',
  'diff.as': 'as',

  // --- karty samolotów (trait + blurb per typ; label/fullName/weapons zostają z shared) ---
  'plane.spitfire.trait': 'Wszechstronny',
  'plane.spitfire.blurb': 'Zrównoważony i wytrzymały — dobry zakręt, szybki, pewny w nurkowaniu; lotki pracują też przy dużej prędkości.',
  'plane.bf109.trait': 'Energia',
  'plane.bf109.blurb': 'Mocne działka i przewaga w pionie — boom & zoom.',
  'plane.zero.trait': 'Wiraż',
  'plane.zero.blurb': 'Bezkonkurencyjny w ciasnym wirażu, lecz kruchy i łatwopalny; przy dużej prędkości lotki sztywnieją.',
  'plane.pick': 'wybierz',
  'plane.selected': '✔ WYBRANY',

  // --- ekran „jak grać" ---
  'help.title': 'JAK GRAĆ',
  'help.sub': 'Spitfire Mk IIa — kamera pościgowa, celowanie myszą',
  'help.goal': 'Cel: utrzymaj STREFĘ nad górą przez {min} min albo wybij wrogów. Uważaj na ziemię i przeciągnięcie przy ostrym zakręcie.',
  'help.start': '▶ Zaczynamy',
  'help.act.aim': 'Celowanie / lot',
  'help.act.fire': 'Ogień',
  'help.act.pitch': 'Nos w górę / w dół',
  'help.act.roll': 'Przechylenie L / P',
  'help.act.yaw': 'Ster kierunku L / P',
  'help.act.throttle': 'Gaz +  /  −',
  'help.act.wep': 'WEP / dopalacz',
  'help.act.flaps': 'Klapy (wysuń / schowaj)',
  'help.act.look': 'Rozglądanie się (kamera)',
  'help.act.scoreboard': 'Tabela wyników',
  'help.act.netpanel': 'Panel sieci',
  'help.key.aim': 'Mysz (kliknij w ekran)',
  'help.key.fire': 'LPM  •  Spacja',
  'help.key.pitch': 'S / ↓   •   W / ↑',
  'help.key.roll': 'A / ←   •   D / →',
  'help.key.yaw': 'Q   •   E',
  'help.key.throttle': 'L.Shift  /  L.Ctrl',
  'help.key.wep': 'L.Shift przy 100% gazu',
  'help.key.flaps': 'F (cyklicznie)',
  'help.key.look': 'Lewy Alt (przytrzymaj)',
  'help.key.scoreboard': 'Tab (przytrzymaj)',
  'help.key.netpanel': 'N',

  // --- błędy lobby (klient mapuje kod z serwera) ---
  'error.version': 'Niezgodna wersja gry — odśwież stronę.',
  'error.notHost': 'Tylko host może to zrobić.',
  'error.badCode': 'Nieprawidłowy lub nieistniejący kod pokoju.',
  'error.full': 'Pokój jest pełny.',

  // --- HUD: etykiety wierszy ---
  'hud.alt': 'alt',
  'hud.climb': 'wznosz.',
  'hud.throttle': 'gaz',
  'hud.temp': 'temp.',
  'hud.fuel': 'paliwo',
  'hud.ctrl': 'ster',
  'hud.ammo': 'amun.',
  'hud.flaps': 'klapy',
  'hud.mouse': 'mysz',
  'hud.keyboard': 'klawiatura',
  'hud.noWep': 'bez WEP',
  'hud.flaps.torn': 'URWANE',

  // --- HUD: nazwy pozycji klap (z JSON samolotów) ---
  'flaps.schowane': 'schowane',
  'flaps.bojowe': 'bojowe',
  'flaps.pełne': 'pełne',

  // --- HUD: sufiksy ostrzeżeń (wiodące spacje istotne) ---
  'hud.warn.aileronsLocked': '   *** LOTKI ZABETONOWANE ***',
  'hud.warn.aileronsStiff': '   ! lotki sztywne — zwolnij !',
  'hud.warn.vneTear': '   *** Vne — WYRWIE SKRZYDŁA ***',
  'hud.warn.vne': '   ! Vne — zwolnij !',
  'hud.warn.ammoEmpty': '   *** PUSTE ***',
  'hud.warn.low': '   ! mało !',
  'hud.warn.fuelEmpty': '   *** SILNIK STANĄŁ ***',
  'hud.warn.overheat': '   *** PRZEGRZANIE ***',
  'hud.lowFps': 'KARTA GRAFICZNA ZA SŁABA',

  // --- HUD: duże ostrzeżenia (środek ekranu) ---
  'hud.big.stall': 'PRZECIĄGNIĘCIE',
  'hud.big.buffet': 'BUFFET',
  'hud.big.vne': 'PRZEKROCZONA Vne — DRŻENIE URYWA SKRZYDŁA',
  'hud.big.greyout': 'SZARZENIE — ODPUŚĆ G',
  'hud.big.overheat': 'PRZEGRZANIE SILNIKA — ZMNIEJSZ GAZ',
  'hud.big.noFuel': 'BRAK PALIWA — SILNIK STANĄŁ',

  // --- tabela wyników ---
  'sb.title.team': 'TABELA WYNIKÓW — eliminacja drużynowa',
  'sb.title.ffa': 'TABELA WYNIKÓW — eliminacja (każdy na każdego)',
  'sb.col.pilot': 'Pilot',
  'sb.col.kills': 'Z',
  'sb.col.deaths': 'Ś',
  'sb.col.assists': 'A',
  'sb.col.plane': 'Samolot',
  'sb.col.info': 'Info',
  'sb.col.zone': 'Strefa',
  'sb.col.pts': 'Pkt',
  'sb.col.ping': 'ping',
  'sb.reason.zone': 'przejęto strefę kontroli',
  'sb.reason.teamElim': 'przeciwna drużyna wyeliminowana',
  'sb.reason.lastStanding': 'ostatni ocalały',
  'results.title': 'KONIEC MECZU',
  'results.draw': 'Remis ({reason})',
  'results.teamWin': '🏆 ZWYCIĘSTWO DRUŻYNY! ({reason})',
  'results.enemiesWin': 'Wygrywają Wrogowie ({reason})',
  'results.win': '🏆 ZWYCIĘSTWO! ({reason})',
  'results.playerWin': '🏆 Wygrywa {nick} ({reason})',
  'results.over': 'Koniec ({reason})',
  'results.backToLobby': 'Wróć do poczekalni',
  'results.leaveRoom': 'Opuść pokój',
  'results.hint': 'Wróć do poczekalni, by zagrać ponownie, albo opuść pokój. [Tab] chowa/pokazuje tabelę.',

  // --- nakładka po zestrzeleniu ---
  'downed.hint': 'steruj wrakiem: W/S/A/D, Q/E   •   Spacja: ogień   — albo:',
  'downed.spectate': 'TRYB OBSERWATORA',
  'downed.scoreboard': 'TABELA WYNIKÓW',
  'downed.end': 'ZAKOŃCZ MISJĘ',

  // --- menu pauzy ---
  'pause.title': 'PAUZA',
  'pause.resume': 'WRÓĆ DO GRY',
  'pause.end': 'ZAKOŃCZ MISJĘ',
  'pause.backToLobby': 'WRÓĆ DO POCZEKALNI',
  'pause.hintHumans': 'Mecz toczy się dalej dla pozostałych graczy — dołączysz przy kolejnym starcie.',
  'pause.hintBots': 'Mecz zostanie zakończony — wrócisz do poczekalni.',

  // --- pasek strefy ---
  'zone.own': 'PRZEJMUJESZ STREFĘ',
  'zone.enemy': 'WRÓG PRZEJMUJE STREFĘ',
  'zone.contested': 'STREFA SPORNA — pauza',
  'zone.neutral': 'STREFA WOLNA — leć nad górę',
  'zone.enemyLabel': '◀ WRÓG',
  'zone.youLabel': 'TY ▶',
  'zone.target': 'cel {clock}',

  // --- HUD uszkodzeń: strefy + flagi ---
  'zone.engine': 'SILNIK',
  'zone.cockpit': 'PILOT',
  'zone.tank': 'ZBIORNIK',
  'zone.wing': 'SKRZYDŁO',
  'zone.tail': 'OGON',
  'zone.fire': 'POŻAR',
  'dmg.fire': '🔥 POŻAR',
  'dmg.leak': '⛽ WYCIEK',
  'dmg.pilot': '✚ PILOT',
  'dmg.integrity': 'integr. {pct}%',

  // --- killfeed / komunikaty śmierci ---
  'death.shotDown': 'ZESTRZELONY',
  'death.collision': 'KOLIZJA',
  'death.crashed': 'ROZBITY',
  'death.engineFire': 'POŻAR SILNIKA',
  'death.structural': 'ROZPAD KONSTRUKCJI',
  'death.withModule': '{base} — {module}',
  'feed.teammate': ' (sojusznik!)',
  'feed.kill': '✕ {killer} → {victim}{teamkill}',
  'feed.death': '✕ {victim} — {reason}',
  'feed.reason.collision': 'kolizja',
  'feed.reason.flak': 'ostrzał z ziemi',
  'feed.reason.overheat': 'pożar silnika',
  'feed.reason.structure': 'rozpad konstrukcji',
  'feed.reason.crash': 'rozbicie',

  // --- tabela: kolumna „Info" (wartości) ---
  'info.botLevel': 'poziom: {level}',
  'info.botLevelUnknown': 'poziom: —',
  'info.arrows': 'strzałki: {state}',
  'info.on': 'wł.',
  'info.off': 'wył.',

  // --- alerty pełnoekranowe ---
  'alert.spectating': 'OBSERWUJESZ',
  'alert.spectatingWho': 'OBSERWUJESZ: {name}',
  'alert.spectateSwitch': '{who}   [LPM] zmień samolot',
  'alert.arenaEdge': 'KONIEC MAPY ZA {m} m — NASTĄPI PRZENIESIENIE',

  // --- ekran ładowania ---
  'loading.connecting': 'Łączenie z serwerem…',
  'loading.world': 'Wczytywanie świata…',
  'loading.models': 'Wczytywanie modeli samolotów: {ready} / {total}',

  // --- nakładka połączenia ---
  'conn.reconnecting': 'Wznawianie połączenia…',
  'conn.reconnectingMsg': 'powrót do gry ({s} s)',
  'conn.errorHead': 'Błąd połączenia',
  'conn.tryAgain': 'Spróbuj ponownie',
  'conn.closedHead': 'Rozłączono',
  'conn.reconnect': 'Połącz ponownie',
  'conn.msg.error': 'błąd połączenia z serwerem',
  'conn.msg.closed': 'połączenie zamknięte',

  // --- panel dźwięku (menu pauzy) ---
  'audio.sound': '🔊 dźwięk',
  'audio.muted': '🔇 wycisz.',
  'audio.volume': 'głośność',

  // --- błąd WebGL (index.html) ---
  'webgl.head': 'Grafika 3D niedostępna',
  'webgl.body': 'Przeglądarka utraciła kontekst WebGL albo go nie obsługuje. Sprawdź, czy włączona jest akceleracja sprzętowa, i odśwież stronę.',
  'webgl.refresh': 'Odśwież',

  // --- atrybucje CC (spójniki; nazwy własne, autorzy i licencje zostają) ---
  'attr.models': 'Modele: „Supermarine Spitfire Mk.IIa" — ',
  'attr.license': ' (Sketchfab) — licencja CC-BY 4.0. Dźwięki (freesound, CC-BY): ',
  'attr.horizon': '. Sztuczny horyzont: „Sperry F3 artificial horizon" — ',
  'attr.modified': ' (Wikimedia Commons, CC BY-SA 4.0, zmodyfikowany)',
} as const;

export type MessageKey = keyof typeof pl;

// === SŁOWNIK ANGIELSKI ===
// Nazwy własne (Spitfire/Bf 109/Zero, kalibry, warianty) i nicki NIE są tu tłumaczone — zostają
// z shared / danych gracza. Skróty klawiszy dopasowane do konwencji anglojęzycznych (LMB/RMB).
const en: Record<MessageKey, string> = {
  'lang.label': 'Language',
  'entry.nick': 'Your callsign',
  'entry.join': 'Join',
  'entry.create': 'Create your own game',
  'entry.help': '❔ How to play — controls & goal',
  'entry.openGameTitle': 'Open game in progress: {code}',
  'entry.openGameDetail': '{mode}  ·  {count}/{max} players',

  'mode.ffa': 'FFA (free-for-all)',
  'mode.team': 'Team (2 teams)',
  'mode.ffa.short': 'FFA',
  'mode.team.short': 'Team',

  'waiting.title': 'WAITING ROOM',
  'waiting.codeCaption': 'Room code (share with friends):',
  'waiting.yourTeam': 'Your team',
  'waiting.yourPlane': 'Your aircraft',
  'waiting.chat': 'Chat',
  'waiting.chatPlaceholder': 'Type a message…',
  'waiting.send': 'Send',
  'waiting.start': 'Start match',
  'waiting.startCount': 'Start match ({ready}/{total} ready)',
  'waiting.startEmptyTeam': 'Start — fill both teams',
  'waiting.leave': 'Leave',
  'waiting.readyOn': '✔ Ready — click to cancel',
  'waiting.readyOff': '✔ Mark: I’m ready',
  'waiting.readyBtn': '✔ Ready',
  'waiting.tag.you': 'YOU',
  'waiting.disconnected': '(disconnected)',
  'waiting.ready.tip.ready': 'ready',
  'waiting.ready.tip.waiting': 'waiting',
  'waiting.summaryTeam': 'Mode: Team',
  'waiting.summaryFfa': 'Mode: FFA  ·  Bots: {count}',
  'waiting.teamHead': '{team} ({count})',
  'waiting.addBot': '+ add bot',
  'waiting.addBot.roomFull': 'Room full',
  'waiting.botRandom': 'Random',
  'waiting.botModel.tip': 'New bot model',
  'waiting.botDiff.tip': 'New bot difficulty',
  'waiting.moveTo': 'Move to: {team}',
  'waiting.removeBot': 'Remove bot',
  'waiting.matchInProgress': 'Match in progress — you’ll join when the host starts the next one.',
  'waiting.emptyTeamWarn': '⚠ Each team needs at least one pilot or bot — fill the empty side.',
  'waiting.hintPlayer': 'Pick an aircraft and a team, then click “Ready”. The host will start the match.',
  'waiting.arrowsHelp': 'Arrows pointing to off-screen aircraft (for beginners)',

  'team.a': 'Team A',
  'team.b': 'Team B',
  'team.n': 'Team {n}',
  'team.own': 'Your team',
  'team.enemies': 'Enemies',

  'diff.latwy': 'easy',
  'diff.normalny': 'normal',
  'diff.trudny': 'hard',
  'diff.as': 'ace',

  'plane.spitfire.trait': 'All-rounder',
  'plane.spitfire.blurb': 'Balanced and tough — good turn, fast, steady in a dive; ailerons keep working at high speed.',
  'plane.bf109.trait': 'Energy',
  'plane.bf109.blurb': 'Hard-hitting cannons and vertical advantage — boom & zoom.',
  'plane.zero.trait': 'Turn',
  'plane.zero.blurb': 'Unbeatable in a tight turn, but fragile and flammable; ailerons stiffen at high speed.',
  'plane.pick': 'select',
  'plane.selected': '✔ SELECTED',

  'help.title': 'HOW TO PLAY',
  'help.sub': 'Spitfire Mk IIa — chase camera, mouse aiming',
  'help.goal': 'Goal: hold the ZONE over the mountain for {min} min or wipe out the enemies. Watch out for the ground and for stalling in a hard turn.',
  'help.start': '▶ Let’s go',
  'help.act.aim': 'Aim / fly',
  'help.act.fire': 'Fire',
  'help.act.pitch': 'Nose up / down',
  'help.act.roll': 'Roll L / R',
  'help.act.yaw': 'Rudder L / R',
  'help.act.throttle': 'Throttle +  /  −',
  'help.act.wep': 'WEP / boost',
  'help.act.flaps': 'Flaps (extend / retract)',
  'help.act.look': 'Look around (camera)',
  'help.act.scoreboard': 'Scoreboard',
  'help.act.netpanel': 'Network panel',
  'help.key.aim': 'Mouse (click the screen)',
  'help.key.fire': 'LMB  •  Space',
  'help.key.pitch': 'S / ↓   •   W / ↑',
  'help.key.roll': 'A / ←   •   D / →',
  'help.key.yaw': 'Q   •   E',
  'help.key.throttle': 'L.Shift  /  L.Ctrl',
  'help.key.wep': 'L.Shift at 100% throttle',
  'help.key.flaps': 'F (cycle)',
  'help.key.look': 'Left Alt (hold)',
  'help.key.scoreboard': 'Tab (hold)',
  'help.key.netpanel': 'N',

  'error.version': 'Game version mismatch — refresh the page.',
  'error.notHost': 'Only the host can do that.',
  'error.badCode': 'Invalid or unknown room code.',
  'error.full': 'The room is full.',

  'hud.alt': 'alt',
  'hud.climb': 'climb',
  'hud.throttle': 'thr',
  'hud.temp': 'temp',
  'hud.fuel': 'fuel',
  'hud.ctrl': 'ctrl',
  'hud.ammo': 'ammo',
  'hud.flaps': 'flaps',
  'hud.mouse': 'mouse',
  'hud.keyboard': 'keyboard',
  'hud.noWep': 'no WEP',
  'hud.flaps.torn': 'TORN OFF',

  'flaps.schowane': 'retracted',
  'flaps.bojowe': 'combat',
  'flaps.pełne': 'full',

  'hud.warn.aileronsLocked': '   *** AILERONS LOCKED ***',
  'hud.warn.aileronsStiff': '   ! ailerons stiff — slow down !',
  'hud.warn.vneTear': '   *** Vne — WINGS WILL TEAR OFF ***',
  'hud.warn.vne': '   ! Vne — slow down !',
  'hud.warn.ammoEmpty': '   *** EMPTY ***',
  'hud.warn.low': '   ! low !',
  'hud.warn.fuelEmpty': '   *** ENGINE STOPPED ***',
  'hud.warn.overheat': '   *** OVERHEAT ***',
  'hud.lowFps': 'GPU TOO SLOW',

  'hud.big.stall': 'STALL',
  'hud.big.buffet': 'BUFFET',
  'hud.big.vne': 'Vne EXCEEDED — FLUTTER TEARS THE WINGS OFF',
  'hud.big.greyout': 'GREYOUT — EASE OFF THE G',
  'hud.big.overheat': 'ENGINE OVERHEAT — REDUCE THROTTLE',
  'hud.big.noFuel': 'OUT OF FUEL — ENGINE STOPPED',

  'sb.title.team': 'SCOREBOARD — team elimination',
  'sb.title.ffa': 'SCOREBOARD — free-for-all elimination',
  'sb.col.pilot': 'Pilot',
  'sb.col.kills': 'K',
  'sb.col.deaths': 'D',
  'sb.col.assists': 'A',
  'sb.col.plane': 'Aircraft',
  'sb.col.info': 'Info',
  'sb.col.zone': 'Zone',
  'sb.col.pts': 'Pts',
  'sb.col.ping': 'ping',
  'sb.reason.zone': 'control zone captured',
  'sb.reason.teamElim': 'enemy team eliminated',
  'sb.reason.lastStanding': 'last one standing',
  'results.title': 'MATCH OVER',
  'results.draw': 'Draw ({reason})',
  'results.teamWin': '🏆 TEAM VICTORY! ({reason})',
  'results.enemiesWin': 'Enemies win ({reason})',
  'results.win': '🏆 VICTORY! ({reason})',
  'results.playerWin': '🏆 {nick} wins ({reason})',
  'results.over': 'Match over ({reason})',
  'results.backToLobby': 'Back to lobby',
  'results.leaveRoom': 'Leave room',
  'results.hint': 'Return to the lobby to play again, or leave the room. [Tab] hides/shows the table.',

  'downed.hint': 'steer the wreck: W/S/A/D, Q/E   •   Space: fire   — or:',
  'downed.spectate': 'SPECTATE',
  'downed.scoreboard': 'SCOREBOARD',
  'downed.end': 'END MISSION',

  'pause.title': 'PAUSE',
  'pause.resume': 'RESUME',
  'pause.end': 'END MISSION',
  'pause.backToLobby': 'BACK TO LOBBY',
  'pause.hintHumans': 'The match continues for the others — you’ll rejoin at the next start.',
  'pause.hintBots': 'The match will end — you’ll return to the lobby.',

  'zone.own': 'CAPTURING ZONE',
  'zone.enemy': 'ENEMY CAPTURING ZONE',
  'zone.contested': 'ZONE CONTESTED — paused',
  'zone.neutral': 'ZONE OPEN — fly over the mountain',
  'zone.enemyLabel': '◀ ENEMY',
  'zone.youLabel': 'YOU ▶',
  'zone.target': 'target {clock}',

  'zone.engine': 'ENGINE',
  'zone.cockpit': 'PILOT',
  'zone.tank': 'TANK',
  'zone.wing': 'WING',
  'zone.tail': 'TAIL',
  'zone.fire': 'FIRE',
  'dmg.fire': '🔥 FIRE',
  'dmg.leak': '⛽ LEAK',
  'dmg.pilot': '✚ PILOT',
  'dmg.integrity': 'struct. {pct}%',

  'death.shotDown': 'SHOT DOWN',
  'death.collision': 'COLLISION',
  'death.crashed': 'CRASHED',
  'death.engineFire': 'ENGINE FIRE',
  'death.structural': 'STRUCTURAL FAILURE',
  'death.withModule': '{base} — {module}',
  'feed.teammate': ' (teammate!)',
  'feed.kill': '✕ {killer} → {victim}{teamkill}',
  'feed.death': '✕ {victim} — {reason}',
  'feed.reason.collision': 'collision',
  'feed.reason.flak': 'ground fire',
  'feed.reason.overheat': 'engine fire',
  'feed.reason.structure': 'structural failure',
  'feed.reason.crash': 'crash',

  'info.botLevel': 'level: {level}',
  'info.botLevelUnknown': 'level: —',
  'info.arrows': 'arrows: {state}',
  'info.on': 'on',
  'info.off': 'off',

  'alert.spectating': 'SPECTATING',
  'alert.spectatingWho': 'SPECTATING: {name}',
  'alert.spectateSwitch': '{who}   [LMB] switch aircraft',
  'alert.arenaEdge': 'MAP EDGE IN {m} m — YOU WILL BE MOVED',

  'loading.connecting': 'Connecting to server…',
  'loading.world': 'Loading world…',
  'loading.models': 'Loading aircraft models: {ready} / {total}',

  'conn.reconnecting': 'Reconnecting…',
  'conn.reconnectingMsg': 'back to game ({s} s)',
  'conn.errorHead': 'Connection error',
  'conn.tryAgain': 'Try again',
  'conn.closedHead': 'Disconnected',
  'conn.reconnect': 'Reconnect',
  'conn.msg.error': 'connection error',
  'conn.msg.closed': 'connection closed',

  'audio.sound': '🔊 sound',
  'audio.muted': '🔇 muted',
  'audio.volume': 'volume',

  'webgl.head': '3D graphics unavailable',
  'webgl.body': 'The browser lost the WebGL context or does not support it. Check that hardware acceleration is enabled and refresh the page.',
  'webgl.refresh': 'Refresh',

  'attr.models': 'Models: “Supermarine Spitfire Mk.IIa” — ',
  'attr.license': ' (Sketchfab) — CC-BY 4.0 license. Sounds (freesound, CC-BY): ',
  'attr.horizon': '. Artificial horizon: “Sperry F3 artificial horizon” — ',
  'attr.modified': ' (Wikimedia Commons, CC BY-SA 4.0, modified)',
};

const DICT: Record<Lang, Record<MessageKey, string>> = { pl, en };

let current: Lang = loadLang();
const listeners = new Set<() => void>();

function loadLang(): Lang {
  try {
    const raw = localStorage.getItem(LANG_STORAGE_KEY);
    return raw === 'en' ? 'en' : DEFAULT_LANG;
  } catch {
    return DEFAULT_LANG;
  }
}

function saveLang(lang: Lang): void {
  try {
    localStorage.setItem(LANG_STORAGE_KEY, lang);
  } catch {
    /* localStorage niedostępny (tryb prywatny) — pomiń */
  }
}

/** Bieżący język interfejsu. */
export function getLang(): Lang {
  return current;
}

/** Zmienia język, zapisuje wybór i powiadamia subskrybentów (re-render statycznych tekstów). */
export function setLang(lang: Lang): void {
  if (lang === current) return;
  current = lang;
  saveLang(lang);
  for (const cb of listeners) cb();
}

/** Rejestruje callback odświeżający statyczne teksty modułu przy zmianie języka. */
export function onLangChange(cb: () => void): void {
  listeners.add(cb);
}

/** Tłumaczenie klucza w bieżącym języku; `{param}` podmieniane wartościami z `params`. */
export function t(key: MessageKey, params?: MsgParams): string {
  let s: string = DICT[current][key];
  if (params) {
    for (const k of Object.keys(params)) {
      s = s.split(`{${k}}`).join(String(params[k]));
    }
  }
  return s;
}
