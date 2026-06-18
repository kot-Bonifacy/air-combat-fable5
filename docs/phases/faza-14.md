# Faza 14 — Parytet MP cz.1: wizualia i HUD online

**Zależy od:** Faza 13
**Cel:** Zlikwidować wizualną przepaść między trybem online a single-player. Po tej fazie
klient online ma ten sam feedback walki i pełny HUD co SP: wybuchy, dym uszkodzeń, błysk luf,
markery wrogów ze spottingiem, celownik + znacznik nosa, ostrzeżenie granicy areny, listę
uczestników, pełny HUD-G (przeciążenie/przeciągnięcie/szarzenie + sztuczny horyzont) i licznik
amunicji.

## Zakres

W tej fazie:
- **Wybuchy** (`Explosions`) na zdarzeniu KILL — w pozycji ofiary (serwer w f14 ustawia od razu
  `'dead'`; spadający wrak to Faza 16).
- **Dym uszkodzeń** (`SmokeTrails` + `damageSmokeTier`) dla wszystkich żywych encji wg `healthFrac`
  ze snapshotu (lokalny i obce). Wrak (`'dying'`) → Faza 16.
- **Błysk luf** (`MuzzleFlash`) własnego samolotu — wyzwalany lokalnym zdarzeniem MUZZLE (autorytet
  serwera, jak smugacze z f11).
- **Markery wrogów** (`EnemyMarker`) — tylko w zasięgu wykrycia `SPOT_RANGE_M`; unikatowy kolor FFA
  per id gracza.
- **Celownik myszy** (`reticle`) + **znacznik nosa** (`nose-marker`) z lokalnej predykcji.
- **Ostrzeżenie granicy areny** + komunikat rozbicia/respawnu (alert pełnoekranowy).
- **Lista uczestników** (`RosterOverlay`) z `standings` serwera (kolory spójne z markerami).
- **Pełny HUD-G** (`Hud`): IAS/TAS/alt/gaz, n/G-LOC, ster, amunicja, sztuczny horyzont, ostrzeżenia
  stall/buffet/szarzenie. Dane lotu z lokalnej predykcji (`Predictor.sim` — bez zmiany protokołu),
  amunicja ze snapshotu.
- **Protokół: +1 bajt amunicji w encji snapshotu** → bump `PROTOCOL_VERSION` 2→3.

Poza zakresem: tryb obserwatora i sterowany wrak (Faza 16), kolizje + serwerowy `'dying'` (Faza 15),
strefa KotH (Faza 17), drużyny/kolory sojusznik-wróg (Faza 18).

## Kroki

1. `shared/net/protocol.ts`: bump wersji; `SnapshotEntitySource` + żywa referencja ognia i `ammoMax`;
   `EntitySnapshot.ammoFrac`; `SNAPSHOT_ENTITY_BYTES` 30→31; encode/decode bajtu amunicji; testy.
2. `server/game-room.ts`: `rebuildSnapshotSources` dokłada `fire: p.fire` (żywa ref) + `ammoMax`.
3. `client/online.html`: elementy DOM + CSS przeniesione z `index.html` (reticle, nose-marker,
   arena-alert, stall-warning, horizon/horizon-disc).
4. `client/online-main.ts`: wpięcie efektów i pełnego HUD; markery + spotting; dym wg `healthFrac`;
   wybuchy na KILL; błysk luf na lokalnym MUZZLE; reticle/nose; alert granicy; greyout; roster.
5. Sprzątanie nakładek przy wyjściu z meczu (`enterLobby`/`enterWaiting`).
6. `deploy/WDROZENIE-NA-VPS.md`: nota o równoczesnym deployu frontend+backend v3 (niezgodność wersji).

## Kryteria ukończenia

- [x] Online ma wybuchy, dym uszkodzeń, błysk luf — feedback walki jak w SP (`Explosions` na KILL,
  `SmokeTrails`+`damageSmokeTier` wg `healthFrac`, `MuzzleFlash` własnego samolotu na lokalnym MUZZLE)
- [x] Markery wrogów pojawiają się dopiero ≤ `SPOT_RANGE_M`; poza zasięgiem widać goły mesh
  (`updateHudOverlays`: `distanceToSquared > spotSqM` pomija marker; kolor FFA per id)
- [x] Celownik + znacznik nosa działają z myszą; HUD pokazuje G/stall/szarzenie + sztuczny horyzont
  (`Hud` z `Predictor.sim`: `gLoadEffects`/`stallEffects`/`state`, `nAvailG` doliczany; `GreyoutOverlay`)
- [x] Licznik amunicji w HUD spada z faktycznym ogniem (autorytet serwera, snapshot v3 — `localAmmoFrac`)
- [x] Ostrzeżenie granicy areny i komunikat rozbicia/respawnu na ekranie (`arena-alert`)
- [x] Lista uczestników (kille/asysty) z kolorami spójnymi z markerami (`RosterOverlay` ze `standings`)
- [x] typecheck + test (381) + lint zielone; build (Vite + esbuild) przechodzi; commit

## Pułapki

- **Niezgodność wersji** po bumpie: klient v3 ↔ serwer v2 = błąd handshake. Deploy frontendu i
  backendu MUSI być równoczesny (nota w runbooku).
