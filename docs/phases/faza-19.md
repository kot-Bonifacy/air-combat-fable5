# Faza 19 — Drugi samolot + balans: Bf 109 E

**Zależy od:** Faza 18 (parytet multiplayera ukończony)
**Cel:** asymetryczny matchup Spitfire (turn-fighter) vs Bf 109 (energy-fighter) —
dowód, że architektura fizyki rzeczywiście jest data-driven.

## Zakres

W tej fazie:
- `shared/src/planes/bf109-e.json` — pełna konfiguracja wg schematu z `fizyka-lotu.md`
  (rozdz. 9), kalibrowana do kolumny Bf 109 E-3 z tabeli celów (rozdz. 10)
- Model 3D Bf 109 (CC0/CC-BY albo low-poly spójny stylem ze Spitfire) + LICENSES.md
- Uzbrojenie zróżnicowane: Bf 109 E-3 = 2× MG 17 (7.92 mm) + 2× MG FF (20 mm, wolniejsze,
  mocniejsze, mniejszy zapas) — drugi typ pocisku w balistyce (dmg, prędkość, balistyka łukowa)
- Wybór samolotu w poczekalni (per gracz, zmiana między respawnami dozwolona)
- Harness manewrów odpalany dla OBU samolotów (parametryzacja testów po plane config)
- Sesje balansowe: 1v1 ludzie + boty na obu typach; boty losują typ samolotu
- HUD: nazwa typu przeciwnika przy znaczniku (rozpoznawanie matchupu)

Poza zakresem: trzeci samolot (backlog), ujednolicanie osiągów („balans przez nerf do średniej"
ZAKAZANY — asymetria to feature).

## Kroki

1. JSON Bf 109 + kalibracja harnessem (procedura z fazy 2: V_max → V_stall → wznoszenie;
   plus roll/turn z fazy 3)
2. Parametryzacja złotych testów: `describe.each([spitfire, bf109])`
3. Drugi typ pocisku (20 mm) w `shared/combat` + testy balistyki
4. Import modelu, wybór w lobby, propagacja typu w protokole (bajt typu w snapshot/spawn)
5. Sesje balansowe → notatki → ewentualne korekty JSON (nigdy kodu)

## Kryteria ukończenia

- [ ] Złote testy zielone dla obu samolotów względem ich kolumn z tabeli celów
- [ ] Bf 109 wygrywa pościg wznoszący i nurkowanie; Spitfire wygrywa krążenie poziome
  (testy scenariuszowe w harness: 30 s symulacji obu strategii)
- [ ] 20 mm czuć inaczej niż 7.7 mm (wolniejszy tracer, większy łuk, 2-4 trafienia = kill)
- [ ] Boty latają oboma typami bez zmian w AI (interfejs instruktora wystarcza)
- [ ] Sesja balansowa 1v1: oba samoloty wygrywają mecze (żaden nie jest strictly better) —
  notatka w memory
- [ ] typecheck + test + lint zielone; commit `faza-19`; memory zapisane

## Pułapki

- Kuszące jest „poprawianie" fizyki pod balans — NIE: balans robi się danymi (JSON),
  a jeśli dane historyczne dają nudny matchup, różnicuje się uzbrojeniem i zapasem amunicji
- MG FF miał haubiczną balistykę — to utrudnienie celowania JEST balansem dla większego dmg
- Dwa typy samolotów = pierwszy prawdziwy test generyczności kodu; każdy `if (planeType === ...)`
  poza ładowaniem configu to smell

## Wynik

**Faza podzielona na 19a/19b** (decyzja użytkownika 2026-06-20, wzorem fazy 18 — zakres za duży na jedną
sesję: fizyka + podwójne uzbrojenie + bump protokołu + model 3D + lobby + balans). Model 3D Bf 109: użytkownik
wybrał wariant „shortlista CC-BY/CC0 do ręcznego pobrania" (parytet workflow ze Spitfire).

### 19a — warstwa `shared` (2026-06-20, ✅ zacommitowane, 424 testy / typecheck / lint zielone)

- **Refaktor uzbrojenia na grupy broni** (pierwszy test generyczności kodu): `armament` →
  `{ groups: WeaponGroup[] }`, zero `if (planeType)`. Balistyka **per pocisk** (`Bullet.dragK`/`lifetimeS`,
  `pool.update(dtS)`, `spawn(...,dragK,lifetimeS)`) — jedna pula miesza typy. `FireControl` **per grupa**
  (różne kadencje strzelają niezależnie); cache sumy `ammoRemaining` zachowuje snapshot v3 bez zmian.
  Helpery `totalAmmo`/`allMuzzles`/`primaryGroup`/`resetFireControl`. Konsumenci (server/client/bot/testy)
  zaktualizowani — całość zielona.
- **`bf109-e.json` + `BF109_E`** skalibrowane do kolumny Bf 109 E-3 (rozdz. 10): V_max SL 499/465,
  V_max 5.5k 570/555, V_stall 129/125, climb 15.6/15, roll@350 84/85, turn 22.3/22 — wszystko w tolerancji.
- **Złote testy SPARAMETRYZOWANE** `describe.each([Spitfire, Bf 109])` (ten sam harness, dwie kolumny) —
  dowód, że koperta osiągów jest data-driven.
- **Uzbrojenie zróżnicowane**: Bf 109 = 2× MG 17 (7.92, gęsto) + 2× MG FF (20 mm: wolniejszy tracer, większy
  łuk, 3 trafienia = kill); testy w `fire.test`.
- **Scenariusze asymetrii** (turn-fighter ↔ energy-fighter): Spitfire wygrywa zakręt poziomy; Bf 109 wygrywa
  beczkę, nurkowanie (`diveSpeedTest`) i pościg wznoszący/zoom (`zoomClimbTest`). Żaden nie jest strictly better.

