# Faza 14 — Drugi samolot + balans: Bf 109 E

**Zależy od:** Faza 13
**Cel:** asymetryczny matchup Spitfire (turn-fighter) vs Bf 109 (energy-fighter) —
dowód, że architektura fizyki rzeczywiście jest data-driven.

## Zakres

W tej fazie:
- `shared/src/planes/bf109-e.json` — pełna konfiguracja wg schematu z `fizyka-lotu.md`
  (rozdz. 9), kalibrowana do kolumny Bf 109 E-3 z tabeli celów (rozdz. 10)
- Model 3D Bf 109 (CC0/CC-BY albo low-poly spójny stylem ze Spitfire) + LICENSES.md
- Uzbrojenie zróżnicowane: Bf 109 E-3 = 2× MG 17 (7.92 mm) + 2× MG FF (20 mm, wolniejsze,
  mocniejsze, mniejszy zapas) — drugi typ pocisku w balistyce (dmg, prędkość, balistyka łukowa)
- Wybór samolotu w poczekalni (per gracz, zmiana między respawnami dozwolona)
- Harness manewrów odpalany dla OBU samolotów (parametryzacja testów po plane config)
- Sesje balansowe: 1v1 ludzie + boty na obu typach; boty losują typ samolotu
- HUD: nazwa typu przeciwnika przy znaczniku (rozpoznawanie matchupu)

Poza zakresem: trzeci samolot (backlog), ujednolicanie osiągów („balans przez nerf do średniej"
ZAKAZANY — asymetria to feature).

## Kroki

1. JSON Bf 109 + kalibracja harnessem (procedura z fazy 2: V_max → V_stall → wznoszenie;
   plus roll/turn z fazy 3)
2. Parametryzacja złotych testów: `describe.each([spitfire, bf109])`
3. Drugi typ pocisku (20 mm) w `shared/combat` + testy balistyki
4. Import modelu, wybór w lobby, propagacja typu w protokole (bajt typu w snapshot/spawn)
5. Sesje balansowe → notatki → ewentualne korekty JSON (nigdy kodu)

## Kryteria ukończenia

- [ ] Złote testy zielone dla obu samolotów względem ich kolumn z tabeli celów
- [ ] Bf 109 wygrywa pościg wznoszący i nurkowanie; Spitfire wygrywa krążenie poziome
  (testy scenariuszowe w harness: 30 s symulacji obu strategii)
- [ ] 20 mm czuć inaczej niż 7.7 mm (wolniejszy tracer, większy łuk, 2-4 trafienia = kill)
- [ ] Boty latają oboma typami bez zmian w AI (interfejs instruktora wystarcza)
- [ ] Sesja balansowa 1v1: oba samoloty wygrywają mecze (żaden nie jest strictly better) —
  notatka w memory
- [ ] typecheck + test + lint zielone; commit `faza-14`; memory zapisane

## Pułapki

- Kuszące jest „poprawianie" fizyki pod balans — NIE: balans robi się danymi (JSON),
  a jeśli dane historyczne dają nudny matchup, różnicuje się uzbrojeniem i zapasem amunicji
- MG FF miał haubiczną balistykę — to utrudnienie celowania JEST balansem dla większego dmg
- Dwa typy samolotów = pierwszy prawdziwy test generyczności kodu; każdy `if (planeType === ...)`
  poza ładowaniem configu to smell

## Wynik (uzupełnić po zakończeniu)

—
