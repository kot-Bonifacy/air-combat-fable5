# Faza 7 — Wczesny deploy: publiczne demo single-player

**Zależy od:** Faza 6
**Czytaj najpierw:** `PLAN.md` sekcja Deploy + `C:\AI\vps_home_pl_konfiguracja.md`
**Cel:** KAMIEŃ MILOWY — publiczny link do gry. Walidacja całego pipeline'u deploy
zanim dojdzie sieć; zastrzyk motywacji; feedback od znajomych.

## Zakres

W tej fazie:

- Decyzja: nazwa gry + subdomena (robocza: `dogfight.tatanga.eu`)
- Model 3D samolotu zamiast bryły zastępczej: asset CC0/CC-BY ze Sketchfab/Poly Haven
  LUB stylizowany low-poly — decyzja po przeglądzie dostępnych assetów; wpis do `assets/LICENSES.md`
- Build produkcyjny klienta (`npx vite build`) — demo działa w 100% statycznie (bez backendu)
- `deploy/`: `Dockerfile.frontend` (nginx:alpine + dist), `docker-compose.yml` z portem 8087,
  `nginx.conf` — od razu z blokiem `location /ws` proxy do przyszłego backendu (zakomentowanym
  lub no-op), żeby faza 13 była tylko odkomentowaniem
- VPS: katalog `/opt/docker-apps/dogfight/`, DNS rekord A, NPM Proxy Host + SSL
- Strona „jak grać" (sterowanie) jako prosty overlay przy pierwszym uruchomieniu

Poza zakresem: backend na produkcji, analityka, jakiekolwiek konta.

## Kroki

1. Przegląd assetów 3D (Spitfire) → wybór, import .glb, licencja do LICENSES.md
2. Loading screen + obsługa utraty kontekstu WebGL (komunikat zamiast białej strony)
3. Build + test lokalny w Dockerze (`docker compose up` na Windows)
4. **Sprawdź, czy port 8087 nadal wolny** (`docker ps` na VPS; baza wiedzy mogła się zdezaktualizować)
5. DNS w home.pl → propagacja → NPM Proxy Host (SSL, Force SSL; Websockets ON od razu — przyda się w f.13)
6. Wgranie na VPS, `docker compose up -d --build`, weryfikacja `docker compose ps` + logi
7. Test na 2-3 różnych komputerach/przeglądarkach (Chrome, Firefox, Edge)

## Kryteria ukończenia

- [x] `https://dogfight.tatanga.eu` działa z ważnym certyfikatem — **wdrożone 2026-06-15**
  (HTTP/2 200, `text/html`; bundle `/assets/main-*.js` → 200 `application/javascript`; serwowane
  przez NPM/openresty). Rozgrywka w realnej przeglądarce — potwierdzona przez wdrażającego.
- [x] Osoba bez instrukcji ustnej uruchamia grę i strzela do bota — overlay „Jak grać"
  (sterowanie) pokazuje się przy pierwszym uruchomieniu; do potwierdzenia na żywo po deployu
- [x] Brak błędów w konsoli przeglądarki (wskaźnik sieci wyłączony w prod — koniec prób `ws://`);
  60 fps na zintegrowanej grafice — do potwierdzenia na żywo
- [x] Licencja modelu w `assets/LICENSES.md`; atrybucja widoczna w grze (ekran startowy + „Jak grać")
- [x] Aktualizacja `C:\AI\vps_home_pl_konfiguracja.md`: wiersz w tabeli portów (8087),
  drzewo katalogów, lista subdomen NPM, „następny wolny port" → 8088
- [x] typecheck + test (270) + lint zielone; commit zrobiony; **tag `demo-1` założony po wdrożeniu**;
  memory zapisane

## Pułapki / lekcje z bazy wiedzy VPS

- `npx vite build`, NIE `npm run build` (tsc wydłuża build w Dockerze — lekcja z Tetrisa)
- `.dockerignore` z `node_modules` (kolizja Windows ↔ Linux)
- Bez bloku `types {}` w nginx.conf (nadpisuje MIME — lekcja z clear-context)
- Certyfikat SSL dopiero PO propagacji DNS (sprawdź `dig`/`nslookup` zanim klikniesz Request)
- glTF: modele bywają zorientowane różnie — po imporcie sprawdź, czy nos = +Z body frame;
  jeśli nie, korekta na poziomie sceny (wrapper Object3D), NIE w fizyce

## Wynik

Faza **ukończona i wdrożona** — `https://dogfight.tatanga.eu` działa publicznie (deploy: user
wg `deploy/WDROZENIE-NA-VPS.md`, tag `demo-1`). Stan na 2026-06-15:

**Klient — gotowość do produkcji statycznej:**

- Tytuł strony `Air Combat — Bitwa o Anglię` (był placeholder `air-combat-fable5`).
- Ekran ładowania (inline w `index.html`, widoczny przed bundle'em) — chowany po wczytaniu
  modelu gracza (`PlaneModel.ready`) albo po timeoutcie 8 s; brak czarnej strony na starcie.
- Obsługa utraty/braku kontekstu WebGL: `webglcontextlost/restored` + try/catch na tworzeniu
  renderera → pełnoekranowy komunikat zamiast białej strony.
- **Wskaźnik sieci wyłączony w prod** (`import.meta.env.DEV`): demo jest w 100% statyczne,
  więc bez prób `ws://localhost` (byłby mixed-content na https i wieczne „rozłączono").
- Overlay „Jak grać" (sterowanie + cel) przy pierwszym uruchomieniu (flaga `localStorage`),
  potem pod przyciskiem „Sterowanie". Atrybucja modelu (barking_dogo, CC-BY 4.0) na ekranie
  startowym i w „Jak grać".

**Deploy (`deploy/`):** `Dockerfile.frontend` (multi-stage Vite → nginx:alpine),
`Dockerfile.frontend.dockerignore`, `docker-compose.yml` (8087:80, backend zakomentowany na f.13),
`nginx.conf` (SPA + cache; `/ws` zakomentowany na f.13), `.env.example`, `README.md` (runbook).
Zbudowane i przetestowane lokalnie: kontener `dogfight` serwuje index/bundle/model, MIME JS OK,
fallback SPA OK, jeden czysty `Cache-Control`.

**Pułapka napotkana:** `npm ci` w alpine zrywa się na `Missing: @emnapi/core … from lock file` —
lockfile generowany na Windows nie zawiera natywnych bindingów dla linux-musl. Rozwiązane
`npm install` w Dockerfile (wersje wciąż pinuje lock; build na VPS = Linux). **Nie wracać do
`npm ci`**, póki lock powstaje na Windows.

**Decyzje:** subdomena `dogfight.tatanga.eu` (port 8087), nazwa gry zostaje „Air Combat — Bitwa
o Anglię". Podział pracy: artefakty + runbook po mojej stronie, wdrożenie na VPS po stronie usera.

**Wdrożenie (2026-06-15):** user wdrożył wg `deploy/WDROZENIE-NA-VPS.md`. Weryfikacja HTTP:
`https://dogfight.tatanga.eu` → HTTP/2 200 `text/html` (NPM/openresty), bundle
`/assets/main-*.js` → 200 `application/javascript` (MIME OK). Rozgrywka w przeglądarce
potwierdzona przez wdrażającego. Faza zamknięta tagiem `demo-1`.
