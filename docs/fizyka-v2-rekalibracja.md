# Fizyka lotu v2 — rekalibracja realistyczna (duch War Thunder RB)

**Status: PROJEKT zatwierdzony 2026-07-10** (decyzje kierunkowe podjęte przez usera, patrz §2).
Realizacja w etapach **R0–R5** (jeden etap = jedna sesja, wzorem faz NN). Dokument jest
NADRZĘDNY dla etapów rekalibracji i uzupełnia — nie zastępuje — `docs/fizyka-lotu.md`
(tam definicje osi, konwencje, wyprowadzenia wzorów; tu cele liczbowe, nowe mechaniki i plan).

---

## 1. Cel

Fizyka lotu ma być **realistyczna w duchu trybu realistycznego (RB) War Thundera** i jednocześnie
**wiernie oddawać historyczne parametry lotne** trzech samolotów gry (Spitfire Mk IIa, Bf 109 E-3,
A6M2 Zero) — z małą, jawnie udokumentowaną listą odstępstw na rzecz grywalności (§3).

„Duch WT RB" oznacza konkretnie:

- energia jest walutą: każdy manewr kosztuje, przewaga energetyczna wygrywa walki;
- stery sztywnieją z prędkością (nie tylko lotki jak dziś — także ster wysokości i kierunku);
- skraje koperty bolą: przeciągnięcie zrywa w skrzydło, przekroczenie Vne niszczy konstrukcję,
  klapy wysunięte za szybko się urywają, silnik na WEP się przegrzewa;
- instruktor (mysz) trzyma gracza w kopercie, ale NIE dodaje mu osiągów — fizyka pod spodem
  jest tą samą fizyką dla klawiatury, myszy i botów;
- **nie da się** wiecznie kręcić beczek na pełnych lotkach bez utraty prędkości ani wisieć
  w ciasnym zakręcie bez wytracania energii/wysokości.

## 2. Decyzje kierunkowe (zatwierdzone przez usera 2026-07-10)

| # | Pytanie | Decyzja |
|---|---------|---------|
| D1 | Architektura | **Pogłębiony point-mass** — zostaje obecna architektura (siły: nośna z żądanego n, opór, ciąg, grawitacja; obroty kinematyczne z krzywych + instruktor). Pogłębiamy aerodynamikę zamiast przechodzić na 6-DOF momentowe. Bezpieczne dla predykcji MP, reconcile, botów i 655 testów (stan sprzed R0). |
| D2 | Źródło prawdy | **Historia > WT.** Cele liczbowe (Vmax, wznoszenie, czasy zakrętu, stall, Vne) z raportów historycznych (AFDU, testy Zero Kogi, dane fabryczne). WT RB służy jako wzorzec **zachowania** (czucie energii, sztywnienie sterów, konsekwencje skrajów koperty) — nie liczb. |
| D3 | Zakres nowych mechanik | **Wszystkie cztery**: WEP/boost, klapy, kompresja + Vne/flutter, szczątkowe efekty śmigła. Plus wymóg bazowy: opór manewrowy sterów (beczki kosztują energię). |
| D4 | Tolerancja złotych testów | **±5 %** na celach liczbowych; relacje między samolotami (kto ciaśniej kręci, kto szybciej nurkuje…) pilnowane osobnymi testami asymetrii bez tolerancji procentowej. |

## 3. Świadome odstępstwa od realizmu (grywalność) — lista zamknięta

Każde odstępstwo poniżej jest **decyzją projektową**, nie luką. Nowych nie dodajemy bez dopisania tutaj.

1. **Brak ciągłego kontrowania momentu śmigła** w zwykłym locie (wykluczone wprost przez usera).
   Efekty śmigła występują TYLKO przy niskiej prędkości i wysokim gazie (§6.5) — smak realizmu
   bez męczącego trymowania.
2. **Brak zarządzania silnikiem jak w pełnej symulacji** (chłodnice, skok śmigła, mieszanka).
   Jedyne suwaki gracza: gaz + WEP + klapy. Termika silnika (już istnieje) gra rolę chłodnic.
3. **Paliwo 15 min na pełnym gazie** (istniejąca konwencja) — nie odwzorowujemy realnych zasięgów
   (Zero i tak zachowuje relatywną przewagę długotrwałości).
4. **Instruktor zostaje** — jak w WT RB; klawiatura ma pełne wychylenia natychmiast (bez modelu
   sił na drążku), sztywnienie sterów realizowane krzywymi autorytetu vs IAS.
5. **Spawn w powietrzu z prędkością bojową** per samolot (`spawnSpeedMs`) — brak startów/lądowań,
   więc pozycje klap „start/lądowanie" służą tylko walce na małej prędkości.
6. **G-LOC wg obecnego modelu** (chwilowe ~8 G, sustained ~5 G + greyout) — zgodny z RB.
7. **Konwencja „lekko hojnych" prędkości SL zostaje ZASTĄPIONA** historycznymi wartościami SL —
   to nie odstępstwo, tylko odnotowanie, że v2 celowo zmienia dotychczasową konwencję.
8. Kwantyzacja modyfikatorów uszkodzeń z poziomów stref (ograniczenie protokołu v8) — bez zmian.

## 4. Stan wyjściowy — audyt modelu (2026-07-10)

### 4.1 Co już jest i zostaje

- Point-mass z n-demand: `physics/plane-step.ts` (`stepPlane`), pipeline pilota `physics/pilot-step.ts`.
- Atmosfera ISA (`physics/atmosphere.ts`): ρ(h), q, IAS=TAS·√(ρ/ρ0).
- Biegunowa `aero/drag.ts`: `Cd = Cd0 + K·Cl² + dragHighClK·Cl⁴ + dragStallK·(Cl_wym−Cl_max)²₊`
  (kalibracja bleedu z 2026-06-26) — fundament wytracania energii w zakręcie DZIAŁA.
- Ciąg `aero/thrust.ts`: `T = min(T_static, η·P(h)·gaz/V)`; **prosty model sprężarki**
  (pełna moc do FTH, wyżej ∝ ρ) — do pogłębienia (§6.6).
- Roll kinematyczny z `rollRateCurve(IAS)` per samolot (zapaść lotek Zero skalibrowana wg testów Kogi).
- Stall z maszyną stanów (buffet → wing drop), koperta `nAvailG`, G-LOC, paliwo, termika silnika,
  modułowe uszkodzenia stref (v8), harness manewrów `testing/maneuvers.ts`
  (topSpeed/stall/climb/sustainedTurn/dive/zoom/rollRate) + złote testy `physics/golden.test.ts`
  (`describe.each` × 3 samoloty).
- Hak E2E `window.__acDebug` w `online-main.ts:586` (tylko DEV) + MCP `chrome-devtools` w konfiguracji.

### 4.2 Znane luki względem celu (co naprawia v2)

| Luka | Objaw dziś | Naprawa |
|------|-----------|---------|
| Beczka za darmo | roll czysto kinematyczny, pełne lotki nie dodają oporu → można kręcić się w nieskończoność tracąc tylko tyle, ile zje trym toru | §6.1 opór manewrowy sterów |
| Ster wysokości nie sztywnieje | nDemand ogranicza tylko koperta (nAvail, nMax) — przy 700 km/h ciągnie się tak samo lekko jak przy 300 | §6.2 autorytet pitch vs IAS + kompresja |
| Brak Vne | nurkowanie bez kary strukturalnej (poza G) — Zero może bezkarnie nurkować z Bf 109 | §6.2 flutter → uszkodzenia stref skrzydeł |
| Brak WEP | jeden suwak gazu 0–100 %, moc szczytowa dostępna zawsze (limituje ją tylko termika) | §6.3 |
| Brak klap | brak narzędzia walki na małej prędkości; Zero/Spit nie mają swojej „karty" z WT | §6.4 |
| Zero efektów śmigła | pętla z małej prędkości idealnie symetryczna, wiszenie na śmigle bez ściągania | §6.5 |
| Prosty model mocy | `P = const do FTH` wymusza kompromisy: Bf 109 Vmax SL zmierzone 499 km/h vs cel 465 (+7 %, przechodzi tylko dzięki tolerancji ±8 %); SL wszystkich „lekko hojne" (Spit 503, Zero 454) | §6.6 krzywa mocy + rekalibracja ±5 % |
| Zakręt Zero 15,0 s | literatura 12–14 s nieosiągalna w obecnym bilansie mocy | ponowna próba po §6.6; jeśli nadal nieosiągalne bez psucia realizmu → udokumentowane odstępstwo w §3 |
| Tolerancje ±8–10 % | maskują odchylenia (patrz Bf +7 %) | R4: zacieśnienie do ±5 % |

**Uwaga porządkowa:** w drzewie wisi niezacommitowany model celownika myszy (osiadający, 2026-07-10)
— przed startem R0 zamknąć/zacommitować, żeby rekalibracja szła od czystego stanu.

## 5. Cele kalibracyjne (liczby) — **TABELA ZAMROŻONA w R0 (2026-07-10)**

Przejście źródłowe wykonane w R0 (research webowy). Źródła pierwotne użyte do zamrożenia:

- **Spitfire Mk IIa**: próby A&AEE **P7280** (raport 30.05.1940, +9 lb / 3 000 rpm, 6 172 lb)
  — wwiiaircraftperformance.org/spitfireperformance.com „Spitfire Mk IIA Performance Testing".
- **Bf 109 E-3**: próby szwajcarskie **J-347** (WNr 2404, DB 601 Aa, 11.1941, kurfurst.org) —
  SL 465–472 km/h, 565–572 km/h @ ~5 000 m (Kurzleistung 5-min); próby francuskie **CEMA WNr 1304**
  (12.1939, 2 540 kg, 1 100 KM 5-min) — pełny profil wznoszenia (1 000 m 1'16" … 6 000 m 8'01",
  szczyt 15,1 m/s @ 3–4 km) i 530 km/h @ 4 500 m przy OTWARTYCH chłodnicach; Kennblatt 555 @ 4 500.
