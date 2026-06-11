# Faza 3 — Model lotu cz.2: koperta, instruktor, strojenie czucia

**Zależy od:** Faza 2
**Czytaj najpierw:** `docs/fizyka-lotu.md` (rozdz. 6, 7, 11, 12)
**Cel:** „5 minut przyjemnego latania" — najważniejsze kryterium całego projektu.
Tu powstaje czucie lotu i komplet narzędzi do jego strojenia.

## Zakres

W tej fazie:
- Koperta osiągów: `n_avail`, limity strukturalne, krzywa `rollRate(IAS)`,
  spójność nos↔tor (`alignTau`), koordynacja yaw (`sideslipDamping`)
- Przeciągnięcie z pełnymi efektami: buffet (drganie kamery + HUD), nose drop,
  utrata sterowności lotek, wing drop po 1 s (seeded RNG w `shared`)
- Instruktor mouse-aim (bank-and-pull, regulator P z nasyceniem) + celownik na sferze
- Sterowanie klawiaturą jako pełnoprawny fallback (rate'y przez kopertę)
- Kamera pościgowa (chase cam ze smoothingiem i wyprzedzeniem skrętu)
- HUD gracza: IAS, wysokość, throttle, wskaźnik G, ostrzeżenie przeciągnięcia, horyzont
- **Panel strojenia** (Tweakpane, dev-only): wszystkie parametry JSON na żywo + eksport presetu
- **Rejestrator lotu**: ring buffer 60 Hz × 5 min, eksport CSV, strona `/telemetry` z wykresami (uPlot)
- Harness rozszerzony: `sustainedTurnTest` (~19 s ±8%), `rollRateTest(350)` (~70°/s ±10%)

Poza zakresem: teren (faza 4), broń (faza 5), drugi samolot.

## Kroki

1. `shared/src/physics/envelope.ts` (n_avail, roll curve, align, sideslip) + testy jednostkowe
2. `shared/src/physics/stall.ts` — maszyna stanów przeciągnięcia (normal → buffet → stalled) + testy przejść
3. `shared/src/instructor/instructor.ts` + testy („cel za ogonem → najpierw roll, potem pull")
4. Klient: mysz (pointer lock), celownik, kamera pościgowa, HUD
5. Panel Tweakpane + okablowanie hot-reload parametrów
6. Rejestrator + `/telemetry`
7. Strojenie: iteracje na krzywej roll, alignTau, parametrach instruktora — aż latanie
   będzie przyjemne; każda iteracja potwierdzona testami metryk (nie zepsuć osiągów z fazy 2!)

## Kryteria ukończenia

- [ ] `sustainedTurnTest()` ≈ 19 s ±8%; `rollRateTest(350)` ≈ 70°/s ±10%
- [ ] Wszystkie testy z fazy 2 nadal zielone (strojenie czucia nie zepsuło osiągów)
- [ ] Przeciągnięcie: buffet ostrzega przed, nose drop wyprowadza, procedura „oddać drążek" działa
- [ ] Subiektywnie: 5 minut latania myszą bez frustracji — pętla, beczka, immelmann,
  zakręt bojowy wychodzą naturalnie (notatka z sesji testowej w memory)
- [ ] Panel strojenia zmienia zachowanie natychmiast; eksport presetu → diff w JSON
- [ ] Rejestrator: nagranie pętli → wykres n(t) pokazuje przebieg przeciążenia
- [ ] typecheck + test + lint zielone; commit `faza-3`; memory zapisane (w tym finalny preset!)

## Pułapki / lekcje z opus4-7

- W opus4-7 odpowiednikiem tej fazy było żonglowanie `aileronCoeff=0.025` i `rollDamping=-1.2` —
  sprzężonymi liczbami bez fizycznego sensu. Tu strojysz `rollRateCurve` w °/s. Jeśli złapiesz się
  na dodawaniu „współczynnika do współczynnika" — STOP, to sygnał odejścia od architektury
- Mysz: pointer lock + akumulacja delty; celownik NIE może być sprzężony 1:1 z kamerą
  (choroba symulatorowa) — kamera podąża za samolotem, celownik za myszą
- Procedura debugowania z `fizyka-lotu.md` rozdz. 12 obowiązuje od tej fazy

## Wynik (2026-06-11)

Wszystkie kryteria spełnione. Model przestrojony w trakcie fazy na **Spitfire Mk IA
w konfiguracji BoB (+12 lb boost, 1310 KM)** po sesji testowej użytkownika („za mało
dynamiczny") — parametry ze źródeł: N.3171, RAE 06.1940, Collar, Morgan & Morris
(szczegóły: `memory/project_phase3_decisions.md`, tabela celów: fizyka-lotu.md rozdz. 10).

Metryki (93 testy zielone): V_max SL 503.5 km/h (cel 505), V_max 5500 m 557 (cel 570 ±8%),
stall 117.0 (cel 117), wznoszenie 17.6 m/s (cel 17 ±15%), **zakręt 360° 16.6 s** (cel 16 ±8%,
zgodny z bilansem mocy 16.0, dryf wysokości −27 m), **roll @350 68.0°/s** (cel 70 ±10%).

Powstało: `envelope.ts`, `stall.ts` (maszyna stanów + seeded wing drop),
`instructor/instructor.ts` (bank-and-pull), `pilot-step.ts` (wspólny pipeline
pilot→koperta→stall→fizyka dla klienta/serwera/botów), klient: pointer lock + celownik
+ kamera pościgowa + HUD + klawiatura przez kopertę, panel Tweakpane z eksportem presetu,
rejestrator 60 Hz×5 min + `/telemetry.html` (uPlot). Sesja testowa: „jest ok";
finalny preset = `spitfire-mk1.json` w commicie fazy.

Poprawki modelu odkryte testami: limit autorytetu tłumika ślizgu (`sideslipMaxAccelG`),
feed-forward koordynacji yaw w zakręcie (−g·right.y/V) — opisane w fizyka-lotu.md 6.3.