Kryteria spełnione w 19a: złote testy obu samolotów ✅ · matchup asymetryczny ✅ · 20 mm ≠ 7.7 mm ✅ ·
interfejs instruktora generyczny (bot lata oboma — `primaryGroup` w lead) ✅ · typecheck+test+lint+commit+memory ✅.

> **NAPIĘCIE do świadomości (rozwiązane interpretacją):** kryterium „Bf 109 wygrywa pościg wznoszący" koliduje
> z kolumną celów (109 climb 15 < Spit 17 USTALONY). Zinterpretowano „pościg wznoszący" jako **zoom climb
> (energia w pionie)**, który 109 wygrywa przez lepszy współczynnik balistyczny W/(S·cd0) (małe skrzydło).
> W czystym modelu aero (bez odcięcia gaźnika Merlina pod −G, bez ściśliwości) przewaga 109 w nurkowaniu jest
> mała — `cd0` 109 ustawione na 0.022 (czystszy płatowiec, w widełkach E-3) dla wyraźnego marginesu energii.

### 19b — integracja (2026-06-20, ✅ zacommitowane, 440 testów / typecheck / lint / build zielone)

Decyzje użytkownika (2026-06-20): wybór samolotu **tylko w poczekalni** (po P1 brak respawnu → „zmiana między
respawnami" martwa); w trybie **drużynowym sprzęt wg strony** (drużyna 0 = Spitfire/Alianci, 1 = Bf 109/Oś),
w FFA wolny wybór per gracz; model 3D **wpięty teraz** z best-guess (weryfikacja wzrokowa user-side).

- **Protokół v4** (`PROTOCOL_VERSION` 3→4): snapshot encji +1 bajt **typu samolotu** (`SNAPSHOT_ENTITY_BYTES`
  31→32), nowy rejestr `planes/plane-type.ts` (`PlaneType`, `PLANE_TYPES` = kolejność na drucie, `planeTypeToCode`/
  `FromCode`, `clampPlaneType`, `planeConfigOf`, `planeLabelOf`, `planeTypeForTeam`); `RoomPlayer.planeType`,
  `mode` w `RoomJoined`/`RoomUpdate`, wiadomość `selectPlane`. **Deploy front+back RAZEM** (niespójna wersja = błąd
  handshake). Helper `wingspanM(config)=√(AR·S)` w loaderze (auto-skala modelu z geometrii, bez pola w JSON).
- **Serwer per-player plane**: usunięty `GameRoom.plane`; `ServerPlayer` ma `selectedType`/`planeType`/`plane`/`health`/
  `fire` PER GRACZ. `effectiveType` (team→strona, FFA→wybór), `applyPlaneSelection` (zmiana typu → re-create `fire`
  bo liczba grup różni się 1↔2 + HP + przebudowa źródeł snapshotu), `selectPlane`, `addBot(diff, type?)` (forsowany
  typ; bez niego losowany z id). Hit radius per CEL, promień kolizji per płatowiec (suma), `ammoMax`/`planeType` per
  encja w snapshocie. Connection routuje `selectPlane` (clampPlaneType, niezm. 11), `mode` w roomJoined.
- **Klient**: rejestr meshy `plane-mesh.ts` per typ (`ModelSpec`: URL/orientacja/węzły śmigła+podwozia; Bf 109 ukrywa
  podwozie też po MATERIALE — pewniejsze), `createPlaneMesh(type, wingspan)`. `online-main` reaguje na typ z własnej
  encji (`setLocalPlane`: świeży predyktor + amunicja + błysk luf z OBU grup), mesh per encja wg `planeType`, kosmetyczne
  smugacze z luf strzelca, HUD: etykieta typu wroga przy markerze (`EnemyMarker.setType`). Lobby: selektor samolotu w
  poczekalni (FFA; drużynowy → „sprzęt wg drużyny"), typ przy nicku w roster, atrybucja CC-BY OBU modeli.
- **Model 3D Bf 109** (Jankenstein, CC-BY 4.0) — `bf109-web.glb` (2,72 MB, nazwy węzłów zachowane), wpis w `LICENSES.md`
  + atrybucja w lobby. fixEuler best-guess `{0,0,0}` — **weryfikacja wzrokowa orientacji/śmigła user-side** (jak Spitfire).
- **Sesja balansowa 1v1** (`balance.test.ts`, harness pełnej walki serwera, boty „trudny" oba typy, 8 ziaren × 2 sloty):
  **Bf 109 16/16, pełne HP, Spitfire 0 obrażeń** — generyczne AI nie turn-fightuje, więc energy-fighter czysto wygrywa
  każdy merge; osiągi per kolumna 19a NIENARUSZONE. Decyzja usera: **akceptacja + playtest** (bez nerfu do średniej —
  asymetria to feature, a bot to słaby probierz stylu gry). Test asercjonuje tylko ODPORNOŚĆ mieszanej walki (każdy
  pojedynek rozstrzyga się bez NaN/zawieszenia), rozkład loguje do notatki. **Prawdziwy balans „oba wygrywają" =
  human playtest (user-side).**

Kryteria spełnione w 19b: protokół v4 + per-player plane ✅ · model 3D + LICENSES ✅ · wybór w lobby ✅ · HUD typ wroga ✅ ·
boty oba typy bez zmian AI ✅ · typecheck+test(440)+lint+build ✅. **Otwarte (user): playtest balansu 1v1 + weryfikacja
wzrokowa modelu Bf 109 (orientacja/śmigło/podwozie) + smoke online v4 (deploy front+back RAZEM).**
