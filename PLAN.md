# PLAN — air-combat-fable5

Multiplayerowa gra walk powietrznych z okresu wczesnej II wojny światowej (Bitwa o Anglię).
Klient w przeglądarce (Windows 11 = dowolna nowoczesna przeglądarka), serwer autorytatywny
w Dockerze na VPS Tatanga. 2–8 graczy + boty. Fizyka simcade (wzorzec: War Thunder),
budowana metodą vibecodingu — jedna faza na sesję, każda faza w osobnym pliku
`docs/phases/faza-NN.md`.

**Priorytet nr 1 projektu: fizyka lotu, która daje się stroić i debugować.**
Szczegółowy projekt modelu lotu: `docs/fizyka-lotu.md` — to dokument nadrzędny dla faz 1–3.

---

## Lekcje z poprzednich podejść (dlaczego ten plan wygląda tak, a nie inaczej)

Obok tego projektu leżą 4 wcześniejsze podejścia. Najdalej zaszedł `air-combat-opus4-7`
(monorepo TS, ukończone fazy 0–5 z 18). Wnioski, które kształtują ten plan:

| Lekcja z opus4-7 | Odpowiedź w tym projekcie |
|---|---|
| Pełny momentowy model 6DoF (tabele Cl/Cd/Cm + momenty + tłumienia) przeszedł testy, ale strojenie czucia lotu było walką z układem sprzężonych współczynników „dobieranych na oko" | Model hybrydowy: **siły fizyczne + rotacja kinematyczna z kopertą osiągów**. Parametry strojenia = bezpośrednio odczuwalne wielkości (roll rate, limit G, czas zakrętu). Szczegóły: `docs/fizyka-lotu.md` |
| Własna biblioteka matematyczna + niestandardowa konwencja osi = godziny debugowania kwaternionów i układów odniesienia | **Zakaz własnego matha** — wyłącznie `three` (Vector3/Quaternion), działa też w Node. Jedna konwencja osi (glTF: +Z nos, +Y góra) z helperami `getForward/getUp/getRight` i testami |
| Brak narzędzi obserwowalności — błąd w siłach widoczny dopiero jako „dziwne latanie" | Narzędzia obowiązkowe i WCZESNE: strzałki sił 3D, telemetria, rejestrator lotu + wykresy, strażnik NaN, panel strojenia na żywo (fazy 1–3, nie „kiedyś") |
| Projekt umarł na fazie 6 (teren: LOD, splatting, chmury) — zanim cokolwiek było grywalne (grywalność planowana na fazę 10) | **Grywalny dogfight z botem w fazie 6, publiczne demo w fazie 7.** Teren minimalny (ocean + wyspa) w fazie 4; ładny teren dopiero w fazie 15, z twardym timeboxem |
| RK4 + 120 Hz — moc obliczeniowa i złożoność bez zysku dla simcade | Semi-implicit Euler @ 60 Hz, stały krok. Prostszy do debugowania, standard w grach |
| Wymóg bitowego determinizmu klient↔serwer — kruchy i niepotrzebny | Determinizmu NIE wymagamy. Serwer jest autorytetem, prediction+reconciliation koryguje dryf |
| Dobre wzorce, które przejmujemy | Monorepo `shared/client/server`, binarny protokół WS, autorytatywny serwer, tick rates rozdzielone, deploy wzorzec C z VPS, dyscyplina dokumentacji (CLAUDE.md + fazy + memory) |

