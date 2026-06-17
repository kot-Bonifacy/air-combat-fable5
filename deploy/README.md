# Deploy — `dogfight.tatanga.eu` (Faza 13: pełny multiplayer)

Frontend (statyczne SPA) + backend (autorytatywny serwer WS) w Dockerze, wzorzec **C** z
`C:\AI\vps_home_pl_konfiguracja.md`. Port zewnętrzny **8087** (tylko frontend); backend jest
wewnętrzny, nginx proxuje do niego `/ws`. Procedura krok-po-kroku: **`WDROZENIE-NA-VPS.md`**
(sekcja „Faza 13 — backend multiplayer"). Ten plik to referencja artefaktów.

## Pliki

| Plik | Rola |
| --- | --- |
| `Dockerfile.frontend` | multi-stage: `node:20-alpine` buduje klienta (Vite) → `nginx:alpine` serwuje `dist/` |
| `Dockerfile.frontend.dockerignore` | wyklucza `node_modules`/`dist`/`.git` z kontekstu builda |
| `Dockerfile.backend` | multi-stage: esbuild bundluje serwer (z `shared`) → cienki `node:20-alpine` (ws+pino) |
| `Dockerfile.backend.dockerignore` | jak wyżej + pomija `assets/` (backend ich nie buduje) |
| `docker-compose.yml` | `frontend` (8087:80) + `backend` (wewn. 3001, `mem_limit`/`cpus`/healthcheck) |
| `nginx.conf` | SPA + cache assetów + `location /ws` → `backend:3001` (`proxy_read_timeout 86400`) |
| `.env.example` | `LOG_LEVEL`, `NODE_ENV` (skopiuj do `.env` na VPS) |

**Build context = korzeń repo** (`context: ..`), bo monorepo workspaces wymaga `shared` + manifestów z korzenia. Dlatego na VPS musi wylądować **całe repo**, nie tylko `deploy/`.

Architektura ruchu: przeglądarka → NPM (SSL, Websockets ON) → `frontend:8087` →
nginx `/ws` → `backend:3001`. Klient buduje URL jako `wss://<host>/ws` na produkcji
(`net-client.ts` `defaultServerUrl`), `ws://<host>:3001` w dev.

---

## Runbook (kolejność ma znaczenie)

### 0. Pre-flight — czy port 8087 nadal wolny

Baza wiedzy VPS mogła się zdezaktualizować. Na VPS:

```bash
docker ps --format '{{.Names}}\t{{.Ports}}' | grep 8087 || echo "8087 WOLNY"
```

Jeśli zajęty — wybierz kolejny wolny port i podmień go w `docker-compose.yml` (`"<port>:80"`) oraz w NPM (krok 4).

### 1. DNS (panel home.pl)

Dodaj rekord **A**: `dogfight.tatanga.eu` → `217.154.210.181`. Propagacja do ~1 h.
Zanim przejdziesz do SSL (krok 4), sprawdź propagację:

```bash
dig +short dogfight.tatanga.eu     # ma zwrócić 217.154.210.181
```

### 2. Wgranie repo na VPS

Najprościej — `git archive` (wysyła tylko zacommitowane pliki, bez `node_modules`).
Z katalogu repo na Windowsie (Git Bash):

```bash
ssh root@217.154.210.181 "mkdir -p /opt/docker-apps/dogfight"
git archive --format=tar HEAD | ssh root@217.154.210.181 "tar -x -C /opt/docker-apps/dogfight"
```

Alternatywa (rsync, wysyła też niezacommitowane zmiany):

```bash
rsync -avz --delete --exclude node_modules --exclude .git --exclude 'packages/*/dist' \
  ./ root@217.154.210.181:/opt/docker-apps/dogfight/
```

### 3. Build i uruchomienie (na VPS)

```bash
cd /opt/docker-apps/dogfight/deploy
docker compose up -d --build
docker compose ps          # frontend ma być "Up", port 0.0.0.0:8087->80
docker compose logs -f      # Ctrl+C po weryfikacji
```

Szybki test HTTP z samego VPS-a (zanim podłączysz NPM/SSL):

```bash
curl -I http://localhost:8087/        # HTTP 200, text/html
```

### 4. Nginx Proxy Manager (`http://217.154.210.181:81`)

Proxy Hosts → Add Proxy Host:

| Pole | Wartość |
| --- | --- |
| Domain Names | `dogfight.tatanga.eu` |
| Scheme | `http` |
| Forward Hostname / IP | `217.154.210.181` |
| Forward Port | `8087` |
| Websockets Support | **ON** (niepotrzebne w fazie 7, ale włącz od razu — w fazie 13 dojdzie `/ws`) |
| SSL (zakładka SSL) | Request a new SSL Certificate + **Force SSL** |

SSL klikaj **dopiero po** propagacji DNS (krok 1), inaczej Let's Encrypt odmówi.

### 5. Weryfikacja końcowa

- `https://dogfight.tatanga.eu` ładuje się z ważnym certyfikatem (kłódka).
- Ekran ładowania → ekran „Jak grać" (sterowanie) → menu → mecz; da się strzelać do bota.
- Konsola przeglądarki (F12) bez błędów; brak prób łączenia z `ws://` (sieć wyłączona w prod).
- Sprawdź na 2-3 przeglądarkach (Chrome, Firefox, Edge).

---

## Aktualizacja po zmianach w kodzie

```bash
# ponów krok 2 (git archive / rsync), potem:
cd /opt/docker-apps/dogfight/deploy
docker compose up -d --build
```

## Częste problemy

| Objaw | Przyczyna / rozwiązanie |
| --- | --- |
| `npm ci`/build zrywa się na optional deps | Dockerfile używa `npm install` (lock z Windows nie ma bindingów linux-musl) — nie przełączaj na `npm ci`. |
| Biała strona, w konsoli MIME error na `.js` | Nie dodawaj bloku `types {}` w `nginx.conf` (nadpisuje MIME). |
| Certyfikat SSL się nie wydaje | DNS jeszcze nie sportagowany — sprawdź `dig`, poczekaj do 1 h. |
| Model się nie ładuje, leci bryła-stożek | `assets/models/spitfire/` nie trafił do kontekstu builda — sprawdź, czy repo wgrane w całości. |
| Gra w spinnerze, `/ws` → 502 | `backend` nie żyje/`unhealthy` — `docker compose logs backend`; frontend czeka na `service_healthy`. |
| WS pada co ~60 s | Websockets Support OFF w NPM albo brak `proxy_read_timeout 86400` (jest w `nginx.conf` od fazy 13). |
