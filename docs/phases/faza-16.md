# Faza 16 — Parytet MP cz.3: kliencka warstwa śmierci (obserwator + sterowany wrak)

**Zależy od:** Faza 15 (serwerowy model śmierci: `'dying'`/`stepWreck`/kolizje).
**Cel:** Domknąć różnicę w WARSTWIE KLIENCKIEJ śmierci między online a single-player. Po tej
fazie zestrzelony gracz nie ogląda „pustego kadru": STERUJE własnym spadającym wrakiem (lokalna
predykcja `'dying'`), widzi dym wraku i wybuch dopiero przy uderzeniu w ziemię, dostaje nakładkę
decyzji (obserwator / tabela / opuść pokój), może przejść w tryb obserwatora (LPM cyklicznie
zmienia oglądany samolot) i przełączyć kamerę orbitalną (C) — jak w SP. Bez zmian protokołu.

## Zakres

W tej fazie (klient + jedna wspólna funkcja w `shared`; BEZ zmian protokołu):
- **Wspólna `stepWreckPiloted`** (`shared/world/piloted-plane.ts`) — autorytatywny krok wraku
  `'dying'` używany przez SERWER i predykcję KLIENTA (ten sam niezmiennik reconciliation co
  `stepPilotedPlane`). Wyciągnięta z serwerowego `stepWreckEntity` (Faza 15): silnik martwy
  (throttle 0), sterowanie wprost wychyleniami (`keyboardDemands`, bez instruktora/myszy) dla
  gracza, neutralny opad dla bota (`command === null`); sekwencja: żądania → `stepWreck` →
  zawinięcie torusa → strażnik NaN → cykl życia (`wreckImpact` → `'dead'`).
- **Predykcja wraku** (`net/prediction.ts`) — `Predictor.predict` liczy `'dying'` przez
  `stepWreckPiloted` (dotąd no-op dla nie-żywych); `reconcile` rozróżnia CIĄGŁOŚĆ fazy
  (żywy→żywy / wrak→wrak = replay bufora tą samą ścieżką) od zmiany fazy (spawn / zestrzelenie
  alive→dying / uderzenie dying→dead / respawn = snap + czyszczenie bufora + reset maszyn).
- **Render + sterowanie wraku gracza** (`online-main.ts`) — mesh własnego wraku z `predictor`
  (widoczny do `'dead'`, śmigło staje), dym wraku (`WRECK_TIER`), ogień Spacją (serwer dopuszcza
  wrak gracza od Fazy 15), znacznik nosa do celowania wrakiem.
- **Wybuch na `dying→dead`** — duży wybuch w miejscu mesha przy przejściu encji `'dying'`→`'dead'`
  (uderzenie wraku w ziemię), dla LOKALNEGO i OBCYCH; `onKill` daje tylko mały błysk przy
  zestrzeleniu/kolizji (`AIR_KILL_FLASH_SCALE`), a pełny wybuch przy rozbiciu o teren (`'ground'`,
  serwer od razu `'dead'`).
- **Nakładka decyzji `DownedOverlay`** (reużyta z SP) — obserwator (gdy jest kogo oglądać) /
  tabela wyników / „zakończ misję" = opuść pokój → lobby.
- **Tryb obserwatora** — `playerDeath: 'none'|'wreck'|'spectating'`; po wyborze LPM cyklicznie
  zmienia oglądany (żywy, obcy) samolot; kamera podąża za interpolowaną pozą obcego.
- **Kamera orbitalna (C)** — `OrbitCamera` reużyta z SP; przełącznik pościgowa ↔ orbitalna spina
  `updateMouseAimEnabled` (mysz-celownik aktywna tylko w pościgowej i gdy gracz żyje), podłoga
  kamery nad terenem.

Poza zakresem: strefa KotH (17), tryb drużynowy (18). Protokół bez zmian (wciąż v3 z Fazy 14).

## Kroki

1. `shared/world/piloted-plane.ts`: `stepWreckPiloted(sim, plane, demands, command|null, terrain,
   dtS, ctx)` zwracająca `LifeEvent`.
2. `server/game-room.ts`: gałęzie `'dying'` w `stepPlayer`/`stepBot` wołają `stepWreckPiloted`
   (gracz: `latestInput`, bot: `null`); usunięte `stepWreckEntity` + `scratchWreckDefl`; ack
   `lastProcessedSeq` przy call-site gracza. Bez zmiany zachowania (te same testy zielone).
