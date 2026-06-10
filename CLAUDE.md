# CLAUDE.md — air-combat-fable5

<!--
  Trwałe instrukcje sesyjne. Ładowane na każdym starcie sesji, przeżywają /compact.
  TU żyją twarde niezmienniki. NIE wpisuj tutaj: historii projektu (→ memory/),
  szczegółów decyzji (→ PLAN.md / docs/phases/), notatek bieżącej sesji.
-->

## Status faz

Fazy ukończone: 0 ; aktualny fokus: Faza 1 — Fundament fizyki + obserwowalność

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
- **Timeboxy są twarde** (szczególnie faza 15 — teren). Po przekroczeniu: zamknij co działa,
  resztę do backlogu w PLAN.md.

## Referencje

- Pełny plan, decyzje, ryzyka: `PLAN.md`
- Projekt modelu lotu (fazy 1–3): `docs/fizyka-lotu.md`
- Aktualna faza: `docs/phases/faza-NN.md` (NN z linii statusu)
- Konfiguracja docelowego VPS (poza repo): `C:\AI\vps_home_pl_konfiguracja.md`
- Poprzedni projekt jako referencja (poza repo, NIE kopiować na ślepo):
  `C:\AI\pozostałe\gry\symulator\air-combat-opus4-7\` — zwłaszcza `memory/project_phase*_decisions.md`
