# Faza 5 — decyzje i pułapki (uzbrojenie, balistyka, HP)

## Decyzje użytkownika (pytania uzupełniające przed implementacją, 2026-06-13)

1. **Ogień na LPM** (przy zablokowanej myszy) + **Spacja** jako zapas w obu trybach.
2. **Opór pocisku kwadratowy** `a = −k·|v|·v` (realistyczniejszy spadek prędkości niż liniowy).
3. **Obrażenia realistyczne**: 8× .303 historycznie słabe — zestrzelenie myśliwca to seria
   ~1,5–2 s celnego ognia. Balon/dron padają szybciej (mniej HP). Kalibracja: hpPool=120,
   damagePerHit=1.5 → ~80 trafień na kill (≈0,5 s przy 100% celności, ~1,7 s przy ~30%).

## Decyzje techniczne nieoczywiste z kodu

- **Pocisk całkuje pozycję jako `p += v·dt + ½·a·dt²`, NIE semi-implicit Euler** jak płatowiec.
  Semi-implicit (`p += v_new·dt`) zawyża opad grawitacyjny o czynnik (n+1)/n — przy locie 300 m
  (~24 ticki) to ~4%, ponad próg balistyki ±2%. Człon ½·a·dt² czyni opad grawitacyjny dokładnym.
  Pocisk to osobny punkt bez rotacji → wolno mu mieć dokładniejszy schemat niż samolot.
  (Złoty test `ballistics.test.ts` to wymusza — patrz „opad bez oporu = ½g(d/v0)²".)
- **Własność analityczna oporu kwadratowego do testów**: wzdłuż toru bez grawitacji
  `dv/dx = −k·v ⇒ v(x) = v0·e^(−k·x)`, k [1/m]. Grawitacja perturbuje <0.1% przy strzale
  poziomym, więc test „spadek prędkości" porównuje z formą zamkniętą. Opad z oporem (brak formy
  zamkniętej) testowany przez **gęste całkowanie referencyjne** (dt/16) jako „analityk".
- **Konwergencja luf**: każdy pocisk celuje w punkt `(0,0,convergenceM)` w body frame
  (`aimDirectionBody`) → lufy w skrzydłach mają zbieg (toe-in), strumienie schodzą się na 200 m.
  Bez tego trafianie z 8 rozjeżdżających się luf frustruje. Test sprawdza zbieżność dokładnie
  na convergenceM (x,y → 0).
- **Rozrzut zużywa 2 liczby z RNG ZAWSZE**, też przy dispersion=0 — strumień RNG nie zależy od
  strojenia rozrzutu (przygotowanie pod determinizm klient↔serwer w fazie 11).
- **Pula pocisków prealokowana** (BULLET_POOL_CAPACITY=768; 8 luf×1150 rpm×3 s ≈ 460 w szczycie).
  Spawn nadpisuje wolny/najstarszy slot in-place, krok bez `new`. `prevPosition` zapisywane
  w `stepBullet` PRZED ruchem → odcinek prev→pos jest wejściem hit-detekcji (anty-tunelowanie:
  pocisk skacze ~12 m/tick, punktowy test by go przepuścił).
- **Smugacz co 3. pocisk** (flaga przy spawnie). Klient rysuje TYLKO smugacze (InstancedMesh),
  reszta leci niewidzialnie ale fizycznie — realistyczne i tanie.
- **HP celów strzelnicy w `constants.ts`, nie w JSON** — balon/dron to nie samoloty; parametry
  samolotów zostają w `planes/*.json` (niezmiennik nr 3). Po fazie 6 cele zastąpią boty.
- **Pociski i cele żyją niezależnie od stanu gracza** (krok puli + ruch celów + hit-detekcja
  na końcu `physicsStep` w obu gałęziach alive/dead). Po respawnie `resetPlane` dolewa amunicję.

## Pułapki

- `noUncheckedIndexedAccess`: `armament.muzzles[i]` i pętle po pulach wymagają strażników
  `if (!x) continue` z komentarzem „nieosiągalne" (konwencja repo).
- Walidacja JSON: dodanie sekcji `armament` wymagało osobnego `checkArmament` + `checkMuzzles`
  (muzzles to tablica trójek, nie pola numeryczne) oraz aktualizacji `NumericKey` (exclude
  'armament') i `fixtures.ts`/`loader.test.ts` (nowe wymagane pola hpPool+armament).
- Pierwsze kliknięcie przejmuje pointer lock i NIE może strzelać — `triggerHeld()` bramkuje LPM
  na `mouseAim.locked` (mousedown ustawia flagę, ale ogień rusza dopiero po locku).

## Do oceny przez gracza / backlog

- „Czucie" trafień i wyprzedzenia ruchomego drona — playtest (`npm run dev`). Knoby: `armament.*`
  w JSON (rozrzut/konwergencja/dmg/kadencja), `TARGET_*_HP`, długość/grubość smugi w tracerach.
- Hit detekcja vs SAMOLOTY jeszcze niewpięta (brak wrogich samolotów do fazy 6) — moduły są
  generyczne (sfera), wpięcie hpPool gracza + sfera kadłuba przyjdzie z botem (faza 6).
- Brak dźwięku (faza 16), bez efektu iskier przy „absorbed" (tylko hit marker) — świadomie.
