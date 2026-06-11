# Faza 2 — Model lotu cz.1: siły

**Zależy od:** Faza 1
**Czytaj najpierw:** `docs/fizyka-lotu.md` (rozdz. 4, 5, 9, 10, 11.5)
**Cel:** samolot (na razie bryła zastępcza) lata pod działaniem prawdziwych sił,
a harness manewrów mierzy jego osiągi liczbowo.

## Zakres

W tej fazie:
- Atmosfera ISA: `ρ(h)`, ciśnienie dynamiczne, IAS/TAS
- Siły: nośna (z zadanego n), opór (biegunowa), ciąg (moc/sprężarka/clamp), grawitacja
  — każda z własną strzałką debug
- `α_implied` + flaga przeciągnięcia (na razie tylko: obcięcie Cl do Cl_max, bez efektów specjalnych)
- Konfiguracja `shared/src/planes/spitfire-mk1.json` + walidacja schematu przy ładowaniu
- Sterowanie TYMCZASOWE (klawiatura, bez koperty): strzałki = bezpośrednie rate'y pitch/roll,
  Z/X = throttle. Celowo surowe — pełne sterowanie to faza 3
- Harness manewrów (Vitest): `topSpeedTest`, `stallTest`, `climbTest`, `diveEnergyTest`
- Telemetria HUD rozszerzona: IAS/TAS, alt, n, α_implied, energia, throttle

Poza zakresem: koperta sterowności, instruktor/mysz, przeciągnięcie z efektami, kamera pościgowa
(na razie orbitalna), teren.

## Kroki

1. `shared/src/physics/atmosphere.ts` + testy (ρ na 0/3/6 km vs wartości tablicowe)
2. Siły w osobnych plikach `aero/lift.ts`, `aero/drag.ts`, `aero/thrust.ts` + testy jednostkowe
   (np. lift przy zadanym q,S,Cl = dokładna wartość)
3. Loader + walidator JSON samolotu (`planes/loader.ts`)
4. Harness: `shared/src/testing/maneuvers.ts` — scenariusze sterujące stanem bez renderera
5. Spięcie w kliencie: bryła zastępcza (stożek+skrzydła z prymitywów), input tymczasowy
6. Kalibracja parametrów JSON do tabeli z `fizyka-lotu.md` rozdz. 10 (V_max SL, V_max 5 km,
   V_stall, wznoszenie) — iteracyjnie, testami

## Kryteria ukończenia

- [ ] `topSpeedTest(0)` ≈ 460 km/h ±8%; `topSpeedTest(5500)` ≈ 570 km/h ±8%
- [ ] `stallTest()` ≈ 120 km/h IAS ±8%
- [ ] `climbTest()` ≈ 12.5 m/s ±15% (większa tolerancja — zależy od V wznoszenia)
- [ ] `diveEnergyTest()`: energia całkowita nie rośnie przy throttle=0 (sanity bilansu)
- [ ] W scenie: pełny gaz → samolot rozpędza się i przestaje przyspieszać przy V_max;
  wyłączenie gazu → zwalnia; nurkowanie → przyspiesza; strzałki sił sensowne
- [ ] typecheck + test + lint zielone; commit `faza-2`; memory zapisane

## Pułapki / lekcje z opus4-7

- Kalibracja: zaczynaj od V_max (ustala Cd0 przy znanej mocy), potem V_stall (ustala Cl_max),
  na końcu wznoszenie (kompromis). Nie ruszaj wielu parametrów naraz
- Trim w opus4-7 wymagał Cl(2°)=0.126 — w naszym modelu trym nie istnieje jako problem:
  nośna bierze się z zadanego n=1, nie z wystrojonego α. To celowa przewaga modelu
- Ciąg przy V→0: bez clampa statycznego T=P/V eksploduje — strażnik NaN to wyłapie, ale clamp ma być od początku

## Wynik (uzupełnić po zakończeniu)

Ukończona 2026-06-11. Zmierzone osiągi (złote testy, `testing/maneuvers.test.ts`):

- `topSpeedTest(0)` = **454.7 km/h** TAS (cel 460, −1.2%)
- `topSpeedTest(5500)` = **544.1 km/h** TAS (cel 570, −4.5%)
- `stallTest()` = **122.9 km/h** IAS (cel 120, +2.4%)
- `climbTest()` = **12.95 m/s** @ 331 km/h TAS (cel 12.5, +3.6%); zgodność symulacji
  w czasie z bilansem mocy < 0.1%
- `diveEnergyTest()`: energia maleje w każdym ticku (max ΔE/tick ≈ −6.7 kJ)

Kalibracja względem wartości startowych z fizyka-lotu.md rozdz. 9 (kolejność wg lekcji
z opus4-7: V_max → V_stall → wznoszenie):

- `clMax` 1.45 → **1.65** (stall był 131 km/h; przy m=2700 kg potrzeba więcej Cl)
- `staticThrustN` 13000 → **6500** (wznoszenie było 19.5 m/s — stałe η zawyża moc śmigła
  przy małych V; niski clamp statyczny pełni rolę spadku η, nie ogranicza V_max)
- `fullThrottleHeightM` 5000 → **5500** (V_max na 5500 m było 533 km/h, −6.4% — blisko granicy)

Nowe moduły `shared`: `physics/{atmosphere,plane-step}.ts`, `aero/{lift,drag,thrust}.ts`,
`planes/{loader.ts,spitfire-mk1.json}`, `testing/{maneuvers,fixtures}.ts`, `PlaneConfigError`.
Klient: `plane-mesh.ts` (stożek+skrzydła), `input.ts` (strzałki/Z/X, konwencja symulatorowa:
dół = nos w górę — decyzja użytkownika), `orbit-camera.ts` (mysz+kółko), HUD: IAS/TAS/alt/n/α/E/gaz.
56 testów zielonych. Sterowanie tymczasowe: pitch rate → n przez `nDemandForPitchRate`
(n = liftDir·ŷ + ω·V/g — odwrócenie wzoru zakrętu ustalonego).