Kod referencyjny (do podglądania, nie kopiowania bez zrozumienia):
`C:\AI\pozostałe\gry\symulator\air-combat-opus4-7\` — szczególnie `memory/project_phase*_decisions.md`.

---

## Decyzje techniczne

| Obszar | Decyzja | Uzasadnienie |
|---|---|---|
| Klient | TypeScript 5 + Three.js + Vite | Zero instalacji dla graczy, najszybsza pętla iteracji w vibecodingu |
| Serwer | Node.js 20+ + TypeScript + `ws` | Współdzielony kod fizyki, pasuje do infry VPS (wzorzec C) |
| Architektura | Monorepo npm workspaces: `shared` / `client` / `server` | Jedna fizyka po obu stronach, zero duplikacji stałych |
| Matematyka | `three` (Vector3, Quaternion, Matrix4) także w `shared` i na serwerze | Sprawdzona w boju biblioteka zamiast własnych bugów |
| Fizyka | Hybryda simcade: siły 3DoF + rotacja kinematyczna z kopertą; 60 Hz semi-implicit Euler | Patrz `docs/fizyka-lotu.md` |
| Parametry samolotów | Pliki JSON w `shared/planes/` + schema | Strojenie bez rekompilacji, presety, diff-owalne |
| Multiplayer | Autorytatywny serwer, client prediction + reconciliation, snapshot interpolation, lag compensation | Standard dla fizyki ciągłej |
| Tick rates | Fizyka 60 Hz, snapshot 30 Hz, input 60 Hz | Wystarczające dla simcade; tanie dla współdzielonego VPS |
| Protokół | WebSocket binarny (DataView); JSON tylko w lobby/handshake | <100 KB/s na klienta przy 8 graczach |
| Sterowanie | Mysz (mouse-aim + instruktor) + klawiatura | Wzorzec WT; gamepad/HOTAS w backlogu |
| Kamera | 3rd person chase | Brak kokpitów w MVP |
| Boty | FSM sterujące przez instruktora (jak gracz) | Bot automatycznie respektuje kopertę — nie umie „oszukać" fizyki |
| Uszkodzenia | Globalne HP w MVP; modułowe w fazie 17 | Najpierw fundament |
| Świat | Arena 20×20 km: ocean + wyspa, start w powietrzu | Minimalny koszt, maksimum grywalności |
| Konta | Stateless: nick + pokój. Brak DB | Prostota; konta w backlogu |
| Samoloty | MVP: Spitfire Mk I; faza 14: Bf 109 E | Klasyczny matchup turn-fighter vs energy-fighter |
| Assety 3D | Sketchfab / Poly Haven, CC0/CC-BY z atrybucją w `assets/LICENSES.md` | Twardy niezmiennik z CLAUDE.md |
| Deploy | Docker, wzorzec C; port **8087**; subdomena **dogfight.tatanga.eu** (do potwierdzenia) | Zgodnie z `C:\AI\vps_home_pl_konfiguracja.md` |
| Repo | `git init` w fazie 0, commit po każdej fazie | Historia faz = punkty powrotu |

---

## Świadome non-goals (MVP)

- Brak kont, logowania, statystyk, DB
- Brak kokpitu 1st person, brak startu/lądowania (spawn w powietrzu)
- Brak pogody, wiatru, chmur wolumetrycznych
- Brak anti-cheata po stronie klienta (walidacja tylko serwerowa, hobby community)
- Brak gamepada/HOTAS, brak voice chatu, brak monetyzacji
- Brak streamingu mapy — stała arena 20×20 km
- Dźwięk dopiero w fazie 16 (świadomie późno — nie blokuje grywalności)

---

## Mapa faz

Każda faza = osobny plik, osobna sesja vibecodingu, mierzalne kryterium ukończenia.

| # | Plik | Nazwa | Kamień milowy |
|---|---|---|---|
| 0 | `docs/phases/faza-00.md` | Bootstrap: monorepo + hello WebSocket | szkielet działa |
| 1 | `docs/phases/faza-01.md` | Fundament fizyki + obserwowalność | spadający sześcian, strzałki sił, złote testy |
| 2 | `docs/phases/faza-02.md` | Model lotu cz.1 — siły | samolot lata; metryki: V_max, V_stall, trym |
| 3 | `docs/phases/faza-03.md` | Model lotu cz.2 — koperta, instruktor, strojenie | **„5 minut przyjemnego latania"** |
| 4 | `docs/phases/faza-04.md` | Świat minimalny: ocean + wyspa + kolizje | crash = wybuch + respawn |
| 5 | `docs/phases/faza-05.md` | Uzbrojenie, balistyka, HP | zestrzelenie celu |
| 6 | `docs/phases/faza-06.md` | Bot AI (FSM przez instruktora) | **pierwszy grywalny dogfight (offline)** |
| 7 | `docs/phases/faza-07.md` | Wczesny deploy: demo single-player na VPS | **publiczny link dla znajomych** |
| 8 | `docs/phases/faza-08.md` | Multiplayer cz.1: protokół binarny + serwer autorytatywny | 1 klient lata „przez serwer" |
| 9 | `docs/phases/faza-09.md` | Multiplayer cz.2: prediction + interpolacja | 2 klientów smooth @ 100 ms ping |
| 10 | `docs/phases/faza-10.md` | Lobby i pokoje | 2 osoby z 2 komputerów w 1 meczu |
| 11 | `docs/phases/faza-11.md` | Walka sieciowa: serwerowy hit detection + lag compensation | „co widzę, to trafiam" |
| 12 | `docs/phases/faza-12.md` | Boty na serwerze | mecz 1 gracz + 3 boty |
| 13 | `docs/phases/faza-13.md` | Pętla meczu: FFA, scoreboard, respawn + deploy MP | **publiczny multiplayer** |
| 14 | `docs/phases/faza-14.md` | Drugi samolot + balans (Bf 109 E) | asymetryczny matchup |
| 15 | `docs/phases/faza-15.md` | Teren v2 (LOD, detale) — TIMEBOX | ładniej, bez regresji fps |
| 16 | `docs/phases/faza-16.md` | Dźwięk i efekty | pełne udźwiękowienie |
| 17 | `docs/phases/faza-17.md` | Modułowe uszkodzenia | odstrzelone skrzydło = korkociąg |

### Backlog (po fazie 17, kolejność do ustalenia)

Kokpit 1st person · gamepad/HOTAS · konta i statystyki · replay system · TDM Allies vs Axis ·
cele naziemne / eskorta bombowca · pogoda i wiatr · większa mapa ze streamingiem ·
więcej samolotów (Hurricane, Bf 110) · tryb treningowy z samouczkiem

---

## Architektura sieci (skrót — szczegóły w fazach 8–12)

- Transport: WebSocket binarny (`ws` na serwerze, natywny WebSocket w przeglądarce), `wss://` na produkcji
- Klient → serwer: ramki INPUT (sequence, sterowanie, timestamp) @ 60 Hz
- Serwer → klient: SNAPSHOT (tick, encje, ack ostatniego inputu) @ 30 Hz
- Własny samolot: client prediction + reconciliation (replay inputów od ack)
- Obce samoloty: snapshot interpolation z buforem 100 ms
- Pociski: lag compensation na serwerze (rewind świata, cap 200 ms)
- Skala: 8 graczy/pokój; interest management dopiero gdy pomiary pokażą potrzebę

