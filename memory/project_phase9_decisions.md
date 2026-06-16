# Faza 9 — decyzje (multiplayer cz.2: predykcja, reconciliation, interpolacja)

Cel: sterowanie online czuje się jak offline przy pingu ≤ 100 ms, obce samoloty płynne.

## Decyzje architektoniczne (nieoczywiste z kodu)

- **Wspólny autorytatywny tick w `shared/world/piloted-plane.ts` (`stepPilotedPlane`).**
  Wyciągnięty z `GameRoom.stepPlayer` (gałąź `alive`), bo używają go OBA autorytety:
  serwer (symulacja pokoju) i klient (predykcja). To niezmiennik reconciliation —
  replay inputów na kliencie MUSI iść DOKŁADNIE tym samym kodem co serwer, inaczej
  każdy snapshot daje korektę i obraz drga. `InputFrame` spełnia strukturalnie interfejs
  `PilotCommand` (te same pola sterowania), więc serwer podaje ramkę wprost. `command=null`
  = chwila po spawnie (trzymaj prosto neutralnie). Serwer zachowuje TYLKO opakowanie cyklu
  życia/respawnu wokół tej funkcji.
- **Ukryty stan maszyn NIE jest w snapshocie — tolerowany mikro-dryf (decyzja per fazę).**
  Snapshot niesie tylko stan widoczny (pozycja f32, orient/vel int16, throttle, life, stalled).
  Przy reconcile klient nadpisuje stan widoczny serwerem, ale ZACHOWUJE własny stan maszyn
  (stall, g-load, instruktor) oraz odtwarza `iasMs` z prędkości i wysokości (`tasToIasMs`,
  bo koperta `maxRollRate` czyta `iasMs` już w pierwszym kroku replay). Pełny zapis/odtwarzanie
  stanu maszyn per input byłby cięższy i niepotrzebny dla simcade (PLAN: „determinizmu NIE
  wymagamy"). Test pętli z lagiem 100 ms: 100% korekt < próg snap, maks < 10 m.
- **Wygładzanie korekty = OFFSET RENDERU, nie stanu fizyki.** Fizyka zostaje autorytatywna
  (sim = serwer + replay); render = `sim ⊕ (posError, quatError)`, gdzie offset zanika
  wykładniczo (`RECONCILE_SMOOTH_TAU_S=0.1 s`). Mała korekta = obraz „dogania" w ~100 ms;
  duża (≥ `RECONCILE_SNAP_DIST_M=50 m`: respawn / seria strat) = twardy snap (offset zerowany).
  Dzięki temu mikro-dryf nie drga, a teleport nie rozmazuje się gumą.
- **Zegar interpolacji jedzie po TICKU SERWERA, nie po `Date.now()` między maszynami**
  (pułapka faza-09.md). `renderTimeMs` płynie realnym czasem klatki i MIĘKKO goni
  `najnowszy_tick − INTERP_DELAY_MS (100)`. Czysty „render = najnowszy − delay" dawałby
  zamrożenie między snapshotami (30 Hz) i skoki — stąd ciągłe posuwanie + delikatna korekta
  tempa (`CLOCK_CATCHUP=0.08`).
- **Pełny snapshot (bez delty per-encja) → strata = strata CAŁEGO snapshotu.** Wszystkie encje
  są w każdym snapshocie, więc ekstrapolacja jest fallbackiem na opróżnienie bufora (zacięcie
  renderu / przejściowe wyprzedzenie zegara), max `INTERP_EXTRAPOLATION_MAX_MS=100` prędkością.
  Przy zwykłej stracie zegar i tak zostaje za najnowszym tickiem → płynny lerp bez ekstrapolacji.
- **Symulator sieci wpięty w `NetClient` (TX i RX) — logika czysta w `net-conditions.ts`.**
  `rollDelayMs(cfg, rand)` (deterministyczny z wstrzykniętym RNG) zwraca opóźnienie 1-kier.
  albo `null` (strata). RTT mierzony od MOMENTU `sendInput` (przed sztucznym opóźnieniem) do
  przetworzenia acka → ping w overlay odzwierciedla symulowany lag. Przy opóźnieniu TX bajty
  KOPIOWANE (współdzielony bufor inputu zostałby nadpisany przed wysyłką).
- **Panel symulatora (tweakpane) tylko DEV — tree-shaken z produkcji.** `online-main` importuje
  go dynamicznie za `import.meta.env.DEV`; w build prod to martwa gałąź → vite usuwa import,
  bundle online nie wozi tweakpane. `conditions.enabled` domyślnie `false` → produkcja nie
  symuluje lagu. Overlay debug (`[N]`, czysty DOM) zostaje zawsze, ale domyślnie ukryty.
- **Reset kamery przy teleporcie** (skok render-pozycji > 1000 m: zawinięcie torusa / respawn /
  twardy snap), inaczej kamera pościgowa robi wygładzony przelot przez całą arenę.

## Pułapki napotkane

- **Toroidalna metryka i lerp.** `wrapToArena` tworzy nieciągłość pozycji. Korekta predykcji =
  `toroidalDistanceSqM(oldPos, newPos)` (nie zwykła odległość), offset = `nearestToroidalImage`,
  a lerp interpolacji liczony do najbliższego obrazu toroidalnego sąsiada — bez tego skok przez
  szew wygląda jak przelot przez środek areny.
- **Test reconciliation: orientacja spawnu vs domyślny `aim`.** Nos na −Z + domyślny `aim=(0,0,1)`
  = „cel za plecami" → serwer robił zawrót 180°, nie „lot prosto". Fix: nos na +Z w teście.
- **`noUncheckedIndexedAccess`**: każde `buf[i]` to `T | undefined` — wszystkie dostępy do bufora
  inputów/sampli przez lokalną zmienną z guardem (`const head = pending[0]; if (!head…)`).

## Co świadomie POZA fazą

- Lag compensation broni i hit detection (faza 11) — broń online wciąż wyłączona.
- Lobby/pokoje (faza 10), boty na serwerze (faza 12).
- Rejestrator lotu w trybie online: niezbudowany. Równoważność czucia jest STRUKTURALNA
  (online i offline dzielą `stepPilotedPlane`/`pilotStep`), więc n(t) jest z definicji ten sam;
  porównanie wykresów zostaje jako test manualny, nie kod.

## Stan domknięcia

typecheck + 316 testów + lint zielone; build klienta (multi-page) i serwera OK. Testy fazy 9:
`shared/world/piloted-plane.test.ts` (determinizm/replay), `client/src/net/{net-conditions,
prediction,interpolation}.test.ts`. Weryfikacja „dwa okna" i czucie lotu — manualnie (browser).

UWAGA porządkowa: pamięć projektu (`memory/`) NIE ma `project_phase8_decisions.md` —
decyzje fazy 8 są tylko w auto-pamięci (`faza8-protokol-serwer.md`). Do ewentualnego backfillu.
