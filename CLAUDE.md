# CLAUDE.md — air-combat-fable5

<!--
  Trwałe instrukcje sesyjne. Ładowane na każdym starcie sesji, przeżywają /compact.
  TU żyją twarde niezmienniki. NIE wpisuj tutaj: historii projektu (→ memory/),
  szczegółów decyzji (→ PLAN.md / docs/phases/), notatek bieżącej sesji.
-->

## Status faz

Fazy ukończone: 0–17 (Faza 13: KOD + artefakty deployu gotowe; **publiczny deploy MP i pomiary
na VPS po stronie użytkownika** — brak SSH z sesji). Faza 7 wdrożona na VPS 2026-06-15 (tag `demo-1`) — publiczne demo
`https://dogfight.tatanga.eu` (port 8087). Faza 8 (2026-06-15): protokół binarny DataView
w `shared/net` + autorytatywny serwer (`packages/server`: game-room/connection/server) 60 Hz
+ snapshoty 30 Hz. Faza 9 (2026-06-16): client prediction + reconciliation własnego samolotu
i interpolacja obcych — wspólny `stepPilotedPlane` (`shared/world/piloted-plane.ts`) używany
przez serwer i klienta; moduły `packages/client/src/net/` (net-client, prediction, interpolation,
net-conditions[+panel], net-debug-overlay); symulator warunków sieci (dev) + overlay metryk.
Faza 10 (2026-06-16): lobby i pokoje — rejestr wielu pokoi (`server/lobby.ts`) + maszyna stanów
`GameRoom` (waiting/playing/ended); protokół lobby = osobny kanał JSON (createRoom/joinRoom/
quickPlay/startMatch + roomJoined/roomUpdate/matchStarted); token sesji + reconnect (okno 60 s,
brak wycieku pokoi); klient: leniwe łączenie, ekrany lobby vanilla DOM (`client/src/net/lobby-ui.ts`),
poczekalnia na tle `/dogfight-splash.jpg` (asset w repo od fazy 13, wpis w `assets/LICENSES.md`).
Faza 11 (2026-06-17): walka sieciowa autorytatywna — pociski na serwerze (pula per-pokój) +
hit detection z lag-compensation (`shared/combat/lag-comp.ts` `PositionHistory`; rewind celów =
echo ticku `ackServerTick` + bufor interpolacji, cap 250 ms; cofamy TYLKO cele); HP/kill credit/
asysty serwerowo; eventy binarne MUZZLE/HIT/KILL (`MSG_EVENT`, protokół v2); klient: spust w INPUT,
kosmetyczne smugacze z eventu MUZZLE (RNG z seeda = strumień serwera), hit marker/kill feed = echo
serwera. Benchmark 8 graczy ognia = 0,476 ms/tick (dev). **OTWARTE dla użytkownika po deployu:
sesja 2-os. ping ~150 ms (ocena „co widzę, to trafiam") + pomiar CPU 8 graczy na VPS → memory.**
Faza 12 (2026-06-17): boty na serwerze — bot = `ServerPlayer` (member=null, isBot), protokołowo
nieodróżnialny od gracza (te same ścieżki combat/HP/snapshot/eventy); `server/bot-manager.ts` =
kontrolery AI (`Bot` z fazy 6) + decymacja myślenia 10 Hz (`BOT_THINK_INTERVAL=6`, sterowanie co tick),
unikanie ziemi też 10 Hz; host wybiera 0–7 botów + poziom przy tworzeniu pokoju (`CreateRoomMessage`
+bots/+difficulty, connection klampuje); sprzątanie pokoi po `humanCount` (boty nie trzymają pokoju);
„Szybka gra" zasiewa 3 boty. Benchmark 1 gracz + 7 botów = 0,309 ms/tick (dev).
Faza 13 (2026-06-17, KAMIEŃ MILOWY — kod): pętla meczu FFA — `shared/world/ffa.ts` (`evaluateFfa`:
koniec przy limicie zestrzeleń [5/10/20] lub czasu 15 min, zwycięzca = lider `rankFfa`); maszyna
meczu w `GameRoom.step` (playing liczy zegar + `checkMatchEnd`; `ended` → `matchEnded`, po 15 s
auto-`waiting`; rewanż = `start()` także z `ended`); respawn z ochroną `SPAWN_PROTECTION_S=3`
(`resolveHits` pomija cel, ogień ją znosi) + wybór miejsca z dala od wrogów (`shared/world/spawn.ts`);
scoreboard (Tab) + ekran wyników + rewanż (`client/src/net/match-ui.ts`), HUD z wynikiem/zegarem;
standings 2 Hz + ping serwerowy z echa ticku (diagnostyka); protokół BEZ bumpu (+`scoreLimit`,
+`standings`/`matchEnded`/`serverShutdown`); `/health` (http.Server + WebSocketServer) + graceful
shutdown (`notifyShutdown` → komunikat zamiast spinnera). **Błąd naprawiony**: `defaultServerUrl` →
`wss://<host>/ws` na produkcji (był `:3001`); nginx `/ws → backend:3001`. Deploy: `Dockerfile.backend`
(esbuild bundle, ws+pino external) + compose backend (mem_limit 256m/cpus 0.5/healthcheck) +
runbook `deploy/WDROZENIE-NA-VPS.md` sekcja „Faza 13". **OTWARTE (użytkownik): deploy na VPS,
smoke 2 os. przez wss://, `docker stats` przy pełnym pokoju → memory; tag `mp-1`.**
Faza 14 (2026-06-18): parytet wizualny MP↔SP — klient online dostał te same moduły co SP:
wybuchy (event KILL), dym uszkodzeń wg `healthFrac` (`damageSmokeTier`), błysk luf własnego
samolotu (lokalny MUZZLE), markery wrogów ze spottingiem `SPOT_RANGE_M` (kolor FFA per id),
celownik + znacznik nosa, ostrzeżenie granicy areny, lista uczestników (`RosterOverlay` ze
`standings`) i pełny HUD-G (G-LOC/stall/szarzenie + sztuczny horyzont) — dane lotu z lokalnej
predykcji (`Predictor.sim`), amunicja ze snapshotu. **Protokół v3** (`PROTOCOL_VERSION` 2→3):
encja snapshotu +1 bajt amunicji (`ammoFrac`), `SNAPSHOT_ENTITY_BYTES` 30→31; `Explosions`/
`SmokeTrails` dostały `clear()` (reset meczu). Elementy DOM/CSS przeniesione do `online.html`.
Faza 15 (2026-06-18): parytet MP cz.2 — serwerowy model śmierci (BEZ bumpu protokołu —
`'dying'`/`'collision'` w protokole od f11). Zestrzelenie w powietrzu i zderzenie samolot↔samolot
nie kończą encji od razu (`'dead'`), tylko czynią z niej spadający wrak (`'dying'` → `stepWreck` →
`wreckImpact` → `'dead'`), jak w SP. `ServerPlayer.prevPos` + `resolvePlaneCollisions` (zamiatany
`planesCollide` r=`collisionRadiusM`, po ruchu przed historią/ogniem; oba → wrak, cause `'collision'`
bez kredytu); korekta `prevPos` po zawinięciu torusa (`nearestToroidalImage` — bez ruszania
współdzielonego `stepPilotedPlane`); nietykalni po respawnie nie zderzają się. `enterWreck`
(`'dying'`+`deaths`) wspólny dla zestrzelenia i kolizji; `onGroundDeath` (rozbicie żywego) bez zmian.
`stepWreckEntity`: wrak gracza steruje się inputem (`keyboardDemands`), bot leci neutralnie.
**Decyzja (uzgodniona z użytkownikiem): wrak GRACZA może strzelać** (parytet z SP; bot-wrak nie) —
wrak nie jest celem ani się nie zderza, ale broń działa. Klient f14 zgodny (interpolator/`reconcile`
obsługują `'dying'`), lokalny wrak gracza w pełni grywalny dopiero z f16 → **deploy f15+f16 razem**.
Testy `server/collision.test.ts` (+7, łącznie 388).
Faza 16 (2026-06-18): parytet MP cz.3 — kliencka warstwa śmierci (BEZ zmian protokołu). Zestrzelony
gracz STERUJE własnym spadającym wrakiem (lokalna predykcja `'dying'`), dym wraku, wybuch dopiero
przy uderzeniu w ziemię, nakładka decyzji, tryb obserwatora i kamera orbitalna — brak „pustego kadru".
Wspólna `stepWreckPiloted` (`shared/world/piloted-plane.ts`) = autorytatywny krok wraku dla SERWERA
i predykcji KLIENTA (niezmiennik reconciliation jak `stepPilotedPlane`); serwer zrefaktorowany na nią
(usunięte `stepWreckEntity`), bez zmiany zachowania. `Predictor.predict` liczy `'dying'`; `reconcile`
rozróżnia ciągłość fazy (żywy→żywy / wrak→wrak = replay bufora) od zmiany fazy (snap + reset).
`online-main`: `OrbitCamera`+`cameraMode` (C), `DownedOverlay` (obserwator/tabela/opuść pokój),
maszyna `playerDeath` (`enterPlayerWreck`/`onLocalRespawn`/`updateDeathState`), tryb obserwatora
(LPM cyklicznie zmienia oglądany samolot, kamera za interpolowaną pozą), dym wraku (`WRECK_TIER`),
wybuch `dying→dead` (lokalny i obcy, porównanie `lifeById`), `onKill` mały błysk przy zestrzeleniu/
kolizji (pełny przy `'ground'`), `updateMouseAimEnabled` (mysz tylko w pościgowej + gdy żywy).
Testy +6 (łącznie 394). **Deploy: f15 + f16 razem.**
Faza 17 (2026-06-19): parytet MP cz.4 — kontrola strefy KotH online jako DODATKOWY warunek
zwycięstwa obok limitu zestrzeleń/czasu (jak SP), autorytatywnie na serwerze; **BEZ bumpu protokołu**
(addytywne pola JSON w `standings`, wciąż v3). Decyzja użytkownika: tylko `ZoneBar`, bez znacznika 3D
(szczyt góry = punkt orientacyjny). Serwer (`game-room.ts`): `ZoneControl` w `step()` po ruchu/kolizjach
(FFA: frakcja = `id`, liczą się tylko żywi — świeży wrak strefy nie kontestuje); `checkMatchEnd` sprawdza
`zone.captured` PRZED `evaluateFfa` → `endMatch(_, 'zone')`; `buildStandings` +`zoneSeconds`,
`broadcastStandings` +`zone={controlling,occupied}`; `start()` resetuje strefę. Protokół: `MatchEndReason`
+`'zone'`, `StandingRow.zoneSeconds`, `ZoneStatus`, `StandingsMessage.zone`. Klient (`online-main.ts`):
`ZoneBar` (reużyty z SP, własny DOM — `online.html` bez zmian), status z `standings.zone`, fronty z
`zoneSeconds` (perspektywa-niezależnie), ukryty na wynikach/poza meczem; kolumna „Strefa" w tabeli
(`match-ui.ts`). Boty kontestują bez zmian (`PATROL_WAYPOINTS` od f12). Testy `zone-control.test.ts`
+3 (łącznie 397). **Deploy: razem z f15+f16.** Następna: Faza 18 — tryb drużynowy.
Decyzja 2026-06-18: blok parytetu MP↔SP (Fazy 14–18: wizualia/HUD → kolizje+wrak → obserwator →
strefa KotH → tryb drużynowy) PRZED Bf 109; dotychczasowe fazy przesunięte (Bf 109→19, teren→20,
dźwięk→21, uszkodzenia→22). Szczegóły: sekcja „Parytet multiplayera" w PLAN.md.

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
- Projekt modelu lotu (fazy 1–3): `docs/fizyka-lotu.md`
- Aktualna faza: `docs/phases/faza-NN.md` (NN z linii statusu)
- Konfiguracja docelowego VPS (poza repo): `C:\AI\vps_home_pl_konfiguracja.md`
- Poprzedni projekt jako referencja (poza repo, NIE kopiować na ślepo):
  `C:\AI\pozostałe\gry\symulator\air-combat-opus4-7\` — zwłaszcza `memory/project_phase*_decisions.md`
