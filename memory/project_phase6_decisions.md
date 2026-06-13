# Faza 6 — decyzje i pułapki (Bot AI: FSM przez instruktora)

## Decyzje użytkownika (pytania uzupełniające przed implementacją, 2026-06-14)

1. **Tylko tryb 1v1** w tej fazie (1v2/2v2 ze skrzydłowym → backlog PLAN.md). Rdzeń AI
   napisany jednak generycznie (wybór celu, N botów) — by przejść kryterium „4 boty 10 min".
2. **Mecz: punkty do N z respawnami** (`MATCH_SCORE_TO_WIN=3`). Obie strony respawnują (3 s).
   Liczą się TYLKO zestrzelenia pociskami; rozbicie o teren = strata respawnu, BEZ punktu.
3. **Strzelnica z fazy 5 zostaje** jako tryb „Trening" na ekranie startowym (nie usuwać).

## Architektura (gdzie co żyje)

- Rdzeń decyzyjny w `shared/src/ai/` (od fazy 12 pobiegnie na serwerze):
  `geometry.ts` (aspect/off-boresight/closure + pozycja ogonowa), `lead.ts` (wyprzedzenie),
  `fsm.ts` (CZYSTE przejścia stanów), `difficulty.ts`+`difficulty.json` (loader+SI), `bot.ts`
  (orkiestracja: FSM→sterowanie→degradacja→override'y→instruktor).
- **Bot steruje WYŁĄCZNIE przez `Instructor`** (kierunek nosa + throttle + spust). Fizycznie nie
  umie więcej niż gracz — dziedziczy kopertę. Każdy bot ma własny `Instructor` (stan filtra).
- Klient: `menu.ts` (ekran start/wynik), `enemy-marker.ts` (strzałka HUD + dystans),
  integracja w `main.ts` (tryb 'menu'|'dogfight'|'training'; przeciwnik = drugi SimPlane+Bot).

## Decyzje techniczne nieoczywiste z kodu

- **Geometria: `targetOffBoresight = π − aspect`** (kąt z wektorem przeciwnym). Liczona z tożsamości,
  nie drugim cross-productem; test sprawdza niezmiennik `aspect + targetOff = π`.
- **Lead = równanie kwadratowe w układzie STRZELCA** (`relVel = targetVel − shooterVel`, bo pocisk
  dziedziczy prędkość strzelca): `(|relVel|²−s²)t² + 2(relPos·relVel)t + |relPos|² = 0`, najmniejszy
  dodatni pierwiastek. DOKŁADNE dla celu po prostej. Grawitacja/opór pocisku pominięte (kompensuje
  convergenceRise; błąd < promień trafienia). Brak rozwiązania (cel szybszy i ucieka) → aimDir=LOS.
- **Limit G bota przez interfejs instruktora**: clamp KĄTA komendy nos→cel do
  `(maxG−1)/aggressivenessPitch` (bo `n ≈ 1 + aggr·błąd`). Łatwy bot = mały kąt → leniwy skręt →
  wyprowadzalny. Clamp przez rotację kwaternionem (stabilny też antypodalnie), nie nlerp.
- **Degradacja w kolejności: limit G → opóźnienie reakcji (lerp aimDir, τ=reactionTime) → szum
  celowania (błądzący, resamplowany co 0.8 s, slew τ=0.3 s)**. Override'y bezpieczeństwa są PO
  degradacji (precyzyjne, bez szumu). Ogień liczony z PRAWDZIWEGO leadu (bez szumu) vs realny nos —
  przy dużym szumie nos rzadko siedzi na celu → strzela, ale pudłuje (nie aimbot).
- **Unikanie ziemi = NADRZĘDNA warstwa, ciągły sufit zniżania zależny od AGL**, nie nagły override.
  `minAimY` rośnie od `−sin(maxDive)` wysoko do `+sin(climb)` przy podłodze; `frac` może być
  UJEMNY (poniżej grani z przodu) → climb tym stromszy, cap blisko pionu. AGL „skracane" prędkością
  zniżania (predykcja). KLUCZOWE: `maxDiveDeg=28` — przy IAS dogfightu roll rate Spitfire'a spada do
  ~14°/s, więc wyrwanie z PRZECHYLONEGO stromego nuru trwa kilkanaście s (instruktor wybiera wtedy
  roll 180°/split-S). Płytki sufit nie pozwala stromemu nurowi się rozwinąć → wyrwanie zawsze jest
  ciągnięciem do przodu, nie obrotem.
- **Próbkowanie terenu Z WYPRZEDZENIEM** (`lookaheadSurfaceM` w `world/lifecycle.ts`): max wysokości
  pod botem i przed nim wzdłuż prędkości (300/600/1000/1500 m). Bez tego bot skimuje stok i wlatuje
  w grań rosnącą PRZED nim (próbkowanie tylko „pod sobą" tego nie łapie).
- **`hitRadiusM` samolotu trafił do `planes/*.json`** (obok `hpPool`) — to parametr płatowca
  (niezmiennik nr 3), nie `constants.ts`. Sfera jednomodułowa MVP (strefy → faza 17).
- **Mecz freezuje fizykę** (render loop: `playing = mode!=='menu' && !matchOver` → bez `loop.advance`,
  alpha=1). Menu/wynik = scena renderowana, fizyka stoi. Model przeciwnika = drugi `createPlaneMesh`
  (ten sam glTF) + czerwony beacon do identyfikacji (tint glTF zbyt kosztowny w MVP).

## Testy (kryteria fazy)

- `ai-sim.test.ts`: **10 min, 4 boty, zero crashy o teren ani ucieczki poza arenę** (flight safety;
  broń off). Wykrył iteracyjnie: za późny climb-override → roll-trap przy dużym IAS → rozwiązanie
  jw. (ciągły sufit + lookahead + maxDive 28°).
- `ai-gunnery.test.ts`: trudny trafia manewrujący cel (lead+ogień działają); łatwy trafia ISTOTNIE
  rzadziej (degradacja, „nie aimbotuje na łatwym").
- `fsm.test.ts`: KAŻDE przejście ma test (patrol/engage/evade/extend + predykaty threat/offensive).
- `geometry.test.ts`, `lead.test.ts`, `difficulty.test.ts`: jednostkowe rdzenia.

## Pułapki

- `noUncheckedIndexedAccess`: `waypoints[idx]` wymaga strażnika; w testach indeks do obiektu trudności
  przez kształt (`as { normalny: ... }`), nie `Record[...]`.
- Dodanie `hitRadiusM` do `PlaneConfig` wymaga aktualizacji `fixtures.ts` i `loader.test.ts`
  (literały PlaneConfig) — inaczej typecheck/test fail.
- `instructor.smoothingTauS` (0.08 s) dokłada się do reactionTime bota — to cecha samolotu, OK.
- Bot nie strzela do gracza w autopilocie granicy (anty-tani-kill); rozbicie nie daje punktu.

## Do oceny przez gracza / backlog

- **Balans 1v1 „normalny"** (winnable & losable, walka > 60 s) — playtest `npm run dev`. Knoby:
  `difficulty.json` (reactionTime/aimError/maxG/throttle/fireRange/fireCone per poziom + wspólne
  progi FSM). Headless dowodzi działania, nie „czucia".
- Wydajność 4 boty + gracz @ 60 fps — bot to kilka operacji wektorowych + 1 `pilotStep`; headless
  4×36000 ticków ~0.7 s. Licznik fps w HUD.
- Backlog: skrzydłowy/2v2, osobowości botów, manewry nazwane (immelmann jako decyzja AI),
  iteracyjne uściślenie leadu o opór/grawitację, tint modelu wroga.
