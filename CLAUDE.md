# CLAUDE.md — air-combat-fable5

<!--
  Trwałe instrukcje sesyjne. Ładowane na każdym starcie sesji, przeżywają /compact.
  TU żyją twarde niezmienniki. NIE wpisuj tutaj: historii projektu (→ memory/),
  szczegółów decyzji (→ PLAN.md / docs/phases/), notatek bieżącej sesji.
-->

## Status faz

Fazy ukończone: **0–18 + domknięcie parytetu MP↔SP (P1–P5) + Faza 19 (19a ✅, 19b ✅) + Faza 20 ✅ + Faza 21 (audio ✅; wizualia → backlog)**. Szczegóły
każdej fazy w `docs/phases/faza-NN.md` i `memory/`; cały wysiłek parytetu MP↔SP (fazy 14–18 + P1–P5) spięty
w przewodniku **`docs/parytet-mp-sp.md`** (mapa SP→MP, decyzje, pułapki, otwarte sprawy).

| #     | Temat                                                                 | Stan / uwaga |
| ----- | --------------------------------------------------------------------- | ------------ |
| 0–6   | Fundament: monorepo, fizyka lotu, świat, broń, bot AI                 | ✅ grywalny dogfight SP |
| 7     | Wczesny deploy: publiczne demo SP                                     | ✅ `https://dogfight.tatanga.eu` (port 8087, tag `demo-1`) |
| 8     | Multiplayer: protokół binarny + serwer autorytatywny                  | ✅ fizyka 60 Hz / snapshoty 30 Hz |
| 9     | Prediction + reconciliation + interpolacja                            | ✅ wspólny `stepPilotedPlane` |
| 10    | Lobby i pokoje                                                        | ✅ rejestr pokoi + reconnect (token, okno 60 s) |
| 11    | Walka sieciowa: hit detection + lag‑comp                              | ✅ kod; ⏳ user: ping ~150 ms 2‑os. + CPU 8 graczy na VPS |
| 12    | Boty na serwerze                                                      | ✅ bot = `ServerPlayer`, nieodróżnialny protokołowo |
| 13    | Pętla meczu FFA + deploy MP (kamień milowy)                           | ✅ kod + **wdrożone** `https://dogfight.tatanga.eu` (8087, Websockets ON, tag `mp-1`, live 2026-06-25); ⏳ user: smoke wss:// + `docker stats` |
| 14–18 | **Parytet MP↔SP**: wizualia → wrak → obserwator → strefa → drużyny    | ✅ → `docs/parytet-mp-sp.md` |
| P1–P5 | **Domknięcie parytetu**: FFA eliminacja, CC-BY, onboarding, buffet, sprzątanie | ✅ zacommitowane (404 testy zielone) |
| 19a   | **Drugi samolot (shared)**: Bf 109 E-3, uzbrojenie w grupach, balistyka per-pocisk, złote testy `describe.each` | ✅ 424 testy zielone (`bf109-e.json`, asymetria turn↔energy) |
| 19b   | **Drugi samolot (integracja)**: protokół v4 (bajt typu), per-player plane serwer, rejestr meshy + model 3D Bf 109, wybór w lobby, HUD typ wroga, balans 1v1 | ✅ 440 testów zielone; ⏳ user: playtest balansu + weryfikacja wzrokowa modelu + smoke v4 |
| 20    | **Teren v2 (timebox)**: złota godzina+lens flare, chmury billboardowe (krycie się), woda v2 (waternormals+odbicie nieba, bez planar), teren 2-poziomowy | ✅ 460 testów zielone; podpunkt 5 → backlog; **doszlif 2026-06-21**: tekstury v3 2K + anti-tiling (koniec „kraty"), fix migotania brzegu (`logarithmicDepthBuffer`), drzewa próbowane→odrzucone; ⏳ user: pomiar fps RTX + weryfikacja wzrokowa (patrz `docs/phases/faza-20.md`) |
| 21    | **Dźwięk i efekty (audio)**: Web Audio (Three.js listener), silniki dobrane do modeli (Merlin→Spitfire, **DB 601→Bf 109**), broń 7,7 mm vs działko 20 mm, eksplozje/trafienia (sample freesound CC0/CC-BY), świst∝IAS²+buffet+ding/UI proceduralne, master vol+mute (localStorage, menu pauzy/klawisz M) | ✅ 474 testy zielone; **wizualia (smugi kondensacyjne/szczątki/ślad 20 mm) → backlog** (nieweryfikowalne wzrokowo z sesji, fps to kryterium); ⏳ user: odsłuch/playtest miksu + brak błędów autoplay (Chrome/FF/Edge) + fps RTX (patrz `docs/phases/faza-21.md`) |

**Protokół: `PROTOCOL_VERSION = 7`** (bumpnięty w f14 +1 bajt amunicji, w f19b +1 bajt typu samolotu,
w sesji poprawek 2026-06-21 +1 bajt amunicji GRUPY WTÓRNEJ = działko 20 mm Bf 109 → v5; v6 = naziemne
stanowiska ogniowe AA (nowe zdarzenia binarne EV_AA_FIRE/EV_AA_DESTROYED, cause `'flak'`); v7 = +1 bajt
PALIWA w snapshocie encji (paliwo przestało być ukrytym stanem — autorytatywne jak HP/amunicja, fix pustego
baku po auto-reconnekcie, 2026-06-26); fazy 15–18, P1–P5 i czat poczekalni bez bumpu — addytywne JSON albo
usunięcia). **Deploy front+back RAZEM** (niespójna wersja = błąd handshake).

**Sesja poprawek 2026-06-21 (poza fazami, 7 zgłoszeń usera — 460 testów zielone):** (1) pole nicku/czatu
— `KeyboardInput` nie przechwytuje WSADQE, gdy fokus w polu tekstowym (`isEditingText`); (2) ekran ładowania
online czeka na modele 3D WSZYSTKICH samolotów meczu + postęp „X/Y" (teren generuje się natychmiast, .glb
sekundy → bryły zastępcze); (3) ping w HUD odświeżany co ~1 s; (4) boty „trudne" zrywają w GÓRĘ-w-bok 0,5 s
po trafieniu (`hitReactionDelayS` w JSON tylko trudny; pull MUSI mieć dominującą pionę, bo instruktor bramkuje
ciągnięcie błędem przechylenia); (5) nazwiska botów wg samolotu (PL/Spitfire, DE/Bf 109; `nextName(type)`+`refreshBotName`)
i wyrównanie listy uczestników (kolumna auto-dopasowana + przycinanie); (6) licznik amunicji 20 mm (protokół v5);
(7) kolizje na starcie meczu (zwł. FFA): sticky `player.slot` (`nextSlot++ % SPAWN_RING_SLOTS`, nigdy nie zerowany)
churnował się przy przebudowie botów (zmiana ustawień w poczekalni → `setBots` kasuje+tworzy) i po zawinięciu modulo
dwie żywe encje dostawały TEN SAM slot → spawn w identycznym punkcie → zderzenie tuż po wygaśnięciu ochrony 3 s.
Fix: `start()` przydziela odrębne, równomiernie rozłożone sloty (`assignStartSlots`, round(i·S/n)); BEZ protokołu (v5).

