# Domknięcie parytetu MP ↔ SP — plan przeniesienia rozwiązań z single-player

> Plan w formie „vibecodingu": każdy punkt ma gotowy kontekst, pliki, kroki, pułapki,
> weryfikację i prompt do wklejenia. Sesje robić **pojedynczo** (jak fazy), z `/clear`
> między nimi; po każdej `npm run typecheck && npm test && npm run lint` na zielono.

## Kontekst

Po blokach 14–18 multiplayer ma już parytet w wizualiach, modelu śmierci, obserwatorze,
strefie KotH i trybie drużynowym. Audyt porównawczy `packages/client/src/main.ts` (SP, lepiej
dopracowany, starszy) ↔ `packages/client/src/online-main.ts` + `packages/server/src/game-room.ts`
(MP) wykazał kilka **pozostałych** różnic, które warto przenieść do MP. Bot AI, kolizje, wrak,
spotting, asysty, kontrola strefy, kolory frakcji — **są na parytecie** (zweryfikowane w kodzie),
więc nie ma ich w tym planie.

Metoda: czytanie obu warstw linia po linii + porównanie z modułami współdzielonymi
(`shared/world/*`, `chase-camera.ts`, `plane-mesh.ts`).

## Decyzje użytkownika (2026-06-19)

1. **FFA w MP → eliminacja jak SP** (1 życie, brak respawnu, last-man-standing). Pełny parytet,
   nawet kosztem twardości online. → punkt **P1**.
2. **Zakres planu: pełny** — feel/wizualia + onboarding w lobby + atrybucja CC-BY. → P1–P5.

## Legenda priorytetów

- **P1** — zmiana rozgrywki (serwer + klient + lobby), największy zakres i ryzyko.
- **P2** — compliance (licencja CC-BY) — niski wysiłek, ale formalnie ważne.
- **P3** — onboarding (UX nowego gracza).
- **P4** — feel (drobna, czysta zmiana wizualna).
- **P5** — drobne niespójności / sprzątanie martwego kodu.

---

## P1 — FFA jako tryb eliminacyjny (parytet z SP) 🎯 serwer + klient + lobby

