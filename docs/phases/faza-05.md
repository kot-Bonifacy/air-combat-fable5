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

- [x] Test: pocisk na 300 m opada zgodnie z balistyką (wartość analityczna ±2%)
- [x] Test: hit detection łapie przelot przez sferę nawet przy 1 ticku wewnątrz segmentu
- [~] W grze: zestrzelenie balonu nieruchomego i poruszającego się (z wyprzedzeniem) —
  trafienia czuć spójnie z tracerami → do weryfikacji w grze (`npm run dev`); ścieżkę
  walki end-to-end pokrywa test integracyjny `combat/integration.test.ts`
- [x] 8 luf × 60 Hz nie alokuje w pętli (pula prealokowana 768; krok puli bez `new`)
- [x] typecheck + test + lint zielone; commit `faza-5`; memory zapisane

## Pułapki

- Konwergencja luf w skrzydłach to nie bajer — bez niej strumień pocisków rozjeżdża się
  i trafianie frustruje; 200 m to historyczny default RAF
- Rozrzut: seeded RNG z `shared` (przygotowanie pod serwer w fazie 11 — ten sam strumień
  liczb po obu stronach przy tym samym seedzie)
- Tracery: NIE jeden mesh per pocisk — InstancedMesh albo punkty, inaczej fps zjedzony

## Wynik

Zaimplementowano kompletny rdzeń walki w `shared/combat/` + warstwę kliencką.

**Decyzje użytkownika (2026-06-13):** ogień na LPM (+ Spacja w obu trybach), opór pocisku
**kwadratowy** `a = −k·|v|·v`, obrażenia **realistyczne** (.303 słabe, zestrzelenie = długa seria).

**Moduły `shared/combat/`:**
- `ballistics.ts` — `stepBullet` (grawitacja + opór kwadratowy) i `BulletPool` (prealokacja
  768, spawn/krok bez alokacji, nadpisanie najstarszego przy przepełnieniu). Pocisk całkuje
  pozycję jako `p += v·dt + ½·a·dt²` (NIE semi-implicit Euler jak płatowiec) — bez członu
  ½·a·dt² opad grawitacyjny był zawyżony o ~1/n (≈4% na 300 m, ponad próg ±2%).
- `hit.ts` — `segmentSphereHitT` (odcinek prev→pos vs sfera): łapie tunelowanie (oba końce
  poza sferą), styczną, start wewnątrz; zwraca t∈[0,1] lub −1.
- `health.ts` — pula HP, `applyDamage` zwraca `absorbed`/`destroyed`/`ignored` (kill liczony raz).
- `fire.ts` — `updateFire` (kadencja, amunicja), konwergencja (`aimDirectionBody` → punkt
  (0,0,convergenceM), zbieg luf w skrzydłach), rozrzut (`applyDispersion`, seeded RNG z shared),
  smugacz co 3. pocisk, dziedziczenie prędkości samolotu.
- `integration.test.ts` — end-to-end: seria w sferę na 200 m niszczy ją (lustro pętli klienta).

**Konfiguracja (JSON/stałe, zero liczb w kodzie):** `spitfire-mk1.json` → `hpPool: 120` +
`armament` (8 luf .303, 744 m/s, konwergencja 200 m, 1150 rpm/lufę, 300 szt./lufę, rozrzut
3 mrad, dmg 1.5, dragK 0.001, życie 3 s). Walidacja sekcji w `loader.ts`. Cele strzelnicy
(HP/promień/respawn) w `constants.ts` — nie są samolotami.

**Klient:** `bullet-tracers.ts` (InstancedMesh, tylko smugacze, interpolacja prev→curr),
`muzzle-flash.ts` (billboardowane błyski w lufach), `targets.ts` (balon nieruchomy + 2 drony
po okręgu, HP + respawn + rozwiązywanie trafień), hit marker (krzyżyk) + kill feed + licznik
amunicji w HUD. Strzał: LPM (przy zablokowanej myszy) lub Spacja.

**Pozostało do oceny przez gracza:** „czucie" trafień i wyprzedzenia (npm run dev). Knoby
strojenia: `armament.*` w JSON, `TARGET_*_HP` w constants, długość/grubość smugi w
`bullet-tracers.ts`, `dispersionMrad`/`convergenceM` dla rozrzutu/zbiegu.