**Sesja poprawek 2026-06-21 cz.2 (3 zgłoszenia, 465 testów zielone, BEZ bumpu protokołu — v5):** (1) usunięty
napis HUD „[kliknij — celowanie myszą]" (redundantny z wierszem „ster"; tryb celowania nadal w „ster"); (2) FPS
w HUD także online (`fpsHudLine` w `hud.ts`, wspólny SP+MP); poniżej 30 fps wiersz **miga naprzemiennie** (wolno,
cykl 5 s) liczbą klatek i „KARTA GRAFICZNA ZA SŁABA"; (3) **paliwo** jako ukryty stan fizyki (`PlaneState.fuelFrac`
0..1, BEZ snapshotu — jak maszyna stallu/G-LOC): spala się proporcjonalnie do gazu (`fuelEnduranceFullThrottleS=900`
w JSON obu samolotów = 15 min na 100% gazu), po wyczerpaniu silnik gaśnie (`thrustForce` T=0), każdy samolot
(gracz+boty), respawn = pełny bak. Liczy `pilotStep` (serwer autorytatywnie, klient predykuje; `reconcile` resetuje
do 1 przy świeżym spawnie). HUD: wiersz „paliwo %" + „! mało !"/„BRAK PALIWA — SILNIK STANĄŁ". Śmigło nadal kręci
się wg gazu (nie wg paliwa) — parytet local↔remote (paliwa zdalnych nie ma w snapshocie).

**Sesja poprawek 2026-06-22 (2 zgłoszenia, 466 testów zielone, BEZ bumpu protokołu — v5):** (1) **zwłoka 5 s przed
tabelą wyników** (`MATCH_END_VIEW_DELAY_S`) przy KAŻDYM naturalnym końcu meczu (eliminacja/strefa, zwycięstwo i
porażka — decyzja usera) — świat żyje dalej, więc widać upadek ostatniego pokonanego wroga. SP: `scheduleMatchEnd`
(zamraża werdykt, timer w pętli renderu) → po 5 s `finalizeMatch`; ręczne „zakończ misję" omija zwłokę (od razu).
Serwer: `pendingEnd`+`advancePendingEnd` w `step()` — pokój zostaje `'playing'` (fizyka+snapshoty lecą), `matchEnded`
dopiero po zwłoce; klient online bez zmian (czeka na `matchEnded`). (2) **woda vs ląd przy uderzeniu** (parytet
SP↔MP, BEZ protokołu — decyzja woda/ląd po `terrain.heightAt`>SEA_LEVEL_M, klient ma ten sam seed): **woda** → jasny
**plusk** (`Explosions.splash`, paleta błękitno-biała, słabsza grawitacja) i samolot **znika** pod taflą; **ląd** →
krótki ognisty wybuch + **zwęglony wrak ZOSTAJE** w miejscu rozbicia, **lekko dymi** (`GROUND_FIRE_TIER`) do końca
meczu. Zwęglenie = odwracalna podmiana materiałów na wspólny ciemny (`charPlaneMesh`/`restorePlaneMesh` w
`plane-mesh.ts`; oryginał w `userData`, przywracany przy (re)spawnie). SP: flaga `Combatant.burningWreck` (render
trzyma mesh widoczny+dym); MP: `burningWreckIds` w `online-main.ts` (efekt przy przejściu →`dead` w pętli renderu;
`onKill` już NIE robi wybuchu dla `'ground'` — robi go `handleSurfaceImpact`). Dotyczy bezpośrednich rozbić i
spadających wraków, gracza i botów.

**Usunięcie trybu SP 2026-06-22 (decyzja usera — SP był tylko etapem rozwoju):** jedyną wersją gry jest
teraz **multiplayer**. Strona MP (`online.html` → `online-main.ts`) przejęła miejsce `index.html` (przez
`git mv`, z zachowaniem historii) i jest serwowana pod rootem `/` — także na `dogfight.tatanga.eu` (było:
demo SP pod `/`). Usunięte pliki klienta: `index.html` (stary SP), `main.ts`, `menu.ts`, `standings-overlay.ts`,
`net-status.ts` oraz narzędzia DEV wpięte tylko w SP: `force-arrows.ts`, `flight-recorder.ts`, `tuning-panel.ts`
i strona telemetrii (`telemetry.html` + `telemetry.ts` + `recording-codec.ts`). `vite.config.ts` uproszczony do
jednego wejścia (domyślne `index.html`). **`packages/shared` NIETKNIĘTY** — to rdzeń fizyki współdzielony z
serwerem (część eksportów używana już tylko przez serwer/testy; świadomie nie przycinane). Protokół BEZ zmian (v5).
**Deploy:** front+back RAZEM — backend MUSI działać, bo MP pod rootem bez serwera WS nie wystartuje (lobby).
`docs/phases/*` zostają jako zapis historyczny (opisują przeszłe fazy, w tym SP).

