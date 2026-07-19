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
| `.env.example` | `LOG_LEVEL`, `NODE_ENV`, `DB_LOG_*` (logowanie sesji) — skopiuj do `.env` na VPS |

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

---

## Logowanie sesji graczy do MySQL (kto/kiedy gra → phpMyAdmin :8081)

Backend zapisuje **jeden wiersz na sesję** (wejście gracza do pokoju → wyjście/rozłączenie)
do bazy **MySQL portfolio** `39790326_temp` (kontener `portfolio_db`), tej samej, którą widać
w phpMyAdmin pod `http://tatanga.eu:8081`. Tabela `dogfight_sessions` tworzy się sama przy
pierwszym starcie (`CREATE TABLE IF NOT EXISTS`). Kolumny: `nick`, `ip` (prawdziwe IP klienta),
`room_code`, `mode`, `joined_at`, `left_at`, `duration_s` (czas w Europe/Warsaw).

**Logowanie jest best-effort:** gdy baza jest nieosiągalna albo brak konfiguracji, gra działa
normalnie (serwer tylko ostrzega w logach). Włącza się dopiero po ustawieniu `DB_LOG_PASSWORD`.

### Konfiguracja na VPS (jednorazowo)

1. **Sprawdź nazwę sieci portfolio** (docker-compose zakłada `portfolio_default`):

   ```bash
   docker network ls | grep portfolio        # zwykle: portfolio_default
   ```

   Jeśli nazwa jest inna — popraw `name:` w sekcji `networks` w `docker-compose.yml`.

2. **Uzupełnij `.env`** w `deploy/` (hasło NIE jest w repo — patrz `config.php` portfolio):

   ```bash
   cd /opt/docker-apps/dogfight/deploy
   cat >> .env <<'EOF'
   DB_LOG_HOST=portfolio_db
   DB_LOG_PORT=3306
   DB_LOG_USER=39790326_temp
   DB_LOG_PASSWORD=Mar2chewka1
   DB_LOG_DATABASE=39790326_temp
   EOF
   ```

3. **Przebuduj/uruchom** (backend musi wejść do sieci portfolio):

   ```bash
   docker compose up -d --build
   docker compose logs backend | grep db-log   # ma być: "logowanie sesji do MySQL włączone"
   ```

### Weryfikacja

- Wejdź do gry (`https://dogfight.tatanga.eu`), zagraj chwilę, wyjdź.
- W phpMyAdmin (`http://tatanga.eu:8081`) → baza `39790326_temp` → tabela `dogfight_sessions`:
  ma przybyć wiersz z Twoim nickiem, IP i czasem; po wyjściu — `left_at`/`duration_s` wypełnione.

**Uwaga o IP:** prawdziwe IP działa, bo `nginx.conf` przekazuje `X-Forwarded-For` na `/ws`,
a NPM dokłada IP klienta. Jeśli w `ip` widać adres wewnętrzny Dockera (np. `172.x`), sprawdź,
czy w NPM dla `dogfight.tatanga.eu` nie wyłączono przekazywania nagłówków.

## Częste problemy

| Objaw | Przyczyna / rozwiązanie |
| --- | --- |
| `npm ci`/build zrywa się na optional deps | Dockerfile używa `npm install` (lock z Windows nie ma bindingów linux-musl) — nie przełączaj na `npm ci`. |
| Biała strona, w konsoli MIME error na `.js` | Nie dodawaj bloku `types {}` w `nginx.conf` (nadpisuje MIME). |
| Certyfikat SSL się nie wydaje | DNS jeszcze nie sportagowany — sprawdź `dig`, poczekaj do 1 h. |
| Model się nie ładuje, leci bryła-stożek | `assets/models/spitfire/` nie trafił do kontekstu builda — sprawdź, czy repo wgrane w całości. |
| Gra w spinnerze, `/ws` → 502 | `backend` nie żyje/`unhealthy` — `docker compose logs backend`; frontend czeka na `service_healthy`. |
| WS pada co ~60 s | Websockets Support OFF w NPM albo brak `proxy_read_timeout 86400` (jest w `nginx.conf` od fazy 13). |
