# Faza 22 — Modułowe uszkodzenia („zaawansowana fizyka walki")

**Zależy od:** Faza 21
**Cel:** trafienia mają konsekwencje taktyczne — uszkodzony samolot lata gorzej w konkretny,
czytelny sposób. Zwieńczenie projektu: fizyka walki na poziomie obiecanym w założeniach.

---

## Decyzje projektowe (2026-06-27, ustalone z userem przez AskUserQuestion)

1. **Podział na 5 części** (re-split 2026-06-27 — wcześniej 2; user poprosił o drobniejszy podział
   i kończenie sesji po jednej części). Granice cięcia niżej. Po **Części 1** uszkodzenia liczą się
   poprawnie w fizyce `shared` (serwer + predykcja klienta), choć NIC ich jeszcze nie wywołuje ani
   nie pokazuje — to czysty, nieinwazyjny fundament (BEZ protokołu, BEZ deployu).

2. **Model śmierci = HYBRYDA (strefy + globalna „integralność" jako backstop).** Globalne HP NIE
   znika (odrzucony, najryzykowniejszy wariant pierwotny — groził „gąbczastym" celem nie do dobicia):
   - każda strefa ma WŁASNE HP i własne skutki (utrata mocy, roll bias, autorytet ogona…),
   - globalna „integralność" = istniejące `Health` (`hpPool`, healthFrac w snapshocie) — skumulowane
     obrażenia kadłuba/pożar nadal zabijają. Model uszkodzeń NIE duplikuje integralności.
   - WIELE dróg śmierci (niżej), ale zawsze da się kogoś dobić ogniem.

3. **Kształt brył stref = KAPSUŁY + SFERY.** Skrzydła L/P i kadłub/ogon = kapsuły (odcinek↔odcinek);
   silnik/kabina/zbiornik = sfery. Bryły w JSON (body frame); serwer transformuje do świata z lag-comp.

### Ograniczenie architektoniczne (wynika z fazy 9 — nie podlega negocjacji)

Lokalny gracz **predykuje pełną fizykę** (`pilotStep` w `shared`). Skutki uszkodzeń muszą być
liczone z danych, które klient ZNA ze snapshotu — czyli z **kwantyzowanych POZIOMÓW stref** (2 bity/
strefa), nie z surowego HP (klient go nie ma). Dlatego `computeDamageModifiers` zależy WYŁĄCZNIE od
poziomów → serwer i predykcja klienta liczą identycznie (spójny reconcile, jak przy paliwie po v7).

### Drogi śmierci (model hybrydowy)

- **integralność (`health`) ≤ 0** — skumulowane obrażenia (zwykłe dobicie ogniem),
- **pilot kill** — strefa kabiny zniszczona (natychmiastowy `'dying'`); rzadkie (< 5% killi),
- **destrukcja skrzydła** — strefa skrzydła do 0 HP → korkociąg → krater,
- **pożar dobijający** — DoT od ognia sprowadza integralność do 0,
- (pośrednio) **silnik 0% nad lądem** → brak ciągu → przymusowe lądowanie/rozbicie.

### Niezmiennik bezpieczeństwa

`computeDamageModifiers(bez uszkodzeń)` = tożsamość (`NO_DAMAGE_MODIFIERS`) → **złote testy fizyki
nieuszkodzonego samolotu BEZ zmian**. Każdy skutek to MODYFIKATOR istniejącego parametru JSON; skutek
wymagający nowego mechanizmu w rdzeniu = sygnał przeprojektowania skutku, nie fizyki.

---

## Strefy trafień (wspólne dla wszystkich części)

6 stref per samolot; definicje w JSON, body frame (+Z nos, +Y góra, +X lewe skrzydło):

| Strefa     | Bryła    | Skutek (modyfikator fizyki)                                                       |
| ---------- | -------- | -------------------------------------------------------------------------------- |
| `engine`   | sfera    | `enginePowerW`/`staticThrustN` progowo 100/60/30/0%; dym; szansa pożaru (kaliber) |
| `cockpit`  | sfera    | pilot ranny (zaburzenie inputu) przy heavy; **pilot kill** przy 0 HP             |
| `tank`     | sfera    | wyciek (mnożnik deplecji `fuelFrac`) lub pożar (DoT do integralności)             |
| `wingL`    | kapsuła  | `clMax`↓ i `cd0`↑; **bias roll rate** (asymetria — kontra lotką); 0 HP → korkociąg|
| `wingR`    | kapsuła  | jak `wingL`, strona prawa                                                         |
| `tail`     | kapsuła  | mnożnik autorytetu pitch/yaw < 1 (degradacja sterowności)                         |

Poziomy: 0=ok / 1=lekkie / 2=ciężkie / 3=zniszczona (progi `lightFrac`/`heavyFrac` w JSON). Kodowanie
snapshotu (Część 3): 6 stref × 2 bity + bit pożaru = **u16 per encja**.

---

## CZĘŚĆ 1 — Fundament fizyki uszkodzeń (shared)  ✅ UKOŃCZONE (2026-06-27)

**Warstwa:** wyłącznie `packages/shared`. **Protokół:** BEZ zmian (v7). **Deploy:** nie dotyczy
(commit nieinwazyjny — nic nie ustawia stanu uszkodzeń, zachowanie gry bez zmian).

### Zrobione
- `combat/capsule.ts` — odcinek↔kapsuła (najmniejszy dystans odcinek↔odcinek, Ericson) + testy (11).
- `combat/damage-model.ts` — `ZONE_ROLES`, `HitShape`/`HitZone`, `DamageTuning`, `DamageState`
  (HP stref + ogień; integralność = `health`, NIE tu), `applyZoneHit`, `quantizeZoneLevel`,
  `zoneLevels`, `computeDamageModifiers` (poziomy→modyfikatory, tożsamość bez uszkodzeń),
  `maybeIgnite`/`stepFire` + testy (17).
- JSON `spitfire-mk2.json` i `bf109-e.json` — sekcje `zones` (6 brył) i `damage` (tuning);
  walidacja w `planes/loader.ts` (role kompletne/unikalne, kształty, zakresy) + testy (loader 26).
- `physics/pilot-step.ts` — `SimPlane.damageLevels` + `effectivePlaneConfig` (klon z nadpisanymi
  `enginePowerW`/`staticThrustN`/`clMax`/`cd0`); modyfikatory wpięte (silnik/clMax/cd0/roll bias/
  autorytet pitch+yaw/wyciek paliwa). Złote testy tożsame; nowe testy degradacji (8).

### Wynik 1
Wszystkie bramki zielone: **typecheck (3 workspace'y) ✓, 555 testów ✓ (+41), lint ✓, build ✓**.
Niezmiennik tożsamości potwierdzony (95 testów fizyki/harness + złote bez zmian). Knoby balansu już
w JSON (sekcja `damage`) — strojenie w Części 5 bez kodu.

---

## CZĘŚĆ 2 — Serwer: hit detection po strefach + maszyna stanów  ✅ UKOŃCZONE (2026-06-27)

**Warstwa:** `packages/server` (+ drobne `shared`: `firstZoneHit`, `CANNON_DAMAGE_THRESHOLD`).
**Protokół:** BEZ zmian (v7 — stan stref jeszcze nie jedzie w snapshocie, to Część 3; serwer trzyma go
autorytatywnie i działa lokalnie). **Deploy:** nie dotyczy (BEZ protokołu).

### Decyzja usera (AskUserQuestion 2026-06-27)
Lag-comp stref = **pozycja z historii + bieżąca orientacja** (zgodne z dokiem „jak dziś", zero ryzyka
dla load-bearing modułu lag-comp; broad-phase = CZY trafienie bez zmian → TTK i „co widzę, to trafiam"
zachowane; tylko WYBÓR strefy może się minimalnie rozjechać przy szybkim manewrze). Odrzucone:
rozszerzenie historii o kwaternion (wyższa wierność, większe ryzyko).

### Zrobione
- **`shared/combat/damage-model.ts`** — `firstZoneHit(zones, center, q, p0, p1)`: narrow-phase, bryły
  body→world (pozycja+orientacja), wybór NAJWCZEŚNIEJ trafionej strefy (najmniejsze t na torze) lub −1.
  Reużywa `segmentSphereHitT`/`segmentCapsuleHitT`. 6 testów geometrii (przód/tył/skrzydło/pudło/orientacja/translacja).
- **`shared/constants.ts`** — `CANNON_DAMAGE_THRESHOLD = 10` (kaliber z `bullet.damage`: kaem ≤1,5 << działko 40).
- **`server/game-room.ts`**:
  - `ServerPlayer.damage: DamageState` (createDamageState z `plane.zones`) + `damageLevelsBuf` + `fireStarterId`/
    `fireFromAa` (kredyt dobicia ogniem). Re-tworzony przy zmianie typu (`applyPlaneSelection`), resetowany na
    (re)spawnie (`resetDamageState`, `sim.damageLevels=null`, fireStarter wyzerowany).
  - **Krok 0 `step()`** — `refreshDamageLevels`: poziomy stref → `sim.damageLevels` (lub null, gdy sprawny =
    tożsamość, złote testy nietknięte). Uszkodzenia z poprzedniego ticku działają na ruch tego ticku.
  - **`resolveHits` po STREFACH**: broad-phase `hitRadiusM` (cofnięta pozycja + bieżąca orientacja) →
    `applyDamage(health, dmg)` (PEŁNE obrażenia = TTK niezmienione) + narrow-phase `firstZoneHit` na odcinku
    **wydłużonym o 1 tick** (`pos+v·dt`, anty-tunelowanie: sfera 6 m konsumuje pocisk o tick przed dosięgnięciem
    skupionych przy środku brył) → `applyZoneHit`; skutek krytyczny (kabina/skrzydło 0 HP) → kill mimo health>0.
  - **`maybeIgnite`** po trafieniu (kaliber → cannon/mg), RNG `damageRng` (osobny od balistyki); zapamiętanie podpalacza.
  - **`stepFireDamage`** (krok 5b) — DoT pożaru do `health`; dobicie → `onFireKill` (kredyt podpalaczowi /
    'flak' gdy flak/nieznany).
  - Diagnostyka/testy: `zoneHpOf`, `zoneLevelOf`, `isOnFire`, `damageActiveOf`, `igniteForTest` (test-only).
- **`server/zone-damage.test.ts`** (6 testów): strefa+integralność z tyłu (przód nietknięty); utrata skrzydła
  → śmierć mimo health>0 + kredyt + damageActive; pożar DoT+samowygaszenie; pożar dobija (kredyt podpalaczowi);
  flak dobija bez kredytu; reset stref+pożaru na (re)spawnie. **`combat.test.ts`** zaktualizowany (remis + asysta:
  pętle na `lives`, bo krytyk zostawia health>0).

### Wynik 2
typecheck (3 ws) ✓, **567 testów** ✓ (+12), lint ✓, build ✓. Niezmiennik tożsamości zachowany (sprawny =
`sim.damageLevels=null`). **Pułapka odkryta i naprawiona:** sfera obrysu (6 m) > skupione bryły stref + skok
pocisku ~12 m/tick → pocisk konsumowany w „halo" o tick przed strefą (lub przeskakiwał ją między pozycjami) →
strefy nie obrywały przy podejściu od tyłu/przodu. Fix: narrow-phase na odcinku `[prevPos, pos+v·dt]`.

### Pierwotny plan Części 2 (zrealizowany)

### Zakres
- `ServerPlayer.damage: DamageState` (createDamageState z `plane.zones`); reset przy respawnie.
- `resolveHits` po STREFACH: broad-phase `hitRadiusM` (odrzucenie) → narrow-phase iteracja stref
  (transform bryły body→world z lag-comp jak dziś, `segmentSphereHitT`/`segmentCapsuleHitT`), wybór
  najwcześniej trafionej strefy; `applyZoneHit` (HP strefy) ORAZ `applyDamage(health, amount)`
  (integralność). Trafienie w broad-phase bez strefy → tylko integralność (generyczny kadłub —
  zachowuje TTK i rejestrację „co widzę, to trafiam").
- Maszyna stanów per encja (co tick): `stepFire` → DoT do `health` (pożar dobija); `maybeIgnite`
  po trafieniu (kaliber z `damagePerHit` grupy → cannon/mg); skutki krytyczne stref:
  - kabina 0 HP → **pilot kill** (natychmiastowy `enterWreck`, cause analogiczny do air),
  - skrzydło 0 HP → **korkociąg** (enterWreck z autorotacją; reuse `stepWreck` + bias z modyfikatorów),
  - silnik 0% → już obsłużone przez modyfikator (brak ciągu) — bez osobnej gałęzi.
- Zasilenie `SimPlane.damageLevels` z `DamageState` co tick (`zoneLevels`) — by serwerowa fizyka
  uwzględniała uszkodzenia (predykcja klienta dostanie poziomy w Części 3).

### Kryteria
- [x] Trafienie aktualizuje właściwą strefę + integralność; broad/narrow-phase spójne z TTK.
- [x] Maszyna stanów: pożar (gaśnie/dobija), wyciek (modyfikator z poziomów), pilot kill (rzadki — kabina 0 HP,
      ta sama gałąź co utrata skrzydła), utrata skrzydła→korkociąg (`spin` z modyfikatorów w `stepWreck`).
- [x] Reset stanu uszkodzeń przy respawnie; brak wycieków stanu między życiami.
- [x] Testy serwerowe (combat/zone-hit/state-machine); typecheck+test+lint+build zielone; commit.

### Pułapki
- Pilot kill: start od ~0 szansy/twardości, podnosić w Części 5 (< 5% killi).
- Korkociąg jako reuse `stepWreck` (kinematyka), NIE nowy solver.

---

## CZĘŚĆ 3 — Protokół v8 + predykcja klienta + reakcja botów  ✅ UKOŃCZONE (2026-06-27)

**Warstwa:** `shared/net` + `client` + `shared/ai`/`server` (boty). **Protokół:** **bump v7→v8**
(+u16 stanu stref w encji, `SNAPSHOT_ENTITY_BYTES` 34→36). **Deploy front+back RAZEM.**

### Zrobione
- **`shared/net/protocol.ts`** — `PROTOCOL_VERSION = 8` + nota v8. Nowy `EntityDamage` (`levels: number[]`
  długości ZONE_COUNT, indeks=ZONE_ROLES, 0..3 + `onFire`). `EntitySnapshot.damage` (dekod) i
  `SnapshotEntitySource.damage` (`{ levels: readonly number[]; fire: { onFire: boolean } }` — żywe
  referencje, struktura zamiast typu `DamageState`, by protokół nie zależał od logiki combat). `packDamage`/
  `unpackDamage` (u16: 6×2 bity poziomów + bit pożaru `1<<(ZONE_COUNT*2)`; import `ZONE_COUNT` pilnuje rozmiaru
  bez duplikacji liczby). Encode/decode u16 na offsecie 34; `SNAPSHOT_ENTITY_BYTES` 34→36 (8 encji = 298 B < budżet).
- **`server/game-room.ts`** — `rebuildSnapshotSources` dokłada `damage: { levels: p.damageLevelsBuf, fire: p.damage }`
  (żywe ref: buf mutuje `refreshDamageLevels` co tick w kroku 0, `p.damage` niesie onFire). Snapshot niesie
  poziomy z kroku 0 (te, którymi liczono RUCH tego ticku) → reconcile spójny w stanie ustalonym (zmiana
  poziomu = transient ≤ 1 snapshot, korygowany, niezmienny niezmiennik „brak narastającej korekty").
- **`client/net/prediction.ts`** — `reconcile` przyjmuje `sim.damageLevels = server.damage.levels.some(>0) ? levels : null`
  PRZED replayem nowszych inputów (uszkodzony lot predykowany TYMI SAMYMI modyfikatorami co serwer; sprawny/spawn
  → null = tożsamość fizyki, złote testy nietknięte).
- **`client/online-main.ts`** — `damageById: Map<id, EntityDamage>` zasilana co snapshot dla WSZYSTKICH encji
  (lokalny+obce), czyszczona jak `healthFracById` (usunięcie encji / reset meczu) — pod wizualia Części 4.
- **Boty** — `shared/combat/damage-model.ts` `isCriticalDamage(levels, onFire)` (pożar LUB którakolwiek strefa
  poziom ≥ 2; próg = knob Części 5). `BotPerception.criticalDamage` + `nextBotState`: krytyk → `extend` (ucieczka),
  po `evade` (zagrożenie ratuje ostry break), nadrzędne nad histerezą (raz uszkodzony nie wraca do `engage`).
  `Bot.update(..., criticalDamage=false)` ustawia percepcję; `BotManager.think(..., criticalDamage=false)` przekazuje;
  `game-room.stepBot` liczy `isCriticalDamage(damageLevelsBuf, damage.onFire)` w ticku myślenia.
- **Testy (+8 → 575):** protocol round-trip u16 (poziomy+pożar, sprawny=0); prediction (uszkodzony lot spójny po
  replay 1:1, sprawny→null); fsm (krytyk→extend z każdego stanu, evade>krytyk, brak celu→patrol); bot.update
  (sprawny engage / krytyk extend); damage-model `isCriticalDamage` (pożar, próg ≥2). Helpery testowe
  (makeEntity/entityOf/ent/p) dostały nowe wymagane pola.

### Wynik 3
typecheck (3 ws) ✓, **575 testów** ✓ (+8), lint ✓, build ✓. Protokół v8 — **wymaga deployu front+back RAZEM**
(niespójna wersja = błąd handshake). Skutki uszkodzeń zależą WYŁĄCZNIE od poziomów (2 bity/strefa) → predykcja
klienta i serwer liczą identycznie (spójny reconcile, jak paliwo po v7). Wizualia uszkodzeń (HUD sylwetki własnego
+ dym/ogień/brak końcówki obcych) → Część 4 (czyta `EntitySnapshot.damage` / `damageById`).

### Kryteria
- [x] Round-trip v8; rozmiar pakietu w budżecie (8 encji = 298 B).
- [x] Predykcja lokalna spójna z serwerem dla uszkodzonego samolotu (brak narastającej korekty).
- [x] Boty uciekają przy krytycznych uszkodzeniach.
- [x] typecheck+test+lint+build zielone; commit (deploy front+back razem).

---

## CZĘŚĆ 4 — Klient: HUD sylwetki + wizualizacja uszkodzeń obcych  ✅ UKOŃCZONE (2026-06-27)

**Warstwa:** `packages/client`. **Protokół:** BEZ zmian (czyta v8 z Części 3). **Deploy:** nie dotyczy
(czysto klienckie; działa na już wdrożonym v8).

### Decyzja usera (AskUserQuestion 2026-06-27)
Zniszczone/ciężko uszkodzone skrzydło obcych = **efekty (dym/ogień z pozycji końcówki)**, BEZ ruszania
geometrii. Powód (zgłoszony userowi jako ryzyko): w GLTF-ach Spitfire/Bf 109 skrzydło bywa JEDNĄ bryłą bez
nazwanych węzłów końcówek → prawdziwe „odcięcie końcówki" wymagałoby zrzutu drzewa + oględzin wzrokowych z
działającej gry (niedostępne z sesji) albo przycinania wierzchołków per-model (ryzyko). Dodatkowo skrzydło
na 0 HP to skutek krytyczny → śmierć (Część 2), więc „żywy bez końcówki" jest i tak ulotny.

### Zrobione
- **`client/src/damage-hud.ts`** (nowy) — czyste helpery (testowalne bez DOM) + klasa `DamageHud`:
  - `zoneLevelColor(level)` 0..3 → 4 barwy (zielony/żółty/pomarańcz/ciemnoczerwony); `damageFlags(damage)`
    → {fire (onFire), leak (zbiornik ≥1), pilot (kabina ≥2)}; `criticalZoneLabel(damage)` → moduł krytyczny
    (POŻAR > strefa o najwyższym poziomie ≥2, remis rozstrzyga priorytet roli: pilot > silnik > skrzydło > ogon > zbiornik).
  - `DamageHud` maluje SVG sylwetkę z góry (6 stref kolorowanych poziomem + neutralny grzbiet) i wskaźniki
    🔥/⛽/✚; `update(EntityDamage|null)` (null = ukrycie), `setVisible`. DOM tylko w klasie (jak `Hud`/`ZoneBar`).
- **`index.html`** — `#damage-hud` (lewy dolny róg) + style (sylwetka + 3 kolorowe flagi).
- **`client/src/smoke.ts`** — `SmokeProfile.additive?` (ogień = AdditiveBlending, dym = NormalBlending);
  `FIRE_TIER` (krótkie, jasne, kurczące się języki, interwał 0,05); refaktor progów na wspólny `hpSmokeLevel`
  + `LIVING_TIERS[0..3]`; `livingSmokeTier(hpFrac, engineLevel)` = GORSZY z (HP, silnik) → „narastający dym
  silnika"; `zoneSmokeTier(level)` (≥2) dla dymu z końcówki skrzydła. Budżet `MAX_PUFFS=260` chroni fps
  (świadomie NIE ponawiane `Explosions`, które nie mają limitu).
- **`client/src/online-main.ts`** — `DamageHud` instancja + update w `updateHud` (własna encja, tylko w
  locie; poziomy z `damageById.get(localId)`), ukrycie w `hideCombatOverlays`. Pętla `updateWorldVisuals`
  przepisana: smuga kadłuba `livingSmokeTier` (pożar → wymuszony czarny), `FIRE_TIER` u kotwicy silnika i
  `zoneSmokeTier` u kotwic końcówek skrzydeł — kotwice w body frame czytane z `planeConfigOf(type).zones`
  (TEN SAM JSON co serwerowy hit-detection → efekt wychodzi dokładnie ze strefy, która obrywa; cache per typ).
  Akumulatory emisji jako struktura `{body,fire,wingL,wingR}` (`emitAccumById`, zastąpił `smokeAccumById`),
  czyszczone przy usunięciu encji / resecie. Czytelność śmierci: `localDeathModule` (z `criticalZoneLabel`
  w `onKill`) dokleja moduł do `deathLabel` („ZESTRZELONY — SILNIK"); pokazywany dla air/flak, pomijany dla
  kolizji/rozbicia (to nie strefa dobiła). Korkociąg/dym wraku w 'dying' bez zmian (już WRECK_TIER).
- **`client/src/damage-hud.test.ts`** (nowy, +14 testów) — kolor strefy (clamp/round), flagi (progi
  zbiornik ≥1 / kabina ≥2 / onFire), moduł krytyczny (pożar>strefa, remis→priorytet, <2→null), tiery
  (livingSmokeTier worse-of, zoneSmokeTier ≥2, FIRE additive).

### Wynik 4
typecheck (3 ws) ✓, **589 testów** ✓ (+14), lint ✓, build ✓. BEZ protokołu (czyta v8). Wizualia
nieweryfikowalne wzrokowo z sesji → ⏳ user (weryfikacja + fps RTX przy 8 samolotach).

### Kryteria
- [x] HUD sylwetki (4 kolory: ok/lekkie/ciężkie/zniszczone) + flagi pożaru/wycieku/pilota.
- [x] Uszkodzenia obcych widoczne (dym narastający z silnikiem/HP, ogień u silnika, dym z końcówki
      skrzydła, czarny dym wraku w korkociągu); budżet kłębów chroni fps — ⏳ user: pomiar fps RTX @8.
- [x] typecheck+test+lint+build zielone; commit.

---

## CZĘŚĆ 5 — Balans + tag `1.0`  ⛔ NIE ROZPOCZĘTE

**Warstwa:** strojenie JSON (`damage`) + playtest. **Protokół:** BEZ zmian.

### Zakres
- Sesje balansowe: czas do killa 20 mm vs 7,7 mm; progi stref, szanse pożaru/pilot kill, siła roll
  biasu — wszystko knobem w JSON `damage`, bez kodu.
- Test subiektywny: asymetrię skrzydła CZUĆ na drążku (bias roll wymaga kontry).
- Sesja online z testerami: śmierci czytelne — feedback do `memory/`.

### Kryteria
- [ ] Czas do killa 20 mm vs 7,7 mm udokumentowany w `memory/`.
- [ ] Asymetria skrzydła odczuwalna (test subiektywny usera).
- [ ] typecheck+test+lint+build zielone; commit + **tag `1.0`**; memory zapisane.

---

## Wynik (uzupełniać po każdej części)

- **Część 1 (fundament shared)** — ✅ 2026-06-27, 555 testów/typecheck/lint/build zielone, BEZ
  protokołu (v7). Pliki: `combat/capsule.ts`, `combat/damage-model.ts` (+testy), strefy+tuning w
  JSON obu samolotów + walidacja loadera, modyfikatory w `pilotStep` (`SimPlane.damageLevels`,
  `effectivePlaneConfig`). Tożsamość bez uszkodzeń zachowana.
- **Część 2 (serwer: hit detection po strefach + maszyna stanów)** — ✅ 2026-06-27, 567 testów/typecheck/
  lint/build zielone, BEZ protokołu (v7). Pliki: `shared` `firstZoneHit` + `CANNON_DAMAGE_THRESHOLD`;
  `server/game-room.ts` (`ServerPlayer.damage`, `refreshDamageLevels`, `resolveHits` po strefach +
  skutki krytyczne, `stepFireDamage`/`onFireKill`, diagnostyka); `server/zone-damage.test.ts`. Decyzja
  usera: lag-comp = pozycja z historii + bieżąca orientacja. Pułapka „halo" broad-phase naprawiona
  (narrow-phase na odcinku `pos+v·dt`).
- **Część 3 (protokół v8 + predykcja klienta + reakcja botów)** — ✅ 2026-06-27, 575 testów/typecheck/lint/
  build zielone, **protokół v8 (deploy front+back RAZEM)**. Pliki: `shared/net/protocol.ts` (EntityDamage +
  pack/unpack u16, ENTITY_BYTES 34→36), `server/game-room.ts` (snapshot źródło uszkodzeń), `client/net/prediction.ts`
  (`sim.damageLevels` z autorytetu przed replay), `client/online-main.ts` (`damageById`), `shared/combat/damage-model.ts`
  (`isCriticalDamage`), `shared/ai/{fsm,bot}.ts` + `server/bot-manager.ts` (ucieczka botów). Wizualia → Część 4.
- **Część 4 (klient: HUD sylwetki + wizualia obcych)** — ✅ 2026-06-27, 589 testów/typecheck/lint/build
  zielone, BEZ protokołu (czyta v8). Pliki: `client/src/damage-hud.ts` (+ `.test.ts`), `index.html`
  (#damage-hud), `client/src/smoke.ts` (FIRE_TIER + livingSmokeTier/zoneSmokeTier), `client/src/online-main.ts`
  (DamageHud w HUD, pętla efektów z kotwic stref, moduł śmierci w deathLabel). Decyzja usera: zniszczone
  skrzydło = efekty (dym/ogień), bez ruszania geometrii (GLTF bez nazwanych końcówek). ⏳ user: fps RTX @8.
- **Część 5** — —