3. `client/net/prediction.ts`: `predict` obsługuje `'dying'`; `reconcile` = continuesAlive/
   continuesDying (replay właściwą ścieżką) vs zmiana fazy (snap + reset); metryki Fazy 9 tylko
   dla lotu żywego.
4. `client/online-main.ts`: `OrbitCamera`+`cameraMode` (C), `DownedOverlay`, maszyna `playerDeath`
   (`enterPlayerWreck`/`onLocalRespawn`/`updateDeathState`), tryb obserwatora (cykl LPM, wybór
   widoku kamery), dym wraku, wybuch `dying→dead`, `onKill` mały błysk, alert (obserwator/wrak/
   respawn), znacznik nosa wraku, podłoga kamery.
5. Testy: `shared/world/piloted-plane.test.ts` (+4: determinizm wraku, throttle 0/opad, lotki
   działają, `wreckImpact`→`dead`); `client/net/prediction.test.ts` (+2: reconcile `'dying'` +
   replay wraku, uderzenie wraku → `dead` → no-op).

## Kryteria ukończenia

- [x] Zestrzelony gracz STERUJE spadającym wrakiem (lokalna predykcja `'dying'` przez
  `stepWreckPiloted`); reconcile bez snapowania 30 Hz (ciągłość wrak→wrak = replay bufora)
- [x] Wrak gracza może strzelać Spacją (serwer dopuszcza od f15), znacznik nosa do celowania
- [x] Spadający wrak (lokalny i obcy) ciągnie dym `WRECK_TIER`; wybuch dopiero przy uderzeniu
  w ziemię (`dying→dead`), a przy zestrzeleniu/kolizji tylko mały błysk
- [x] Po rozbiciu wraku gracz dostaje `DownedOverlay` (obserwator / tabela / opuść pokój);
  brak „pustego kadru"
- [x] Tryb obserwatora: LPM cyklicznie zmienia oglądany żywy samolot; kamera podąża za nim
- [x] Kamera orbitalna na C (parytet z SP), mysz-celownik wyłączona w orbitalnej/wraku/obserwatorze
- [x] Respawn (serwer `dead→alive`) wraca do normalnej gry (mysz, nakładka schowana)
- [x] `stepWreckPiloted` wspólna dla serwera i klienta (niezmiennik reconciliation); serwer
  bez zmiany zachowania (388 testów f15 nadal zielone)
- [x] typecheck + test (394, +6) + lint zielone; build (Vite + esbuild) przechodzi; commit
- [ ] **(użytkownik)** smoke online: dać się zestrzelić, sterować wrakiem, ostrzelać kogoś z wraku,
  zobaczyć wybuch przy ziemi, przejść w obserwatora (LPM), przełączyć kamerę (C), doczekać respawnu

## Pułapki

- **Reconciliation wraku = ta sama ścieżka co serwer.** Replikowanie kroku wraku w predyktorze
  (zamiast wspólnej `stepWreckPiloted`) = dryf i wieczne drganie korekty (ten sam powód, dla
  którego Faza 9 wyciągnęła `stepPilotedPlane`). Stąd refaktor serwera na wspólną funkcję.
- **Zmiana fazy życia to NIECIĄGŁOŚĆ predykcji.** `alive→dying` (zestrzelenie) i `dying→dead`
  (uderzenie) czyszczą bufor inputów i resetują maszyny — bufor po alive→dying zawiera inputy
  ŻYWE (nie wolno ich odtwarzać jako wraku). Ciągłość (replay) tylko wewnątrz jednej fazy.
- **Reorder w serwerowej gałęzi `'dying'`**: `stepWreckPiloted` woła `updateLifecycle` WEWNĄTRZ
  (przed `fixWrapPrev`), Faza 15 wołała ją po. Bezpieczne: `updateLifecycle` nie rusza pozycji,
  a `fixWrapPrev` czyta tylko pozycję (niezależne od `prevPos`). Kolizje i tak pomijają wraki.
- **Wybuch raz, nie dwa.** Mały błysk przy zestrzeleniu (`onKill`) + duży przy uderzeniu
  (`dying→dead`) to dwa różne momenty. `dying→dead` wykrywane porównaniem `lifeById` (poprzednia
  klatka) z bieżącą fazą — lokalnie z predykcji, dla obcych z interpolacji; po `'dead'` predykcja
  no-opuje, serwer nie wraca `dead→dying`, więc brak migotania = brak podwójnego wybuchu.
