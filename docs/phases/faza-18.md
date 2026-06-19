# Faza 18 — Parytet MP cz.5: tryb drużynowy (opcja pokoju)

**Zależy od:** Fazy 10 (lobby/pokoje), 11 (walka + kredyt), 13 (pętla meczu + standings/respawn),
15–16 (model śmierci/wrak), 17 (kontrola strefy KotH).
**Cel:** Domknąć parytet MP↔SP — wprowadzić tryb drużynowy jako OPCJĘ pokoju (host wybiera FFA albo
Drużynowy), wierny modelowi single-player: dwie drużyny, **eliminacja** (`MATCH_LIVES = 1` na samolot,
brak respawnu, ostatnia drużyna w grze wygrywa), strefa KotH jako dodatkowy warunek zwycięstwa,
**bez limitu czasu**. Friendly fire ON (jak SP), ale bez kredytu za teamkill. Frakcja = drużyna.

## Decyzje (uzgodnione z użytkownikiem, 2026-06-19)

- **Przydział do drużyn: AUTO-BALANS serwera** — każdy nowy uczestnik (gracz/bot) trafia do mniejszej
  drużyny; przy starcie meczu pełny równy podział w kolejności id. Bez wyboru drużyny w lobby i bez
  nowych wiadomości protokołu (parytet z SP, gdzie przydział jest automatyczny).
- **Warunek zwycięstwa = eliminacja LUB strefa, NIE czas** — „tak jak w single playerze, który jest
  dopracowany i ma służyć za wzór". `MATCH_LIVES = 1` (sztywno, 1 zestrzelenie na samolot → drużyna
  odpada, gdy wszystkie jej samoloty padną). Bez limitu czasu (`timeLeftS = 0` w standings).
- **Podział na 2 sesje** — sesja 1 (TEN dokument, zrealizowana): serwer + lobby + protokół (logika
  drużyn, w pełni testowalna). Sesja 2 (następna): warstwa wizualna klienta (kolory markerów
  wróg/sojusznik, scoreboard drużynowy, kill-feed teamkill, status strefy wg frakcji, obserwator
  sojuszników). Parytet wizualny zamyka się dopiero po sesji 2.

## Zakres

Serwer + lobby + protokół; **BEZ bumpu `PROTOCOL_VERSION`** (addytywne pola JSON, wciąż v3 — jak strefa
w f17; binarne INPUT/SNAPSHOT/EVENT bez zmian). FFA (fazy 13–17) zostaje nietknięte — tryb drużynowy
to gałąź `mode` obok niego.

- **Współdzielone (`shared/world/team.ts`, NOWY)** — `MatchMode = 'ffa' | 'team'`, `MATCH_MODES`,
  `TEAM_COUNT = 2`, `clampMatchMode` (walidacja wejścia, niezm. 11), `smallerTeamIndex` (auto-balans).
  Model rozstrzygnięcia drużynowego REUŻYWA `world/match.ts` (`factionsInPlay`) — ten sam co SP.
- **Protokół (`net/protocol.ts`)** — `CreateRoomMessage.mode?`; `RoomSummary.mode`;
  `StandingRow.faction` (FFA: = id; drużynowy: 0/1); `StandingsMessage.mode`;
  `MatchEndedMessage.mode + winningFaction`. `MatchEndReason` bez zmian — eliminacja drużynowa
  używa `'score'` (klient rozróżnia po `mode`); `'time'` w drużynowym nie występuje.
- **Serwer (`game-room.ts`)** — `mode`; `ServerPlayer.faction + livesLeft`; `assignFaction` (late-join)
  i `assignFactions` (start, równy podział); friendly fire ON, ale kredyt/asysty TYLKO między różnymi
  frakcjami; `loseLife` + `canRespawn` (drużynowy: bez respawnu po wyczerpaniu żyć); `checkMatchEnd`:
  strefa → `checkTeamElimination` (drużynowy) / `evaluateFfa` (FFA); `endMatch(winnerId,
  winningFaction, reason)`; `updateZone`/`buildStandings` po `p.faction`; cele bota wg frakcji.