- Amunicja lokalna pochodzi ze snapshotu (predykcja NIE symuluje ognia) — żadnej lokalnej dekrementacji.
- Dane G/stall/szarzenie czytane z `Predictor.sim` (`gLoadEffects`/`stallEffects`/`state`), `nAvailG`
  doliczany helperem `shared` (q z prędkości i wysokości) — bez kopii pipeline'u fizyki.
- Markery/dym/greyout/roster trzeba chować przy wyjściu z meczu, inaczej zostają na ekranie lobby.
- Budżet snapshotu: 8 encji × 31 B + 10 B = 258 B < 350 (limit pasma z f8 utrzymany).

## Wynik

**Zrealizowane (2026-06-18).** Klient online (`packages/client/src/online-main.ts`) osiągnął parytet
wizualny z SP — wszystkie efekty to TE SAME moduły co w `main.ts` (zero duplikacji renderu).

**Protokół v3** (`shared/net/protocol.ts`): `PROTOCOL_VERSION` 2→3; encja snapshotu +1 bajt amunicji
(`ammoFrac` = `ammoRemaining/ammoMax`, u8), `SNAPSHOT_ENTITY_BYTES` 30→31 (8 encji = 258 B < 350).
`SnapshotEntitySource` dostał ŻYWĄ referencję `fire` + stały `ammoMax` (jak `health` — pole
`ammoRemaining` mutuje się co tick, więc snapshot koduje aktualny stan bez przebudowy źródeł).
Serwer (`game-room.ts` `rebuildSnapshotSources`): `fire: p.fire`, `ammoMax: totalAmmo(...)`.

**Klient — wpięte (faza 14):**
- **Wybuchy** (`Explosions`) na evencie KILL w pozycji meshu ofiary (skala 0.8 powietrze / 1.0 ziemia-kolizja);
  serwer w f14 ustawia od razu `'dead'` (mesh znika), więc to jedyny moment efektu — wrak ze spadaniem → f16.
- **Dym uszkodzeń** (`SmokeTrails` + `damageSmokeTier(healthFrac, 1)`) dla wszystkich żywych encji;
  `healthFrac` per id z mapy `healthFracById` (ustawianej w `handleSnapshot` dla lokalnego i obcych),
  akumulator interwału per id (`smokeAccumById`), emisja cofnięta o `SMOKE_BACK_OFFSET_M` za ogon.
- **Błysk luf** (`MuzzleFlash`) TYLKO własnego samolotu — `flash()` na lokalnym evencie MUZZLE
  (`ownerId === localId`), pozycja z `predictor.renderPosition/renderOrientation` (jak SP).
- **Markery wrogów** (`EnemyMarker` ×7) — tylko żywe, obce, ≤ `SPOT_RANGE_M`; `setColorHex` per id
  z palety FFA. Faza życia per id z mapy `lifeById` (zapisywana w pętli renderu).
- **Celownik** (`mouseAim.reticleScreenPos`) + **znacznik nosa** (`projectDirToScreen`) — żywy gracz z myszą.
- **Ostrzeżenie granicy** (`distanceToArenaEdgeM` ≤ `ARENA_WARNING_DISTANCE_M`) + komunikat rozbicia/respawnu.
- **Lista uczestników** (`RosterOverlay`) z `standings` serwera; kolory z `entityColorHex` (gracz złoty,
  inni z palety FFA per id — spójne z markerami). `isLost` zawsze false (FFA = respawn bez limitu żyć).
- **Pełny HUD-G** (`Hud`): dane lotu z `Predictor.sim` (`state.loadFactor`, `gLoadEffects.gLimitG/blackoutFactor`,
  `stallEffects.phase/buffetIntensity`), `nAvailG` doliczany z `q = dynamicPressurePa(airDensityKgM3(alt), tas)`
  — BEZ kopii pipeline'u fizyki; amunicja z `localAmmoFrac` (snapshot); sztuczny horyzont z `bank/pitch`.
  `GreyoutOverlay` tylko gdy żywy gracz.

**DOM/CSS:** `online.html` dostał `#reticle`, `#nose-marker`, `#arena-alert`, `#stall-warning`,
`#horizon`+`#horizon-disc` (przeniesione z `index.html`). `Explosions`/`SmokeTrails` dostały `clear()`
(reset meczu/reconnect — bez artefaktów zamrożonych cząstek na rewanżu). `hideCombatOverlays()`
gasi nakładki przy wyjściu z meczu (`enterWaiting`/`enterLobby` przez `resetGameState`).

**Walidacja:** `npm run typecheck` + `npm test` (381, +1 test ułamka amunicji) + `npm run lint` zielone;
`npm run build` (Vite klient 37,9 kB online + esbuild serwer 558 kB) przechodzi. Bundle online wzrósł
o wpięte moduły SP.

**Otwarte (użytkownik):** wgranie v3 na VPS (frontend+backend RAZEM — niezgodność wersji w runbooku);
ocena „co widzę, to trafiam" na żywym pingu. **Niezweryfikowane w realnej grze** (brak sesji 2-os.
z sesji Claude'a) — logika i build potwierdzone, smoke wzrokowy po stronie użytkownika.
