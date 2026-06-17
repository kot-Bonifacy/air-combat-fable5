# Wdrożenie na VPS — krok po kroku (`dogfight.tatanga.eu`)

Instrukcja przeniesienia projektu na VPS Tatanga. **Kroki 0–6** stawiają frontend (jak w
fazie 7). **[Faza 13 — backend multiplayer](#faza-13--backend-multiplayer)** dokłada
autorytatywny serwer WebSocket (pełny multiplayer pod tym samym adresem). Jeśli demo z fazy
7 już działa, przejdź wprost do sekcji Fazy 13 — to aktualizacja, nie wdrożenie od zera.

> Plik `deploy/README.md` to referencja artefaktów (co jest w którym pliku). Ten dokument
> to gotowa procedura do przeklikania od zera do działającego `https://`.

## Parametry (stałe dla tego wdrożenia)

| Co              | Wartość                                                 |
| --------------- | ------------------------------------------------------- |
| VPS IP          | `217.154.210.181`                                       |
| Użytkownik SSH  | `root`                                                  |
| Repozytorium    | `https://github.com/kot-Bonifacy/air-combat-fable5.git` |
| Katalog na VPS  | `/opt/docker-apps/dogfight`                             |
| Subdomena       | `dogfight.tatanga.eu`                                   |
| Port zewnętrzny | `8087`                                                  |
| Panel NPM       | `http://217.154.210.181:81`                             |
| Panel DNS       | home.pl (zarządzanie domeną `tatanga.eu`)               |

## Czego potrzebujesz pod ręką

- Dostęp SSH do VPS-a (`ssh root@217.154.210.181`).
- Login do panelu home.pl (rekordy DNS domeny `tatanga.eu`).
- Login do panelu Nginx Proxy Manager (`http://217.154.210.181:81`).

Docker i Nginx Proxy Manager są już na VPS-ie zainstalowane (inne projekty z nich korzystają).

---

## Krok 0 — sprawdź, czy port 8087 jest wolny

Baza wiedzy mówi, że 8087 jest następny wolny, ale warto potwierdzić. Na VPS-ie:

```bash
ssh root@217.154.210.181
docker ps --format '{{.Names}}\t{{.Ports}}' | grep 8087 || echo "8087 WOLNY"
```

- Jeśli widzisz `8087 WOLNY` — idź dalej.
- Jeśli port zajęty — wybierz inny wolny (np. 8088) i podmień go później w dwóch miejscach:
  w `deploy/docker-compose.yml` (`"8087:80"` → `"8088:80"`) oraz w NPM (krok 5, „Forward Port").

---

## Krok 1 — DNS w home.pl (rób NAJPIERW, propagacja trwa)

W panelu home.pl, w rekordach DNS domeny `tatanga.eu`, dodaj rekord **A**:

| Pole               | Wartość           |
| ------------------ | ----------------- |
| Typ                | `A`               |
| Nazwa / subdomena  | `dogfight`        |
| Wartość / adres IP | `217.154.210.181` |
| TTL                | domyślny          |

Propagacja trwa do ~1 h. Sprawdzaj, aż adres zacznie się zwracać (z dowolnego komputera):

```bash
nslookup dogfight.tatanga.eu
# lub na VPS:
dig +short dogfight.tatanga.eu     # ma zwrócić 217.154.210.181
```

> SSL (krok 5) ruszy dopiero, gdy DNS się sportaguje. Build i uruchomienie (kroki 2–4)
> możesz robić równolegle, czekając na propagację.

---

## Krok 2 — pobierz projekt na VPS (git clone)

Zaloguj się na VPS i sklonuj repozytorium do docelowego katalogu:

```bash
ssh root@217.154.210.181
cd /opt/docker-apps
git clone https://github.com/kot-Bonifacy/air-combat-fable5.git dogfight
cd dogfight
```

Sprawdź, że masz pliki deploy:

```bash
ls deploy/
# m.in.: Dockerfile.frontend  Dockerfile.backend  docker-compose.yml  nginx.conf
#        .env.example  README.md  WDROZENIE-NA-VPS.md
```

---

## Krok 3 — zbuduj i uruchom kontener

Build odpala się z katalogu `deploy/` (kontekst budowy to korzeń repo — tak ustawia
`docker-compose.yml`). Pierwszy build trwa kilka minut (instalacja zależności + `vite build`):

```bash
cd /opt/docker-apps/dogfight/deploy
docker compose up -d --build
```

Po zakończeniu sprawdź status — kontener `dogfight` ma być `Up`, z portem `0.0.0.0:8087->80`:

```bash
docker compose ps
```

Podejrzyj logi (Ctrl+C kończy podgląd):

```bash
docker compose logs -f
```

---

## Krok 4 — szybki test HTTP z samego VPS-a

Zanim podłączysz NPM i SSL, sprawdź, że nginx w kontenerze odpowiada:

```bash
curl -I http://localhost:8087/
# oczekiwane: HTTP/1.1 200 OK, Content-Type: text/html
```

Jeśli `200 OK` — frontend działa lokalnie. Zostaje wystawić go na świat przez NPM.

---

## Krok 5 — Nginx Proxy Manager + SSL

Wejdź do panelu `http://217.154.210.181:81` → **Proxy Hosts** → **Add Proxy Host**.

Zakładka **Details**:

| Pole                  | Wartość                                                       |
| --------------------- | ------------------------------------------------------------- |
| Domain Names          | `dogfight.tatanga.eu`                                         |
| Scheme                | `http`                                                        |
| Forward Hostname / IP | `217.154.210.181`                                             |
| Forward Port          | `8087`                                                        |
| Cache Assets          | (opcjonalnie)                                                 |
| Websockets Support    | **ON** ← włącz od razu (w fazie 13 dojdzie backend WebSocket) |
| Block Common Exploits | (opcjonalnie)                                                 |

Zakładka **SSL**:

| Pole                           | Wartość                           |
| ------------------------------ | --------------------------------- |
| SSL Certificate                | **Request a new SSL Certificate** |
| Force SSL                      | **ON**                            |
| HTTP/2 Support                 | ON (opcjonalnie)                  |
| Zgoda na warunki Let's Encrypt | zaznacz                           |

Kliknij **Save**.

> Jeśli wydanie certyfikatu się nie powiedzie — najczęściej DNS jeszcze nie sportagowany.
> Sprawdź `dig +short dogfight.tatanga.eu`, odczekaj i spróbuj ponownie (Edit hosta → SSL).

---

## Krok 6 — weryfikacja końcowa

Otwórz w przeglądarce **`https://dogfight.tatanga.eu`** i sprawdź:

- [x] strona ładuje się z ważnym certyfikatem (kłódka, bez ostrzeżeń),
- [x] pojawia się ekran ładowania → ekran „Jak grać" (sterowanie) → menu,
- [x] da się rozpocząć mecz i strzelać,
- [x] w konsoli (F12 → Console) brak błędów; brak prób łączenia z `ws://`,
- [x] przetestuj na 2-3 przeglądarkach (Chrome, Firefox, Edge).

Jeśli wszystko gra — demo jest publiczne. 🎉

---

## Faza 13 — backend multiplayer

Faza 13 dokłada drugą usługę (`backend` = serwer WebSocket) do tego samego stacku. Klient
łączy się z `wss://dogfight.tatanga.eu/ws`; ruch idzie: przeglądarka → NPM (SSL, Websockets
ON) → frontend:8087 → nginx `location /ws` → `backend:3001` (sieć dockera). Backend NIE jest
wystawiony na zewnątrz.

**Wymagania wstępne (już spełnione od fazy 7):** w NPM dla hosta `dogfight.tatanga.eu`
**Websockets Support = ON** (krok 5). Zweryfikuj — bez tego handshake WS nie przejdzie.

### 13.1 — pobierz kod fazy 13 i utwórz `.env`

```bash
cd /opt/docker-apps/dogfight
git pull origin master                 # commit/tag fazy 13 (mp-1)
cp -n deploy/.env.example deploy/.env   # -n: nie nadpisuj, jeśli już masz
cat deploy/.env                         # LOG_LEVEL=info, NODE_ENV=production
```

### 13.2 — przebuduj i uruchom oba serwisy

```bash
cd /opt/docker-apps/dogfight/deploy
docker compose up -d --build
```

Pierwszy build backendu to kolejne kilka minut (osobny obraz). Sprawdź, że **oba** kontenery
stoją, a backend jest `healthy`:

```bash
docker compose ps
# dogfight          ... Up                 0.0.0.0:8087->80/tcp
# dogfight-backend  ... Up (healthy)       3001/tcp        ← BEZ mapowania na zewnątrz
```

Jeśli `dogfight-backend` jest `unhealthy` lub frontend nie wstał (`depends_on` czeka na
zdrowie backendu) — patrz logi:

```bash
docker compose logs backend | tail -n 40   # ma być „serwer gry nasłuchuje ... port 3001"
```

### 13.3 — test healthchecku i WS z VPS-a

```bash
# health backendu z sieci dockera (z wnętrza kontenera frontu):
docker compose exec frontend wget -qO- http://backend:3001/health   # → ok

# że nginx proxuje /ws (101 = upgrade albo 426/400 bez nagłówków — byle nie 502):
curl -i http://localhost:8087/ws            # 502 = backend nie żyje; inne = proxy działa
```

### 13.4 — smoke test produkcji (kryterium fazy)

Z **dwóch różnych komputerów/sieci** otwórz `https://dogfight.tatanga.eu`:

- [x] wpisz nick → **Utwórz pokój** (np. 2 boty, „Mecz do 5"), drugi gracz → **Dołącz** kodem,
- [x] host klika **Start meczu**; obaj latają, strzelają, trafienia są spójne („co widzę, to trafiam"),
- [x] **Tab** pokazuje tabelę wyników (zestrzelenia / śmierci / asysty / ping; boty na liście),
- [x] mecz kończy się po 5 zestrzeleniach → **ekran wyników** → host **Rewanż** → nowy mecz,
- [x] w konsoli (F12) brak błędów; połączenie idzie do `wss://…/ws` (zakładka Network → WS),
- [x] respawn nie pod lufą wroga (ochrona 3 s + spawn z dala).

### 13.5 — pomiar zasobów (kryterium fazy → memory)

Przy pełnym pokoju (np. 2 ludzi + 6 botów w trakcie meczu) zmierz zużycie backendu:

```bash
docker stats --no-stream dogfight-backend
# zapisz CPU % i MEM USAGE / LIMIT (limit = 256 MiB) — trafia do memory fazy 13
```

Wartości przekaż do zapisania w `memory/` (decyzja o interest management — PLAN.md, otwarte
decyzje). Spodziewane: ułamek rdzenia i kilkadziesiąt MB (benchmark dev: 1+7 botów ≈ 0,3 ms/tick).

### 13.6 — graceful shutdown / restart

```bash
docker compose restart backend     # SIGTERM → gracze dostają komunikat „Serwer restartowany",
                                   #            log meczu trafia do konsoli, potem zamknięcie
docker compose logs backend | tail # zobacz wpis „log meczu przy zamknięciu serwera"
```

Po restarcie pokoje są bezstanowe (brak DB) — gracze odświeżają i tworzą je na nowo. Klient
po restarcie pokazuje komunikat, **nie** wieczny spinner.

> **Uwaga (502 po restarcie samego backendu):** nginx frontendu rozwiązuje `backend` raz, przy
> starcie. Jeśli backend dostanie nowy adres w sieci dockera (po `restart`/odtworzeniu), front
> może trzymać stary IP → `502` na `/ws`. Wtedy zrestartuj też frontend: `docker compose restart`
> (oba) albo `docker compose up -d`.

---

## Aktualizacja po zmianach w kodzie

Gdy wypchniesz nowe commity na GitHub, na VPS-ie:

```bash
cd /opt/docker-apps/dogfight
git pull origin master
cd deploy
docker compose up -d --build
```

NPM i certyfikat zostają bez zmian. `docker compose up -d --build` przebudowuje oba serwisy
(frontend + backend) i podmienia tylko te, których obraz się zmienił.

---

## Zatrzymanie / restart / sprzątanie

```bash
cd /opt/docker-apps/dogfight/deploy

docker compose restart        # restart bez przebudowy
docker compose down           # zatrzymaj i usuń kontener (dane = brak, gra jest bezstanowa)
docker compose up -d          # ponowny start z istniejącego obrazu
docker compose up -d --build  # przebuduj i wystartuj
```

---

## Najczęstsze problemy

| Objaw                                       | Przyczyna / rozwiązanie                                                                                                       |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Build zrywa się na `npm ci` / `@emnapi/...` | Dockerfile celowo używa `npm install` (lock z Windows nie ma bindingów linux-musl). Nie przełączaj na `npm ci`.               |
| `curl localhost:8087` → connection refused  | Kontener nie wstał — `docker compose ps` i `docker compose logs`.                                                             |
| Biała strona, w konsoli błąd MIME na `.js`  | Nie dodawaj bloku `types {}` w `nginx.conf` (nadpisuje MIME).                                                                 |
| Certyfikat SSL się nie wydaje               | DNS niesportagowany — `dig +short dogfight.tatanga.eu`, poczekaj do 1 h.                                                      |
| `502 Bad Gateway` w przeglądarce            | Zły port/host w NPM albo kontener nie działa — sprawdź Forward Port `8087` i `docker compose ps`.                             |
| WS nie łączy się (`/ws` 502, gra w spinnerze) | `dogfight-backend` nie żyje/`unhealthy` — `docker compose logs backend`. Frontend ma `depends_on: service_healthy`.          |
| WS pada zaraz po połączeniu / co 60 s        | Websockets Support w NPM = OFF (włącz) albo brak `proxy_read_timeout 86400` w nginx.conf (jest od fazy 13).                  |
| `dogfight-backend` ciągle `unhealthy`        | Healthcheck (`wget /health`) nie przechodzi — sprawdź logi backendu; port 3001 wewnątrz kontenera.                          |
| Klient łączy się z `ws://…:3001` (nie `/ws`) | Stary build klienta — przebuduj frontend (`defaultServerUrl` używa `/ws` na https od fazy 13).                              |
| Model się nie ładuje, leci bryła-stożek     | `assets/models/spitfire/` nie trafił do builda — upewnij się, że `git clone` pobrał całe repo (`ls assets/models/spitfire/`). |
| Strona pokazuje starą wersję po update      | Twardy refresh w przeglądarce (Ctrl+Shift+R) — bundle Vite ma hash, ale `index.html` bywa cache'owany.                        |