### Co robi SP
`setupFfa` nadaje każdemu pilotowi `lives: MATCH_LIVES` (=1). `respawnCombatant` odradza
**tylko gdy `livesLeft > 0`**, więc po pierwszym zestrzeleniu pilot wypada. `checkMatchEnd`
kończy mecz, gdy `factionsInPlay(...) <= 1` (w FFA frakcja = id, więc „last man standing").
Brak limitu zestrzeleń i brak limitu czasu — czysta eliminacja. Zestrzelony gracz steruje
wrakiem → `DownedOverlay` (obserwator / koniec).

### Co robi MP dziś
`game-room.ts`:
- `canRespawn()` → `this.mode !== 'team' || livesLeft > 0` — **FFA respawnuje w nieskończoność**.
- `loseLife()` → dekrementuje życia **tylko w team** (`if (this.mode === 'team')`).
- `checkMatchEnd()` gałąź FFA → `evaluateFfa(...)` = koniec przy **limicie zestrzeleń (10)**
  albo **czasie (15 min)**. To deathmatch, nie eliminacja.

To świadomy rozjazd z faz 8–13 (MP powstał jako FFA deathmatch). Decyzja usera: ujednolicić z SP.

### Dlaczego to ważne
Dwa różne „FFA" w jednej grze mylą. Po zmianie OBA tryby MP (FFA i drużynowy) są eliminacyjne
1-życiowe — spójnie z SP; obserwator i overlay wraku (faza 16) zaczynają w FFA pełnić tę samą rolę
co w SP (dziś w FFA są tylko chwilowe przed respawnem).

### Pliki
- `packages/server/src/game-room.ts` — `loseLife`, `canRespawn`, `checkMatchEnd`, ew. usunięcie
  użycia `evaluateFfa`.
- `packages/client/src/online-main.ts` — `rosterRows` (isLost), komunikat „oczekiwanie na respawn",
  linia zegara w HUD.
- `packages/client/src/net/lobby-ui.ts` — wiersz „Mecz do N zestrzeleń" (patrz pytanie otwarte Q1).
- Testy: `packages/server/src/match-loop.test.ts`, `combat.test.ts`, `team-mode.test.ts`
  (FFA przestaje kończyć się limitem — istniejące testy FFA-deathmatch trzeba przepisać).

### Kroki (serwer)
1. `loseLife()` — zdejmij warunek trybu: życie traci się **w obu trybach**
   (`victim.livesLeft = Math.max(0, victim.livesLeft - 1)`). `start()` i `createPlayer`/`enterWorld`
   już ustawiają `livesLeft = MATCH_LIVES`, więc reset jest pokryty.
2. `canRespawn()` — zwróć `player.livesLeft > 0` niezależnie od trybu.
3. `checkMatchEnd()` — gałąź FFA zastąp **eliminacją**. Najczyściej: jeden wspólny
   `checkElimination()` używany dla obu trybów (w FFA frakcja = id → `factionsInPlay` traktuje
   każdego osobno). **Uwaga na guard**: `checkTeamElimination` ma `if (factions.size < TEAM_COUNT) return`
   (TEAM_COUNT=2) — w FFA z ≥2 pilotami przechodzi, ale **solo-pokój FFA (1 pilot, 0 botów) nigdy
   nie skończy się eliminacją** (skończy tylko strefa). To akceptowalny edge (jak SP wymaga botów),
   ale go udokumentuj komentarzem.
4. Strefa KotH zostaje **przed** eliminacją w `checkMatchEnd` (już tak jest) — parytet z SP.
5. `evaluateFfa` (shared/world/ffa.ts) po zmianie nie jest już wołane przez serwer — albo usuń
   (martwy kod), albo zostaw, jeśli wybierzesz hybrydę z Q1. `compareFfa`/`rankFfa` zostają
   (sort standings, `topPlayerOfFaction`).

### Kroki (klient)
6. `rosterRows()` — `isLost` policz też w FFA: `r.deaths >= MATCH_LIVES && life !== 'alive'
   && life !== 'dying'` (dziś bramkowane `matchMode === 'team'`). Po zmianie warunek wspólny.
7. Komunikat śmierci: `ZESTRZELONY — oczekiwanie na respawn` jest już nieprawdziwy (brak respawnu).
   Po uderzeniu wraku w ziemię gracz zostaje na `DownedOverlay` (obserwator / opuść pokój), jak SP.
   Zmień copy (np. „ZESTRZELONY") albo polegaj wyłącznie na overlayu — sprawdź ścieżkę
   `playerDeath==='wreck'` po `dying→dead` (overlay ma zostać).
8. HUD — linia „czas": serwer w eliminacji wyśle `timeLeftS=0` (jak team), więc ukryj zegar tak
   jak dla drużynowego (dziś `hudExtraLines` pokazuje zegar zawsze, gdy są standings).

### Pułapki
- Po tej zmianie **żaden** tryb MP nie respawnuje → cała ścieżka „respawn w trakcie meczu" w
  `stepPlayer`/`stepBot` (`updateLifecycle === 'respawnReady' && canRespawn`) staje się martwa
  dla normalnej gry (zostaje tylko late-join). To OK, ale nie usuwaj jej — late-join i guard NaN
  (`spawn(player, true)` w catch) jej używają.
- `protectionTimerS` (ochrona po spawnie) i wybór slotu z dala od wrogów tracą znaczenie bez
  respawnu — zostaw (działają przy late-join / starcie).
- Standings/scoreboard FFA: ranking po `compareFfa` (kills↓/deaths↑/id↑) wciąż poprawny.

### Weryfikacja
- `npm test` (po przepisaniu testów FFA): mecz FFA 1v3 boty kończy się, gdy zostaje 1 frakcja.
- Smoke online: zestrzel/daj się zestrzelić w FFA → brak respawnu, overlay obserwatora, ekran
  wyników po wyeliminowaniu wszystkich poza jednym.

### Prompt do wklejenia
```
Ujednolić tryb FFA w multiplayerze z singleplayerem: ma być eliminacyjny 1-życiowy
(last-man-standing), bez limitu zestrzeleń i czasu, dokładnie jak setupFfa+checkMatchEnd w
packages/client/src/main.ts. W packages/server/src/game-room.ts: loseLife dekrementuje życia w
OBU trybach; canRespawn = livesLeft>0 niezależnie od trybu; checkMatchEnd dla FFA użyj eliminacji
(factionsInPlay; frakcja=id) zamiast evaluateFfa, ze strefą wciąż przed eliminacją. Po stronie
klienta (online-main.ts): rosterRows.isLost liczone też w FFA, popraw komunikat „oczekiwanie na
respawn" (brak respawnu — overlay obserwatora jak SP), ukryj zegar w HUD gdy timeLeftS=0.
Przepisz testy FFA (match-loop/combat) z deathmatchu na eliminację. Zapytaj o Q1 z planu
(scoreLimit/limit czasu) ZANIM ruszysz lobby.
```

---

## P2 — Widoczna atrybucja CC-BY modelu Spitfire 🎯 online.html / lobby

### Co robi SP
`menu.ts` → `modelAttribution()` renderuje w menu link „Supermarine Spitfire Mk.IIa — barking_dogo
(Sketchfab) — licencja CC-BY 4.0".

### Co robi MP
**Nic.** `online.html` i `lobby-ui.ts` nie pokazują atrybucji, mimo że MP ładuje **ten sam** model
GLB (`plane-mesh.ts` → `/models/spitfire/scene.gltf`).

### Dlaczego to ważne
Licencja **CC-BY 4.0 wymaga widocznej atrybucji** w każdym wydaniu używającym assetu. Wpis w
`assets/LICENSES.md` (niezmiennik #8) spełnia stronę repo, ale publiczny deploy online pokazuje
model bez kredytu autora — to luka compliance, nie kosmetyka.

### Pliki
- `packages/client/src/net/lobby-ui.ts` — dodać element atrybucji na ekranie wejściowym (`entry`).
- (Alternatywnie/dodatkowo) `packages/client/online.html` — drobny przypis przy ekranie ładowania.

### Kroki
1. Dodaj w `lobby-ui` (ekran `entry`, na dole) element jak `modelAttribution()` z `menu.ts`
   (link `target="_blank" rel="noopener noreferrer"`, CC-BY 4.0). Możesz wyeksportować
   `modelAttribution()` z `menu.ts` i reużyć, ALE uwaga na warstwy: `menu.ts` jest modułem klienta
   SP — import z `lobby-ui` jest dozwolony (oba w `client`). Jeśli wolisz brak sprzężenia,
   skopiuj 6 linii.

### Pułapki
- `lobby-ui.ts` wstrzykuje własny CSS (`LOBBY_CSS`) — dodaj klasę `.lobby-attribution` zamiast
  inline-style, dla spójności.
- Tekst przez `textContent` / kontrolowany link — nie buduj z `innerHTML`.

### Weryfikacja
- Ekran wejściowy lobby pokazuje kredyt; link działa; build online przechodzi.

### Prompt do wklejenia
```
Dodaj widoczną atrybucję CC-BY modelu Spitfire w lobby online (parytet z modelAttribution() w
packages/client/src/menu.ts). Wstaw na dole ekranu wejściowego w packages/client/src/net/lobby-ui.ts
link „Supermarine Spitfire Mk.IIa — barking_dogo (Sketchfab) — CC-BY 4.0" (textContent + bezpieczny
link, klasa CSS w LOBBY_CSS). Online ładuje ten sam GLB co SP, więc atrybucja jest wymagana licencją.
```

---

## P3 — Onboarding w lobby: ekran sterowania + opis celu 🎯 lobby-ui

### Co robi SP
`menu.ts` ma ekran „JAK GRAĆ" (`showHelp`) z tabelą sterowania (`CONTROL_ROWS`) i opisem celu
(strefa nad górą / eliminacja). Pokazywany **automatycznie przy pierwszym uruchomieniu**
(`HELP_SEEN_KEY` w localStorage) i potem pod przyciskiem „Sterowanie". Kryterium fazy 7:
osoba bez instrukcji ustnej ma dać radę.

### Co robi MP
Brak ekranu sterowania i opisu celu. Jedyna pomoc to **jedna linia** w HUD podczas gry
(`'WSAD/strzałki ster • Q/E ... [Tab] tabela [N] sieć'`). Nowy gracz online nie wie, że głównym
celem jest **strefa KotH**, ani jak latać, zanim wejdzie do meczu.

### Dlaczego to ważne
Multiplayer jest publiczny (`dogfight.tatanga.eu`) — pierwsze wrażenie ma najgorszy moment na naukę
sterowania (już w locie, pod ostrzałem). SP rozwiązuje to onboardingiem przed grą.

### Pliki
- `packages/client/src/net/lobby-ui.ts` — przycisk „Sterowanie" na ekranie `entry` + nakładka
  z tabelą sterowania i celem; ewentualny auto-pokaz przy 1. wizycie (localStorage).

### Kroki
1. Reużyj listy sterowania z `menu.ts` (`CONTROL_ROWS`) — z poprawką klawiszy specyficznych dla
   online (np. respawn „R" **nie istnieje** w MP → usuń wiersz; dodaj „[N] panel sieci").
2. Dodaj opis celu: strefa nad górą (`ZONE_CAPTURE_SECONDS`) ALBO wyeliminowanie wrogów.
3. Auto-pokaz przy 1. wejściu (`localStorage`, własny klucz np. `air-combat:help-seen-online`).

### Pułapki
- Nie kopiuj wiersza „Respawn (poligon) — R": w MP nie ma respawnu graczem (i po P1 w ogóle).
- Treść sterowania to ŹRÓDŁO PRAWDY = `input.ts` + obsługa w `online-main.ts` (klawisz C kamera,
  Tab tabela, N sieć) — zweryfikuj zgodność.

### Weryfikacja
- Pierwsze wejście do lobby (czysty localStorage) pokazuje „JAK GRAĆ"; przycisk otwiera ją ponownie;
  klawisze zgodne z realną obsługą.

### Prompt do wklejenia
```
Dodaj onboarding w lobby online (parytet z ekranem „JAK GRAĆ" w packages/client/src/menu.ts):
tabela sterowania + opis celu (strefa KotH nad górą / eliminacja wrogów), auto-pokaz przy 1.
wejściu (localStorage) i przycisk „Sterowanie" na ekranie wejściowym. Klawisze dostosuj do
online-main.ts (C kamera, Tab tabela, N sieć; BEZ respawnu R). Zmiany tylko w lobby-ui.ts.
```

---

## P4 — Trzęsienie kamery przy buffecie/przeciągnięciu 🎯 online-main (czysta zmiana feel)

### Co robi SP
`main.ts` w pętli renderu liczy `buffet = lastTick.stall.buffetIntensity` i przekazuje go do
`chaseCamera.update(..., buffet)`. `ChaseCamera` dodaje losowe drgania kamery o amplitudzie
`BUFFET_SHAKE_M * buffetIntensity` — fizyczne „czucie" przeciągnięcia.

### Co robi MP
`online-main.ts` woła `chaseCamera.update(frameDtS, viewPos, viewQuat, viewVel, 0)` —
**buffet zahardkodowany na 0**. Kamera online NIE trzęsie się przy buffecie, mimo że dane są
dostępne lokalnie (`predictor.sim.stallEffects.buffetIntensity`, używane już w HUD `updateHud`).

### Dlaczego to ważne
To jeden z mocniejszych sygnałów „lecisz na granicy przeciągnięcia" — w SP jest, w MP go nie ma.
Klient online liczy pełną fizykę lokalnie (predykcja), więc to zero-koszt i bez zmiany protokołu.

### Pliki
- `packages/client/src/online-main.ts` — pętla renderu, wywołanie `chaseCamera.update`.

### Kroki
1. Tuż przed wywołaniem kamery policz:
   `const buffet = !spectate && predictor.ready ? predictor.sim.stallEffects.buffetIntensity : 0;`
   (gdy obserwujesz cudzy samolot — 0, parytet z SP `viewC === player ? buffet : 0`).
2. Przekaż `buffet` zamiast `0` w gałęzi `chaseCamera.update(...)`.

### Pułapki
- Tylko w kamerze pościgowej (orbitalna nie dostaje buffetu w SP też).
- Nie ruszaj `0` w gałęzi obserwatora — drganie ma być tylko z perspektywy własnego, żywego samolotu.

### Weryfikacja
- Wprowadź samolot w buffet (ostry zakręt/przeciągnięcie) online → kamera drży jak w SP.

### Prompt do wklejenia
```
W packages/client/src/online-main.ts przekaż realny buffet do chaseCamera.update zamiast 0:
buffet = (!spectate && predictor.ready) ? predictor.sim.stallEffects.buffetIntensity : 0.
Parytet z main.ts (chaseCamera dostaje stall.buffetIntensity tylko dla własnego, żywego samolotu).
```

---

## P5 — Drobne niespójności / sprzątanie 🎯 online-main

Niski priorytet, do zrobienia przy okazji P1/P4.

1. **Gaz po (re)spawnie.** SP `spawnCombatant` ustawia `keyboard.throttle = 0.8` przy każdym
   (re)spawnie. MP nie resetuje gazu klienta — serwer spawnuje na 0.8, ale klient w następnej
   ramce nadpisuje swoim `keyboard.throttle`. Po P1 (brak respawnu) dotyczy już tylko startu meczu,
   więc waga spada do kosmetyki — ale dla spójności rozważ reset `keyboard.throttle = SPAWN_THROTTLE`
   przy `enterPlaying`.
2. **HUD `buffetIntensity` przy obserwacji.** SP zeruje buffet/blackout, gdy `viewC !== player`.
   MP `updateHud` zawsze czyta `predictor.sim` (własny) — w praktyce buffet martwego samolotu ≈ 0,
   blackout bramkowany `localAlive`, więc różnica jest kosmetyczna. Domknij przy P4 (spójny `spectate`).
3. **Martwy kod po P1.** Jeśli FFA przestaje używać `evaluateFfa`, rozważ usunięcie funkcji
   (lub zostaw, jeśli Q1 = hybryda). `MATCH_SCORE_LIMIT_OPTIONS`/`scoreLimit` patrz Q1.

---

## Otwarte pytania / ryzyka do potwierdzenia PRZED implementacją P1

> Te decyzje zmieniają zakres P1 — ustalić na początku sesji P1.

- **Q1 — limit czasu i `scoreLimit` w FFA-eliminacji.** SP nie ma ani limitu czasu, ani
  zestrzeleń. Dla online „nieskończony" mecz, gdy dwóch ostatnich się chowa, bywa problemem.
  Warianty:
  - (a) **Pełny parytet SP** — usuń `scoreLimit` i limit czasu z FFA; wiersz „Mecz do N zestrzeleń"
    w lobby ukryj (jak dla drużynowego); `evaluateFfa` → martwy kod do usunięcia.
  - (b) **Eliminacja + bezpiecznik czasu** — eliminacja jak SP, ale zachowaj `MATCH_TIME_LIMIT_S`
    jako twardy limit z rozstrzygnięciem po `compareFfa` (kto prowadzi). Bezpieczniejsze dla online.
  - (c) **Hybryda hosta** — zachowaj `scoreLimit` jako ALTERNATYWNY warunek obok eliminacji.
    Najbliżej obecnego MP, ale najdalej od „czystego SP".
  Rekomendacja: **(b)** — wierne SP w odczuciu, ale bez ryzyka wiszącego meczu online.

- **Q2 — `MAX_BOTS` (6 samolotów SP) vs `MAX_PLAYERS_PER_ROOM` (8 MP).** To NIE jest luka do
  przeniesienia (MP ma więcej), tylko różnica skali — odnotowane, bez akcji.

- **Ryzyko testów.** Istniejące testy serwera zakładają FFA-deathmatch (limit zestrzeleń kończy mecz
  — `match-loop.test.ts`, `combat.test.ts`). P1 wymaga ich przepisania na eliminację; zaplanuj to
  jako część sesji P1, nie traktuj „czerwonych" testów jako regresji.

## Sugerowana kolejność sesji (vibecoding)

1. **P4** (kamera/buffet) — rozgrzewka, czysta i bezpieczna, natychmiastowy efekt feel.
2. **P2** (atrybucja) — szybkie, zamyka compliance przed kolejnym deployem.
3. **P3** (onboarding lobby) — UX, niezależne od reszty.
4. **P1** (FFA eliminacja) — największa zmiana; zacznij od ustalenia **Q1**, potem serwer → testy →
   klient → lobby. Deploy front+back RAZEM (zmiana zachowania serwera).
5. **P5** — sprzątanie przy okazji P1/P4.

> Po każdej sesji: aktualizacja `PLAN.md`/`CLAUDE.md` (status), wpis w `memory/`, commit z opisem.
> Po P1 i P2 — ponowny deploy publiczny (parytet zachowania serwera + compliance).
