# CLAUDE.md — air-combat-fable5

<!--
  Trwałe instrukcje sesyjne. Ładowane na każdym starcie sesji, przeżywają /compact.
  TU żyją twarde niezmienniki. NIE wpisuj tutaj: historii projektu (→ memory/),
  szczegółów decyzji (→ PLAN.md / docs/phases/), notatek bieżącej sesji.
-->

## Status faz

Fazy ukończone: **0–18 + domknięcie parytetu MP↔SP (P1–P5) + Faza 19 (19a ✅, 19b ✅) + Faza 20 ✅**. Szczegóły
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
| 13    | Pętla meczu FFA + deploy MP (kamień milowy)                           | ✅ kod; ⏳ user: deploy/smoke wss:// + `docker stats`, tag `mp-1` |
| 14–18 | **Parytet MP↔SP**: wizualia → wrak → obserwator → strefa → drużyny    | ✅ → `docs/parytet-mp-sp.md` |
| P1–P5 | **Domknięcie parytetu**: FFA eliminacja, CC-BY, onboarding, buffet, sprzątanie | ✅ zacommitowane (404 testy zielone) |
| 19a   | **Drugi samolot (shared)**: Bf 109 E-3, uzbrojenie w grupach, balistyka per-pocisk, złote testy `describe.each` | ✅ 424 testy zielone (`bf109-e.json`, asymetria turn↔energy) |
| 19b   | **Drugi samolot (integracja)**: protokół v4 (bajt typu), per-player plane serwer, rejestr meshy + model 3D Bf 109, wybór w lobby, HUD typ wroga, balans 1v1 | ✅ 440 testów zielone; ⏳ user: playtest balansu + weryfikacja wzrokowa modelu + smoke v4 |
| 20    | **Teren v2 (timebox)**: złota godzina+lens flare, chmury billboardowe (krycie się), woda v2 (waternormals+odbicie nieba, bez planar), teren 2-poziomowy | ✅ 460 testów zielone; podpunkt 5 → backlog; **doszlif 2026-06-21**: tekstury v3 2K + anti-tiling (koniec „kraty"), fix migotania brzegu (`logarithmicDepthBuffer`), drzewa próbowane→odrzucone; ⏳ user: pomiar fps RTX + weryfikacja wzrokowa (patrz `docs/phases/faza-20.md`) |

**Protokół: `PROTOCOL_VERSION = 5`** (bumpnięty w f14 +1 bajt amunicji, w f19b +1 bajt typu samolotu,
w sesji poprawek 2026-06-21 +1 bajt amunicji GRUPY WTÓRNEJ = działko 20 mm Bf 109; fazy 15–18, P1–P5
i czat poczekalni bez bumpu — addytywne JSON albo usunięcia). **Deploy front+back RAZEM** (niespójna wersja = błąd handshake).

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

⏳ **Otwarte po stronie użytkownika:** publiczny deploy MP (po P1+P2) + smoke online (FFA bez respawnu
→ overlay obserwatora; drużynowy; v5 z wyborem samolotu + licznik 20 mm + ekran ładowania + zryw botów) +
playtest poprawek 2026-06-21 (zryw botów „trudnych", nazwiska PL/DE) + playtest balansu 1v1 Spitfire↔Bf 109 +
weryfikacja wzrokowa modelu Bf 109 (orientacja/śmigło/podwozie — fixEuler best-guess) + zaległe pomiary VPS —
pełna lista w `docs/parytet-mp-sp.md` („Otwarte sprawy"). Brak SSH z sesji.

**Następna: Faza 21 — dźwięk i efekty** (`docs/phases/faza-21.md`).
(Decyzja 2026-06-18: pełny parytet MP↔SP przed Bf 109; Bf 109→19 ✅, teren→20 ✅, dźwięk→21, uszkodzenia→22.)

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
