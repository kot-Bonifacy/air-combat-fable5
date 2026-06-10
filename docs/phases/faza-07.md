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

- [ ] `https://dogfight.tatanga.eu` (lub wybrana subdomena) działa z ważnym certyfikatem
- [ ] Osoba bez instrukcji ustnej uruchamia grę i strzela do bota (overlay sterowania wystarcza)
- [ ] 60 fps na laptopie ze zintegrowaną grafiką; brak błędów w konsoli przeglądarki
- [ ] Licencja modelu w `assets/LICENSES.md`; atrybucja widoczna w grze (ekran startowy)
- [ ] Aktualizacja `C:\AI\vps_home_pl_konfiguracja.md`: nowy wiersz w tabeli portów (8087)
  i drzewie katalogów
- [ ] typecheck + test + lint zielone; commit + tag `demo-1`; memory zapisane

## Pułapki / lekcje z bazy wiedzy VPS

- `npx vite build`, NIE `npm run build` (tsc wydłuża build w Dockerze — lekcja z Tetrisa)
- `.dockerignore` z `node_modules` (kolizja Windows ↔ Linux)
- Bez bloku `types {}` w nginx.conf (nadpisuje MIME — lekcja z clear-context)
- Certyfikat SSL dopiero PO propagacji DNS (sprawdź `dig`/`nslookup` zanim klikniesz Request)
- glTF: modele bywają zorientowane różnie — po imporcie sprawdź, czy nos = +Z body frame;
  jeśli nie, korekta na poziomie sceny (wrapper Object3D), NIE w fizyce

## Wynik (uzupełnić po zakończeniu)

—
