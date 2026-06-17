# Faza 11 — decyzje (walka sieciowa: serwerowy hit detection + lag compensation)

Cel: „co widzę, to trafiam" przy pingu ≤ 150 ms — strzelanie online czuje się jak offline.

## Decyzje architektoniczne (nieoczywiste z kodu)

- **Rewind liczony z ECHA TICKU (pełny RTT), nie z „ping/2".** Klient odsyła w INPUT
  `ackServerTick` (najnowszy serverTick, jaki zastosował); serwer:
  `rewind = (tick − ackServerTick) + INTERP_DELAY_TICKS`, clamp do `MAX_REWIND_TICKS`
  (`game-room.ts: computeRewindTicks`). To DOKŁADNE odtworzenie tego, co strzelec widział:
  snapshot dotarł do klienta ping/2, echo wróciło ping/2 (`sinceAck ≈ pełny ping`), a cele
  były renderowane dodatkowo o bufor interpolacji w przeszłości. **Brak synchronizacji zegarów
  między maszynami i brak wartości deklarowanej przez klienta — nie ma czego oszukać.** Spec.
  (krok 2) mówiła o „ping mierzony + bufor deklarowany w handshake, clamp serwerowy" oraz
  „now − ping/2 − bufor": świadomie odrzucone na rzecz modelu pełnego RTT z echa — prostszego,
  antycheatowego i ściślejszego. „Clamp serwerowy" realizuje `MAX_REWIND_TICKS`.
- **Cap rewindu = 250 ms (`LAGCOMP_MAX_REWIND_MS`), NIE 200 ms ze spec.** Wynika wprost z modelu
  pełnego RTT: ping 150 ms + bufor 100 ms = 250 ms, więc 250 to MINIMUM, by gracz z pingiem 150 ms
  (granica kryterium fazy) nie był przycinany. Cap 200 ms ze spec. zakładał odrzucony model „ping/2".
- **Historia pozycji `PositionHistory` trzyma TYLKO pozycję** (`shared/combat/lag-comp.ts`). Sfera
  trafień jest izotropowa (promień `hitRadiusM`), więc orientacja nie zmienia testu segment↔sfera —
  zapis orientacji byłby martwy. Bufor pierścieniowy `tick % capacity` (zero alokacji per tick),
  klatka otwierana raz na tick (`beginTick`), encje dopisywane (`record`). `LAGCOMP_HISTORY_TICKS=20`
  (~333 ms) z zapasem nad capem (250 ms = 15 ticków), żeby potrzebna klatka nigdy nie była nadpisana —
  także tuż po zawinięciu u32 (porównujemy DOKŁADNĄ wartość ticku, okno < pojemność).
- **`rewindTicks` jest WŁASNOŚCIĄ POCISKU, ustaloną przy strzale i stałą przez całe życie.**
  Tor pocisku leci w teraźniejszości; cofamy tylko CEL przy hit-detekcji (`resolveHits`:
  `targetTick = tick − b.rewindTicks`, `history.sample` → fallback na pozycję bieżącą gdy poza oknem).
  Strzelec i lecące pociski NIE są cofane (pułapka spec.). Pole dodane do `Bullet` (`ballistics.ts`),
  domyślnie 0 → offline/serwer lokalny zachowuje się jak w fazie 5 bez zmian.
- **Pociski NIE jadą w snapshotach** (pułapka „eksplozja rozmiaru"). Serwer wysyła event MUZZLE
  (`ownerId, seed, shots`); klient renderuje WŁASNĄ kosmetyczną salwę smugaczy z pozy renderowanego
  strzelca i z `createRng(seed)` — ten sam strumień RNG i `applyDispersion` (2 liczby zawsze) co
  serwer, więc rozrzut wizualny zgadza się bez transmisji pocisków. Smugacze klienta mają damage=0,
  brak hit-detekcji — gasną po czasie życia.
- **Eventy walki są BINARNE (`MSG_EVENT`), nie JSON.** Strzał z kadencją to hot path (niezmiennik
  nr 6) — inaczej niż „rzadki event JSON" z fazy 8. Jedna ramka pakuje wiele zdarzeń z interwału
  snapshotu (count u8). Eventy są BROADCASTOWE (jeden bufor dla pokoju); klient filtruje po id
  (czy to ja strzelam / ja oberwałem / ja zabiłem). Ramki binarne snapshot vs event rozróżniane po
  pierwszym bajcie (`game-room.flushEvents`, klient `net-client.handleBinary`).
- **Hit marker dopiero po evencie HIT z serwera (uczciwość > responsywność).** Klient NIE robi
  żadnej hit-detekcji; marker/feed/HP są czystym echem autorytetu. HP w HUD z `healthFrac` snapshotu.
- **Protokół podbity do v2.** INPUT niesie `ackServerTick` zamiast `clientTimeMs` (faza 9 nie
  potrzebowała echa ticku; lag-comp potrzebuje). Snapshot encji +1 bajt HP (29→30 B/encję). Doszła
  binarna ramka EVENT. Niezgodność klient/serwer = czytelny błąd w handshake.

## Pułapki napotkane / domknięte

- **Kredyt zestrzelenia = wynik `applyDamage` 'destroyed' (tylko PIERWSZE przejście HP≤0).** Remis
  (dwaj giną ~w tym samym ticku) działa, bo pociski „już lecące" drugiego dobijają — `applyDamage`
  zwraca 'destroyed' raz, kredyt trafia do właściciela pocisku. Asysty: `damagedBy` (Set id) na
  ofierze, kredyt w `creditAssists` dla każdego napastnika poza zabójcą; czyszczone przy spawnie.
- **Śmierć od ziemi też daje asysty.** `onGroundDeath` (z `stepPilotedPlane` → 'crashed') woła
  `creditAssists(victim, null)` — kto wcześniej trafił, dostaje asystę mimo braku dobicia.
- **NaN jednego gracza nie kładzie pokoju** (niezmiennik nr 11): `step` łapie wyjątek per gracz,
  loguje zrzut i respawnuje winowajcę; pozostali grają dalej.
- **Test integracyjny ognia end-to-end** (`server/integration.test.ts`): pole `TestClient.events`
  było zbierane, ale nieasertowane — dołożony test „spust w INPUT → binarny MUZZLE u klienta"
  (ownerId=youId, shots>0) domyka jedyną nieprzetestowaną ścieżkę transportu i wykorzystuje to pole.

## Stan domknięcia

typecheck + 352 testy + lint zielone. Testy fazy 11: `shared/combat/lag-comp.test.ts`,
`server/combat.test.ts` (kadencja anty-grief, hit/HP/kredyt, remis, asysta, benchmark),
`shared/net/protocol.test.ts` (round-trip EVENT, HP w snapshocie), `server/integration.test.ts`
(ogień end-to-end). Benchmark 8 graczy ognia 10 s = **0,476 ms/tick** na dev (budżet 20% rdzenia
= 3,3 ms/tick), próg testu luźny (5 ms) na CI.

## Otwarte — DO WYKONANIA PRZEZ UŻYTKOWNIKA po deployu (wymaga 2 osób przez internet)

- Kryterium 2: sesja 2-osobowa, ping ~150 ms, subiektywna ocena „co widzę, to trafiam" → memory.
- Kryterium 5: pomiar CPU 8 graczy na docelowym VPS → memory.

UWAGA porządkowa: `memory/` nadal bez `project_phase8_decisions.md` i `project_phase10_decisions.md`
(decyzje tych faz tylko w auto-pamięci `faza8-*`/`faza10-*`). Do ewentualnego backfillu.