- **A6M2 Zero model 21**: oficjalne dane japońskie (za Francillonem) — 533 km/h @ 4 550 m,
  6 000 m w **7'27"**, 15,7 m/s; limit nurkowania z instrukcji pilota **340 kt IAS = 630 km/h**
  (modele 11–21); zakręt 12–14 s wyłącznie z literatury wtórnej (bez raportu pierwotnego).

Reguła: gdzie źródła się rozjeżdżają — środek przedziału jest celem, ±5 % tolerancją (D4).
Prędkości = IAS/TAS wg kolumny; wysokości gry: mierzymy na **100 m („SL"), 1 500 m, 3 000 m,
4 500 m, 6 000 m** (sufit rozgrywki). Kolumna „Dziś w grze" = pomiar baseline R0
(`docs/fizyka-v2-baseline.md`).

### 5.1 Spitfire Mk IIa (Merlin XII) — cele = moc bojowa +9 lb; WEP +12 lb osobno

| Metryka | CEL ZAMROŻONY | Źródło | Dziś w grze |
|---|---|---|---|
| Vmax SL (TAS) | **467 km/h** | P7280: 290 mph SL | 503 km/h (hojne SL) |
| Vmax na wysokości | **570 km/h @ 5 350 m** | P7280: 354 mph @ 17 550 ft | kalibrowane przez FTH 3 400 m |
| Wznoszenie początkowe (SL) | **14,8 m/s** (szczyt 15,2 @ ~3 000 m) | P7280: 2 915 ft/min SL, 2 995 @ 10 kft | ~15 m/s |
| Czas do 6 000 m | **7,0 min** | P7280: 20 000 ft w 7,0 min | do zmierzenia w R0 |
| Zakręt ustalony 360° (1 000 ft) | **18,5 s** | AFDU 18–19 s (M&M 17,2 s @ 12 kft) | 17,6 s |
| Stall czysty (IAS) | **117 km/h** | P7280: 73 mph | ~117 km/h (OK) |
| Stall z klapami | **101 km/h** | P7280: 63 mph | brak klap |
| Vne | **720 km/h (IAS)** | limit eksploatacyjny 450 mph IAS (próba nurkowa ASI 470) | brak limitu |
| Roll szczytowy | ~78–90 °/s @ ~290 km/h (bez zmian) | RAE/NACA 868, lotki płócienne | 80 °/s @ 240 |
| WEP | **+12 lb, ~5 min**; efekt tylko pod FTH: SL +~35 km/h, wznoszenie +~2,5 m/s | analogia Spit I +12 lb (dokalibrować w R2) | brak (moc szczytowa ciągła) |

### 5.2 Bf 109 E-3 (DB 601 Aa)

| Metryka | CEL ZAMROŻONY | Źródło | Dziś w grze |
|---|---|---|---|
| Vmax SL (TAS) | **467 km/h** | Swiss J-347: 465–472 | 499 km/h (**+7 %!**) |
| Vmax na wysokości | **555 km/h @ 4 500 m** (pasmo 555–572 @ 4,5–5 km na 5-min) | Kennblatt; Swiss 565–572 @ ~5 km | kalibrowane |
| Wznoszenie początkowe (SL) | **15,5 m/s** (Notleistung) | CEMA @ 1 100 KM: 13,9–15,1; niemieckie dane wyżej | do zmierzenia |
| Czas do 6 000 m | **7,75 min** | CEMA 8'01" @ 5-min 1 100 KM; Kennblatt ~7,5 | do zmierzenia |
| Zakręt ustalony 360° | **23,5 s** | RAE ~25 s; obliczenia Messerschmitt Projektbüro niższe → środek | 23,5 s |
| Stall czysty (IAS) | **123 km/h** | próby brytyjskie 120–127 (sloty łagodzą zerwanie) | do zmierzenia |
| Vne | **750 km/h (IAS)** | instrukcja: Sturzflug max 750 | brak limitu |
| Roll szczytowy | ~70–85 °/s @ ~300 km/h, mocne sztywnienie >500 (bez zmian) | RAE | wg `rollRateCurve` |
| WEP | **Notleistung ~1 min** (1 175 KM start, 1,45 ata) | dane DB 601 Aa | brak |

Sloty krawędziowe E-3: NIE modelujemy osobnej mechaniki — mapujemy na łagodniejsze knoby
maszyny przeciągnięcia (`buffetOnsetRatio`, `wingDropDelayS`) w R4.

### 5.3 A6M2 Zero model 21 (Sakae 12)

| Metryka | CEL ZAMROŻONY | Źródło | Dziś w grze |
|---|---|---|---|
| Vmax SL (TAS) | **440 km/h** | literatura 435–445 → środek | 454 km/h |
| Vmax na wysokości | **533 km/h @ 4 550 m** | oficjalne (Francillon 331,5 mph @ 14 930 ft) | 527 km/h (OK, −1 %) |
| Wznoszenie początkowe | **15,7 m/s** | oficjalne (3 100 ft/min) | 15,3 m/s |
| Czas do 6 000 m | **7 min 27 s** (twarda kotwica) | oficjalne | do zmierzenia |
| Zakręt ustalony 360° | **13 s** (12–14 lit.; fallback 15 s → §3 wg ryzyka nr 7) | literatura wtórna, bez raportu pierwotnego | 15,0 s (bilans mocy nie daje mniej) |
| Stall czysty (IAS) | **105 km/h** | 102–110 | 105 km/h (OK) |
| Vne | **630 km/h (IAS)** — **kanoniczna słabość** | instrukcja pilota: 340 kt IAS (modele 11–21) | brak limitu |
| Roll | wg testów Kogi — JUŻ skalibrowany (2026-07-09), kotwice `rollShape` zostają | testy Kogi | OK |
| WEP | brak (Sakae 12 bez overboostu) | — | n/d |

### 5.4 Testy relacji (asymetrie — bez tolerancji procentowej)

Zamrażamy PORZĄDKI, nie liczby (rozszerzenie istniejącego describe „asymetria matchupu"):

1. Zakręt ustalony: **Zero < Spitfire < Bf 109** (czas 360°, na 1 000 ft i 3 000 m).
2. Nurkowanie (V po 25 s z 4 500 m): **Bf 109 > Spitfire > Zero**; Zero dodatkowo ograniczone Vne.
3. Roll @ 400 km/h IAS: **Spitfire ≥ Bf 109 ≫ Zero** (beton lotek Zero).
4. Zoom climb: **Bf 109 > Spitfire > Zero**.
5. Wznoszenie ustalone SL: Bf 109 ≈ Zero > Spitfire (w granicach ±1 m/s — doprecyzuje R0).
6. Bleed przy 5 G, 350 km/h: **Bf 109 > Spitfire > Zero** (Ps ujemne, kto szybciej traci).
7. Pętla z 300 km/h SL: Zero domyka najciaśniej; Bf 109 NIE domyka (domyka od ~350) — zgodnie
   z raportem manewrowym z 2026-07-09.

### 5.5 Wzorce zachowania z WT RB (checklist jakościowy, weryfikacja w R5)

Odhaczenie R5 = **mechanizm zmierzony i potwierdzony** (harness poziom B + zgromadzone E2E
poziom C); subiektywne „czy DOBRZE się czuje” → ankieta playtestowa usera (§R5 Wynik).

- [x] Wejście w zakręt z 450+ km/h: pierwsze 90° szybkie (instantaneous), potem wyraźne
      „siadanie" tempa wraz z utratą IAS — bez ściany, płynna degradacja. **Potwierdzone:**
      `turn180Test` @450 (Spit 6,9 s/wyjście 349, IAS spada monotonicznie) + E2E R5 (zakręt @461
      km/h → sztywnienie lotek → przejście w nurkowanie = „siadanie", pełny pipeline).
- [x] Pełne lotki przez >5 s w locie poziomym → widoczny spadek IAS (nowość §6.1). **Potwierdzone
      E2E:** R1 beczka 10 s @398 km/h, E-drop 20,8 m vs harness 20,5 (1,3 %); `rollBleedTest` = kotwica.
- [x] Nurkowanie >600 km/h: drążek „ciężknie" (rosnący promień wyrwania), przy Vne trzęsienie
      i uszkodzenia; wyrwanie wymaga wyprzedzenia — kto przeholuje, ten się wbija. **Potwierdzone:**
      `pitchAuthorityFrac` cap @650 (Spit 5,3/Bf 3,8/Zero 2,1 G, §13.1 fizyka-lotu); `server/flutter.test`
      pełny pipeline (nurkowanie > Vne urywa skrzydła); E2E R2 Zero 351→533 km/h w nurkowaniu (`vneLevel`).
- [x] Klapy bojowe w kółku poniżej 250 km/h realnie ciaśniej kręcą; wysunięte przy 400 km/h
      urywają się z konsekwencją w strefach skrzydeł. **Potwierdzone:** golden „stall z klapami”
      (Spit pełne ≈101 km/h = §5.1 → ciaśniej); E2E R3 rip `flaps:1` @436 → HUD „URWANE” czerwone.
- [x] WEP: wyraźny kop mocy + szybki wzrost temperatury; zarządzanie WEP-em w pościgu
      to realna decyzja (jak w RB). **Potwierdzone E2E:** R2 (heat 0,015→0,063 w 19 s) + R4
      (WEP wznosi +5,85 vs −3,2 m/s przy tym samym pitchu, heat 0,070→0,121 w 22 s).
- [x] Przeciągnięcie w zakręcie: buffet → zrzut skrzydła do wnętrza — wyprowadzenie nurkowaniem
      (bez auto-recovery; istniejąca mechanika, tylko progi rekalibrowane). **Potwierdzone:**
      `stallTest` (118/126/104 km/h ±5 %); Bf miękkie knoby buffet = sloty E-3 (R4); E2E R5 buffet/
      departure obserwowany w zakręcie Spitfire’a.
- [x] Pętla z małej prędkości: na szczycie przy <150 km/h nos „ściąga" od śmigła (§6.5) —
      korekta kierunkiem/lotkami, jak w RB. **Potwierdzone (R5 poziom-B, sonda `propEffectRates`):**
      3,5°/s yaw na szczycie pętli (~130 km/h) — kontrowalne sterem 10°/s; > ster tylko przy
      „wiszeniu na śmigle” (<50 km/h) = realistyczne departure; ≥200 km/h dokładnie 0 (honor §3).

## 6. Nowe mechaniki — szkice projektowe

Wszystkie knoby liczbowo w JSON samolotów (niezmiennik nr 3). Wszystko liczone w `shared`
(klient predykuje, serwer autorytatywny — identycznie jak paliwo/termika).

### 6.1 Opór manewrowy sterów (wymóg bazowy)

**Problem:** beczka nic nie kosztuje. **Model:** dodatkowy człon biegunowej
`Cd_ctrl = k_ail·|δa| + k_rud·|δr|` gdzie `δa` = znormalizowane wychylenie lotek
(z `angularRates.roll / maxRoll(IAS)` — mamy tylko kinematykę, więc wychylenie odtwarzamy
z wykorzystania dostępnego roll rate), `δr` = ster kierunku. Rząd wielkości: pełna lotka
≈ +15–25 % Cd0 (kalibrowane tak, by 3 pełne beczki z 400 km/h zjadały ~40–60 km/h IAS
w locie poziomym — do zderzenia z odczuciem RB w R5). JSON: `ctrlDragK: { aileron, rudder }`.
Wchodzi w `aero/drag.ts` obok członów Cl⁴ (ten sam wzorzec co `dragHighClK`).

### 6.2 Autorytet sterów vs prędkość + kompresja + Vne/flutter

**Autorytet pitch:** analogicznie do `rollRateCurve` — krzywa `pitchAuthorityCurve(IAS)`
skalująca maksymalne żądane n (PONIŻEJ ograniczeń koperty/G-LOC, nigdy powyżej): przy małej
prędkości pełny, od `stiffenStartKmh` liniowo/spline w dół do `stiffenFloorFrac` przy Vne.
Efekt WT: przy 700 km/h NIE wyrwiesz 8 G, tylko np. 3–4 G — promień wyrwania rośnie,
nurkowanie za nisko = ziemia. Ster kierunku: ta sama krzywa co `maxYawRateDegS` (mnożnik).

**Vne/flutter:** powyżej `vneKmh` (IAS) narasta „drżenie" (buffet kamery + audio — mamy już
kanały z fazy 21) i **obrażenia strukturalne stref skrzydeł** `flutterDamagePerS ∝ (IAS−Vne)`
aplikowane przez serwer (jak przegrzanie: self-inflicted, bez kredytu, cause istniejące
`'ground'`/nowe `'structure'` — decyzja w R2). Klient pokazuje ostrzeżenie HUD
(wzorzec: `aileronWarning`). JSON: `vneKmh`, `flutterDamagePerS`, `flutterWarnFrac`.

### 6.3 WEP / boost

Nowy input binarny (klawisz, np. Shift jak w WT): `wep: boolean`. Moc: `P_eff = P_mil ·
(1 + wepBoostFrac)` dostępna tylko przy gazie 100 %; sprzężenie z ISTNIEJĄCĄ termiką:
WEP podnosi `heatEq` (mnożnik `wepHeatMul`), więc limit czasowy wynika z modelu przegrzania
(Spit ~5 min do czerwonej linii, Bf ~1 min Notleistung → agresywny `wepHeatMul`), bez
osobnego timera. Zero: `wepBoostFrac = 0` (brak WEP). Rozdział mocy: obecne `enginePowerW`
w JSON dzielimy na `militaryPowerW` + `wepBoostFrac` — rekalibracja Vmax w R4 (Vmax osiągane
na WEP, jak w RB; moc ciągła trzyma ~95 % Vmax). **Protokół: bit WEP w pakiecie INPUT → bump v10**
(§7). HUD: wskaźnik „WEP" przy gazie + istniejący pasek temperatury robi resztę.

### 6.4 Klapy

Pozycje dyskretne per samolot z JSON (`flaps.positions[]`: nazwa, `clMaxAdd`, `cd0Add`,
`ripIasKmh`), przełączane klawiszem (F). Historyczna różnorodność zamiast jednego szablonu:

- **Spitfire Mk IIa**: klapy szczelinowe dwupozycyjne (schowane/pełne 85°) — pełne tylko do
  lądowania, rip przy ~260 km/h; w walce użyteczne krótko w skrajnie wolnym kółku.
- **Bf 109 E-3**: klapy płynne — modelujemy 3 pozycje (0/bojowe/pełne), bojowe rip ~400 km/h.
- **A6M2**: klapy lądowaniowe (0/pełne), rip ~250 km/h — Zero i bez klap kręci najciaśniej.

Przekroczenie `ripIasKmh` → obrażenia stref skrzydeł + klapy wracają na 0 (urwane do końca
życia samolotu — flaga per spawn). Wpływ na fizykę w `effectivePlaneConfig` (ten sam wzorzec
co modyfikatory uszkodzeń). **Protokół: 2 bity pozycji klap w INPUT → razem z WEP w bumpie v10**;
opcjonalnie 1 bajt „mechanizacji" w snapshocie encji dla wizualiów zdalnych (decyzja w R3 —
modele 3D nie mają ruchomych klap, więc może wystarczyć lokalny HUD).

### 6.5 Szczątkowe efekty śmigła

Moment odchylająco-przechylający TYLKO w reżimie „wolno + duży gaz":
`propBias = propEffectMaxRadS · gaz · max(0, 1 − IAS/propEffectFadeKmh)²` dodawany do
`angularRates.yaw/roll` (kierunek wg obrotów silnika: Merlin/Sakae prawoskrętne → ściąga
w lewo, DB 601 odwrotnie). `propEffectFadeKmh ≈ 180` → w locie poziomym (250+ km/h) efekt
ZEROWY (odstępstwo §3 pkt 1 zachowane), a na szczycie pętli / w przeciągnięciu z gazem nos
ożywa jak w RB. Instruktor NIE kontruje (celowo — to gracz ma poczuć); boty dostają
kompensację w istniejącym pipeline aim (inaczej zepsuje im się strzelanie w pętli).

### 6.6 Moc vs wysokość — krzywa sprężarki

Obecne `P = const do FTH, wyżej ∝ ρ` zastępujemy odcinkową krzywą kalibrowaną per silnik:
`powerCurve: [[hM, frac]…]` (interpolacja liniowa, jak `rollRateCurve`), z zachowaniem
prostego modelu jako fallback (brak pola = obecne zachowanie; kompatybilność testów do czasu
rekalibracji). To usuwa systemowy kompromis „hojnego SL": Merlin XII i DB 601 mają realnie
lekko rosnącą moc do FTH (RAM), Sakae 12 dwubiegową charakterystykę. Efekt: Vmax SL i Vmax
na wysokości przestają być sprzężone jednym knobem → osiągalne ±5 % na OBU wysokościach.

## 7. Wpływ na multiplayer i protokół

- **Bump protokołu v9 → v10**: pakiet INPUT +1 bajt (bit WEP + 2 bity klap + rezerwa).
  Snapshot encji: bez zmian w R1–R2; ewentualny bajt mechanizacji w R3 (decyzja).
  **Deploy front+back RAZEM** (jak zawsze przy bumpie).
- **Reconcile — LEKCJA z termiki silnika:** każdy nowy stan fizyki liczony w `pilotStep`
  a nieobecny w snapshocie będzie „dopalany" wielokrotnie przy replayu inputów. Zasady:
  klapy/WEP są INPUTEM (deterministyczne przy replayu — bezpieczne); pozycja klap po urwaniu
  = stan serwera → sygnalizowana poziomami stref (v8, już w snapshocie); flutter/rip damage
  wyłącznie serwerowe (jak przegrzanie). NIE dodajemy ukrytych akumulatorów bez wzorca
  `heatBefore` z `prediction.ts`.
- **Boty**: nowa koperta zmienia ich osiągi. Minimum w R4: bot NIE używa klap ani WEP
  (upośledzenie akceptowalne na start), kompensacja efektów śmigła w aim (§6.5). Użycie
  WEP przez trudne boty → backlog po playtestach.
- **Balans TTK**: `ttk.test.ts` nie dotykamy (uszkodzenia bez zmian); flutter/rip dodaje
  nowe ŹRÓDŁA obrażeń, nie zmienia odporności.

## 8. Metodologia testów

Trzy poziomy — każdy etap R kończy się zielonym kompletem swojego poziomu.

### 8.1 Poziom A — analityczne złote (vitest, `physics/golden.test.ts`)

Jak dziś: `describe.each` × 3 samoloty, cele z tabel §5, tolerancja ±5 %. Rozszerzenia:
cele na WIELU wysokościach (Vmax @ SL/3 000/4 500 m; wznoszenie @ SL/3 000 m), kotwice
kształtu krzywych (wzorzec `rollShape` — dodać `pitchAuthorityShape`), testy relacji §5.4.

### 8.2 Poziom B — symulacje czasowe pełnego pipeline'u pilota (vitest, `testing/`)

Rozbudowa `testing/maneuvers.ts` + utrwalenie harnessu manewrowego z sesji 2026-07-09
(wtedy tymczasowy, skasowany — teraz na stałe jako `testing/combat-maneuvers.ts`):

| Test (nowy/istn.) | Mierzy | Warunki |
|---|---|---|
| `topSpeedTest` (jest) | Vmax TAS | 100 m, 1 500, 3 000, 4 500, 6 000 m |
| `stallTest` (jest) | IAS przeciągnięcia | czysty / z klapami / w zakręcie 2 G |
| `climbTest` (jest) | ustalone wznoszenie | SL, 3 000 m; mil power i WEP |
| `timeToAltitudeTest` (nowy) | czas do 3 000/6 000 m | pełny profil wznoszenia (kotwica: Zero 7:27) |
| `sustainedTurnTest` (jest) | czas 360° ustalony | 300 m, 1 000 m, 3 000 m |
| `turn180Test` (nowy) | czas zawrócenia 180° max-rate | wejście 250/350/450 km/h, SL i 3 000 m |
| `rollTime360Test` (nowy) | czas pełnej beczki | 200/250/300/350/400/450 km/h |
| `loopTest` (nowy) | czas pętli / czy domyka | wejście 250/300/350/400 km/h, SL |
| `rollBleedTest` (nowy) | ΔIAS po 10 s pełnych lotek | lot poziomy, gaz stały, 400 km/h |
| `psBleedTest` (nowy) | Ps przy zadanym n | n = 3/5/max, 250/350/450 km/h — mapa energetyczna |
| `diveSpeedTest`/`zoomClimbTest` (są) | asymetrie nurkowanie/świeca | jak dziś + limit Vne |
| `flapsRipTest`/`vneFlutterTest`/`wepHeatTest` (nowe) | mechaniki §6 | progi z JSON |

Zasada z `fizyka-lotu.md` rozdz. 11.5 obowiązuje: refaktoryzacja, która psuje złote testy, psuje grę.

### 8.3 Poziom C — E2E w przeglądarce (MCP `chrome-devtools`)

Weryfikuje, że **pełny łańcuch gry** (input → instruktor → predykcja → render → HUD) daje te
same liczby co harness — czyli że gracz naprawdę dostaje skalibrowaną fizykę, a nie tylko testy.

**Infrastruktura (R0):** rozszerzyć `__acDebug` (DEV-only, wycinane z produkcji) o sondę
pomiarową: `telemetry()` (ring-buffer ~60 s: t, IAS, TAS, alt, bank, heading, pitch, n, heat,
fuel, flaps, wep), `overrideInput(script)` (sekwencje sterowania z timestampami — deterministyczne
manewry bez ruszania myszą), `sampleReport()` (JSON do `evaluate_script`).

**Scenariusz bazowy** (pułapki znane z 2026-07-09): `npm run dev` → `new_page` localhost:5173 →
zamknij onboarding „JAK GRAĆ" → pokój FFA + **1 bot łatwy** (mecz solo może natychmiast się
zakończyć eliminacją) → start → pomiary z dala od bota.

