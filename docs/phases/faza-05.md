# Faza 5 — Uzbrojenie, balistyka, HP

**Zależy od:** Faza 4
**Cel:** strzelanie, które trafia tam, gdzie poleciały pociski — fundament walki
(na razie lokalnie, bez sieci).

## Zakres

W tej fazie:
- Konfiguracja uzbrojenia w JSON samolotu: Spitfire Mk I = 8× 7.7 mm w skrzydłach
  (rozrzut, kadencja, prędkość wylotowa ~744 m/s, zapas amunicji, konwergencja 200 m)
- Symulacja pocisków w `shared`: punkt materialny z grawitacją i prostym oporem
  (deceleracja ~konfigurowalna), czas życia ~3 s, pula obiektów (zero alokacji w pętli)
- Hit detection: raycast segmentowy (pozycja pocisku tick→tick) vs sfera otaczająca samolot
  (jedna sfera w MVP; strefy trafień → faza 17)
- HP: pula globalna, dmg per trafienie, zniszczenie → wybuch + respawn (reużycie z fazy 4)
- Klient: tracery (co 3. pocisk widoczny), błysk luf, hit marker (dźwięk wizualny — krzyżyk),
  kill feed lokalny, licznik amunicji w HUD
- Cel testowy: balon/dron latający po okręgu (stała prędkość, bez AI) do testów celowania

Poza zakresem: bot walczący (faza 6), sieć (fazy 8+), uszkodzenia modułowe (faza 17),
bomby/rakiety (backlog).

## Kroki

1. `shared/src/combat/ballistics.ts`: krok pocisku + testy analityczne (zasięg, opad na 300 m)
2. `shared/src/combat/hit.ts`: przecięcie odcinek–sfera + testy brzegowe (styczna, wewnątrz)
3. `shared/src/combat/health.ts`: HP, eventy damage/kill
4. Pula pocisków + spawn z konwergencją i rozrzutem (seeded RNG)
5. Klient: tracery (InstancedMesh), efekty, HUD
6. Cel testowy + strzelnica: scena startowa z 3 balonami

## Kryteria ukończenia

- [ ] Test: pocisk na 300 m opada zgodnie z balistyką (wartość analityczna ±2%)
- [ ] Test: hit detection łapie przelot przez sferę nawet przy 1 ticku wewnątrz segmentu
- [ ] W grze: zestrzelenie balonu nieruchomego i poruszającego się (z wyprzedzeniem) —
  trafienia czuć spójnie z tracerami
- [ ] 8 luf × 60 Hz nie alokuje w pętli (pula; brak zauważalnego GC w profilerze)
- [ ] typecheck + test + lint zielone; commit `faza-5`; memory zapisane

## Pułapki

- Konwergencja luf w skrzydłach to nie bajer — bez niej strumień pocisków rozjeżdża się
  i trafianie frustruje; 200 m to historyczny default RAF
- Rozrzut: seeded RNG z `shared` (przygotowanie pod serwer w fazie 11 — ten sam strumień
  liczb po obu stronach przy tym samym seedzie)
- Tracery: NIE jeden mesh per pocisk — InstancedMesh albo punkty, inaczej fps zjedzony

## Wynik (uzupełnić po zakończeniu)

—