**Sesja poprawek 2026-06-23 (2 zgłoszenia, czysto klienckie, 470 testów zielone, BEZ protokołu — v5):**
(1) **komunikat śmierci wg przyczyny** (`KillCause` z eventu KILL): ogień wroga → „ZESTRZELONY", zderzenie z
samolotem (`collision`) → „KOLIZJA", rozbicie o teren/wodę (`ground`) → „ROZBITY" (decyzja usera: rozróżniać, nie
jeden napis). `localDeathCause` ustawiany w `onKill` gdy `victimId===localId`; helper `deathLabel`; użyty w alercie
pełnoekranowym i w tytule `DownedOverlay.show(canSpectate, title)` (dodany param); reset w `onLocalRespawn`/`resetGameState`;
domyślnie (przyczyna nieznana) → „ZESTRZELONY". (2) **tonięcie wraku na wodzie**: zamiast unoszenia się — wrak osiada
na tafli, po `WATER_SINK_HOLD_S=0.6 s` zanurza się (`WATER_SINK_SPEED_MS=9`) i po `WATER_SINK_TOTAL_S=1.5 s` znika.
`sinkingWrecks: Map<id,czas>` rozłączna z `burningWreckIds` (woda znika, ląd zostaje zwęglony); `handleSurfaceImpact`
woda → `splash`+`sinkingWrecks.set(id,0)`; pętla renderu: widoczność `|| sinkingWrecks.has(id)`, opuszczanie `position.y`,
po czasie `visible=false`+usuń wpis; czyszczone przy respawnie/resecie/usunięciu encji. (Uwaga: nad otwartym morzem mesh
i tak znikał od razu — „pływające" wraki widziane przez usera mogą być płytką wodą przybrzeżną klasyfikowaną jako ląd
przez `terrain.heightAt`>SEA_LEVEL_M; do weryfikacji wzrokowej.)

**Zakończenie misji w dowolnym momencie 2026-06-23 (życzenie usera, 474 testy zielone, BEZ bumpu protokołu — v5,
addytywne wiadomości JSON):** klawisz **Esc** otwiera menu pauzy (`pause-menu.ts`, `PauseMenu`) w trakcie meczu (świat
żyje dalej — serwer autorytatywny, nic się nie pauzuje; menu tylko zwalnia kursor i bramkuje ogień/celowanie przez
`pauseMenuOpen`). Akcja końca jest **kontekstowa** (`otherHumansPresent()` z `roomView.players`): (a) **same boty** →
„ZAKOŃCZ MISJĘ" = `net.endMatch()` → serwer `abortMatch()` (playing→**waiting** BEZ ekranu wyników) → wszyscy do
poczekalni przez `roomUpdate`; (b) **są ludzie** → „WRÓĆ DO POCZEKALNI" = `net.leaveMatch()` → serwer
`withdrawToLobby(id)` (samolot martwy, `livesLeft=0`, `withdrawn=true`, bez respawnu — nie blokuje eliminacji), klient
od razu pokazuje poczekalnię (`withdrawnToWaiting`), **mecz trwa dla reszty**; gracz wraca do gry przy następnym
`start()` (zeruje `withdrawn`+życia). Serwer egzekwuje regułę (connection): `endMatch` tylko host **i** `humanCount≤1`,
`leaveMatch` dla każdego członka. Poczekalnia podczas trwającego meczu (lobby-ui `updateWaiting`, `view.state≠'waiting'`):
chowa Start/ustawienia, pokazuje „mecz w toku". Guardy klienta: `onRoomUpdate` 'playing' nie wciąga wycofanego z powrotem,
`onMatchEnded` pomijany w phase 'lobby'. **Tryb obserwatora po zniszczeniu** też dla **bezpośredniego rozbicia o teren**
(alive→dead z pominięciem fazy 'dying') — `updateDeathState` łapie teraz tę gałąź (wcześniej gracz zostawał „uwięziony"
na ekranie ROZBITY bez nakładki); `DownedOverlay.show(...,flyableWreck)` chowa podpowiedź o sterowaniu wrakiem, gdy nie
ma czym sterować. Akcja „ZAKOŃCZ MISJĘ" w `DownedOverlay` używa tej samej logiki kontekstowej. Te same akcje dostępne
w menu Esc i w nakładce po zestrzeleniu. ⏳ user: smoke (Esc→koniec z botami; Esc→poczekalnia gdy 2 ludzi; obserwator po rozbiciu o teren).

