# Faza 13 — Pętla meczu: FFA + scoreboard + deploy multiplayer

**Zależy od:** Faza 12
**Cel:** KAMIEŃ MILOWY — kompletna, publiczna gra multiplayer: wejście → mecz → wynik →
rewanż, dostępna pod publicznym adresem.

## Zakres

W tej fazie:
- Tryb FFA: mecz do N killi (host wybiera: 5/10/20) lub limit czasu 15 min — co pierwsze
- Scoreboard (Tab): killi / śmierci / ping, sortowanie, podświetlenie własnego wiersza
- Respawn z ochroną: 3 s nieśmiertelności + spawn z dala od wrogów (heurystyka odległości)
- Koniec meczu: ekran wyników (zwycięzca, tabela) → powrót do poczekalni (rewanż jednym kliknięciem)
- **Deploy pełnego stacku na VPS**: backend Node w docker-compose (drugi serwis), nginx proxy
  `/ws` → backend (odkomentowanie przygotowane w fazie 7), zmienne w `.env`,
  healthcheck `/health`, limity zasobów kontenera (`mem_limit`, `cpus`)
- Graceful shutdown serwera: SIGTERM → powiadomienie graczy → zapis logu meczu (konsola)
- Smoke test produkcji: mecz 2 graczy + 2 boty przez `wss://`

Poza zakresem: TDM/drużyny (backlog), statystyki trwałe (backlog), spectator (backlog).

## Kroki

1. Serwer: maszyna stanów meczu (`waiting → playing → ended → waiting`) + liczniki + testy
2. Klient: scoreboard, ekran końca, przepływ rewanżu
3. Spawn-selection + ochrona respawnu (testy: spawn nigdy < 1.5 km od wroga jeśli to możliwe)
4. `deploy/`: Dockerfile.backend (multi-stage), aktualizacja compose + nginx.conf, `.env.example`
5. Deploy na VPS wg procedury z PLAN.md; **Websockets ON w NPM** (włączone w fazie 7 — zweryfikować)
6. Pomiar na produkcji: CPU/RAM kontenera przy pełnym pokoju (`docker stats`) → memory;
   decyzja czy interest management potrzebny (PLAN.md, otwarte decyzje)
7. Aktualizacja `C:\AI\vps_home_pl_konfiguracja.md` (drugi serwis w opisie)

## Kryteria ukończenia

- [~] Pełny cykl na produkcji: 2 osoby przez internet + 2 boty → mecz do 5 killi → wyniki → rewanż
  — KOD gotowy (lobby z wyborem limitu, mecz FFA, ekran wyników + rewanż); **wykonanie na VPS po stronie użytkownika** (runbook 13.4)
- [x] Scoreboard i kill feed spójne z faktycznym przebiegiem (w tym killi botów) — standings z serwera (Tab) + kill feed z eventów; boty to pełne encje
- [x] Spawn-kill niemożliwy w typowej sytuacji — ochrona 3 s (`SPAWN_PROTECTION_S`) + wybór miejsca z dala od wrogów (`chooseSpawnIndex`); testy w `match-loop.test.ts`/`spawn.test.ts`
- [~] `docker stats` przy pełnym pokoju zapisane w memory — **pomiar na VPS po stronie użytkownika** (runbook 13.5); benchmark dev: 1+7 botów ≈ 0,3 ms/tick (budżet 8,3 ms)
- [x] Restart kontenera backendu → klienci dostają komunikat (nie wieczny spinner) — graceful shutdown `notifyShutdown` + `serverShutdown` → status 'error'; pokoje bezstanowe (odtwarzalne)
- [x] typecheck + test + lint zielone (380 testów); commit + tag `mp-1` — wykonane; memory zapisane (`faza13-petla-meczu-deploy.md`)

## Pułapki

- `proxy_read_timeout 86400` w nginx dla `/ws` (lekcja z Tetrisa — bez tego WS zrywa się po 60 s)
- Współdzielony VPS: ustaw limity kontenera ZANIM coś pójdzie nie tak (OOM killer wybiera ofiary
  nieprzewidywalnie — może zabić CRM klienta zamiast gry)
