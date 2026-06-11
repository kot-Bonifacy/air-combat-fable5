# Faza 2 — decyzje i pułapki (2026-06-11)

## Decyzje nieoczywiste z kodu

- **Sterowanie tymczasowe pitch→n** (`nDemandForPitchRate`): n = liftDir·ŷ + ω·V/g
  (odwrócenie wzoru zakrętu ustalonego z fizyka-lotu.md 6.1). Bez inputu nośna równoważy
  tylko składową grawitacji prostopadłą do toru → tor leci PROSTO (nie poziomo!) w dowolnym
  przechyleniu. Dzięki temu harness nie potrzebuje regulatora wysokości: n=1 przy locie
  poziomym zeruje pionową wypadkową co tick.
- **Konwencja klawiatury: symulatorowa** (strzałka w dół = nos w górę) — decyzja użytkownika
  z 2026-06-11. Utrzymać w fazie 3 dla klawiszowych rate'ów.
- **Kalibracja `staticThrustN` 13000→6500**: to NIE jest fizyczny ciąg statyczny.
  Stałe η zawyża moc śmigła przy małych V (realne η spada z V) — niski clamp pełni rolę
  uproszczonego spadku sprawności i ustawia wznoszenie (19.5→12.95 m/s), nie ograniczając
  V_max (clamp puszcza powyżej ~95 m/s przy pełnym gazie). Jeśli w fazie 3 przyspieszanie
  z małych prędkości będzie „gumowe" — to ten parametr.
- **`clMax` 1.65** (nie historyczne ~1.36): przy m=2700 kg i S=22.5 m² inaczej stall
  wychodzi 131 km/h zamiast 120. Parametr gameplayowy, nie aerodynamiczny.
- **`climbTest` hybrydowy**: optimum prędkości z bilansu mocy (iteracja punktu stałego
  sinγ=(T−D)/mg na modułach sił), potem 20 s symulacji w czasie od stanu ustalonego;
  asercja zgodności obu < 5% pilnuje integratora. Regulatory P na fizyce punktu
  materialnego oscylują fugoidalnie — unikać, punkt stały jest deterministyczny.
- **`stallTest`**: throttle z odwrócenia T=η·P/V (cel: wytracanie 1 km/h/s), opór z poprzedniego
  ticku (lag 1 ticku bez znaczenia). Pomiar = IAS pierwszego ticku z flagą stall.
- **Loader JSON odrzuca nieznane klucze** i ma zakresy sanity per pole — łapie literówki
  i pomyłki jednostek (moc w kW zamiast W) już przy imporcie modułu (fail fast).

## Pułapki

- **0/0 w licznikach Cl**: `clRequired = n·W/(q·S)` przy q=0 i n=0 daje NaN (nie Infinity!) —
  jawne rozgałęzienie w lift.ts. Strażnik NaN by to złapał, ale dopiero po zatruciu stanu.
- **`Math.min/max` z NaN zwraca NaN** — clamp nie jest ochroną przed NaN (i słusznie,
  niezmiennik 7: nie maskować).
- **liftDirection degeneruje się** przy V≈0 oraz up ∥ v̂ (lot idealnie pionowy) — zwraca
  false, siła zerowa, bez NaN.
- vitest połyka console.log — raport kalibracji wymagał `--disable-console-intercept`.

## Celowo odłożone

- Brak limitów n (nMaxG/nMinG) i koperty — faza 3. W scenie można zażądać absurdalnego G
  przy dużej prędkości; jedyny limiter to obcięcie Cl.
- η stałe (bez krzywej od V) — jeśli czucie rozpędzania będzie złe, krzywa η(V) to backlog.
- Alokacje per tick w stepPlane (4 obiekty sił) — bez znaczenia dla 1 samolotu w kliencie;
  przy serwerowej symulacji wielu samolotów (faza ~7+) przejść na pulę/scratch.
