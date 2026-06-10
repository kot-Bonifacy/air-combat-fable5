# Faza 0 — decyzje i pułapki (2026-06-10)

## Decyzje nieoczywiste z kodu

- **`shared` nie ma builda** — `exports` w package.json wskazuje surowe `./src/index.ts`.
  Vite, tsx i esbuild konsumują źródła .ts bezpośrednio; importy bez rozszerzeń
  (`moduleResolution: "Bundler"`). To realizacja lekcji „dual tsconfig bywa upierdliwy" z opus4-7.
- **Build serwera = esbuild bundle** (nie tsc): bundluje `shared` do jednego pliku,
  ale `ws` i `pino` zostają external — pino bundlowane do ESM psuje się (worker threads/transports).
- **TypeScript przypięty `^5`** — npm domyślnie ciągnął 6.x, a stack w CLAUDE.md mówi TS 5.
  Przy aktualizacjach nie podbijać bez decyzji.
- **ESLint 10 + typescript-eslint 8.61 + flat config działają razem** (mimo że ts-eslint 8.x
  powstał pod ESLint 9). Strażnik warstw = `no-restricted-imports` z patterns per `files`
  w eslint.config.js — zweryfikowany testowym zakazanym importem.
- **Vitest bez configu** — odpala się z roota i sam znajduje `packages/**/*.test.ts`.

## Pułapki

- Polskie znaki w ścieżce repo (`C:\AI\pozostałe\...`) — żaden tool (Vite/tsx/esbuild/vitest) nie miał problemu.
- Logi pino w konsoli Windows wyglądają na krzaczki (cp1250 vs UTF-8) — kosmetyka, nie bug;
  ewentualnie `pino-pretty` w przyszłości.
- ESLint 10 wymaga flat config (`eslint.config.js`) — `.eslintrc.*` już nie działa.

## Celowo odłożone

- `pino-pretty` dla czytelnych logów dev.
- Code-splitting klienta (warning Vite o chunku >500 kB przez three) — bez znaczenia do fazy 7 (deploy).
