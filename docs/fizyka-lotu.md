# Projekt fizyki lotu — model hybrydowy simcade

Dokument nadrzędny dla faz 1–3. Cel: model, który **zachowuje się** jak samolot z 1940 r.
(energia, przeciągnięcie, charakterystyki zależne od prędkości i wysokości), ale którego
**parametry strojenia mapują się 1:1 na odczucia pilota** i który jest debugowalny.

## 1. Dlaczego nie pełne 6DoF momentowe (lekcja z opus4-7)

W poprzednim projekcie zaimplementowano klasyczny model momentowy: tabele Cl/Cd/Cm,
momenty od sterów, pochodne tłumienia (Cmq, Clp, Cnr), RK4 @ 120 Hz. Wynik:

- model przeszedł testy fizyczne, ale **czucie lotu strojono pośrednio** — żeby zmienić
  szybkość przechylania trzeba było żonglować `aileronCoeff` ↔ `Clp`, których wpływ
  jest sprzężony i nieintuicyjny („dobrane na oko" — cytat z notatek projektu);
- każdy błąd w układach odniesienia (force=world, torque=body, własna konwencja osi)
  objawiał się jako „dziwne latanie" bez śladu, gdzie szukać przyczyny.

**Decyzja: rotacja samolotu NIE wynika z momentów aerodynamicznych.** Momenty to jedyna
część pełnego modelu, której gracz nie czuje bezpośrednio — czuje ich *skutek*: prędkości
kątowe i dostępne przeciążenie. Modelujemy więc skutek wprost.

Ścieżka rozbudowy (backlog): model momentowy można dodać później per-oś (np. najpierw pitch),
bo koperta osiągów z tego dokumentu definiuje dokładnie, jakie zachowanie ma być zachowane.

## 2. Architektura modelu w jednym akapicie

**Translacja jest w pełni fizyczna**: na punkt materialny działają siła nośna, opór
(pasożytniczy + indukowany), ciąg i grawitacja; całkowanie semi-implicit Euler @ 60 Hz.
**Rotacja jest kinematyczna**: input gracza (przez warstwę „instruktora") zadaje prędkości
kątowe, ale obcięte przez **kopertę osiągów** zależną od prędkości, wysokości i energii
(dostępne G, krzywa roll rate vs IAS, utrata sterowności przy przeciągnięciu). Sprzęgło
między rotacją a translacją: zadane przeciążenie → współczynnik siły nośnej → siła nośna
zakrzywia tor + opór indukowany zjada energię. Przeciągnięcie = zadany Cl przekracza Cl_max.

To jest dokładnie ten podział, który stosują simcade'y: fizyka tam, gdzie decyduje
o taktyce (energia, zakręty, nurkowania), parametryzacja tam, gdzie decyduje o czuciu.

## 3. Konwencje (obowiązują w całym projekcie — niezmiennik nr 1 w CLAUDE.md)

- **Jednostki**: SI wewnątrz (m, m/s, kg, N, rad). Konwersje (km/h, stopy, °) tylko w HUD.
- **World frame**: Three.js — +Y w górę, prawoskrętny.
- **Body frame**: zgodny z glTF — **+Z = nos, +Y = góra kadłuba, +X = lewe skrzydło**.
- Dostęp do osi tylko przez helpery z `shared/src/math/frame.ts`:
  `getForward(q)`, `getUp(q)`, `getRight(q)` (right = -X), z testami jednostkowymi
  sprawdzającymi wszystkie cztery podstawowe orientacje.
- Stan samolotu (`PlaneState`): `position: Vector3` (world), `velocity: Vector3` (world),
  `orientation: Quaternion`, `angularRates: {pitch, roll, yaw}` (body, rad/s — kinematyczne),
  `throttle: 0..1`, pomocnicze: `iasMs`, `loadFactor`, `stalled`.

## 4. Atmosfera i prędkości

- Gęstość (ISA, troposfera): `ρ(h) = 1.225 · (1 − 2.2558e-5·h)^4.2559` [kg/m³]
- Ciśnienie dynamiczne: `q = ½ · ρ · V²`
- **IAS vs TAS**: `IAS = TAS · sqrt(ρ/ρ0)`. HUD pokazuje IAS; koperta sterowności liczy się
  z IAS (tak czuje to pilot), osiągi silnika z wysokości. To daje za darmo poprawne
  zachowanie „na wysokości samolot jest szybszy po TAS, ale stery miękną".

## 5. Siły (translacja)

Każda siła ma własną funkcję `(state, plane) => Vector3` i własną strzałkę debug w 3D.

### 5.1 Siła nośna
- Zadane przeciążenie `n` przychodzi z instruktora (rozdz. 7), obcięte do `n_avail` (rozdz. 6.1).
- Wymagany współczynnik: `Cl = n · m · g / (q · S)`; obcięty do `Cl_max` z konfiguracji.
- Kierunek: prostopadle do wektora prędkości, w płaszczyźnie symetrii samolotu:
  `liftDir = normalize(up − v̂ · dot(up, v̂))`, gdzie `up = getUp(orientation)`.
- `L = q · S · Cl` wzdłuż `liftDir`. Przy locie odwróconym/nożowym wzór działa bez przypadków specjalnych.

### 5.2 Opór
- Biegunowa oporu: `Cd = Cd0 + K · Cl²`, gdzie `K = 1/(π · e · AR)`.
- `D = q · S · Cd` przeciwnie do `v̂`.
- Opcjonalnie (faza 3, jeśli nurkowania będą „za bezpieczne"): narost Cd0 powyżej
  ~0.65 Ma (uproszczone ściśliwości) — daje historyczny limit prędkości nurkowania.

### 5.3 Ciąg
- Moc silnika: `P(h) = P0` do wysokości pełnej mocy sprężarki `h_fth`, powyżej `P0 · ρ(h)/ρ(h_fth)`.
- `T = min(T_static, η · P(h) · throttle / max(V, V_eps))` — clamp statyczny usuwa osobliwość przy V→0.
- Kierunek: `getForward(orientation)`.

### 5.4 Grawitacja
- `(0, −m·g, 0)` world. Koniec.

### 5.5 Kąt natarcia (pochodny, nie całkowany)
- `α_implied = Cl / Clα` (zakres liniowy; `Clα` z konfiguracji, typowo ~5.0 /rad).
- Używany do: progu przeciągnięcia (`α_implied > α_stall`), buffetu w HUD,
  delikatnego odchylenia nosa od wektora prędkości (czysto wizualne, rozdz. 6.4).

## 6. Koperta osiągów i rotacja (kinematyczna)

### 6.1 Dostępne przeciążenie
- `n_avail = q · S · Cl_max / (m · g)` — fizyczny limit z prędkości.
- `n_max_struct` (np. 8 G) i `n_min` (np. −4 G) — limity z konfiguracji.
- Efektywnie: `n = clamp(n_demand, n_min, min(n_avail, n_max_struct))`.
- Zadany pitch rate wynika z n: `ω_pitch = (n − cos(γ_bank_comp)) · g / V` (zakręt ustalony);
  w praktyce: pitch rate = ten wzór, a HUD pokazuje G — strojenie przez `n_max`, nie przez rad/s.

### 6.2 Roll rate
- Krzywa `rollRate(IAS)` zadana 3–4 punktami w konfiguracji JSON (interpolacja liniowa):
  niska przy małej IAS (mało siły na lotkach), szczyt przy ~350–450 km/h, spadek przy
  wysokiej IAS (sztywność drążka — charakterystyczne dla epoki!).
- To JEST parametr strojenia i parametr balansu (Bf 109 vs Spitfire) — żadnych współczynników pośrednich.

### 6.3 Yaw
- Mały zadawany rate (klawisze/rudder) + **automatyczna koordynacja**: składowa boczna
  prędkości w body frame wygaszana ze stałą czasową (`sideslipDamping`). Ślizg istnieje
  chwilowo (strzelanie z wyprzedzeniem!), ale samolot naturalnie „idzie za nosem".
- **Limit autorytetu** (`sideslipMaxAccelG`, lekcja z fazy 3): korekta na tick obcięta do
  realnego przyspieszenia od siły bocznej kadłuba. Bez limitu tłumik działa jak nieskończony
  ster — w przechyleniu „zawraca" grawitacyjne opadanie toru w górę (artefakt zoom climbu).
  |v| nie jest renormalizowane: ubytek energii = opór ślizgu.
- **Feed-forward koordynacji zakrętu** (w pipeline pilotStep): w przechyleniu grawitacja
  zagina tor bokiem względem płaszczyzny symetrii z przyspieszeniem g·sinφ; nos dostaje
  yaw rate = −g·right.y/V, inaczej w zakręcie ustalonym powstaje trwały ślizg, którego
  tłumik (z limitem!) nie nadgoni.

### 6.4 Spójność nos↔tor lotu
- Nos podąża za wektorem prędkości plus `α_implied` (weathervaning ze stałą czasową
  `alignTau` ~0.3–0.6 s). Dzięki temu atak/tor nigdy się nie rozjeżdżają o nierealne kąty,
  a stała czasowa daje wrażenie bezwładności bez całkowania momentów.
- Tempo korekty obcięte do `weathervaneMaxRateDegS` (~120°/s): przy odwróceniu wektora
  prędkości (tailslide po świecy) błąd ~180° dawałby z samego kąt/τ snap ~450°/s —
  z limitem przewrót nosa jest płynny.

### 6.5 Przeciągnięcie
- Próg: `n_demand > n_avail` (równoważnie `α_implied > α_stall`).
- Skutki, narastająco: (1) buffet — drganie kamery + ostrzeżenie HUD ~10% przed progiem,
  (2) Cl obcięty do Cl_max → nośna nie utrzymuje toru: tor (a za nim nos) opada mimo
  ciągnięcia, (3) sterowność lotek spada do ~30%, (4) wing drop: losowo-deterministyczny
  (seeded) powolny przewrót, jeśli gracz trzyma przeciągnięcie > 1 s.
- **Brak wymuszonego (skryptowanego) opadania nosa i auto-wyprowadzenia** (decyzja 2026-06-14):
  samolot ma naturalnie tracić sterowność, a wyprowadzenie jest zadaniem gracza. Nos opada
  sam, bo obcięty Cl nie zakrzywia toru w górę — nie dokładamy do tego żadnego „autopilota"
  (poprzednio maszyna wymuszała pitch-down ~12°/s, co samo wyprowadzało z przeciągnięcia).
- Progi (buffet/stall) działają na |Cl wymaganym| — przeciągnięcie ujemne (pchanie)
  wykrywane symetrycznie (uproszczenie simcade: symetryczny zakres Cl).
- Wyjście: oddać drążek / skierować nos w dół i nabrać prędkości — klasyczna procedura;
  trzymanie ciągnięcia utrzymuje przeciągnięcie (mush), bo n siedzi na n_avail.
- Pełny korkociąg: backlog (faza 17 ma uproszczony po utracie skrzydła).

## 7. Instruktor (mouse-aim, wzorzec War Thunder)

Warstwa między inputem a kopertą. Gracz myszą wskazuje punkt na sferze wokół samolotu;
instruktor zamienia to na `n_demand`, `rollRate_demand`, `yaw_demand`:

1. Błąd kątowy nos→cel rozłożony na składową w płaszczyźnie symetrii i poprzeczną.
2. Strategia **bank-and-pull**: jeśli składowa poprzeczna > próg — najpierw przechyl
   (roll proporcjonalny do błędu, ograniczony krzywą 6.2), potem ciągnij (n proporcjonalne
   do błędu w płaszczyźnie, ograniczone 6.1).
3. Regulator P z nasyceniem wystarcza (rates są kinematyczne — nie ma oscylacji typowych
   dla PID nad fizyką momentową). Parametry: `aggressiveness`, `bankThreshold`, `smoothing`.
4. Klawiatura (WSAD/QE) omija instruktora: bezpośrednie żądania rate'ów (nadal przez kopertę).
5. **Boty używają dokładnie tego interfejsu** (cel + throttle) — nie umieją złamać koperty.

## 8. Całkowanie i pętla

- Stały krok `dt = 1/60 s`, akumulator czasu, semi-implicit Euler:
  `v += a·dt` najpierw, potem `p += v·dt`; orientacja: `q ← q · Δq(ω·dt)`, normalizacja co tick.
- Render interpoluje między dwoma ostatnimi stanami fizyki (alpha z akumulatora).
- Strażnik NaN (dev): walidacja pól stanu po każdym ticku; wyjątek z dumpem stanu+inputu.

## 9. Parametry samolotu — schema JSON (`shared/src/planes/*.json`)

| Pole | Znaczenie | Spitfire Mk IA, +12 lb (po kalibracji fazy 3) |
|---|---|---|
| `massKg` | masa | 2744 (6050 lb, próby N.3171) |
| `wingAreaM2` | powierzchnia S | 22.5 |
| `aspectRatio` | AR (do K) | 5.61 |
| `oswaldE` | e (do K) | 0.87 (k≈1.15, Ackroyd/Salisbury) |
| `cd0` | opór pasożytniczy | 0.020 (Collar/RAE 1940) |
| `clMax` | maks. wsp. nośnej | 1.85 (gameplay: stall 117 km/h przy 2744 kg) |
| `clAlphaPerRad` | nachylenie Cl(α) | 5.0 |
| `enginePowerW` | P0 | 977000 (1310 KM, Merlin III @ +12 lb) |
| `fullThrottleHeightM` | h pełnej mocy sprężarki | 3400 (9000 ft + ram) |
| `propEfficiency` | η | 0.8 (Collar) |
| `staticThrustN` | clamp ciągu (kalibruje wznoszenie) | 7700 |
| `nMaxG` / `nMinG` | limity przeciążeń | 8 / −4 |
| `rollRateCurve` | punkty [IAS km/h, °/s] (lotki płócienne: szczyt nisko, zapaść przy dużej IAS) | [[120,32],[240,80],[320,75],[480,40],[640,14]] |
| `alignTauS` | stała czasowa nosa | 0.4 |
| `weathervaneMaxRateDegS` | limit tempa weathervaningu (tailslide) | 120 |
| `sideslipDampingS` | wygaszanie ślizgu | 0.5 |
| `sideslipMaxAccelG` | limit siły bocznej kadłuba | 0.3 |
| `stall.*` | buffet/lotki/wing drop (bez wymuszania nosa) | rozdz. 6.5 |
| `instructor.*` | parametry mouse-aim (aggressivenessPitch w G/rad!) | rozdz. 7 |

Wartości startowe = punkt wyjścia do strojenia, nie dogmat. **Żadna z tych liczb nie może
pojawić się w kodzie.**

## 10. Cele osiągów (kryteria akceptacji faz 2–3, potem 14)

Wartości przybliżone, wystarczające do gry; tolerancja ±8% o ile nie podano inaczej.

Spitfire w konfiguracji Bitwy o Anglię: 100 oktanów, +12 lb boost (decyzja z 2026-06-11 —
„dynamika myśliwca"; źródła: próby N.3171 A&AEE 1940, RAE 06.1940, Collar 1940,
Morgan & Morris BA 1640). Kolumna Bf 109 E-3 do rewizji źródłowej w fazie 14.

| Metryka | Spitfire Mk IA (+12 lb) | Bf 109 E-3 (faza 14) |
|---|---|---|
| V_max na poziomie morza (TAS) | ~505 km/h (314 mph, RAE) | ~465 km/h |
| V_max na 5–6 km (TAS) | ~570 km/h (354 mph @ 18.9k ft) | ~555 km/h |
| V przeciągnięcia (IAS, czysty) | ~117 km/h (~73 mph @ 6050 lb) | ~125 km/h |
| Czas pełnego zakrętu 360° (niska wys., pełna moc) | ~16 s (M&M: 17.2 s @ 12k ft) | ~22 s |
| Roll rate @ 350 km/h | ~70°/s | ~85°/s |
| Wznoszenie początkowe | ~17 m/s (+6¼ lb dawało 2820 ft/min) | ~15 m/s |
| Pułap praktyczny (wznoszenie < 2,5 m/s) | ~10,5 km (34 700 ft) | ~10 km |

## 11. Narzędzia (obowiązkowe; bez nich fazy 1–3 nie są „done")

1. **Strzałki sił 3D** (faza 1): osobny `ArrowHelper` per siła (nośna/opór/ciąg/grawitacja/wypadkowa),
   skala logarytmiczna, toggle klawiszem F3.
2. **Telemetria HUD** (faza 1): IAS/TAS, alt, α_implied, n, energia całkowita (½mV²+mgh),
   stan przeciągnięcia, throttle.
3. **Panel strojenia na żywo** (faza 3): Tweakpane nad parametrami z JSON; zmiana działa
   natychmiast; przycisk „eksportuj preset" → JSON do schowka/pliku. Tylko dev build.
4. **Rejestrator lotu** (faza 3): ring buffer (60 Hz × 5 min) pełnego stanu + sił;
   eksport CSV; strona `/telemetry` z wykresami (uPlot): V(t), h(t), n(t), energia(t).
5. **Harness manewrów** (fazy 2–3): skryptowane scenariusze w Vitest — bez renderera,
   czysta fizyka z `shared`:
   - `topSpeedTest(h)` — rozpędzanie w locie poziomym do ustalenia → V_max
   - `stallTest()` — wytracanie 1 km/h/s → IAS przeciągnięcia
   - `sustainedTurnTest()` — pełny zakręt z utrzymaniem wysokości → czas 360°
   - `rollRateTest(ias)` — pełna lotka → °/s w ustalonym
   - `climbTest()` — wznoszenie z V optymalną → m/s
   - `diveEnergyTest()` — bilans energii w nurkowaniu (sanity: energia nie rośnie bez ciągu)
   Każdy test asercją porównuje wynik z tabelą z rozdz. 10. **To są „złote testy" fizyki** —
   refaktoryzacja, która je psuje, psuje grę.

## 12. Plan debugowania, gdy „lata dziwnie" (procedura, nie improwizacja)

1. F3 — strzałki sił: czy któraś ma absurdalny kierunek/wielkość?
2. HUD: czy α_implied, n, IAS są w sensownych zakresach?
3. Nagraj 30 s rejestratorem → wykresy: co dokładnie się dzieje z V/h/n w momencie problemu?
4. Odtwórz problem jako test w harness (zadany stan początkowy + input) → debuguj bez renderera.
5. Dopiero potem zmieniaj parametry — pojedynczo, z notatką w memory.
