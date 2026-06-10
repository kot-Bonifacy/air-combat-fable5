# Faza 8 — Multiplayer cz.1: protokół binarny + serwer autorytatywny

**Zależy od:** Faza 7
**Cel:** serwer symuluje świat tą samą fizyką z `shared`, jeden klient lata „przez serwer".
Celowo BEZ predykcji — w tej fazie input ma widoczne opóźnienie i to jest OK (naprawia faza 9).

## Zakres

W tej fazie:
- Protokół binarny w `shared/src/net/`: enkoder/dekoder na DataView
  - `INPUT` (klient→serwer): sequence, sterowanie (cel instruktora, rate'y klawiatury,
    throttle, spust), client timestamp — kwantyzacja pól (np. kąty jako int16)
  - `SNAPSHOT` (serwer→klient): tick, ack ostatniego inputu, encje (id, pozycja, orientacja
    skwantyzowana, prędkość, HP, flagi stanu)
  - `EVENT` (serwer→klient): spawn/kill/hit (rzadkie, mogą być JSON-owe w MVP — decyzja tu)
  - bajt wersji protokołu w handshake; niezgodność = czytelny błąd na kliencie
- Serwer: pętla 60 Hz (fizyka) + wysyłka snapshotów 30 Hz; pokój na sztywno (1 pokój, auto-join)
- Walidacja inputu na serwerze: zakresy, rozmiar, rate limit (niezmiennik nr 11)
- Klient: tryb `online` (flagą/parametrem URL) — wysyła input 60 Hz, renderuje stan z serwera
  (na razie surowo, bez interpolacji)
- Pomiar: rozmiar snapshotu w bajtach logowany; cel < 100 KB/s przy 8 encjach

Poza zakresem: predykcja, interpolacja, reconciliation (faza 9), lobby (faza 10),
strzelanie przez sieć (faza 11 — w trybie online broń tymczasowo wyłączona).

## Kroki

1. `shared/src/net/protocol.ts`: layout pakietów + enkoder/dekoder + testy round-trip
   (encode→decode = identyczne wartości w granicach kwantyzacji)
2. Serwer: `game-room.ts` (pętla, stany graczy), `connection.ts` (ws, handshake, walidacja)
3. Klient: `net-client.ts`, przełącznik offline/online
4. Test integracyjny: serwer w procesie testowym + klient WS symulowany → samolot na serwerze
   reaguje na input
5. Benchmark rozmiaru snapshotu dla 8 encji → notatka w memory (decyzja: czy trzeba delta encoding)

## Kryteria ukończenia

- [ ] Testy round-trip protokołu zielone (w tym wartości brzegowe kwantyzacji)
- [ ] Klient w trybie online lata samolotem symulowanym na serwerze (z opóźnieniem — akceptowane)
- [ ] Zerwanie połączenia → czytelny komunikat na kliencie, czysty cleanup na serwerze
- [ ] Spreparowany pakiet (zły rozmiar / wartości poza zakresem) → odrzucony + log, serwer żyje
- [ ] Snapshot dla 8 encji < ~350 B (≈ 84 KB/s przy 30 Hz) — zmierzony, zapisany w memory
- [ ] typecheck + test + lint zielone; commit `faza-8`; memory zapisane

## Pułapki

- NIGDY `JSON.stringify` w hot path (niezmiennik nr 6) — tylko handshake/lobby/eventy
- Kwantyzacja orientacji: kwaternion jako „smallest three" (3× int16 + 2 bity indeksu)
  albo prościej 4× int16 — zacznij od prostszego, benchmark zdecyduje
- Endianness: DataView z jawnym `littleEndian=true` wszędzie — domyślne zachowanie bywa różne
- `setInterval` na 60 Hz dryfuje — pętla serwera z korekcją czasu (akumulator jak w kliencie)

## Wynik (uzupełnić po zakończeniu)

—