- **Lobby (`lobby.ts` + `connection.ts`)** — `createRoom` przyjmuje `mode`, ustawia `room.mode` PRZED
  `addPlayer` (enterWorld przydziela frakcję wg trybu); `connection` klampuje `clampMatchMode`.
- **Klient — wiring (`net-client.ts`, `lobby-ui.ts`, `online-main.ts`)** — `createRoom` wysyła `mode`;
  lobby ma select „Tryb" (FFA/Drużynowy), w trybie drużynowym ukrywa wiersz limitu zestrzeleń;
  lista pokoi pokazuje tryb. (Render walki/scoreboard pozostaje FFA-owy do sesji 2.)

Poza zakresem sesji 1 (→ sesja 2): kolory markerów wróg/sojusznik, scoreboard drużynowy (grupowanie
po frakcji + agregat drużyny), kill-feed „(sojusznik!)", status `ZoneBar` wg drużyny, obserwator
ograniczony do sojuszników, ewentualne `RoomPlayer.faction` do podglądu drużyn w poczekalni.

## Kroki (sesja 1)

1. `shared/world/team.ts` (+ test) + eksport w `index.ts`.
2. `protocol.ts`: pola `mode`/`faction`/`winningFaction`.
3. `game-room.ts`: frakcje + życia + auto-balans + friendly fire + eliminacja + strefa drużynowa.
4. `lobby.ts`/`connection.ts`: `mode` → `room.mode` (klamp).
5. `net-client.ts`/`lobby-ui.ts`/`online-main.ts`: select trybu + przekazanie `mode`.
6. Testy: `shared/world/team.test.ts` (+7), `server/team-mode.test.ts` (+8).

## Kryteria ukończenia

### Sesja 1 (serwer + lobby + protokół) — ZREALIZOWANE
- [x] `MatchMode`/`clampMatchMode`/`smallerTeamIndex` w `shared/world/team.ts` (+ test)
- [x] Protokół niesie tryb i frakcję (addytywne pola JSON, BEZ bumpu — wciąż v3)
- [x] Auto-balans: uczestnicy (gracze + boty) dzieleni równo na 2 drużyny; FFA: frakcja = id
- [x] Friendly fire ON (pocisk rani sojusznika), ale teamkill bez kredytu i bez asysty (parytet SP)
- [x] Eliminacja: 1 życie/samolot, brak respawnu; ostatnia drużyna z samolotami wygrywa (`'score'`)
- [x] Strefa KotH działa OBOK eliminacji (przejęcie kończy mecz, frakcja = drużyna); BEZ limitu czasu
- [x] Boty atakują tylko wrogów (inna frakcja); kontestują strefę bez zmian (waypoint z f12)
- [x] Lobby: host wybiera FFA/Drużynowy; tryb klampowany na serwerze; lista pokoi pokazuje tryb
- [x] typecheck + test (412, +15) + lint zielone; build (Vite + esbuild) przechodzi

### Sesja 2 (klient — wizualia) — ZREALIZOWANE
- [x] Markery wróg (czerwony) / sojusznik (zielony) wg `StandingRow.faction` vs własna frakcja
- [x] Scoreboard drużynowy (`match-ui.ts`): grupowanie po frakcji + agregat drużyny; ekran wyników
      z `winningFaction`; baner powodu mode-aware
- [x] Kill-feed rozróżnia teamkill; status `ZoneBar` liczony względem własnej drużyny (`controlling`
      vs własna frakcja); obserwator po eliminacji ogranicza się do żywych sojuszników
- [ ] **(użytkownik)** smoke online: mecz drużynowy z botami — sprawdzić auto-balans, friendly fire,
      koniec przez eliminację/strefę

## Pułapki

- **`MATCH_LIVES = 1` ⇒ brak respawnu w drużynowym.** Respawn bramkuje `canRespawn` (`mode !== 'team'
  || livesLeft > 0`). `updateLifecycle` i tak biegnie (timer rośnie), tylko `spawn` nie. FFA = respawn
  nieskończony (życia nie liczą się). Reset żyć WYŁĄCZNIE w `start()`, NIE w `spawn()` (inaczej respawn
  zerowałby pulę → nieskończone życia).
