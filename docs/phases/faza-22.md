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

## CZĘŚĆ 2 — Serwer: hit detection po strefach + maszyna stanów  ⛔ NIE ROZPOCZĘTE

**Warstwa:** `packages/server` (+ ew. drobne `shared`). **Protokół:** BEZ zmian (stan stref jeszcze
nie jedzie w snapshocie — to Część 3; tu serwer trzyma go autorytatywnie i działa lokalnie).

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
- [ ] Trafienie aktualizuje właściwą strefę + integralność; broad/narrow-phase spójne z TTK.
- [ ] Maszyna stanów: pożar (gaśnie/dobija), wyciek, pilot kill (rzadki), utrata skrzydła→korkociąg.
- [ ] Reset stanu uszkodzeń przy respawnie; brak wycieków stanu między życiami.
- [ ] Testy serwerowe (combat/zone-hit/state-machine); typecheck+test+lint+build zielone; commit.

### Pułapki
- Pilot kill: start od ~0 szansy/twardości, podnosić w Części 5 (< 5% killi).
- Korkociąg jako reuse `stepWreck` (kinematyka), NIE nowy solver.

---

## CZĘŚĆ 3 — Protokół v8 + predykcja klienta + reakcja botów  ⛔ NIE ROZPOCZĘTE

**Warstwa:** `shared/net` + `client` + `shared/ai`/`server` (boty). **Protokół:** **bump v7→v8**
(+u16 stanu stref w encji, `SNAPSHOT_ENTITY_BYTES` 34→36). **Deploy front+back RAZEM.**

### Zakres
- `EntitySnapshot.damage`/`SnapshotEntitySource.damage` (u16: 6×2 bity poziomów + bit pożaru);
  encode/decode + round-trip testy; nota wersji w `protocol.ts`.
- Klient: dekod stanu stref → `SimPlane.damageLevels` lokalnego gracza (spójna predykcja uszkodzonego
  lotu) + zapamiętanie poziomów obcych pod wizualia Części 4.
- Boty: warunek wycofania przy krytycznych uszkodzeniach (FSM/`bot-manager`).

### Kryteria
- [ ] Round-trip v8; rozmiar pakietu w budżecie (8 encji).
- [ ] Predykcja lokalna spójna z serwerem dla uszkodzonego samolotu (brak narastającej korekty).
- [ ] Boty uciekają przy krytycznych uszkodzeniach.
- [ ] typecheck+test+lint+build zielone; commit (deploy front+back razem).

---

## CZĘŚĆ 4 — Klient: HUD sylwetki + wizualizacja uszkodzeń obcych  ⛔ NIE ROZPOCZĘTE

**Warstwa:** `packages/client`. **Protokół:** BEZ zmian (czyta v8 z Części 3).

### Zakres
- HUD uszkodzeń: sylwetka samolotu z kolorami stref (zielony/żółty/czerwony) + wskaźniki pożaru/
  wycieku/rannego pilota (z `EntitySnapshot.damage` lokalnego gracza).
- Wizualia obcych: narastający dym silnika, ogień, brakująca końcówka skrzydła (podmiana/ukrycie
  fragmentu meshu — wzorzec `charPlaneMesh`/`restorePlaneMesh`), dym wraku w korkociągu.
- Czytelność śmierci („wiem, co mnie zabiło") — przyczyna modułowa, spójna z `KillCause`/`deathLabel`.
- Cleanup efektów przy śmierci/usunięciu encji (pułapka wiszących źródeł — jak audio fazy 21).

### Kryteria
- [ ] HUD sylwetki (3 kolory) + flagi pożaru/wycieku/pilota.
- [ ] Uszkodzenia obcych widoczne (dym/ogień/brak końcówki/korkociąg); fps na RTX przy 8 samolotach.
- [ ] typecheck+test+lint+build zielone; commit.

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
- **Część 2** — —
- **Część 3** — —
- **Część 4** — —
- **Część 5** — —