**Sesja poprawek 2026-06-25 (auto-powrót po zerwaniu sieci, 492 testy zielone, BEZ bumpu protokołu — v6):**
życzenie usera: powrót do gry i SWOJEGO samolotu po krótkim zerwaniu (≤10 s), gdzie „samolot po utracie pilota
ma swój tor lotu". (1) **Serwer (`game-room.ts`):** żywy gracz-człowiek z `member===null` = bez pilota
(`isPilotless`; boty wyklucza `isBot`) — zamiast trzymać OSTATNI input (rozbijał maszynę w zakręcie/nurkowaniu
przed powrotem) leci w **auto-stabilizacji**: `autopilotCommandFor` daje instruktorowi aim = poziomy rzut nosa
(`getForward`, `y=0`, fallback pozioma prędkość→`spawnDir`), stery zerowe → bank-and-pull do poziomu = wyrównanie
skrzydeł + lot poziomy; gaz `DISCONNECT_CRUISE_THROTTLE=0.7`; **nie strzela** bez pilota. Slot trzymany 60 s jak
było; samolot wciąż wrażliwy (wróg może zestrzelić). Wyłącznie serwerowe → bez wpływu na reconciliation. (2)
**Klient:** `NetClient.onClose` (deliberate-aware — `close()` tłumi auto-reconnect) → watchdog `tryReconnectOnce`
co `RECONNECT_RETRY_MS=1500` przez `AUTO_RECONNECT_WINDOW_MS=12000`, wznawia sesję tokenem **BEZ przeładowania
strony** (świat/modele w pamięci); sukces=`onRoomJoined` (gdy `reconnecting`) wymusza pełne wejście (`phase='lobby'`
przed `enterPlaying`, bo ma early-return przy 'playing') → świeży predyktor/interpolator/meshe, snap od zera, ekran
ładowania mignie (modele z cache). Banner „Wznawianie połączenia… (N s)" w `updateConnOverlay`; po wyczerpaniu okna
→ istniejąca nakładka „Rozłączono"/reload. `serverShutdown`→`serverWentAway` pomija auto-reconnect. Pułapka: WS przy
krótkim blipie może NIE wygenerować `close` (TCP przeżyje) — wtedy reconnect zbędny, ale auto-stabilizacja dotyczy obu
przypadków. Auto-reconnect tylko z `phase==='playing'` (poczekalnia → nakładka ręczna). ⏳ user: smoke (zerwij sieć
na ~5 s w trakcie meczu → powrót do swojego samolotu bez reloadu; >12 s → nakładka ręczna). **NIEZACOMMITOWANE.**

