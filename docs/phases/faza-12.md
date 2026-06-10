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

## Wynik (uzupełnić po zakończeniu)

—
