# Faza 0 — Bootstrap: monorepo + hello WebSocket

**Zależy od:** —
**Cel:** działający szkielet projektu, na którym każda kolejna faza tylko dokłada kod.

## Zakres

W tej fazie:
- `git init` + `.gitignore` (node_modules, dist, build, .env, *.local)
- Monorepo npm workspaces: `packages/shared`, `packages/client`, `packages/server`
- TypeScript 5 strict; wspólny `tsconfig.base.json`, per-pakiet `tsconfig.json`
- Klient: Vite + Three.js — pusta scena (sześcian + światło) renderuje się na :5173
- Serwer: Node 20+ + `ws` na :3001 — odpowiada `pong` na `ping`
- Klient łączy się z serwerem i wyświetla w rogu „pong (XX ms)"
- Vitest (1 przykładowy test w shared), ESLint + Prettier
- Skrypty npm z CLAUDE.md (`dev`, `dev:client`, `dev:server`, `test`, `typecheck`, `lint`, `build`)
- `assets/LICENSES.md` (pusty szablon), `memory/MEMORY.md` + `memory/README.md` (konwencja zapisu)

Poza zakresem: jakakolwiek fizyka, protokół binarny, Docker.

## Kroki

1. `git init`, struktura katalogów, root `package.json` z workspaces
2. `shared`: `constants.ts` (PHYSICS_HZ=60, SNAPSHOT_HZ=30, INPUT_HZ=60, PORT=3001) + test
3. `server`: minimalny ws serwer z logowaniem pino, handler ping→pong
4. `client`: Vite + Three.js scena, klient WS, licznik RTT
5. ESLint (w tym reguła no-restricted-imports pilnująca warstw shared/client/server), Prettier
6. README.md ze skrótem uruchomienia

## Kryteria ukończenia

- [ ] `npm install && npm run dev` na czystym klonie → scena 3D + „pong (XX ms)" w przeglądarce
- [ ] `npm run typecheck && npm test && npm run lint` — zielone
- [ ] Import z `client` do `server` (testowo) → błąd lintera
- [ ] Pierwszy commit z tagiem `faza-0`

## Pułapki / lekcje z opus4-7

- Dual tsconfig (dla Vite i dla Node) bywa upierdliwy — `shared` eksportuje źródła `.ts`,
  klient buduje przez Vite, serwer uruchamia przez `tsx` w dev (decyzja z fazy 1 opus4-7, sprawdziła się)
- `concurrently -k` do równoległego dev (zabija oba procesy razem)
- Windows: ścieżki w skryptach npm bez backslashy; testować polskie znaki w ścieżce repo

## Wynik (uzupełnić po zakończeniu)

Ukończona 2026-06-10. Wszystkie kryteria spełnione:

- `npm install && npm run dev` → scena 3D (sześcian + światła) na :5173, „pong (XX ms)" w rogu,
  serwer WS na :3001 loguje przez pino; weryfikacja w przeglądarce + log „klient połączony"
- `typecheck` / `test` (3 testy w shared) / `lint` — zielone
- strażnik warstw zweryfikowany: testowy import `@air-combat/server` w kliencie → błąd
  `no-restricted-imports`
- commit + tag `faza-0`

Decyzje techniczne i pułapki: `memory/project_phase0_decisions.md`. Najważniejsze:
`shared` eksportuje źródła .ts (bez builda), serwer buduje esbuild (ws/pino external),
TypeScript przypięty `^5`, ESLint 10 flat config.