---

## Deploy (skrót — szczegóły w fazach 7 i 13)

Wzorzec C z `C:\AI\vps_home_pl_konfiguracja.md` (Tetris jako referencja):

- `/opt/docker-apps/dogfight/`, port zewnętrzny **8087** (sprawdzić przed deployem, czy nadal wolny!)
- DNS: rekord A `dogfight.tatanga.eu` → `217.154.210.181` (home.pl, propagacja do 1 h)
- NPM: Proxy Host z **Websockets Support ON** + SSL Let's Encrypt + Force SSL
- Frontend: `nginx:alpine` serwuje SPA; `/ws` proxy do backendu Node
- Lekcje z bazy wiedzy VPS: `npx vite build` zamiast `npm run build`; bez bloku `types{}` w nginx;
  `.dockerignore` z `node_modules`; `.env` tylko na VPS

---

## Ryzyka i potencjalne błędy (świadomie monitorowane)

1. **Strojenie czucia lotu to iteracja, nie jednorazowy strzał.** Dlatego narzędzia z fazy 3
   (panel na żywo, rejestrator, testy metryk) są częścią kryterium ukończenia, nie opcją.
2. **Współdzielony VPS** — gra dzieli CPU/RAM z 7 innymi aplikacjami. Serwer 60 Hz dla 8 graczy
   to małe obciążenie (szacunek: ~5% jednego rdzenia), ale w fazie 13 zmierzyć i ustawić
   limity zasobów w docker-compose.
3. **Brak dobrych modeli 3D CC0/CC-BY** dla konkretnych samolotów — plan B: stylizowany low-poly
   (własny lub generowany), estetyka „flat shading" zamiast realizmu. Decyzja w fazie 7/14.
4. **Scope creep terenu** — historycznie zabił poprzedni projekt. Faza 15 ma twardy timebox
   i status „nice to have".
5. **Różnice float między przeglądarkami/Node** — akceptowane: serwer jest autorytetem,
   reconciliation koryguje dryf. NIE wymagać bitowego determinizmu.
6. **WebSocket przez NPM** — bez „Websockets Support ON" połączenie nie wstanie (znany błąd z bazy wiedzy).
7. **Wydajność WebGL na słabszych laptopach** — budżet: 60 fps na zintegrowanej grafice;
   mierzyć od fazy 4, nie odkładać na koniec.
8. **Bezpieczeństwo**: serwer waliduje każdy input (zakresy, rate limit, rozmiar pakietu);
   nick sanityzowany; brak danych osobowych; limit połączeń per IP.

---

## Otwarte decyzje (do podjęcia we wskazanych fazach)

- Nazwa gry i subdomena (`dogfight.tatanga.eu` robocza) → faza 7
- Źródło modeli 3D: konkretne assety CC vs stylizowany low-poly → faza 7 (demo) / 14
- UI lobby: vanilla DOM (domyślnie) vs Preact → faza 10
- Interest management: czy potrzebny przy 8 graczach → pomiar w fazie 13