- **Brak `lifeTimerS` w snapshocie** → klient nie zna dokładnego odliczania respawnu dla siebie;
  alert pokazuje „ZESTRZELONY — oczekiwanie na respawn" bez sekundnika (uczciwie, bez zgadywania).
- **Mysz a kamera/wrak/obserwator**: `updateMouseAimEnabled` = jedyne źródło `mouseAim.enabled`
  (`pościgowa && playerDeath==='none'`); wołane przy zmianie kamery (C), wejściu w wrak, respawnie
  i resecie meczu — bez tego kursor zostałby uwięziony w pointer locku albo wrak nie miałby
  wolnego kursora do nakładki.

## Wynik

**Zrealizowane (2026-06-18).** Warstwa kliencka śmierci zrównana z SP — bez zmian protokołu (v3).

**`shared/world/piloted-plane.ts`:** `stepWreckPiloted` — wspólny autorytatywny krok wraku
`'dying'` dla serwera i predykcji klienta. Gracz steruje wprost (`keyboardDemands` z
pitch/roll/yaw, throttle wymuszony 0 w `stepWreck`), bot leci neutralnie (`command === null`).
Sekwencja identyczna po obu stronach: żądania → `stepWreck` → `wrapToArena` → `validatePlaneState`
→ `updateLifecycle` (`wreckImpact`→`'dead'`). To samo `scratchWreckDefl` co dotąd na serwerze.

**`server/game-room.ts`:** gałęzie `'dying'` w `stepPlayer`/`stepBot` wołają `stepWreckPiloted`
(usunięte `stepWreckEntity`, `scratchWreckDefl`, importy `keyboardDemands`/`stepWreck`). Zachowanie
bez zmian (388 testów f15 zielone). `updateLifecycle` przeniesione do wnętrza wspólnej funkcji
(reorder bezpieczny — patrz pułapki).

**`client/net/prediction.ts`:** `predict` rozgałęzia `'alive'` (`stepPilotedPlane`) / `'dying'`
(`stepWreckPiloted`) / nie-żywy (no-op). `reconcile` liczy `continuesAlive`/`continuesDying`
(ta sama faza po obu stronach → replay bufora właściwą ścieżką) vs `!continues` (zmiana fazy →
snap, czyszczenie bufora, reset instruktora/maszyny G). Wygładzanie offsetu renderu działa dla
obu faz; metryki Fazy 9 liczone tylko dla lotu żywego (wrak ich nie zaniża).

**`client/online-main.ts`:** `OrbitCamera` + `cameraMode` (C, `updateMouseAimEnabled`);
`DownedOverlay` (obserwator/tabela/opuść pokój); maszyna `playerDeath` (`enterPlayerWreck` przy
lokalnym `alive→dying`, `onLocalRespawn` przy `→alive`, `updateDeathState` co klatkę); tryb
obserwatora (`isSpectatable`/`firstSpectatable`/`cycleSpectatorTarget`, LPM cyklicznie, kamera za
interpolowaną pozą obcego, bufory `spectated*`); dym wraku (`WRECK_TIER`); wybuch `dying→dead`
(porównanie `lifeById`); `onKill` mały błysk przy zestrzeleniu/kolizji (pełny przy `'ground'`);
alert (obserwator / wrak-czysty-środek / oczekiwanie na respawn / granica areny); znacznik nosa
wraku; podłoga kamery nad terenem.

**Walidacja:** `npm run typecheck` + `npm test` (394, +6: 4× `stepWreckPiloted` w
`piloted-plane.test.ts`, 2× predykcja wraku w `prediction.test.ts`) + `npm run lint` zielone;
`npm run build` przechodzi (klient online 37,9 → 40,2 kB; serwer 563,5 kB).

**Otwarte (użytkownik):** smoke online po deployu — dać się zestrzelić i sterować spadającym
wrakiem, ostrzelać kogoś z wraku (Spacja), zobaczyć wybuch przy ziemi, przejść w obserwatora
(LPM zmienia samolot), przełączyć kamerę (C), doczekać respawnu. **Deploy: f15 + f16 razem**
(serwer f15 + klient f16 = pełny parytet wraku gracza; klient f14 z serwerem f15 był DEGRADED).
Następna: Faza 17 — kontrola strefy KotH (serwer + klient, dodatkowy warunek zwycięstwa).
