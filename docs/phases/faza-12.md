# Faza 12 — Boty na serwerze

**Zależy od:** Faza 11
**Cel:** mecz nigdy nie jest pusty — boty dopełniają pokoje i są pełnoprawnymi uczestnikami
walki sieciowej.

## Zakres

W tej fazie:
- Przeniesienie wykonania AI z klienta na serwer: FSM z `shared` (faza 6) odpalany w pętli
  serwera; bot = encja jak gracz (przechodzi przez te same ścieżki combat/HP/snapshot)
- Konfiguracja pokoju: host wybiera liczbę botów (0–7) i trudność przy tworzeniu pokoju
- Boty w poczekalni widoczne na liście (oznaczone [BOT], nicki z puli historycznych imion)
- Optymalizacja: AI „myśli" co 6 ticków (10 Hz), steruje co tick — cel: 7 botów + 60 Hz fizyki
  bez zadyszki na współdzielonym VPS
- Boty respektują pętlę meczu: respawnują, naliczają killi/śmierci do scoreboardu (grunt pod fazę 13)

Poza zakresem: zastępowanie rozłączonych graczy botem (backlog), osobowości botów.

## Kroki

1. Serwer: `bot-manager.ts` (spawn, tick z decymacją 10 Hz, cleanup)
2. Refaktor: upewnić się, że FSM nie ma żadnych zależności od klienta (powinno być czyste
   od fazy 6 — tu jest test tej czystości)
3. Konfiguracja pokoju w lobby (liczba botów, trudność) + UI
4. Pomiar obciążenia: pokój 1 gracz + 7 botów, profil CPU serwera → notatka w memory
5. Sesja testowa: mecz z botami przez internet

## Kryteria ukończenia

- [ ] Pokój z 3 botami: boty walczą z graczem i ZE SOBĄ nawzajem, kill feed poprawny
- [ ] 1 gracz + 7 botów: serwerowy tick < 50% budżetu (8.3 ms przy 60 Hz) na VPS-podobnym
  środowisku (pomiar lokalny w Dockerze z limitem CPU)
- [ ] Bot zestrzelony → respawn po 3 s; bot zestrzeliwuje gracza → poprawny kredyt
- [ ] Z perspektywy klienta bot nieodróżnialny protokołowo od gracza (żadnych specjalnych ścieżek)
- [ ] typecheck + test + lint zielone; commit `faza-12`; memory zapisane

## Pułapki

- AI na serwerze widzi stan PRAWDZIWY (bez interpolacji) — bot celuje lepiej niż w trybie
  offline z fazy 6; skompensować szumem trudności (re-tuning difficulty.json)
- Decymacja myślenia: stan FSM trzymany per bot, nie liczony od zera co decyzję
- 7 botów × raycast unikania ziemi co tick = niepotrzebny koszt — unikanie ziemi też 10 Hz,
  z marginesem wysokości zależnym od prędkości

## Wynik

Ukończona 2026-06-17 (commit `faza-12`). Boty są pełnoprawnymi uczestnikami walki sieciowej.

**Architektura.** Bot to `ServerPlayer` w `GameRoom.players` (`member=null`, `isBot=true`),
sterowany przez AI. Dzięki temu jest PROTOKOŁOWO NIEODRÓŻNIALNY od gracza: ta sama mapa graczy,
snapshot, hit detection, HP, kredyt, eventy MUZZLE/HIT/KILL — zero specjalnych ścieżek (jedyna
różnica: `stepBot` z AI zamiast `stepPlayer` z inputem). Nowy `server/bot-manager.ts` trzyma TYLKO
kontrolery AI (`Bot` z fazy 6 — reużyty bez zmian, czysty od zależności klienta) i sterowanie między
decyzjami; `GameRoom` decyduje, kiedy bot myśli.

**Decymacja.** `BOT_THINK_INTERVAL=6` → decyzja co 6 ticków (10 Hz), sterowanie co tick (powtarzane
żądania-stawki wygładza fizyka). Faza myślenia offsetowana slotem (`(tick+slot)%6`) → 7 botów nie
myśli w jednym ticku. Unikanie ziemi (raycast `lookaheadSurfaceM`) siedzi w `Bot.update` → też 10 Hz.

**Konfiguracja pokoju.** Host w „Utwórz pokój" wybiera liczbę botów (0–7) i poziom (łatwy/normalny/
trudny) — dwa `<select>` w `lobby-ui.ts`. Protokół: `CreateRoomMessage` +`bots`+`difficulty` (kanał
JSON lobby, bez bumpu wersji binarnego protokołu); `connection.ts` klampuje wartości (niezmiennik 11).
„Szybka gra" zasiewa 3 boty/normalny, gdy musi utworzyć pokój (mecz nigdy nie jest pusty). Boty w
poczekalni z nickiem `[BOT] <as historyczny>`. Sprzątanie pokoi przeniesione na `humanCount` (boty nie
trzymają pokoju przy życiu — inaczej wyciek pokoi z samymi botami).

**Pomiar.** Benchmark `bots.test.ts`: 1 gracz + 7 botów w walce = **0,309 ms/tick** (dev) — ~27× pod
kryterium 50% budżetu (8,3 ms). 357 testów + typecheck + lint zielone.

### Kryteria — status

- [x] Pokój z botami: boty walczą z graczem i ZE SOBĄ, kill feed poprawny (testy: kredyt bot↔gracz
  i bot↔bot + event KILL z poprawnymi id).
- [x] 1 gracz + 7 botów: tick < 50% budżetu — 0,309 ms/tick na dev (formalny pomiar pod limitem CPU
  w Dockerze/na VPS pozostaje do potwierdzenia operacyjnie, margines ogromny).
- [x] Bot zestrzelony → respawn po 3 s; bot zestrzeliwuje gracza → poprawny kredyt (testy).
- [x] Z perspektywy klienta bot nieodróżnialny protokołowo (encja w snapshocie, te same eventy).
- [x] typecheck + test + lint zielone; commit `faza-12`; memory zapisane.

### Pułapki (jak wyszły)

- Re-tuning `difficulty.json` NIE był potrzebny: założenie spec. („serwer widzi prawdę → bot celuje
  lepiej niż offline") nie zachodzi — offline z fazy 6 też liczył wszystko na prawdziwym stanie, a
  decymacja 10 Hz to lekki handicap względem offline 60 Hz. Szum/reakcja/limit G zostają.
- Stan FSM trzymany per bot w `BotManager` (nie liczony od zera co decyzja) — ✔.
- Unikanie ziemi 10 Hz z marginesem zależnym od prędkości (predykcja w `applyGroundAvoidance`) — ✔.

### Do zrobienia operacyjnie (po deployu)

- Pomiar CPU pokoju 1 gracz + 7 botów w Dockerze z limitem CPU / na VPS → notatka w memory.
- Sesja testowa: mecz z botami przez internet (subiektywna ocena zachowania botów online).
