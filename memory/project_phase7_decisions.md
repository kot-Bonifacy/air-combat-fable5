# Faza 7 — decyzje (wczesny deploy: statyczne demo single-player)

Subdomena `dogfight.tatanga.eu`, port **8087**, wzorzec C z bazy VPS. Nazwa gry zostaje
„Air Combat — Bitwa o Anglię". Backend (serwer WS) świadomie POZA fazą — szkielet
zakomentowany w `docker-compose.yml` (usługa `backend`) i `nginx.conf` (`location /ws`),
żeby faza 13 była głównie odkomentowaniem.

## Pułapki napotkane (nieoczywiste z kodu)

- **`npm ci` w alpine zrywa się na `Missing: @emnapi/core@1.11.1 from lock file`.** Lockfile
  generowany na Windowsie nie zawiera natywnych bindingów dla linux-musl (gałąź optional deps
  innej platformy). `npm install --package-lock-only` na Windows tego NIE naprawia (lock „up to
  date" lokalnie). Rozwiązanie: w `Dockerfile.frontend` użyć **`npm install`**, nie `npm ci`
  (wersje wciąż pinuje lock; build i tak na Linuksie). Nie wracać do `npm ci`, póki lock
  powstaje na Windows.
- **`net-status.ts` łączył się ZAWSZE z `ws://localhost:3001`.** W statycznym demie pod `https://`
  to mixed-content (blokada) + wieczne „rozłączono — ponawiam…". Zbramkowane do
  `import.meta.env.DEV`; w prod element ukryty. Sieć (i wskaźnik) wracają w fazie 13.
- **Build context = KORZEŃ repo** (`context: ..` w compose, `dockerfile: deploy/Dockerfile.frontend`),
  bo monorepo workspaces wymaga `shared` + manifestów z korzenia obok `client`. Na VPS musi
  trafić całe repo, nie tylko `deploy/`. `.dockerignore` jako `deploy/Dockerfile.frontend.dockerignore`
  (BuildKit, patterny względem korzenia kontekstu) — trzyma deploy/ samowystarczalnym.
- **Vite root**: `vite build` odpalany z `WORKDIR /app/packages/client`, inaczej dist ląduje
  w /app/dist zamiast packages/client/dist (config używa `__dirname`, ale output liczy się od cwd).
- **Cache-Control × 2**: `expires` + `add_header Cache-Control` dają DWA nagłówki. Zostawiony
  sam `add_header "public, max-age=…, immutable"` (jeden czysty nagłówek).

## Klient — gotowość do produkcji statycznej

- Ekran ładowania inline w `index.html` (widoczny PRZED bundle'em) — chowany po `PlaneModel.ready`
  (nowe pole; promise z `loadSpitfireModel`, domyka się też przy błędzie → bryła zastępcza) albo
  po timeoutcie 8 s. Model glTF to 14 MB, więc bez tego menu pokazywałoby się nad czarną stroną.
- Utrata/brak kontekstu WebGL: `webglcontextlost` (preventDefault → restore możliwy) /
  `webglcontextrestored` + try/catch na `new WebGLRenderer` → komunikat `#webgl-error` zamiast
  białej/zamrożonej strony.
- Overlay „Jak grać" (sterowanie + cel) przy 1. uruchomieniu (flaga `localStorage` z try/catch na
  tryb prywatny), potem pod przyciskiem „Sterowanie". Atrybucja modelu na ekranie startowym i tam.

## Stan domknięcia

Kod + artefakty gotowe, **zbudowane i przetestowane lokalnie w Dockerze** (kontener `dogfight`
serwuje index/bundle/model, MIME JS OK, fallback SPA OK). Zostaje wdrożenie na VPS wg
`deploy/README.md` (DNS → wgranie repo `git archive` → `docker compose up -d --build` → NPM
Proxy Host + SSL) i tag `demo-1` po weryfikacji live. typecheck + 270 testów + lint zielone.
