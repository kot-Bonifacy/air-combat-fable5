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

## Wynik (uzupełnić po zakończeniu)

—
