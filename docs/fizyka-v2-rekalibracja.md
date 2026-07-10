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
| D1 | Architektura | **Pogłębiony point-mass** — zostaje obecna architektura (siły: nośna z żądanego n, opór, ciąg, grawitacja; obroty kinematyczne z krzywych + instruktor). Pogłębiamy aerodynamikę zamiast przechodzić na 6-DOF momentowe. Bezpieczne dla predykcji MP, reconcile, botów i 659 testów. |
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

- [ ] Wejście w zakręt z 450+ km/h: pierwsze 90° szybkie (instantaneous), potem wyraźne
      „siadanie" tempa wraz z utratą IAS — bez ściany, płynna degradacja.
- [ ] Pełne lotki przez >5 s w locie poziomym → widoczny spadek IAS (nowość §6.1).
- [ ] Nurkowanie >600 km/h: drążek „ciężknie" (rosnący promień wyrwania), przy Vne trzęsienie
      i uszkodzenia; wyrwanie wymaga wyprzedzenia — kto przeholuje, ten się wbija.
- [ ] Klapy bojowe w kółku poniżej 250 km/h realnie ciaśniej kręcą; wysunięte przy 400 km/h
      urywają się z konsekwencją w strefach skrzydeł.
- [ ] WEP: wyraźny kop mocy + szybki wzrost temperatury; zarządzanie WEP-em w pościgu
      to realna decyzja (jak w RB).
- [ ] Przeciągnięcie w zakręcie: buffet → zrzut skrzydła do wnętrza — wyprowadzenie nurkowaniem
      (bez auto-recovery; istniejąca mechanika, tylko progi rekalibrowane).
- [ ] Pętla z małej prędkości: na szczycie przy <150 km/h nos „ściąga" od śmigła (§6.5) —
      korekta kierunkiem/lotkami, jak w RB.

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

### R1 — Rdzeń aerodynamiki: opór sterów + autorytet pitch + krzywa mocy
**Zakres:** §6.1 (ctrlDragK), §6.2 tylko autorytet (pitchAuthorityCurve, bez Vne),
§6.6 (powerCurve z fallbackiem); wstępna rekalibracja, by NIE zepsuć obecnych złotych
(stare tolerancje); `rollBleedTest`/`psBleedTest` dostają pierwsze cele.
**Kryteria:** beczki bleedują; wyrwanie @ 650 km/h ograniczone autorytetem; wszystkie
testy zielone. **Bez protokołu** (czysto shared/JSON).

### R2 — Skraje koperty: WEP + Vne/flutter (**protokół v10**)
**Zakres:** §6.3 (bit WEP w INPUT, moc mil/WEP w JSON, sprzężenie z termiką),
§6.2 Vne/flutter (serwer autorytatywnie → strefy skrzydeł; HUD ostrzeżenie + buffet);
`wepHeatTest`/`vneFlutterTest`. **Bump v10, deploy front+back RAZEM.**
**Kryteria:** WEP Spit ~5 min/Bf ~1 min do czerwonej linii; nurkowanie Zero > Vne urywa
skrzydła w teście i E2E; reconcile bez dryfu (wzorzec heatBefore sprawdzony testem).

### R3 — Mechanizacja i śmigło: klapy + efekty śmigła
**Zakres:** §6.4 (2 bity klap w INPUT — JUŻ w v10 z R2, rezerwa; pozycje per samolot,
rip → strefy), §6.5 (propBias + kompensacja botów); decyzja o bajcie mechanizacji
w snapshocie; HUD klap; `flapsRipTest`.
**Kryteria:** klapy zmieniają stall/zakręt zgodnie z JSON; rip działa; pętla z małej
prędkości „ściąga" i jest wyprowadzalna; boty strzelają nie gorzej niż przed etapem.

### R4 — Wielka kalibracja trzech samolotów (±5 %)
**Zakres:** dostrojenie WSZYSTKICH JSON-ów do tabel §5 na macierzy §8.4; zacieśnienie
złotych do ±5 %; komplet testów relacji §5.4; ponowna próba zakrętu Zero 12–14 s na nowym
modelu mocy (wynik → §3 albo cel); sloty Bf → knoby stall; rekalibracja `spawnSpeedMs`,
instruktora i trudności botów do nowej koperty.
**Kryteria:** komplet złotych ±5 % zielony; raport porównawczy baseline→v2 w
`docs/fizyka-v2-baseline.md` (druga kolumna).

### R5 — Weryfikacja E2E + doszlif czucia + handoff
**Zakres:** pełny przebieg pomiarów E2E §8.3 przez MCP chrome-devtools (wszystkie punkty 1–9,
trzy samoloty); checklist WT RB §5.5; poprawki instruktora/HUD z pomiarów; aktualizacja
`docs/fizyka-lotu.md` (nowe człony/krzywe), CLAUDE.md (status + protokół v10), memory.
**Kryteria:** E2E vs harness ≤5 % rozbieżności na każdej metryce; checklist §5.5 odhaczony;
⏳ user: playtest czucia (lista pytań przygotowana w etapie).

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
