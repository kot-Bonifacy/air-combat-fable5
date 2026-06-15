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

- [x] Testy round-trip protokołu zielone (w tym wartości brzegowe kwantyzacji)
- [x] Klient w trybie online lata samolotem symulowanym na serwerze (z opóźnieniem — akceptowane)
- [x] Zerwanie połączenia → czytelny komunikat na kliencie, czysty cleanup na serwerze
- [x] Spreparowany pakiet (zły rozmiar / wartości poza zakresem) → odrzucony + log, serwer żyje
- [x] Snapshot dla 8 encji < ~350 B (≈ 84 KB/s przy 30 Hz) — zmierzony, zapisany w memory
- [x] typecheck + test + lint zielone; commit `faza-8`; memory zapisane

## Pułapki

- NIGDY `JSON.stringify` w hot path (niezmiennik nr 6) — tylko handshake/lobby/eventy
- Kwantyzacja orientacji: kwaternion jako „smallest three" (3× int16 + 2 bity indeksu)
  albo prościej 4× int16 — zacznij od prostszego, benchmark zdecyduje
- Endianness: DataView z jawnym `littleEndian=true` wszędzie — domyślne zachowanie bywa różne
- `setInterval` na 60 Hz dryfuje — pętla serwera z korekcją czasu (akumulator jak w kliencie)

## Wynik

Zrealizowane 2026-06-15. Multiplayer cz.1: protokół binarny + autorytatywny serwer
symulujący tą samą fizyką z `shared`. Klient lata „przez serwer" (online), bez predykcji.

**Co powstało**
- `shared/src/net/protocol.ts` — binarny enkoder/dekoder na DataView (jawnie little-endian):
  - `INPUT` (24 B): seq u32, clientTimeMs u32, throttle u16, wychylenia steru i kierunek
    celu jako int16 w [−1,1], spust w bicie flag. Cel instruktora = jednostkowy kierunek
    w świecie (liczony klientem przez MouseAimCore renormalizowany względem nosa z serwera).
  - `SNAPSHOT` (10 B nagłówek + 29 B/encję): tick u32, ack u32, encje (id, flagi
    life/stall/local, pozycja **f32×3**, orientacja **int16×4** + renormalizacja, prędkość
    **int16×3** w zakresie ±600 m/s, throttle u8).
  - Handshake/eventy = **JSON tekstowy** (decyzja fazy): `hello/welcome/error` niosą bajt
    wersji protokołu; niezgodność = czytelny `error` + zamknięcie. EVENT zdefiniowany, ale
    w fazie 8 niepotrzebny — respawn jest widoczny przez flagi life w snapshocie.
- `server/` — `game-room.ts` (autorytatywna symulacja: `pilotStep` + instruktor/klawiatura
  + cykl życia; BEZ walki), `connection.ts` (maszyna stanów handshake→playing, walidacja
  rozmiaru/typu/zakresów + rate limit 2×INPUT_HZ, legacy `ping`/`pong` dla wskaźnika offline),
  `server.ts` (pętla 60 Hz przez `FixedStepLoop` na realnym czasie + snapshoty 30 Hz +
  benchmark pasma), cienki `index.ts`.
- `client/` — **osobna strona `online.html` + `online-main.ts` + `net-client.ts`**
  (izolacja od działającej gry offline `main.ts`; wzorzec jak `telemetry.html`). Wejście
  60 Hz, render najświeższego snapshotu SUROWO (bez interpolacji), HUD ze statusem/ping,
  nakładka stanu połączenia, RTT z acka.
- Test integracyjny WS (serwer w procesie + klient `ws`): handshake, reakcja na input,
  spreparowane pakiety odrzucone (serwer żyje), cleanup po rozłączeniu.

**Pomiar pasma**: `snapshotByteLength(8) = 242 B` → przy 30 Hz ≈ **7,1 KB/s na klienta**
(z budżetem < 350 B / < 100 KB/s z zapasem). Delta encoding NIE jest potrzebne na tym etapie.

**Decyzje**: kwantyzacja orientacji jako 4× int16 (najprostszy wariant — wystarcza, smallest-three
zbędne); pozycja zostaje f32 (zakres areny + wysokość nie mieszczą się w jednej skali int16);
broń online wyłączona (`fire` przenoszony, ignorowany przez serwer do fazy 11); tryb online
jako osobna strona zamiast `?online` w `main.ts` (zero ryzyka dla dema fazy 7).

**Uruchomienie (dev)**: `npm run dev`, potem klient online pod `http://localhost:5173/online.html`
(opcjonalnie `?server=ws://host:3001`).

Następna: Faza 9 — predykcja klienta + reconciliation + interpolacja obcych.
