# Faza 3 — decyzje i pułapki (2026-06-11)

## Decyzje nieoczywiste z kodu

- **Instruktor: pull w G/rad, NIE w pitch rate.** Pierwsza wersja liczyła pitch rate
  z błędu i konwertowała na n — mnożnik V/g dawał 7G przy 2° błędu na 500 km/h.
  Doc (rozdz. 7) mówi wprost „n proporcjonalne do błędu" — `aggressivenessPitch` [G/rad].
- **Bank-and-pull bramka liniowa**: pull pełny poniżej `bankThresholdDeg`, zero przy 2×próg.
  Bramka cos() była za miękka (0.52 przy 79° błędu → przedwczesne ciągnięcie).
- **`rollRelevance = min(1, θ/pushoverCone)`** wygasza roll przy θ→0 — bez tego
  atan2(lateral, vertical) degeneruje się (szum ±90° → pełna beczka przy celu na wprost).
  Pushover tylko gdy cel POD nosem i |lateral| < |vertical| — twarde `rollError=0`
  w całym stożku robiło plateau θ≈8° (roll wyłączony, yaw za słaby, by domknąć).
- **`sideslipMaxAccelG` (nowy parametr JSON)**: tłumik ślizgu to siła boczna kadłuba
  z limitem autorytetu, bez renormalizacji |v|. Bez limitu działa jak nieskończony ster:
  w przechyleniu (right.y=−sinφ) „zawraca" grawitacyjne opadanie toru w górę →
  zoom climb → utrata V → stall w zakręcie ustalonym. Diagnoza: kolumna slipDvy
  w bilansie pionowym per tick.
- **Feed-forward koordynacji zakrętu w pilotStep**: `yaw += −g·right.y/V`.
  W przechyleniu grawitacja zagina tor BOKIEM (g·sinφ) — sam pitch + weathervane
  zostawia trwały ślizg, który tłumik (z limitem) pompował w górę. To nie regulator —
  czysta kinematyka zakrętu ustalonego.
- **`sustainedTurnTest`: bank mierzony z `liftDir.y` (układ toru), nie z osi kadłuba** —
  nos siedzi α nad torem i pomiar attitude zawyża pion nośnej. n = 1/liftDir.y z capem
  na analitycznym n*. **Sprzężenie od vy ZAKAZANE**: na tylnej stronie krzywej mocy
  odpowiada odwrotnie (mniej n → mniej oporu indukowanego → nadmiar ciągu wznosi mocniej).
- **Model = Spitfire Mk IA, 100 oktanów, +12 lb boost (1310 KM)** — decyzja użytkownika
  2026-06-11 po pierwszej sesji („za mało dynamiczny jak na myśliwiec"). Źródła:
  próby N.3171 (A&AEE 1940: 6050 lb, 354 mph @ 18.9k ft, 2820 ft/min @ +6¼),
  RAE 06.1940 (+12 lb: 314 mph SL), Collar/RAE 1940 (cd0=0.020, η=0.8),
  Morgan & Morris BA 1640 (zakręt n=2.7), k≈1.15 → oswaldE 0.87.
- **clMax 1.85 = gameplay** (stall 117 km/h przy 2744 kg), nie aerodynamika profilu.
- **`staticThrustN` 7700 kalibruje wznoszenie** (~17.5 m/s), `fullThrottleHeightM` 3400 m
  = 9000 ft nominalne + efekt ram (podnosi V na 5.5 km do 557).
- **Krzywa rollu z płóciennymi lotkami**: szczyt 80°/s @ 240 km/h, zapaść 14°/s @ 640 —
  sztywność drążka w nurkowaniu to CELOWY element balansu epoki, nie bug.
- Klient: przejęcie klawiatura→mysz przez `mouseAim.alignTo(forward)` (bez szarpnięcia);
  celownik na sferze odsprzężony od kamery; `recording-codec.ts` bez importów shared,
  żeby /telemetry nie ładowało three.js (527 kB → 53 kB).

## Pułapki

- **Tweakpane 4: typy wymagają `@tweakpane/core` w devDependencies** (deklaruje go tylko
  jako devDep — TS2339 na addFolder/addBinding bez tego).
- Akumulacja dt jest zmiennoprzecinkowa: testy progów czasowych (wing drop po 1 s)
  z marginesem ±2 ticki, nie `toBe(0)` na granicy.
- Filtry 1. rzędu: blend `−Math.expm1(−dt/τ)`, nie `1−exp` (precyzja przy małych dt).
- spitfireperformance.com odrzuca połączenia botów — mirror:
  wwiiaircraftperformance.com/wwiiaircraftperformance.org/spitfireperformance.com/…

## Sesja testowa (kryterium „5 minut latania")

2026-06-11: pierwsza iteracja (Mk I, 1030 KM, szczyt rollu @ 400 km/h) — „działa, ale
mało dynamiczne". Po przejściu na Mk IA +12 lb + przesunięciu szczytu rollu na 240 km/h
+ ostrzejszym instruktorze (smoothing 0.08, roll 7, pitch 5 G/rad): **„jest ok"**.
Finalny preset = `packages/shared/src/planes/spitfire-mk1.json` w commicie fazy 3.

## Celowo odłożone

- Tryb WEP jako mechanika (limit czasu +12 lb) — na razie boost wliczony na stałe.
- Rewizja kolumny Bf 109 E-3 w rozdz. 10 przy fazie 14 (Spitfire +12 ma teraz
  przewagę energetyczną na niskim pułapie — historycznie OK, ale balans do sprawdzenia).
- Ściśliwość (narost Cd0 > 0.65 Ma) — nurkowania nie były „za bezpieczne" w testach.