- Zegar meczu liczony na serwerze; klient tylko wyświetla (nigdy nie kończy meczu lokalnie)

## Wynik

**KOD i artefakty deployu gotowe (2026-06-17); publiczny deploy + pomiary po stronie użytkownika** (brak SSH z sesji — ustalone).

**Pętla meczu FFA (serwer autorytetem — niezmiennik nr 5):**
- `shared/world/ffa.ts` — czysta logika: `evaluateFfa` (koniec przy limicie zestrzeleń **lub** czasu, limit ma pierwszeństwo), zwycięzca = lider `rankFfa`/`compareFfa` (kills↓ → deaths↑ → id↑), `clampScoreLimit` do `[5,10,20]`. `MATCH_TIME_LIMIT_S=900` (15 min).
- Maszyna stanów w `GameRoom.step`: `playing` liczy `matchClockS` i woła `checkMatchEnd` po rozliczeniu trafień; `endMatch` → `ended` + broadcast `matchEnded`; `ended` odlicza `MATCH_RESULTS_LINGER_S=15` → `returnToWaiting`. **Rewanż = `start()` dozwolony z `waiting` i `ended`** (zeruje wynik/zegar, spawn wszystkich).
- `deaths` liczone w `onAirKill` i `onGroundDeath`. Boty są pełnymi uczestnikami (mogą wygrać).

**Respawn z ochroną (anty-spawn-kill):** `SPAWN_PROTECTION_S=3` — `resolveHits` pomija cel pod ochroną, otwarcie ognia ją znosi; wybór miejsca `shared/world/spawn.ts` `chooseSpawnIndex` (max. dystans do żywych wrogów), `spawn(useSelection)` true=respawn / false=start (rozrzut).

**Scoreboard + ekran wyników (klient tylko wyświetla):** `client/src/net/match-ui.ts` — `ScoreboardOverlay` (Tab: zestrzelenia/śmierci/asysty/ping, podświetlenie własnego wiersza, zegar) + `ResultsOverlay` (zwycięzca + finalna tabela + rewanż/wyjście). HUD z wynikiem i zegarem. Standings z serwera `STANDINGS_BROADCAST_HZ=2`; ping szacowany serwerowo z echa ticku (diagnostyka, nie gameplay).

**Protokół:** BEZ bumpu wersji (binarny niezmieniony) — `+scoreLimit?` w `CreateRoomMessage`, nowe JSON `standings`/`matchEnded`/`serverShutdown`. Host wybiera limit w lobby.

**Deploy/operacje:** `/health` (`http.Server` + `WebSocketServer({server})`); graceful shutdown (SIGTERM → `notifyShutdown`: log meczu do konsoli + `serverShutdown` do wszystkich → 300 ms → close); klient pokazuje komunikat, nie spinner. Artefakty: `deploy/Dockerfile.backend` (esbuild bundle, ws+pino external, runtime `npm --omit=dev`), `docker-compose.yml` (backend `mem_limit:256m`/`cpus:0.50`/healthcheck, frontend `depends_on: service_healthy`), `nginx.conf` `location /ws → backend:3001` (`proxy_read_timeout 86400`).

**Błąd naprawiony (krytyczny dla produkcji):** `defaultServerUrl` łączył się z `wss://host:3001` (backend nie jest publicznie wystawiony) → teraz `wss://<host>/ws` na produkcji, `ws://host:3001` w dev.

**Walidacja:** `npm run typecheck && npm test (380) && npm run lint` zielone; bundle serwera (esbuild 558 kB) i klienta (Vite) budują się; runtime `/health`→200 i 404 zweryfikowane lokalnie. Tag `mp-1`.

**Otwarte (użytkownik):** deploy na VPS (`deploy/WDROZENIE-NA-VPS.md` sekcja „Faza 13"), smoke 2 graczy przez `wss://`, `docker stats` przy pełnym pokoju → memory (decyzja o interest management — PLAN.md).
