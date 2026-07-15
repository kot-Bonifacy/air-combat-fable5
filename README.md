# air-combat-fable5

Multiplayerowa gra walk powietrznych z okresu Bitwy o Anglię — klient w przeglądarce
(TypeScript + Three.js + Vite), autorytatywny serwer Node.js (WebSocket). Fizyka simcade.

Pełny plan i decyzje: [`PLAN.md`](PLAN.md) · fazy: `docs/phases/` · model lotu: `docs/fizyka-lotu.md`

## Wymagania

- Node.js 20+ (testowane na 24)

## Uruchomienie

```bash
npm install
npm run dev      # klient (Vite, http://localhost:5173) + serwer WS (:3001) równolegle
```

W przeglądarce: scena 3D, a w prawym górnym rogu „pong (XX ms)" — RTT do serwera.

## Pozostałe komendy

```bash
npm run dev:client   # tylko klient
npm run dev:server   # tylko serwer
npm test             # Vitest
npm run typecheck    # tsc --noEmit we wszystkich workspace'ach
npm run lint         # ESLint (pilnuje też granic warstw shared/client/server)
npm run build        # klient → packages/client/dist/, serwer → packages/server/build/
```

## Struktura

Monorepo npm workspaces: `packages/shared` (fizyka, stałe, typy — wspólne dla obu stron),
`packages/client` (renderer Three.js), `packages/server` (autorytatywna symulacja).
Szczegóły konwencji: [`CLAUDE.md`](CLAUDE.md).