- **`room.mode` PRZED `addPlayer`.** `enterWorld → assignFaction` czyta `mode`; lobby ustawia tryb
  zanim doda hosta i boty, więc auto-balans działa od pierwszej encji.
- **Strefa drużynowa = `o.faction = p.faction`.** Skrzydłowi liczą się WSPÓLNIE (jedna frakcja).
  W FFA `faction = id`, więc f17 działa bez zmian. `zone.captured` zwraca frakcję = drużynę; `endByFaction`
  mapuje ją na `winningFaction` + `winnerId` (najlepszy gracz drużyny).
- **Eliminacja wymaga ≥2 drużyn.** `checkTeamElimination` pomija ocenę, gdy w grze jest <`TEAM_COUNT`
  frakcji (pokój z jedną drużyną nie „wygrywa przez eliminację" — czeka na strefę). Obustronna
  eliminacja w jednym ticku (0 drużyn) → remis (`winningFaction = null`).
- **Kredyt/asysty po frakcji, nie po id.** W FFA `faction = id`, więc warunek `killer.faction !==
  victim.faction` redukuje się do „nie samobójstwo" → zachowanie z fazy 13 BEZ zmian. To samo dla asyst.
- **Bez bumpu protokołu, ale deploy front+back razem.** Stary klient ignoruje nowe pola JSON; mimo to
  klient i serwer wdrażane razem (jak f15–f17). Tryb drużynowy jest grywalny na serwerze po sesji 1,
  ale render walki/scoreboard są wciąż FFA-owe — pełny parytet dopiero po sesji 2.
- **`mode` w `StandingsMessage` perspektywa-niezależny.** Jeden broadcast (2 Hz) obsługuje wszystkich;
  klient przełącza render po `mode`, koloruje po `faction` wierszy, porównuje ze swoją frakcją (z wiersza
  o własnym id) — bez wersji per-odbiorca.

## Wynik

**Sesja 1 zrealizowana (2026-06-19).** Tryb drużynowy działa autorytatywnie na serwerze jako opcja
pokoju; logika w pełni przetestowana. BEZ bumpu protokołu binarnego (addytywne pola JSON, wciąż v3).

**`shared/world/team.ts` (NOWY):** `MatchMode`/`MATCH_MODES`/`TEAM_COUNT`/`DEFAULT_MATCH_MODE`;
`clampMatchMode` (nieznane → `'ffa'`); `smallerTeamIndex` (auto-balans, remis → niższy indeks).
Model eliminacji reużywa `world/match.ts` (`factionsInPlay`) — ten sam co SP.

**`net/protocol.ts`:** `CreateRoomMessage.mode?`; `RoomSummary.mode`; `StandingRow.faction`;
`StandingsMessage.mode`; `MatchEndedMessage.mode + winningFaction`. `MatchEndReason` bez zmian
(eliminacja = `'score'`; `'time'` nieobecne w drużynowym).

**`server/game-room.ts`:** `mode`; `ServerPlayer.faction + livesLeft`; `assignFaction`/`assignFactions`
(auto-balans); `loseLife` (w `enterWreck`/`onGroundDeath`) + `canRespawn` (gating respawnu); kredyt
(`onAirKill`) i asysty (`creditAssists`) tylko między różnymi frakcjami; `checkMatchEnd` →
`endByFaction` (strefa) / `checkTeamElimination` (drużynowy: `factionsInPlay`, guard ≥2 drużyn,
remis = null) / `evaluateFfa` (FFA); `topPlayerOfFaction`; `endMatch(winnerId, winningFaction, reason)`;
`updateZone`/`buildStandings` po `p.faction`; `collectBotTargets` wg frakcji; `timeLeftS = 0` w trybie
drużynowym; gettery `factionOf`/`livesOf`.

**`server/lobby.ts` + `connection.ts`:** `createRoom(..., mode)` ustawia `room.mode = clampMatchMode(mode)`
PRZED `addPlayer`; `connection` klampuje `msg.mode`.

**Klient (wiring):** `net-client.createRoom(..., mode)`; `lobby-ui` — select „Tryb" (FFA/Drużynowy),
ukrycie limitu zestrzeleń w trybie drużynowym, tryb na liście pokoi; `online-main` przekazuje `mode`.

**Walidacja:** `npm run typecheck` + `npm test` (412, +15: `team.test.ts` 7 — clampMatchMode/
smallerTeamIndex; `team-mode.test.ts` 8 — auto-balans gracze/boty, FFA = id, friendly fire bez kredytu,
kredyt za wroga, eliminacja kończy mecz + `winningFaction`, brak respawnu, brak limitu czasu) +
`npm run lint` zielone; `npm run build` przechodzi (klient online 40,7 → 41,4 kB; serwer 567 → 574 kB).

**Otwarte:** sesja 2 (klient: kolory markerów, scoreboard drużynowy, kill-feed teamkill, status strefy
wg drużyny, obserwator sojuszników) + smoke online po stronie użytkownika. Po sesji 2 zamyka się blok
parytetu MP↔SP (Fazy 14–18); następna: Faza 19 — Bf 109 E + balans.

**Sesja 2 zrealizowana (2026-06-19).** Warstwa wizualna klienta dla trybu drużynowego — wyłącznie
po stronie klienta, z pól protokołu już dodanych w sesji 1 (BEZ zmian protokołu, wciąż v3). Snapshot
binarny NIE niesie frakcji, więc klient czyta je z tabeli wyników (`standings`, JSON 2 Hz).

**`online-main.ts`:** stan `matchMode` + `factionById` (mapa id→frakcja) + `localFaction`, odbudowywane
z każdego `standings` (`rebuildFactions`) i resetowane w `resetGameState`. `entityColorHex` zna teraz tryb:
w drużynowym sojusznik zielony (`FRIEND_COLOR`) / wróg czerwony (`FOE_COLOR`) wg frakcji, w FFA paleta per id
(jak f14). Markery: drużynowy → `setFoe(faction !== localFaction)` (paleta foe/friend), FFA → `setColorHex`.
Kill-feed: teamkill (`mode==='team'` i te same frakcje strzelca/ofiary) oznaczony „(sojusznik!)" i bez
złotego markera zestrzelenia (serwer nie kredytuje — parytet z SP). `updateZoneBar` liczony po FRAKCJI
(`r.faction === localFaction`, `controlling === localFaction`) — w FFA redukuje się do f17 (frakcja = id).
Obserwator: `isSpectatable` + `playerHasTeammates` — w drużynowym z sojusznikami zakres zawężony do żywych
sojuszników (jak SP). Roster: `isLost` = drużynowy & `deaths >= MATCH_LIVES` & faza życia ≠ alive/dying
(faza z `lifeById`, bo snapshot nie niesie liczby żyć) → wyszarzenie wyeliminowanych.

**`net/match-ui.ts`:** render zależny od `mode`. Helpery `standingsNodes` (FFA: płaska lista; drużynowy:
nagłówek + grupowanie po frakcji z `teamHeaderRow` — agregat Z/Ś/A + strefa raz, własna drużyna pierwsza
przez `orderedFactions`), `reasonText` (w drużynowym `'score'` = eliminacja, nie limit zestrzeleń),
`teamHeaderRow`. `ScoreboardOverlay.update(..., mode, localFaction)` — tytuł bez zegara w drużynowym.
`ResultsOverlay.show(msg, localId, localFaction, isHost)` — baner wg `winningFaction` (zwycięstwo/porażka/
remis drużynowy), tabela grupowana. CSS `.mui-team`.

**Walidacja:** `npm run typecheck` + `npm test` (412, bez nowych testów — zmiany czysto wizualne/DOM,
weryfikowane przez typecheck+build) + `npm run lint` zielone; `npm run build` (klient online 41,4 → 43,6 kB,
serwer bez zmian 574 kB). **Otwarte (użytkownik):** smoke online — mecz drużynowy z botami (auto-balans,
friendly fire, koniec przez eliminację/strefę, kolory markerów, scoreboard, obserwator sojuszników).
**Deploy front+back razem** (jak f15–f17 — addytywne pola JSON, ale wdrażamy spójnie). Zamyka się blok
parytetu MP↔SP (Fazy 14–18). Następna: Faza 19 — Bf 109 E + balans.