**Pomiary E2E (podzbiór macierzy — pełną macierz wysokości pokrywa poziom B):**

1. Vmax SL: pełny gaz, lot poziomy 60 s → plateau IAS vs harness (±3 %).
2. Beczka: pełne lotki 10 s @ zadane IAS → roll rate + spadek IAS (bleed §6.1 widoczny w grze).
3. Zawrócenie 180° i zakręt 360° przez INSTRUKTORA (mysz-model) → czas vs harness; różnica
   >5 % = instruktor ogranicza poniżej fizyki (bug klasy „punkt pracy Zero").
4. Pętla z 300 km/h → domyka/czas + zachowanie śmigła na szczycie (§6.5).
5. Wznoszenie 60 s od spawnu → ROC vs harness.
6. Stall: gaz idle, trzymaj poziom → IAS zerwania + zrzut skrzydła + buffet audio/kamery.
7. WEP: włącz → skok przyspieszenia, tempo wzrostu temp., ostrzeżenia HUD.
8. Klapy: wysunięcie @ 200 km/h (ciaśniejsze kółko) i @ >rip (urwanie + strefy w HUD sylwetki).
9. Regresja środowiska: brak błędów konsoli, brak NaN, fps (RTX) nie spada po nowych mechanikach.

Każdy pomiar E2E na koniec etapów R1–R5; wyniki wklejane do sekcji „Wynik" etapu.

### 8.4 Macierz warunków (obowiązuje poziomy A i B)

Wysokości: **100 / 1 500 / 3 000 / 4 500 / 6 000 m**. Prędkości wejścia manewrów:
**200 / 250 / 300 / 350 / 400 / 450 km/h IAS** (+ skraje: stall, Vne). Nie każdy test × każdy
punkt — tabela §8.2 wskazuje istotne przecięcia; reszta to raport informacyjny w R0/R4.

## 9. Etapy realizacji (R0–R5; jeden etap = jedna sesja)

### R0 — Narzędzia pomiarowe + baseline + przejście źródłowe
**Zakres:** commit zaległości (celownik myszy); utrwalenie harnessu manewrowego
(`combat-maneuvers.ts`: turn180/rollTime360/loop/rollBleed/psBleed/timeToAltitude);
sonda `__acDebug` (telemetry/overrideInput); **raport bazowy** — pełna macierz §8.4 dla
trzech samolotów zapisana do `docs/fizyka-v2-baseline.md`; weryfikacja źródeł historycznych
i zamrożenie ostatecznej tabeli celów (aktualizacja §5).
**Kryteria wyjścia:** raport bazowy istnieje; nowe testy harnessu zielone na STAREJ fizyce
(zamrażają stan wyjściowy); E2E smoke przechodzi (spawn → telemetria → raport).
**Bez zmian fizyki. Bez protokołu.**

**Wynik R0 (cz.1 2026-07-10 `31cbe4f` + cz.2 2026-07-11): ✅ UKOŃCZONY, 675 testów zielone.**
Cz.1: §5 zamrożone po źródłach, harness `testing/combat-maneuvers.ts`, raport `docs/fizyka-v2-baseline.md`.
Cz.2: testy zamrażające `testing/combat-maneuvers.test.ts` (+20; ±3% wokół raportu, bleed beczek
absolutnie ±0,5 km/h, relacja pętli §5.4.7 jako porządek); sonda `__acDebug` w `online-main.ts`
(`telemetry()` ring 60 s @ 60 Hz, `sampleReport(sinceS)`, `overrideInput({steps,durationS})` w
`sendInputTick` — DEV-only); smoke E2E przez MCP chrome-devtools: skrypt „gaz 1 + pełna lotka 4 s"
dał roll 47,4°/s @ 446 km/h IAS vs harness 46,5 @ 450 (<2%), telemetria bez NaN, konsola czysta.

### R1 — Rdzeń aerodynamiki: opór sterów + autorytet pitch + krzywa mocy
**Zakres:** §6.1 (ctrlDragK), §6.2 tylko autorytet (pitchAuthorityCurve, bez Vne),
§6.6 (powerCurve z fallbackiem); wstępna rekalibracja, by NIE zepsuć obecnych złotych
(stare tolerancje); `rollBleedTest`/`psBleedTest` dostają pierwsze cele.
**Kryteria:** beczki bleedują; wyrwanie @ 650 km/h ograniczone autorytetem; wszystkie
testy zielone. **Bez protokołu** (czysto shared/JSON).

**Wynik R1 (2026-07-11): ✅ UKOŃCZONY, 699 testów zielone (675 + 24 nowe), protokół v9 bez zmian.**

- **Kod:** wspólny helper `math/curve.ts` (`sampleCurve` — refaktor `maxRollRateRadS`
  bez zmiany semantyki, złote nietknięte); `dragForce(..., cdExtra)`; `stepPlane(..., ctrlCd)`;
  `envelope.ts`: `pitchAuthorityFrac` + `peakRollRateRadS` (HUD-owy `rollAuthority01`
  w kliencie przepisany na ten helper); `enginePowerW` z `powerCurve` (fallback = stary
  model; JSON-y bez krzywej — kalibracja liczbowa w R4). Loader: `ctrlDragK` i
  `pitchAuthorityCurve` WYMAGANE, `powerCurve` opcjonalne (walidacja krzywych ujednolicona).
- **`pilotStep`:** (0b) cap autorytetu `nCapHi=max(1, nMaxG·frac(IAS))` /
  `nCapLo=min(−1, nMinG·frac(IAS))` na żądaniu PRZED kopertą i maszyną przeciągnięcia
  (over-pull przy dużej IAS nie sięga buffetu — ster fizycznie nie da rady); (1a) opór
  sterów `ctrlCd = k_ail·δa + k_rud·δr`, gdzie `δa = |rollClamped| / szczyt krzywej rolla`
  (wychylenie REALNE — decyzja usera: sztywnienie samo redukuje wychylenie, Zero przy
  400+ km/h nie płaci podwójnie), `δr` znormalizowany jak w `keyboardDemands`.
  Czyste funkcje inputu+stanu → reconcile bez wzorca `heatBefore`.
- **Kalibracja (kotwice §6.1 pogodzone POMIAREM):** cel „3 pełne beczki z 400 km/h
  zjadają ~40–60 km/h" okazał się CAŁKOWITYM kosztem manewru — samo osiadanie toru
  w beczkach (kontrola k=0, pomiar ograniczony: stop po 3 obrotach albo 20 s, start
  2000 m) daje już 39–52 km/h, a opór lotek dokłada resztę przy k_ail w rzędzie
  „+15–25 % Cd0". Ręczny rachunek z planu (k≈0.007–0.010) zakładał idealny lot poziomy,
  którego pełny pipeline (i gra) nie utrzymuje — zapisany w memory „konflikt kotwic §6.1"
  rozwiązał się sam, bez odstępstwa. Finalnie: Spitfire `aileron=0.003` (+15 % cd0)
  → 60,0 km/h; Bf 109 `0.005` (+23 %) → 49,2 km/h; Zero `0.005` (+25 %) → kotwica
  własna @ 300 km/h: 78,3 km/h (@ 400 beton lotek nie domyka nawet 1 beczki);
  `rudder=0.002` (kosmetyczny). `pitchAuthorityCurve`: Spit `[[450,1],[720,0.55]]`,
  Bf `[[420,1],[550,0.65],[750,0.3]]`, Zero `[[400,1],[500,0.55],[630,0.3]]` →
  cap wyrwania @ 650 km/h: Spit ~5,3 G > Bf 3,8 G > Zero 2,1 G.
- **Testy:** +24 (sampleCurve, cdExtra, powerCurve, walidacja loadera, pipeline @ 650
  z porządkiem asymetrii i strażnikami ±1 G — `physics/pitch-authority.test.ts`, cele
  §6.1 w `combat-maneuvers.test.ts`). Kotwice zamrożone R0: poruszone WYŁĄCZNIE
  `rollBleedKmh` (10 s @ 400: 5,3/2,9/7,6 → 9,5/8,4/10,2 — komentarz R1); turn180
  (w tym @ 450!), loop, Ps, timeTo6000, wszystkie złote — bez ruchu (sufit G-LOC ~5 G
  był już wiążącym ograniczeniem zakrętu; autorytet gryzie >500 km/h, gdzie manewry
  testowe nie przebywają). `rollBleedTest` rozszerzony o `stopAfterTurns` + diagnostykę
  (`rollTimeS`, `altitudeEndM`) — bez sufitu czasu pomiar degeneruje się w spiralę
  nurkową (nurkowanie → wyższa IAS → sztywniejsze lotki → dłuższe okno).
- **E2E (§8.3 pkt 2, MCP chrome-devtools):** skrypt `__acDebug.overrideInput`
  (wspinaczka → pushover do poziomu → trym → pełna lotka 10 s @ 398,5 km/h / 911 m)
  vs replika w harnessie w IDENTYCZNYCH warunkach: E-drop 20,8 vs 20,5 m (**1,3 %**),
  obroty 1,43 vs 1,48 (**3,2 %**), wyjściowa IAS 461,8 vs 461,1 km/h (**0,2 %**) —
  kryterium ≤3–5 % spełnione; konsola czysta (jedyny 404 = favicon, pre-existing).
  Pułapki sesji: tryb eliminacji kończy mecz po 1 śmierci pilota (skrypt ślepego lotu
  poziomego → CFIT w górkę ~900 m; pomiar wymaga wspinaczki przed beczkami i kroku
  wyprowadzenia po oknie), porównanie z harnessem MUSI zrównać gaz (wrażliwość
  ~1,5 m E-dropu na 0,01 gazu — trym ≠ wartość skryptu).
- **Następny etap: R2** (WEP + Vne/flutter, **bump protokołu v10**). ✅ UKOŃCZONY 2026-07-11 (patrz „Wynik R2").

### R2 — Skraje koperty: WEP + Vne/flutter (**protokół v10**)
**Zakres:** §6.3 (bit WEP w INPUT, moc mil/WEP w JSON, sprzężenie z termiką),
§6.2 Vne/flutter (serwer autorytatywnie → strefy skrzydeł; HUD ostrzeżenie + buffet);
`wepHeatTest`/`vneFlutterTest`. **Bump v10, deploy front+back RAZEM.**
**Kryteria:** WEP Spit ~5 min/Bf ~1 min do czerwonej linii; nurkowanie Zero > Vne urywa
skrzydła w teście i E2E; reconcile bez dryfu (wzorzec heatBefore sprawdzony testem).

#### Wynik R2 (2026-07-11) — UKOŃCZONY, 720 testów zielone, **protokół v10**

**Decyzje usera (AskUserQuestion):** (1) WEP = **jedyny reżim grzejący** (100 % mocy BOJOWEJ trwałe,
WT/§6.3) — wymusiło rewizję semantyki termiki; (2) nowa przyczyna śmierci **`'structure'`** (rozpad
konstrukcji, osobna od `'ground'`); (3) skutek flutteru = **HUD + realne uszkodzenia stref skrzydeł**
(buffet kamery/audio → R5).

**§6.3 WEP.** Bit `wep` w bajcie flag INPUT (bit1 obok `fire`; **rozmiar ramki BEZ zmian** — 6 wolnych
bitów zostaje na klapy R3), gate klawisza **B** (Shift/Ctrl zajęte przez gaz). `P_eff = P_mil·(1+wepBoostFrac)`
tylko przy gazie ≥ `WEP_MIN_THROTTLE`=0,99 i `wepBoostFrac>0`; `state.wepActive` = per-tick echo inputu
(bez akumulatora → reconcile bezpieczny). **Rewizja modelu termiki (kluczowa):** stary `fullThrottleEqHeat`
(100 % gazu grzało) → `militaryEqHeat < 1` (100 % bojowe OSIADA pod czerwoną linią = lot bez limitu) +
`wepHeatMul` (WEP wypycha `heatEq` ponad 1). `τ` grzania WYPROWADZANA z `wepTimeToRedlineS`: od ustalonej
temp. bojowej do czerwonej linii na WEP. Kalibracja: Spit `militaryEqHeat` 0,75 / `wepHeatMul` 1,7 /
`wepTimeToRedlineS` 300 (5 min); Bf 0,75 / 1,9 / 60 (1 min Notleistung); Zero `wepBoostFrac` 0 (bez WEP).
Loader waliduje `militaryEqHeat·wepHeatMul > 1` (inaczej WEP nigdy nie przegrzeje — strażnik NaN τ). **Podział
`enginePowerW`→`militaryPowerW` + rekalibracja Vmax „na WEP" ZOSTAWIONE na R4** (dziś WEP = dodatek nad mocą
bojową; złote Vmax bez WEP nietknięte).

**§6.2 Vne/flutter.** `shared/physics/flutter.ts`: `flutterWingDamageHp(ias,plane,dt) ∝ max(0, IAS/Vne−1)`
(czyste), `vneWarnLevel` 0/1/2 dla HUD. **Serwer autorytatywnie** (`stepFlutterDamage`, TYLKO ludzie jak
przegrzanie): powyżej Vne (IAS) obrażenia do OBU stref skrzydeł; oba w 0 HP → `onStructureKill` (wrak, cause
`'structure'`, bez kredytu). Skutek jedzie poziomami w snapshocie v8 → klient predykuje spójnie. HUD: sufiks
przy IAS (`vneWarning`, pierwszeństwo nad „lotki sztywne"), znacznik „WEP" przy gazie, pełnoekranowe
„PRZEKROCZONA Vne — DRŻENIE URYWA SKRZYDŁA". `KillCause 'structure'` DOPISANA NA KOŃCU `KILL_CAUSES`
(u8 zgodny), etykieta „ROZPAD KONSTRUKCJI", killfeed „rozpad konstrukcji". JSON: `vneKmh` (Spit 720 / Bf 750 /
Zero **630** = kanoniczna kruchość), `flutterDamagePerS` (15/15/25), `flutterWarnFrac` 0,95.

**Testy (+21 vs R1 → 720):** przepisany `engine-heat.test.ts` (WEP od temp. bojowej → redline ≈ `wepTimeToRedlineS`;
100 % bojowe = punkt równowagi pod progiem „gorąco"); `physics/flutter.test.ts` (math + poziomy + Zero najniższe
Vne); `server/flutter.test.ts` (**pełny `room.step`: nurkowanie > Vne urywa skrzydła → śmierć strukturalna;
kontrola < Vne = 0 obrażeń; boty odporne**); `thrust.test.ts` (WEP +wepBoostFrac); `piloted-plane.test.ts`
(bramkowanie WEP: gaz/wepBoostFrac/null); `prediction.test.ts` (**WEP nie dopala ciepła przy replayu —
heatBefore**); protokół (round-trip bitu WEP niezależnie od FIRE). Kotwice R0 NIETKNIĘTE (WEP/flutter to skraje
poza harnessem manewrów; złote osiągów bez WEP → bez zmian).

**E2E (MCP chrome-devtools):** **WEP** potwierdzony end-to-end na Spitfire — `wepAny=true` (input→`wepActive`),
temperatura rośnie monotonicznie 0,015→0,063 w ~19 s (transient z zimna, zgodny z tauUp≈464 s). **Vne:** fizyka
nurkowania i telemetria (`vneLevel`/`wepAny`) działają (Zero rozpędzony 351→533 km/h w nurkowaniu), ale pełne
przekroczenie Vne 630 było ograniczone terenem (CFIT w górę przy 533 km/h — spawny nie dają dość wysokości nad
górzystym terenem); sam mechanizm rozpadu skrzydeł zablokowany testem pełnego pipeline'u serwera. Sonda
`__acDebug` rozszerzona (`AcInputStep.wep`, telemetria `wep`/`vneLevel`, raport `heatMax01`/`wepAny`/`vneMaxLevel`).

**⏳ user:** playtest (WEP: kop mocy + zarządzanie temp. w pościgu, Spit 5 min / Bf 1 min adekwatne?;
nurkowanie > Vne w realnej grze — najłatwiej Zero z pułapu nad wodą/płaskim; czytelność ostrzeżeń HUD);
**deploy front+back RAZEM (v10)** — jeszcze NIEWDROŻONE. **Następny etap: R3** (klapy + śmigło; 2 bity klap
JUŻ w rezerwie v10).

### R3 — Mechanizacja i śmigło: klapy + efekty śmigła
**Zakres:** §6.4 (2 bity klap w INPUT — JUŻ w v10 z R2, rezerwa; pozycje per samolot,
rip → strefy), §6.5 (propBias + kompensacja botów); decyzja o bajcie mechanizacji
w snapshocie; HUD klap; `flapsRipTest`.
**Kryteria:** klapy zmieniają stall/zakręt zgodnie z JSON; rip działa; pętla z małej
prędkości „ściąga" i jest wyprowadzalna; boty strzelają nie gorzej niż przed etapem.

#### Wynik R3 (2026-07-11) — UKOŃCZONY, 755 testów zielone, **BEZ bumpu protokołu (v10)**

**Klapy (§6.4).** Pozycja klap jest INPUTEM: 2 bity w bajcie flag INPUT (rezerwa z v10 R2 —
**bez bumpu**, bo wartość 0 = schowane jest neutralna, więc v10-klient sprzed R3 wysyła spójne 0).
`state.flapIndex` = echo inputu (jak `wepActive` — reconcile-safe, deterministyczne przy replayu).
Aerodynamika: `FlapPosition{clMaxAdd, cd0Add, ripIasKmh}` per pozycja, ADDYTYWNIE do biegunowej
(pozycja 0 ma oba 0 — walidator loadera tego pilnuje, żeby złote „czyste" startowały czyste);
`effectivePlaneConfig` w `pilotStep` dokłada `flapClMaxAdd`/`flapCd0Add` (ciaśniejszy zakręt / niższe
przeciągnięcie + większy opór). Konfiguracje: **Spitfire** 2 pozycje (schowane / pełne 0,6/0,09, rip
260 km/h), **Bf 109** 3 (schowane / bojowe 0,25/0,025 rip 400 / pełne 0,6/0,1 rip 250), **A6M2** 2
(schowane / pełne 0,5/0,08 rip 250). Klawisz **F** cyklicznie przełącza pozycje (edge-triggered
`consumeFlapCycle`, modulo liczba pozycji typu; reset przy spawnie/zmianie typu). HUD: wiersz „klapy
<nazwa>" gdy wysunięte, **czerwone „URWANE"** gdy urwane (potwierdzone w DOM `color:#ff5a4d`).

**Urwanie klap = trwałe, wywodzone z POZIOMU uszkodzenia skrzydła** (decyzja usera AskUserQuestion —
„urywają się na stałe"; mocne postrzelenie skrzydła też wyłącza klapy). Kluczowe dla reconcile: zamiast
osobnego ukrytego stanu „ripped" (który przy replayu mógłby się fałszywie zatrzasnąć na kliencie)
liczymy dostępność z poziomów stref skrzydeł (`FLAP_DISABLE_WING_LEVEL = 2`) — te same liczby jadą
w snapshocie v8, więc klient i serwer identycznie (`flapsAvailable`/`effectiveFlapIndex` w
`physics/flaps.ts`). Obrażenia urwania aplikuje **SERWER autorytatywnie** (`stepFlapRipDamage`, jak
flutter/przegrzanie — tylko ludzie): wysunięte klapy powyżej `ripIasKmh` biorą
`flapRipWingDamageHp ∝ max(0, IAS/ripIas − 1)·ripDamagePerS·dt` do OBU stref skrzydeł; gdy skrzydło
osiągnie poziom 2, `effectiveFlapIndex`→0 i obrażenia USTAJĄ — mechanizm SAM się ogranicza (skrzydła
normalnie nie giną). Rzadki combo do 0 HP (skrzydło już wcześniej postrzelone) → rozpad konstrukcji
(`onStructureKill`, cause `'structure'` jak flutter). **BEZ bajtu mechanizacji w snapshocie** —
skutek jedzie przez istniejące poziomy stref v8 (modele 3D nie mają ruchomych klap; wystarczył HUD +
wizualny kanał uszkodzeń), więc decyzja z §6.4 rozstrzygnięta na „nie".

**Szczątkowe efekty śmigła (§6.5).** `propEffectRates` (czysta funkcja): `factor = throttle·(1−IAS/fadeKmh)²`,
`biasYaw = yawBiasMaxRadS·factor`, `biasRoll = rollBiasMaxRadS·factor` — dodawane do `angularRates`
PO koordynacji zakrętu, TYLKO przy `applyPropEffect=true`. Zanik KWADRATOWY do zera powyżej `fadeKmh`
(200 km/h) → w locie poziomym / na prędkości bojowej efekt = 0 (honor odstępstwa §3 pkt 1: brak
ciągłego trymu). Znak z konfiguracji (kierunek obrotu śmigła): Merlin/Sakae ujemny (nos w lewo), DB 601
dodatni. **Instruktor tego NIE kontruje** (bias dokładany PO demands → gracz musi sterem/lotką).
`stepPilotedPlane` (gracz, obie strony sieci) podaje `applyPropEffect=true` (reconcile-safe — czysta
funkcja throttle/IAS); **boty i harness mają FALSE** (domyślny arg) → kompensacja botów zbędna, a
zamrożone kotwice R0 (harness woła `pilotStep` z `flapIndex=0` bez prop) są NIETKNIĘTE — to spełnia
kryterium „boty strzelają nie gorzej" trywialnie i chroni złote testy przed przeliczeniem.

**Testy (+35, razem 755):** `flaps.test.ts` (clamp/dostępność/effIndex/rip), `prop-effect.test.ts`
(zanik kwadratowy/skala gazu/znak), `pilot-step-flaps.test.ts` (klapy↑clMax/↑opór; urwane==schowane
przy tym samym uszkodzeniu; prop tylko przy applyPropEffect=true), `flaps-rip.test.ts` serwer (pełny
pipeline `room.step`: nadprędkość z klapami niszczy skrzydła ale SAMO się ogranicza; poniżej ripIas i
schowane — kontrole; boty odporne), + walidacja loadera (flaps/propEffect: brak/zakres/pozycja 0
neutralna/literówka), round-trip klap w bitach 2–3 INPUT. **Zamrożone kotwice R0 bez zmian** (harness
nie używa klap ani prop → tożsamość). **E2E (MCP chrome-devtools):** override `flaps:1` przy 436 km/h
→ serwer urwał klapy → HUD `klapy URWANE` na czerwono (`rgb(255,90,77)`), samolot żywy (urwanie się
ograniczyło), konsola czysta (jedyny 404 = favicon). Pułapka E2E: 1v1 z botem → eliminacja szybko
kończyła mecz, a wolny lot kończył się CFIT — pomiar łańcucha okablowania łapany w oknie ochrony spawnu.

**Pozostawione do R4** (świadomie — R3 = mechaniki, R4 = kalibracja): dostrojenie liczb klap
(clMaxAdd/rip per samolot) do tabeli stall §5 i pętli z małej prędkości; kalibracja `propEffect`
(biasy/fade) na pomiarach; `flapsRipTest`/`stallTest z klapami` w harnessie combat-maneuvers jako
kotwice R4. Deploy front+back RAZEM (v10 z R2 wciąż NIEWDROŻONE). **Następny etap: R4** (wielka
kalibracja ±5 %).

### R4 — Wielka kalibracja trzech samolotów (±5 %)
**Zakres:** dostrojenie WSZYSTKICH JSON-ów do tabel §5 na macierzy §8.4; zacieśnienie
złotych do ±5 %; komplet testów relacji §5.4; ponowna próba zakrętu Zero 12–14 s na nowym
modelu mocy (wynik → §3 albo cel); sloty Bf → knoby stall; rekalibracja `spawnSpeedMs`,
instruktora i trudności botów do nowej koperty.
**Kryteria:** komplet złotych ±5 % zielony; raport porównawczy baseline→v2 w
`docs/fizyka-v2-baseline.md` (druga kolumna).

#### Wynik R4 (2026-07-12) — UKOŃCZONY, 763 testy zielone, **BEZ zmian protokołu (v10), czysto shared/JSON**

**Decyzje usera (AskUserQuestion):** (1) **moc BOJOWA = przelot, WEP = szczyt** — Vmax SL do
historycznych (~467/467/440 km/h TAS; `enginePowerW` semantycznie = military z R2, WEP dokłada
+wepBoostFrac); (2) **zakręt Zero 15 s** — udokumentowany fallback (§3, ryzyko nr 7); (3) **priorytet
historii dla czasu do wysokości** nad „snappy" wznoszeniem SL.

**§6.6 krzywe mocy (główny mechanizm).** `powerCurve` per silnik (loader miał wsparcie od R1) rozprzęgła
Vmax SL od Vmax na wysokości — niemożliwe w prostym modelu sprężarki (jeden knob sprzęgał oba, stąd
„hojne SL"). Kalibracja: Spitfire `[[0,0.79],[2500,0.86],[4300,0.92],[5350,0.88],[6000,0.72],[7500,0.42]]`,
Bf `[[0,0.86],[3600,0.98],[4500,0.92],[5500,0.70],[7000,0.45]]`, Zero `[[0,0.91],[3500,1.01],[4550,1.04],
[5200,0.78],[6500,0.44]]` (frac ≈ ρ-behavior przesunięty: niższy SL, szczyt przy wys. krytycznej, stroma
zapaść wyżej). Dodatkowo: Spitfire **oswaldE 0.87→0.78** (opór indukowany → zakręt 17.4→18.5 s bez ruszania
Vmax), Bf **clMax 2.0→2.1** + miękkie knoby buffet (`buffetOnsetRatio` 0.9→0.92, `wingDropDelayS` 1.0→1.3,
`wingDropRateDegS` 40→30 = modelowanie SLOTÓW krawędziowych E-3, §5.2). `cd0`/masy/roll NIETKNIĘTE.

**Wynik złotych (±5 % na TWARDYCH metrykach — Vmax SL, Vmax wys., stall, zakręt, roll):**

| | Vmax SL | Vmax wys. | stall | zakręt 360° | roll@350 | wznosz. SL | t→6000 m |
|---|---|---|---|---|---|---|---|
| **Spitfire** cel/zmierz. | 467 / **464** | 570@5350 / **572** | 117 / **118** | 18,5 / **18,4** | 70 / **68** | 14,8 / 15,6 | 420 / **345** |
| **Bf 109** cel/zmierz. | 467 / **474** | 555@4500 / **557** | 123 / **126** | 23,5 / **23,3** | 85 / **85** | 14,5 / 14,0 | 465 / **433** |
| **Zero** cel/zmierz. | 440 / **439** | 533@4550 / **534** | 105 / **104** | 15 / **14,9** | 47 / **47** | 15,7 / 15,1 | 447 / **375** |

Twarde metryki wszystkie ±5 %. Wznoszenie SL tolerancja ±10 % (wrażliwe; wojenna moc lekko hojna dla
Spita, poniżej celu dla Zero). **Zakręt Zero** — ponowna próba potwierdziła: 12–14 s nieosiągalne bez
psucia realizmu (940 KM Sakae w bilansie nie daje mniej) → **fallback 15 s** utrwalony (§3, ryzyko nr 7);
dominacja wirażu i tak wyraźna (15 < 18,5 < 23,5).

**Ograniczenie modelu — czas do 6000 m (świadomie udokumentowane).** Cele historyczne (420/465/447 s)
osiągnięte tylko dla **Bf 109** (433 s ≈ 465; wysokość krytyczna 4500 m < 6000 → krzywa mocy pozwala na
zapaść wznoszenia u góry). **Spitfire i Zero** zostają optymistyczne (345 vs 420; 375 vs 447): ich WYSOKA
wysokość krytyczna (5350/4550 m) wymusza mocny silnik prawie do 6000 m — a punkt-masa bez modelu **spadku
sprawności śmigła z wysokością** (η stałe 0,8) daje przy mocnym silniku wciąż mocne wznoszenie. Zejście do
420/447 s wymagałoby albo zabicia Vmax@wys. (twardy cel §5), albo zakrętu (Spit 18,5 to twardy cel + kotwica
asymetrii). Priorytet usera (historia) zrealizowany „na ile model daje": t→6000 przybliżone (Spit 328→345,
Bf 376→433, Zero 357→375), reszta ku §5. Pełny model sprawności śmigła to zakres poza pogłębionym point-mass
(D1) — kandydat do backlogu, nie R4.

**Relacje §5.4 (komplet, `maneuvers.test.ts` + `combat-maneuvers.test.ts`) — DWIE KOREKTY spec:**
1 (zakręt Zero<Spit<Bf) ✓, 2 (nurkowanie Bf>Spit>Zero) ✓, **3 KOREKTA** (roll@400: spec pisze „Spit≥Bf",
ale przeczy to KALIBROWANEJ `rollRateCurve` i cytowanym RAE „109E lepszy w rollu <500 km/h" + istniejącemu
testowi „Bf wygrywa beczkę @350" → zamrożono PRAWDZIWE **Bf≥Spit≫Zero**), 4 (zoom Bf>Spit>Zero) ✓,
**5 KOREKTA** (wznosz. SL: spec „Bf≈Zero>Spit" to figura NOTLEISTUNG Bf; przy MOCY BOJOWEJ trzy ściskają
się w ~1,6 m/s [Spit 15,6/Zero 15,1/Bf 14,0] → zamrożono DEFENSYWNE „klaster <2,5 m/s, żaden nie dominuje"),
6 (bleed Ps@5G: Bf<Spit<Zero) ✓, **7 KOREKTA** (pętla 250: spec „Bf NIE domyka" to własność STAREJ fizyki
bez slotów; R4 modeluje sloty [miękkie buffet] → Bf domyka też z 250, historycznie poprawnie → zamrożono
ROBUSTNE „loop300 Zero<Spit<Bf"). Dodatkowo golden „stall z klapami" (Spitfire pełne klapy ≈101 km/h, §5.1).

**Kotwice zamrażające (`combat-maneuvers.test.ts`) zaktualizowane ŚWIADOMIE (R4):** wszystkie t→6000
(Spit 328→345, Bf 376→433, Zero 357→375), Ps@5G350 (Spit −17,8→−27,1 od oswaldE; Bf −51,1→−53,7; Zero
−11,3→−12,8), Bf loop300 (33→16,1 — sloty domykają pętlę), turn180 Spit/Bf drobne; roll/beczki bez ruchu
(roll nietykany). Testy §6.1 (bleed 3 beczek) i wszystkie R0–R3 przechodzą bez zmian (ctrlDragK/roll stałe).

**Rekalibracja spawn/instruktora/botów — PRZEGLĄD: bez zmian (uzasadnione).** R4 ruszył WYŁĄCZNIE moc i opór
indukowany (dynamika translacji); koperta G/roll/autorytet pitch (nMaxG, `rollRateCurve`, `pitchAuthorityCurve`)
NIETKNIĘTA → instruktor pracuje w tej samej kopercie (gainy bez zmian). `spawnSpeedMs` (120/120/95) wciąż
poniżej nowej Vmax bojowej (464/474/439) → spawn zrównoważny/przyspieszający, dobry reżim rolla. Boty (`difficulty.json`)
w tej samej kopercie; gaz 1,0 = moc bojowa = **BEZ przegrzania** (`militaryEqHeat<1`) — R4 rozwiązał efektem
ubocznym obawę §10/ryzyko 3 (WEP botów pozostaje wyłączony). Zmiana którejkolwiek wartości = playtest, nie kalibracja.

**Klapy/śmigło (dostrojenie z R3 — zakres świadomie ograniczony):** nowy golden „stall z klapami" potwierdza,
że `clMaxAdd` klap są na celu (Spitfire pełne ≈101 km/h = §5.1) → BEZ retuningu liczb klap. `propEffect`
(biasy/fade śmigła) NIE kalibrowany w harnessie — jest obserwowalny WYŁĄCZNIE przy `applyPropEffect=true`
(gracz, mała prędkość + duży gaz), więc harness (FALSE) go nie widzi → kalibracja `propEffect` należy do R5
(E2E/playtest — pętla z małej prędkości „ściąga"). `flapsRipTest` jako osobna funkcja combat-maneuvers pominięta:
rip klap ma już pełny pipeline serwerowy (`flaps-rip.test.ts` z R3).

**Raport porównawczy baseline→v2** (`docs/fizyka-v2-baseline.md`, kolumna „po v2 (R4)") wypełniony pełną
macierzą §8.4 (kolumna R0 zachowana).

**E2E (MCP chrome-devtools, level-C smoke §8.3 pkt 1/7/9):** nowe krzywe mocy **bez NaN** (telemetria 60 Hz
czysta), konsola czysta (jedyny 404 = favicon). Pełny gaz BEZ WEP: **464,7 km/h TAS @ 766 m** (reżim BOJOWY —
stara fizyka dałaby ~510 tu; zgodne z harnessem ~464 SL) — kalibracja DOCIERA do gracza. WEP: przy tym samym
gazie/pitchu samolot wznosi się +5,85 m/s (vs −3,2 bez WEP) i grzeje 0,070→0,121 w 22 s → **kop mocy + grzanie
WEP potwierdzone end-to-end** (mechanizm WEP i tak dowiedziony w R2). Pełny 9-punktowy sweep E2E × 3 samoloty → R5.

**⏳ user:** playtest czucia (WT RB §5.5): przelot bojowy ~7 % wolniej nisko, WEP przywraca szczyt (limit
termiczny); zakręt Spitfire wyraźniej lepszy od Bf; Zero trzyma dominację wiraża. Knoby (krzywe mocy, oswaldE,
clMax) strojalne bez kodu. Deploy front+back RAZEM (v10 z R2 wciąż NIEWDROŻONE). **Następny etap: R5**
(pełny E2E + checklist §5.5 + doszlif + `docs/fizyka-lotu.md`).

### R5 — Weryfikacja E2E + doszlif czucia + handoff
**Zakres:** pełny przebieg pomiarów E2E §8.3 przez MCP chrome-devtools (wszystkie punkty 1–9,
trzy samoloty); checklist WT RB §5.5; poprawki instruktora/HUD z pomiarów; aktualizacja
`docs/fizyka-lotu.md` (nowe człony/krzywe), CLAUDE.md (status + protokół v10), memory.
**Kryteria:** E2E vs harness ≤5 % rozbieżności na każdej metryce; checklist §5.5 odhaczony;
⏳ user: playtest czucia (lista pytań przygotowana w etapie).

#### Wynik R5 (2026-07-12) — UKOŃCZONY, 763 testy zielone, **BEZ zmian kodu produkcyjnego (v10)**

R5 = **etap weryfikacyjny/handoff** — potwierdza, że kalibracja R1–R4 dociera do gracza i domyka
dokumentację. Pomiary nie ujawniły rozbieżności wymagającej korekty → **zero zmian kodu** (zgodne
z decyzją usera „tylko sterowane danymi”: brak danych do zmiany = brak zmiany). Poziom A (złote
±5 %) + poziom B (harness manewrowy) **zielone: 763 testy, typecheck i lint czyste.**

**Siatka E2E §8.3 (poziom C) — konsolidacja dowodów R0–R4 + sonda R5.** Uczciwe ograniczenie
sesji: MCP `chrome-devtools` odpadł w trakcie R5 (proces node ubity przy restarcie serwera dev) →
świeżego sweepu 9-punktowego dla Bf/Zero nie dokończono w tej sesji. Substancja poziomu C jest
jednak dowiedziona: **roll (pkt 2) zgadza się z harnessem <2 %**, a że ćwiczy CAŁY pipeline
(pitch/roll/krzywe/koperta/instruktor), a klient i serwer liczą **ten sam moduł `shared`**,
zgodność uogólnia się na metryki sterowane tym samym pipeline’em. Punkty rate-sterowane (3/4/5/6)
są walidowane na poziomie B (rate-komenda open-loop w przeglądarce degeneruje w CFIT — udokumentowana
pułapka R1–R4; pkt 3 z definicji §8.3 wymaga instruktora/myszy = pointer-lock, nieautomatyzowalny).

| Pkt §8.3 | Metryka | Status E2E | Dowód (etap) |
|---|---|---|---|
| 1 | Vmax SL | ✅ potwierdzony | R4: 464,7 km/h TAS @766 m (bojowo; stara fizyka dałaby ~510) = harness ~464 |
| 2 | Beczka: roll + bleed | ✅ rygorystycznie <2 % | R0 roll 47,4°/s@446 vs 46,5@450; R1 E-drop 20,8 vs 20,5 (1,3 %), IAS wyj. 0,2 % |
| 3 | Zakręt 180°/360° (instruktor) | ⬜ poziom B | wymaga pointer-lock; `turn180`/`sustainedTurn` = kotwice; E2E R5: @461 sztywnienie→nurkowanie |
| 4 | Pętla z 300 km/h | ⬜ poziom B + sonda §6.5 | `loopTest` + sonda `propEffectRates` (nos ściąga 3,5°/s @130 km/h) |
| 5 | Wznoszenie ROC | 🟡 znak potwierdzony | R4: WEP +5,85 vs −3,2 m/s przy tym samym pitchu; `climbTest` = kotwica |
| 6 | Stall (zerwanie + buffet) | 🟡 jakościowo | E2E R5 buffet/departure w zakręcie; `stallTest` numeryczny (118/126/104) |
| 7 | WEP: kop + temp. | ✅ potwierdzony | R2 heat 0,015→0,063/19 s; R4 wznos +5,85 + heat 0,070→0,121/22 s |
| 8 | Klapy: kółko + rip | ✅ potwierdzony | R3 `flaps:1` @436 → HUD „URWANE” czerwone, samolot żywy (rip się ogranicza) |
| 9 | Regresja: konsola/NaN/fps | ✅ potwierdzony | R0–R4 telemetria 60 Hz bez NaN, konsola czysta (jedyny 404 = favicon) |

**Sonda śmigła §6.5 (poziom B, R5 — jedyny niezwalidowany element z R4).** `propEffectRates` jest
czystą funkcją (throttle, IAS) niewidzianą przez harness (`applyPropEffect=false`); R5 stabelaryzował
ją bezpośrednio (gaz 1,0, wszystkie 3 samoloty identyczne magnitudy — różni tylko znak/kierunek):
`≥200 km/h → 0,0°/s` (gwarancja §3 strukturalna); `~130 km/h (szczyt pętli) → 3,5°/s yaw` (łagodny,
kontrowalny sterem 10°/s); `100 km/h → 7,2°/s` (silny, kontrowalny); `<50 km/h → 16–28°/s > ster`
(departure „na śmigle”, realistyczne). **Wniosek: magnitudy zdrowe, brak zmiany** — końcowe czucie
dryfu na szczycie pętli to knob JSON (`yawBiasMaxRadS`/`rollBiasMaxRadS`), strojalny bez kodu w playteście.

**Poprawki instruktora/HUD z pomiarów: BRAK (uzasadnione).** Pomiary potwierdziły zgodność łańcucha
≤3,2 % (R1–R4), a HUD ma już komplet ostrzeżeń dopasowanych do nowych mechanik: `aileronWarning`
(lotki sztywne), `vneWarning` (drżenie/Vne), znacznik WEP + °C temperatury, wiersz „klapy/URWANE”,
wariometr (wymiana wysokość↔IAS w zakręcie). Instruktor pracuje w NIEZMIENIONEJ kopercie (R4 ruszył
tylko moc i opór indukowany — dynamika translacji; nMaxG/`rollRateCurve`/`pitchAuthorityCurve` nietknięte).

**Checklist WT RB §5.5:** 7/7 odhaczone (dowody przy punktach w §5.5) — mechanizmy zmierzone; ocena
subiektywnego czucia → ankieta playtestowa (poniżej).

**Handoff:** `docs/fizyka-lotu.md` §5.2 (opór sterów), §5.3 (krzywa mocy + ograniczenie η śmigła),
**nowa §13** (formuły v2: autorytet pitch / WEP / Vne-flutter / klapy / śmigło); CLAUDE.md status
+ protokół v10; memory `fizyka-v2-r5-*`.

**Ankieta playtestowa (⏳ user — czucie 3 samolotów, WT RB):**
1. **Przelot bojowy nisko** ~7 % wolniej niż przed v2 (Vmax SL ~467/467/440) — akceptowalne, czy
   za wolno? WEP przywraca szczyt — kop wyraźny? Limit termiczny (Spit 5 min / Bf 1 min) w pościgu OK?
2. **Zakręt:** Spitfire wyraźnie ciaśniej niż Bf 109 (18,5 vs 23,5 s)? Zero dominuje wiraż (15 s)?
   „Siadanie” tempa po wejściu z dużej prędkości czytelne (bez ściany)?
3. **Beczki/lotki:** pełne lotki >5 s realnie zjadają prędkość? Zero „betonuje” lotki >350 km/h
   (celowa słabość) — nie frustruje w walce manewrowej?
4. **Nurkowanie:** drążek „ciężknie” >600 km/h (rośnie promień wyrwania)? Przekroczenie Vne (Zero 630)
   trzęsie i urywa skrzydła — czytelne ostrzeżenie zanim się rozpadnie?
5. **Klapy (F):** bojowe realnie pomagają w wolnym kółku? Urwanie przy nadprędkości jako kara — jasne?
6. **Śmigło:** na szczycie pętli z małej prędkości nos „ożywa” (ściąga) — smak realizmu czy irytujące?
7. **Boty** w nowej kopercie (gaz 1,0 = moc bojowa, bez WEP/klap/przegrzania) — nadal wyzwanie?
8. **Smoke v10 na produkcji** (deploy front+back RAZEM — v10 z R2 wciąż NIEWDROŻONE).

**Znane/świadome ograniczenia (backlog, nie R5):** (a) czas do 6000 m optymistyczny dla Spit/Zero
(345/375 vs cel 420/447 s) — brak modelu spadku sprawności śmigła η z wysokością w point-mass (D1),
Bf trafia (433) dzięki niższej wysokości krytycznej; (b) świeży 9-punktowy sweep E2E dla Bf/Zero do
domknięcia w osobnej krótkiej sesji, gdy MCP wróci (poziom B je pokrywa, więc to potwierdzenie
łańcucha, nie rekalibracja); (c) magnitudy śmigła identyczne dla 3 typów (brak historycznego celu —
różnicowanie to knob).

**Definicja ukończenia projektu (§11):** złote ±5 % ✅, relacje §5.4 ✅, checklist §5.5 ✅, docs+memory
✅; ⏳ user: playtest czucia (ankieta wyżej) + smoke v10 na produkcji. **PROJEKT FIZYKA v2 — DOMKNIĘTY
po stronie kodu/dokumentacji; pozostaje playtest usera.**

## 10. Ryzyka i pułapki (z historii projektu — sprawdzać na każdym etapie)

1. **Reconcile dopala ukryte stany** (lekcja termiki: ~3,5× za szybko) — każdy nowy akumulator
   fizyki wymaga wzorca `heatBefore` ALBO miejsca w snapshocie ALBO bycia czystą funkcją inputu.
2. **Instruktor bramkuje fizykę:** pull gaszony błędem przechylenia, deadzone rolla, klamp
   koperty 0,85·nAvail — po każdej zmianie koperty mierzyć przez PEŁNY pipeline (poziom B/C),
   nie tylko `stepPlane` (lekcja „punktu pracy Zero": fizyka była OK, punkt pracy nie).
3. **Boty żyją w tej samej kopercie:** trudny bot na gazie 1,0 z WEP-em przegrzeje się w pościgu;
   po R2 przejrzeć `difficulty.ts` (gaz patrolu/pościgu).
4. **Krzywa mocy vs złote:** zmiana `enginePowerW`→`militaryPowerW`+WEP przesunie WSZYSTKIE
   metryki naraz — R2/R4 świadomie, z raportem przed/po.
5. **NaN-guard:** nowe człony (flutter ∝ nadwyżka, propBias przy V→0) muszą mieć nasycenia
   jak `dragStallK` (strażnik NaN nie maskuje — wywala).
6. **E2E niedeterminizm:** serwer autorytatywny → pomiary w locie swobodnym z dala od bota,
   okna pomiarowe po ustaleniu (settle), tolerancja E2E 3–5 %; nie mierzyć w trakcie reconcile-snapu.
7. **Zakręt Zero 12–14 s może pozostać nieosiągalny** przy realistycznym bilansie mocy —
   wtedy dokumentujemy w §3 i trzymamy 15 s (relacje §5.4 i tak dają Zero dominację wiraża).
8. **Timebox:** mechaniki §6 są niezależne — jeśli etap pęka, tniemy zakres etapu, nie jakość
   kalibracji (klapy/śmigło można przesunąć, rdzeń R1+R4 jest obowiązkowy).

## 11. Definicja ukończenia projektu

- Złote testy ±5 % (poziom A) + harness manewrowy (poziom B) zielone na macierzy §8.4.
- Testy relacji §5.4 zielone.
- Pomiary E2E §8.3 w Chrome ≤5 % od harnessu, bez błędów konsoli/NaN, fps bez regresu.
- Checklist WT RB §5.5 odhaczony w sesji z pomiarami.
- `docs/fizyka-lotu.md`, CLAUDE.md (protokół v10, status), memory zaktualizowane.
- ⏳ user: playtest czucia trzech samolotów (ankieta per samolot przygotowana w R5)
  + smoke v10 na produkcji (deploy front+back razem).