**Rozdzielenie drużyna↔samolot 2026-06-25 (życzenie usera „dwóch graczy w jednej drużynie", 495 testów zielone,
BEZ bumpu protokołu — v6, addytywne JSON):** do tej pory tryb drużynowy WIĄZAŁ samolot ze stroną (Spitfire→Alianci,
Bf 109→Oś), więc dwóch ludzi mogło być razem tylko lecąc tym samym płatowcem, a wybór różnych samolotów rozrzucał ich
na przeciwne drużyny. Teraz **drużyna i samolot są niezależne** (decyzja usera: dowolny samolot w dowolnej drużynie;
drużyny przestają być narodowościami → „Drużyna A/B"). (1) **Shared:** usunięte `planeTypeForTeam`/`teamForPlaneType`
(sprzężenie zniknęło) + ich testy; `RoomPlayer` dostaje `faction` (addytywne, do grupowania/kolorów poczekalni); nowa
wiadomość `selectTeam{team}` (+tag w `CONTROL_TAGS`). (2) **Serwer (`game-room.ts`):** `sidePref`→`teamPref`
(preferowana drużyna, niezależna od samolotu); `effectiveType` = `selectedType` w OBU trybach; `selectPlane` już NIE
zmienia frakcji; nowa `selectTeam(id,team)` ustawia `teamPref`+`faction` (WOLNY WYBÓR — bez wymuszania balansu między
ludźmi); `assignFactions` utrwala wybory drużyn, boty wyrównują resztę; `roomPlayers()` niesie `faction`. Connection:
`case 'selectTeam'` klampuje team do `[0,TEAM_COUNT)` (niezm. nr 11). (3) **Klient:** `net.selectTeam`; poczekalnia
(`lobby-ui.ts`) w trybie drużynowym pokazuje **dwie kolumny drużyn** (gracze pogrupowani po frakcji + kolory A=niebieski/
B=pomarańczowy) i **selektor „Twoja drużyna"** (każdy wybiera niezależnie); selektor samolotu zostaje, ale bez „=strona".
FFA bez zmian (płaska lista). Rozpoznanie wróg/sojusznik w locie nadal po FRAKCJI (marker zielony/czerwony, `setFoe`/
`factionById` z standings) — niezależne od typu samolotu, więc bezpieczne. **Deploy front+back RAZEM** (protokół v6
niezmieniony, ale semantyka poczekalni rozjechana między wersjami). ⏳ user: smoke (2 ludzi → ta sama drużyna; wybór
różnych samolotów po tej samej stronie; boty wyrównują). **Uwaga UX:** skoro obie drużyny mogą mieć ten sam samolot,
jedynym wizualnym znacznikiem strony jest kolor markera (sylwetka już nie zdradza drużyny) — ewentualne mocniejsze
oznaczenie (tint kadłuba/znaki) to osobny temat. **Zacommitowane `b81f89a` + push.**

**Fix pętli reconnectu + paliwo w snapshocie 2026-06-26 (2 objawy usera, 497 testów zielone, BUMP protokołu
v6→v7):** user: po krótkim braku internetu (1) **pusty bak za każdym razem** + (2) **wznawianie nieskuteczne
i ciągle się powtarza**. (A) **Pętla wznawiania — wyścig serwer↔klient:** gdy sieć pada PO STRONIE KLIENTA,
przeglądarka wykrywa zerwanie szybko, ale serwer NIE (jego TCP czeka na timeout — sekundy/minuty), więc stary
„zombie" wciąż trzyma slot (`member≠null`) → `reconnectByToken` (wymagał `member===null`) zwracał null →
connection traktował to jak NOWE wejście: świeży token + lobby → klient `onWelcome` `saveToken(nowy)` **zatruwał
zapisany token** (nie wskazuje już slotu) → pętla do wygaśnięcia okna 12 s. Fix (3 zmiany, poza hot pathem):
`reconnectByToken` **przejmuje slot także gdy `member≠null`** (token = sekret sesji → okaziciel JEST graczem;
zamyka zombie przez nowy opcjonalny `RoomMember.close?()`); `detachMember(id,nowMs,member?)` **strażnik
tożsamości** (spóźniony `close` zombie nie odpina świeżo wróconego — `connection.ts` przekazuje `this`, dodana
`close()`); klient `onWelcome` **nie nadpisuje tokenu podczas `attemptingResume`**. (B) **Pusty bak (decyzja
usera: REALNE paliwo, nie „pełny bak"):** paliwo było UKRYTYM stanem fizyki (klient predykował lokalnie,
`reconcile` resetował do 1 tylko przy spawnie), więc po wznowieniu rozjeżdżał się z serwerem. Teraz **+1 bajt
paliwa w snapshocie (v7)** — autorytatywne jak HP/amunicja: `prediction.ts` `reconcile` przyjmuje
`state.fuelFrac = server.fuelFrac` (replay nowszych inputów dopala spójnie z pozycją), USUNIĘTY stary reset do
1; serwer paliwa NIE resetuje na reconnect (realizm). Uwaga: dokładnego mechanizmu „0% za każdym razem" nie dało
się wyprowadzić z kodu (deplecja ~1%/12 s), ale fix jest odporny niezależnie. **Znana luka:** paliwo OBCYCH jest
w snapshocie, ale klient go nie używa (silnik gra, póki żyją) — wpięcie do interpolatora to osobny temat. **Deploy
front+back RAZEM** (v6↔v7 handshake). ⏳ user: smoke (zerwij sieć ~5 s → powrót do swojego samolotu bez pętli +
realne paliwo; >12 s → nakładka ręczna).

**Przebudowa wyboru samolotu + fix drużyn + system „Gotów" 2026-06-26 (życzenie usera, 504 testy zielone, BEZ bumpu
protokołu — v7, addytywne JSON):** user: „zmień wybór samolotu wzorem popularnych gier; zrezygnuj z historycznego
dobierania sojuszniczych maszyn; sprawdzaj kto leci dopiero przed grą (podejrzenie buga przy wielokrotnej zmianie
samolotu/drużyny)". (1) **REALNY BUG drużyn (potwierdzony):** poczekalnia pokazywała `faction` (auto-balans przy
wejściu), ale start liczył `assignFactions()` honorujący TYLKO jawny `teamPref`, a resztę (w tym ludzi auto-przydzielonych
do widocznej drużyny) wyrównywał OD NOWA → gdy jeden gracz wybrał drużynę jawnie, a drugi tylko „wylądował" na tej samej,
start przerzucał drugiego na przeciwną stronę „dla balansu", choć poczekalnia pokazywała ich razem (znajomi startowali
osobno). Fix — zasada **WYSIWYG** („co widać w poczekalni, to startuje"): `assignFactions()` honoruje bieżącą, prawidłową
frakcję KAŻDEGO człowieka (jawny wybór ALBO auto-przydział), a boty są wypełniaczem (równoważą wokół ludzi); `selectTeam`
woła teraz `assignFactions()` (rebalans botów NA ŻYWO → poczekalnia == start także dla botów). (2) **Karty samolotów**
(zamiast dropdownu): klikalne kafelki Spitfire/Bf 109 z nazwą, rolą (Zwrotny/Energia), uzbrojeniem i opisem; dane w
`planeCardInfoOf` (shared, obok `planeLabelOf` — etykiety UI, nie strojenie). Podświetlenie „wybranej" idzie za stanem
serwera. (3) **System „Gotów"**: `RoomPlayer.ready` (addytywne JSON) + wiadomość `setReady` (klient→serwer); przycisk dla
nie-hosta, wskaźniki ✔/⏳ w roster, Start hosta pokazuje „X/Y gotowych" (host startuje świadomie — AFK NIE blokuje). Boty
zawsze gotowe; gotowość zerują zmiana samolotu/drużyny i start meczu (potwierdzasz AKTUALNY skład). (4) **Neutralne nazwy
botów**: koniec dobierania narodowości do płatowca (PL/Spitfire, DE/Bf 109) — jedna pula callsignów (`BOT_NAMES`,
`nextName()`/`hasBotName()` zamiast `nextName(type)`/`nickMatchesType`). **Deploy front+back RAZEM** (v7 niezmieniony,
ale semantyka poczekalni/roster rozjechana między wersjami). ⏳ user: smoke (2 ludzi → ta sama drużyna trzyma się po
starcie; karty wyboru; „Gotów" + licznik u hosta; neutralne nicki botów). **NIEZACOMMITOWANE.**

**Lobby slotowe RTS — dowolne składy drużyn 2026-06-26 (życzenie usera, 514 testów zielone, BEZ bumpu protokołu —
v7, addytywne JSON):** user: „zmodyfikuj ustawianie drużyn w poczekalni, by można było dowolne konfiguracje (np. 2 ludzi
przeciw 6 botom); poszukaj wzorców w popularnych grach". Research → kanon RTS/MOBA (Warcraft III, AoE, Dota custom):
kolumny drużyn ze slotami, host stawia AI po konkretnej stronie. **Decyzje usera (AskUserQuestion):** (1) model = **sloty
RTS** (przenoszenie klikiem); (2) ludzie **wybierają drużynę sami** (selektor „Twoja drużyna" zostaje), host steruje TYLKO
botami; (3) pusta drużyna → **pozwól, ale zablokuj Start + ostrzeż**; (4) poziom trudności **per bot**. **Korzeń problemu:**
stary `assignFactions` traktował WSZYSTKIE boty jako wypełniacz auto-balansu (równoważone wokół ludzi) → nie dało się ich
skupić po jednej stronie (np. „2 ludzi + 6 botów" wychodziło 4v4). **Fix serwer (`game-room.ts`):** (a) `assignFactions`
honoruje JAWNE `teamPref` botów jak wybór człowieka; boty BEZ teamPref (stary `addBot`/FFA) zostają wypełniaczem (zachowuje
testy auto-balansu); (b) `ServerPlayer.botDifficulty` (poziom per bot) + `addBot(difficulty,planeType?,team?)`; (c) metody
hosta tylko w 'waiting': `hostAddBot(team|null,difficulty)` (klamp pojemności MAX_PLAYERS=8/MAX_BOTS=7, po dodaniu
`assignFactions`=WYSIWYG), `hostRemoveBot(botId)`, `hostEditBot(botId,team|null,difficulty|null)` (przeniesienie ustawia
teamPref+rebalans wypełniaczy; zmiana poziomu → `BotManager.setDifficulty` odtwarza kontroler z tym samym `botSeed(id)`);
(d) `botDifficultyOf`; `roomPlayers()` niesie `botDifficulty` TYLKO dla botów. **Protokół (BEZ bumpu):** `RoomPlayer.botDifficulty?`
+ 3 wiadomości `addBot{team?,difficulty?}`/`removeBot{botId}`/`editBot{botId,team?,difficulty?}` (union + CONTROL_TAGS);
connection host-only (`notHost`), `clampTeam`/`validBotId`/`validDifficulty` (niezm. nr 11). **Klient (`lobby-ui.ts`):** w
trybie drużynowym kolumny = sloty; bot u HOSTA dostaje `[poziom ▼][⇄ przenieś][✕ usuń]` (`buildBotControls`) + stopka
„+ dodaj bota" per drużyna (disabled przy pełnym pokoju); globalny licznik/poziom botów (`ffaBotsBox`) chowany w team —
`emitSettings` w trybie drużynowym wysyła SAM `mode` (inaczej `setBots` przebudowałby roster i skasował przypisania!);
pusta drużyna → Start `disabled` + ostrzeżenie (czysto klienckie — **serwer NIE blokuje** startu; filozofia „host startuje
świadomie", mecz z pustą drużyną i tak nie rozstrzygnąłby się eliminacją, tylko strefą). FFA bez zmian (płaska lista +
globalny licznik). **Deploy front+back RAZEM** (semantyka poczekalni rozjechana między wersjami). Nowy `bot-slots.test.ts`
(10 testów). ⏳ user: smoke (2 ludzi vs 6 botów; przenoszenie/usuwanie botów; poziom per bot; blokada Startu przy pustej
drużynie). **Zacommitowane w tej sesji** (deploy front+back razem — jeszcze NIEWDROŻONE).

**Energia w ciasnych manewrach — zagięcie biegunowej + opór oderwania 2026-06-26 (życzenie usera, 514 testów zielone,
BEZ bumpu protokołu — v7, czysto shared):** user „wrażenie, że samoloty trzymają energię w ciasnych manewrach zbyt
dobrze (niepewne)". Pomiary (harness E-M + symulacje czasowe `pilotStep`): model strukturalnie poprawny (nośna nie
wykonuje pracy, opór = jedyne źródło bleedu), sustained realistyczny — ALE biegunowa **paraboliczna (stałe K) zaniżała
opór wysokiego Cl** i **over-pull ponad clMax był nieukarany** (Cl obcięty → opór przestawał rosnąć) → ciasny zakręt za
tani energetycznie. Trzecie (UX, nieruszane): przy suficie G-LOC ~5 G samolot wymienia WYSOKOŚĆ na IAS → HUD IAS się
stabilizuje mimo spadku energii (prawdopodobne źródło wrażenia). **Decyzja usera (AskUserQuestion):** dostrój opór wysokiego
Cl. Fix `drag.ts`: `Cd = Cd0 + K·Cl² + dragHighClK·Cl⁴ + dragStallK·(|Cl_wym|−clMax)²₊` (2 nowe pola JSON per samolot +
zakresy loadera; `dragForce` dostał param `clRequired` dla oderwania, `plane-step`/`maneuvers` przekazują `lift.clRequired`;
nadwyżka oderwania nasycana do clMax = Cd plateau + strażnik NaN). Kalibracja świadomie z MAŁYM `dragHighClK` (Spit 0,0026 /
Bf 0,005; `dragStallK` 0,8), by sustained ruszył się tylko trochę (honor cytowanego M&M 17,2 s @ 12k ft), a bleed wpadł w
region powyżej sustained + over-pull: sustained Spit 16→17,6 s, Bf 22,8→23,5 s (bliżej AFDU ~17-18 s); bleed Ps przy 5 G
+20-40% (najwięcej przy niskiej V/wysokim Cl); asymetria zachowana (Bf bleeduje ~2× szybciej). Złote cele turnS 16→17,5 /
22→23,5; część analityczna `sustainedTurnTest` rozszerzona o człon Cl⁴ (kwadrat wzgl. n²). Czysto shared → klient+serwer
liczą identycznie z JSON, reconcile spójny, protokół v7 niezmieniony. **Wariometr w HUD (UX, ta sama sesja, czysto
klienckie):** lek na złudzenie „trzymam energię" — nowy wiersz „wznosz." (`hud.ts` `verticalSpeedMs` + ▲/▼/·, martwa
strefa 0,5 m/s; `online-main.ts` EMA `varioSmoothedMs` z `velocity.y`, τ=0,4 s). W ostrym zakręcie na suficie G-LOC duże
▼ uwidacznia wymianę wysokość→IAS (gracz widzi, że zniża się, nie „trzyma energię"). 514 testów/typecheck/lint/build
zielone. **Zacommitowane `893ab3c` + push** (deploy front+back razem — jeszcze NIEWDROŻONE). ⏳ user: playtest czy bleed
adekwatny + czy wariometr rozwiewa wrażenie (knoby `dragHighClK`/`dragStallK` strojalne bez kodu).

**Publiczny deploy MP: ✅ wdrożone** — `https://dogfight.tatanga.eu` (port 8087, Websockets ON), potwierdzone live 2026-06-25.

⏳ **Otwarte po stronie użytkownika:** smoke online (FFA bez respawnu
→ overlay obserwatora; drużynowy; v5 z wyborem samolotu + licznik 20 mm + ekran ładowania + zryw botów) +
playtest poprawek 2026-06-21 (zryw botów „trudnych", nazwiska PL/DE) + playtest balansu 1v1 Spitfire↔Bf 109 +
weryfikacja wzrokowa modelu Bf 109 (orientacja/śmigło/podwozie — fixEuler best-guess) + zaległe pomiary VPS —
pełna lista w `docs/parytet-mp-sp.md` („Otwarte sprawy"). Brak SSH z sesji.

**Sesja Faza 21 — audio (2026-06-24):** pełny system dźwięku (Web Audio przez `THREE.AudioListener` na
kamerze → 3D pozycyjne obcych). Sample dobrane do KONKRETNYCH modeli (życzenie usera „dźwięki dopasowane do
samolotu"): silnik **Merlin→Spitfire** (`engine-spitfire.ogg`, CC0), **Daimler-Benz DB 601→Bf 109**
(`engine-bf109.ogg`, autentyczny run-up, CC-BY); broń — grzechot MG (ton różnicowany pitch'em: Spitfire .303
wyżej, Bf 109 MG 17 niżej) + **dudnienie działka 20 mm MG FF** tylko dla Bf 109; wybuch, metaliczny łomot
trafienia. Świst opływu (∝ IAS²), buffet przeciągnięcia, „ding" potwierdzenia i klik UI **syntetyzowane
proceduralnie** (bez sampli). Master volume + mute (`listener.setMasterVolume`, localStorage, panel w menu
pauzy + klawisz **M**), AudioContext odblokowywany pierwszym gestem (autoplay policy). Moduły:
`client/src/audio/{audio-manager,voices}.ts`; integracja w `online-main.ts` (głosy per encja w pętli renderu,
cleanup przy śmierci/usunięciu — pułapka wiszących źródeł). Sample z freesound (`ffmpeg`: wycinek+mono+OGG,
~180 KB), atrybucje w `assets/LICENSES.md`. **BEZ zmian protokołu (v5), BEZ shared/serwera — czysto klienckie.**
474 testy/typecheck/lint/build zielone. **Część WIZUALNA fazy (smugi kondensacyjne sprzężone z n, lepszy
wybuch+szczątki, ślad dymny 20 mm) → BACKLOG** (świadomie: nieweryfikowalne wzrokowo z sesji, a 60 fps to
kryterium; plan w `docs/phases/faza-21.md`). ⏳ user: odsłuch/playtest miksu, brak błędów autoplay (Chrome/FF/Edge),
fps RTX przy 8 samolotach.

**Faza 22 — modułowe uszkodzenia (podział na 5 części, życzenie usera; plan w `docs/phases/faza-22.md`):**
model śmierci HYBRYDA (strefy z własnym HP + globalna „integralność" = istniejące `health`); bryły = kapsuły
(skrzydła/kadłub/ogon) + sfery (silnik/kabina/zbiornik); ograniczenie z f9: modyfikatory liczone z KWANTYZOWANYCH
POZIOMÓW stref (klient zna ze snapshotu tylko poziomy → spójny reconcile). **Część 1 ✅ (fundament shared, commit
`762342f`):** `combat/capsule.ts`, `combat/damage-model.ts` (poziomy→modyfikatory, tożsamość bez uszkodzeń), strefy+tuning
w JSON obu samolotów + walidacja loadera, `SimPlane.damageLevels`+`effectivePlaneConfig` w `pilotStep`. **Część 2 ✅
(serwer: hit detection po strefach + maszyna stanów, 2026-06-27, 567 testów):** `shared` `firstZoneHit` (narrow-phase
body→world, najwcześniejsza strefa) + `CANNON_DAMAGE_THRESHOLD`; `game-room.ts` `ServerPlayer.damage`, `refreshDamageLevels`
(poziomy→`sim.damageLevels` co tick, null=tożsamość), `resolveHits` po strefach (broad-phase `hitRadiusM` + PEŁNE obrażenia
health = TTK niezmienione → narrow-phase `firstZoneHit`), skutki krytyczne (kabina/skrzydło 0 HP → kill mimo health>0),
`maybeIgnite`+`stepFireDamage`/`onFireKill` (pożar dobija, kredyt podpalaczowi/'flak'), reset na (re)spawn. Decyzja usera
(AskUserQuestion): lag-comp = pozycja z historii + bieżąca orientacja. **Pułapka:** sfera obrysu 6 m > skupione bryły +
skok pocisku ~12 m/tick → pocisk konsumowany w „halo" o tick przed strefą (lub przeskakiwał między pozycjami) → fix:
narrow-phase na odcinku `[prevPos, pos+v·dt]`. BEZ protokołu (v7), nie wymaga deployu. **Pozostało:** Część 3 (protokół
v8 +u16 stanu stref + predykcja klienta + boty), 4 (klient HUD sylwetki + wizualia obcych), 5 (balans + tag `1.0`).
(Decyzja 2026-06-18: pełny parytet MP↔SP przed Bf 109; Bf 109→19 ✅, teren→20 ✅, dźwięk→21 ✅ audio, uszkodzenia→22.)

## Stack (skrót)

- **Klient**: TypeScript 5 + Three.js + Vite (WebGL2)
- **Serwer**: Node.js 20+ + TypeScript + `ws` (binarne pakiety w hot path)
- **Współdzielone**: monorepo npm workspaces; pakiet `shared` z fizyką używaną po obu stronach
- **Matematyka**: WYŁĄCZNIE klasy z `three` (Vector3, Quaternion, Matrix4) — także w `shared` i na serwerze
- **Test**: Vitest. Lint: ESLint + Prettier.
- **Deploy**: Docker (wzorzec C z `C:\AI\vps_home_pl_konfiguracja.md`) → VPS Tatanga, port 8087, NPM + SSL

## Komendy (istnieją od Fazy 0)

```bash
npm install          # po klonie
npm run dev          # klient (Vite :5173) + serwer (WS :3001) równolegle
npm run dev:client   # tylko klient
npm run dev:server   # tylko serwer
npm test             # Vitest (fizyka, protokół, math helpers)
npm run typecheck    # tsc --noEmit po wszystkich workspace'ach
npm run lint         # ESLint
npm run build        # klient → packages/client/dist/, serwer → packages/server/build/
```

Brak DB — „reset stanu" = restart procesu serwera.

## Mapa katalogów

```
packages/
  shared/    # fizyka, koperta osiągów, instruktor, math helpers, typy pakietów, stałe
    src/planes/*.json   # parametry samolotów (NIGDY liczb strojenia w kodzie!)
  client/    # Three.js renderer, input, HUD, debug tools, prediction, interpolation
  server/    # WebSocket, autorytatywna symulacja, boty, pokoje, game loop
assets/      # .glb, tekstury, audio; LICENSES.md (atrybucje CC)
deploy/      # docker-compose.yml, Dockerfile×2, nginx.conf, .env.example
docs/
  PLAN.md             # (w korzeniu repo) overview, decyzje, ryzyka, mapa faz
  fizyka-lotu.md      # projekt modelu lotu — NADRZĘDNY dla faz 1-3
  phases/faza-NN.md   # szczegóły per faza (cel/zakres/kryteria/wynik)
memory/
  MEMORY.md                     # indeks
  project_phaseN_decisions.md   # po każdej zakończonej fazie
```

## Konwencje kodu

- **TypeScript strict** wszędzie. `any` zakazany poza adapterami libów (+ komentarz `// any: <powód>`).
- Pliki `kebab-case.ts`; klasy `PascalCase`; funkcje/zmienne `camelCase`; stałe `SCREAMING_SNAKE`.
- Warstwy: `shared` nie importuje z `client`/`server`; `client` i `server` nie importują się nawzajem.
- Błędy: typowane klasy (`PhysicsError`, `NetError`, ...). Nigdy `throw "string"`.
- Stałe protokołu i fizyki w `packages/shared/src/constants.ts` — zero duplikacji liczb.
- Komentarze tylko gdy WHY nieoczywiste (workaround, niezmiennik, źródło wzoru/danych).

## Twarde niezmienniki

1. **Jedna konwencja osi w całym projekcie** (zdefiniowana w `docs/fizyka-lotu.md`):
   body frame = +Z nos, +Y góra, +X lewe skrzydło (zgodnie z glTF). Dostęp do osi TYLKO przez
   helpery `getForward/getUp/getRight` z `shared` — nigdy ręczne `applyQuaternion` na surowych osiach.
2. **Zakaz własnych klas matematycznych.** Wektory/kwaterniony tylko z `three`.
3. **Parametry samolotów i strojenia żyją w JSON** (`shared/src/planes/`), nigdy jako literały w kodzie.
4. **Tick rates: fizyka 60 Hz (stały krok), snapshot 30 Hz, input 60 Hz.** Zmiana = świadoma decyzja,
   najpierw aktualizacja PLAN.md.
5. **Serwer jest autorytetem.** Hit detection, HP, kill credit — tylko serwer. Klient predyktuje,
   przy konflikcie wygrywa serwer. Bitowego determinizmu NIE wymagamy.
6. **Pakiety game-loop binarne** (DataView). JSON tylko handshake/lobby. Nigdy `JSON.stringify` w hot path.
7. **Strażnik NaN w dev**: każdy tick waliduje stan; NaN/Infinity = natychmiastowy wyjątek z dumpem
   stanu wejściowego. Nigdy nie maskować NaN przez clampowanie.
8. **Asset CC-BY → wpis w `assets/LICENSES.md` w tym samym commicie.** Bez wpisu nie commituj.
9. **`packages/shared` bez Node API i bez DOM** (import `three` dozwolony — działa w obu środowiskach).
10. **Produkcja: tylko `wss://`.** Plain `ws://` wyłącznie na localhost w dev.
11. **Serwer waliduje każdy input z sieci**: zakresy wartości, rozmiar pakietu, rate limit. Brak zaufania do klienta.

## Reguły workflow (każda sesja)

- **Jedna faza = jedna sesja.** Sesję zaczynamy od `/clear`, potem przeczytaj: ten plik,
  `docs/phases/faza-NN.md` aktualnej fazy, a przy fazach 1–3 również `docs/fizyka-lotu.md`.
- **Przed zamknięciem fazy**: `npm run typecheck && npm test && npm run lint` — wszystko zielone,
  dopiero commit. Niespełnione kryteria z pliku fazy = faza otwarta.
- **Po fazie**:
  - zapisz `memory/project_phaseN_decisions.md` (decyzje nieoczywiste z kodu + pułapki)
  - dopisz linię do `memory/MEMORY.md`
  - uzupełnij sekcję **Wynik** w `docs/phases/faza-NN.md`
  - zaktualizuj linię „Status faz" na górze tego pliku
  - `git commit` z opisem fazy
- **Nie scaffolduj na zapas** — plik powstaje w fazie, która go używa.
- **Timeboxy są twarde** (szczególnie faza 20 — teren). Po przekroczeniu: zamknij co działa,
  resztę do backlogu w PLAN.md.

## Referencje

- Pełny plan, decyzje, ryzyka: `PLAN.md`
- Parytet MP↔SP (fazy 14–18 + domknięcie P1–P5): `docs/parytet-mp-sp.md` (przewodnik/indeks)
- Projekt modelu lotu (fazy 1–3): `docs/fizyka-lotu.md`
- Aktualna faza: `docs/phases/faza-NN.md` (NN z linii statusu)
- Konfiguracja docelowego VPS (poza repo): `C:\AI\vps_home_pl_konfiguracja.md`
- Poprzedni projekt jako referencja (poza repo, NIE kopiować na ślepo):
  `C:\AI\pozostałe\gry\symulator\air-combat-opus4-7\` — zwłaszcza `memory/project_phase*_decisions.md`
