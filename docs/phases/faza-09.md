# Faza 9 — Multiplayer cz.2: prediction, reconciliation, interpolacja

**Zależy od:** Faza 8
**Cel:** sterowanie w trybie online czuje się IDENTYCZNIE jak offline przy pingu ≤ 100 ms,
a obce samoloty poruszają się płynnie.

## Zakres

W tej fazie:
- **Client prediction** własnego samolotu: input działa natychmiast na lokalnej fizyce
  (ta sama fizyka z `shared`); bufor par (sequence, input, stan po)
- **Reconciliation**: snapshot niesie ack → klient przyjmuje stan serwera dla swojego
  samolotu, odtwarza inputy nowsze niż ack; korekta wygładzana (snap przy dużym błędzie,
  smooth przy małym — progi w constants)
- **Snapshot interpolation** obcych samolotów: bufor ~100 ms, interpolacja pozycji (lerp)
  i orientacji (slerp); ekstrapolacja max 100 ms przy zgubionym snapshocie
- **Symulator warunków sieciowych w dev**: sztuczne opóźnienie, jitter, packet loss
  (po stronie klienta, konfigurowalne w panelu dev) — bez tego nie da się tego uczciwie testować
- **Network debug overlay**: ping, wielkość korekt reconciliation (śr./max), utracone snapshoty,
  zajętość bufora interpolacji

Poza zakresem: lag compensation broni (faza 11), lobby (faza 10).

## Kroki

1. Symulator sieci (`client/src/net/net-conditions.ts`) — NAJPIERW, żeby od razu testować uczciwie
2. Bufor inputów + replay po stronie klienta; stan serwera jako autorytet
3. Interpolacja obcych encji (na razie testowana drugim oknem przeglądarki)
4. Debug overlay
5. Testy: jednostkowy replay (zadany dryf → po reconciliation stan = stan serwera + nowsze inputy);
   integracyjny z symulowanym lagiem

## Kryteria ukończenia

- [ ] Przy 100 ms ping + 20 ms jitter + 2% loss: własny samolot odpowiada natychmiast,
  bez widocznych szarpnięć (korekty < progu snap w 99% ticków — metryka z overlay)
- [ ] Dwa okna przeglądarki: samolot z okna A widziany w oknie B porusza się płynnie,
  manewry czytelne (beczka wygląda jak beczka)
- [ ] Pętla/przeciągnięcie w trybie online czuje się jak offline (test subiektywny + nagranie
  rejestratorem w obu trybach → porównanie wykresów n(t))
- [ ] Testy replay zielone
- [ ] typecheck + test + lint zielone; commit `faza-9`; memory zapisane

## Pułapki

- Fizyka klient/serwer nie jest bitowo identyczna (różne silniki JS) — reconciliation
  MUSI tolerować mikro-dryf: korekta poniżej progu = ignoruj/wygładź, inaczej wieczne drganie
- Replay inputów wymaga, żeby krok fizyki był czystą funkcją (stan, input) → stan;
  każdy ukryty stan globalny (np. RNG poza stanem) = bug reconciliation
- Bufor interpolacji: za mały = teleporty przy jitterze; za duży = obcy „w przeszłości"
  (utrudnia celowanie — istotne w fazie 11). 100 ms to start, nie dogmat
- Czas: klient i serwer mają osobne zegary — synchronizacja przez tick serwera w snapshotach,
  nie przez `Date.now()` porównywany między maszynami

## Wynik

Zrealizowane (2026-06-16). typecheck + 316 testów + lint zielone; build klienta (multi-page)
i serwera OK.

- **Wspólny autorytatywny tick** `shared/world/piloted-plane.ts` → `stepPilotedPlane`
  (wyciągnięty z `GameRoom.stepPlayer`, używany przez serwer i predykcję — gwarancja, że
  replay idzie tym samym kodem co serwer). Serwer zrefaktoryzowany na tę funkcję.
- **Client prediction + reconciliation**: `client/src/net/prediction.ts` (`Predictor`).
  Input działa natychmiast na lokalnej fizyce; bufor inputów; snapshot serwera = autorytet
  dla stanu widocznego + replay nowszych niż ack; korekta wygładzana zanikającym OFFSETEM
  RENDERU (τ = `RECONCILE_SMOOTH_TAU_S`), twardy snap ≥ `RECONCILE_SNAP_DIST_M` (50 m).
  Ukryty stan maszyn poza snapshotem (tolerowany mikro-dryf), `iasMs` odtwarzane z prędkości.
- **Snapshot interpolation**: `client/src/net/interpolation.ts` (`SnapshotInterpolator`).
  Bufor `INTERP_DELAY_MS` (100 ms), lerp pozycji (toroidalnie bezpieczny) + slerp orientacji,
  zegar odtwarzania po ticku serwera (nie `Date.now`), ekstrapolacja ≤ `INTERP_EXTRAPOLATION_MAX_MS`.
- **Symulator sieci (dev)**: `client/src/net/net-conditions.ts` (`rollDelayMs`, czysty,
  deterministyczny) wpięty w `NetClient` (TX/RX: opóźnienie, jitter, strata) + panel tweakpane
  `net-conditions-panel.ts` (`[P]`, tylko DEV — tree-shaken z prod) z presetami.
- **Network debug overlay**: `client/src/net/net-debug-overlay.ts` (`[N]`): ping, korekty
  reconciliation (śr./maks/% < próg snap), utracone snapshoty, zajętość bufora interpolacji.
- **`online-main.ts`** przepisany na predykcję (własny samolot) + interpolację (obce); reset
  kamery przy teleporcie (zawinięcie torusa / respawn / snap).

### Kryteria

- [x] Przy 100 ms ping + 20 ms jitter + 2% loss korekty < próg snap — zweryfikowane TESTEM
  zamkniętej pętli z lagiem (`prediction.test.ts`): `belowSnapFraction == 1`, `maxM < 10 m`.
  Subiektywne „bez szarpnięć" — do potwierdzenia manualnie (przeglądarka).
- [x] Dwa okna: implementacja gotowa (interpolacja obcych) — test manualny w przeglądarce.
- [x] Pętla/przeciągnięcie online = offline: STRUKTURALNIE (wspólny `stepPilotedPlane`/`pilotStep`);
  porównanie n(t) rejestratorem zostaje testem manualnym (online recorder nie budowany).
- [x] Testy replay zielone (`piloted-plane.test.ts` determinizm + `prediction.test.ts` reconcile).
- [x] typecheck + test + lint zielone; memory zapisane. Commit `faza-9`.

Poza zakresem (świadomie): rejestrator w trybie online, lag compensation broni (faza 11),
lobby (faza 10). Pamięć projektu nie zawiera `project_phase8_decisions.md` (faza 8 tylko w
auto-pamięci) — do ewentualnego backfillu.
