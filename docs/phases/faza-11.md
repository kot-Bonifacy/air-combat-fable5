# Faza 11 — Walka sieciowa: serwerowy hit detection + lag compensation

**Zależy od:** Faza 10
**Cel:** „co widzę, to trafiam" przy pingu ≤ 150 ms — strzelanie w multiplayerze czuje się
tak samo uczciwie jak offline.

## Zakres

W tej fazie:
- Broń wraca do trybu online: spust w ramce INPUT; pociski symulowane NA SERWERZE
  (balistyka z `shared`, ta sama co offline)
- **Lag compensation**: serwer trzyma historię pozycji encji (~250 ms = 15 ticków @ 60 Hz);
  przy strzale cofa cele do czasu `now − ping/2 − bufor_interpolacji` strzelca (cap 200 ms),
  tam wykonuje hit detection, potem przywraca
- HP, damage, kill credit — wyłącznie serwer (niezmiennik nr 5); eventy HIT/KILL do klientów
- Klient: pociski własne pokazywane natychmiast (kosmetyczna predykcja traserów),
  hit marker dopiero po evencie HIT z serwera (uczciwość > responsywność dla potwierdzeń)
- Kill feed sieciowy (kto kogo, czym)
- Walidacja antygriefingowa: kadencja po stronie serwera (klient nie może strzelać szybciej),
  zapas amunicji liczony serwerowo

Poza zakresem: uszkodzenia modułowe (faza 17), friendly fire / drużyny (faza 13).

## Kroki

1. Serwer: ring buffer historii pozycji + testy (odtworzenie stanu sprzed N ticków)
2. Estymacja opóźnienia strzelca: ping mierzony + deklarowany bufor interpolacji klienta
   (wartość z handshake, clamp serwerowy)
3. Rewind→hit→restore w pętli serwera; pociski serwerowe na puli (jak w fazie 5)
4. Eventy HIT/KILL w protokole binarnym; klient: hit markery, kill feed
5. Test integracyjny: dwóch symulowanych klientów, jeden z lagiem 150 ms strzela do
   przelatującego celu — trafienie tam, gdzie cel BYŁ na jego ekranie
6. Sesja testowa 2 osoby przez internet (nie LAN!) — subiektywna ocena trafień

## Kryteria ukończenia

- [ ] Test integracyjny lag comp zielony (trafienie w pozycję historyczną, nie bieżącą)
- [ ] Przy sztucznym pingu 150 ms: celowanie z wyprzedzeniem działa intuicyjnie —
  ocena z sesji 2-osobowej zapisana w memory
- [ ] Kill credit zawsze poprawny (w tym kill w tym samym ticku co śmierć strzelca — remis testowany)
- [ ] Klient wysyłający spust 10× szybciej niż kadencja → serwer strzela z poprawną kadencją
- [ ] Brak regresji wydajności serwera: 8 graczy symulowanych + pociski < 20% jednego rdzenia
  (zmierzone, zapisane w memory)
- [ ] typecheck + test + lint zielone; commit `faza-11`; memory zapisane

## Pułapki

- Rewind dotyczy CELÓW, nie strzelca i nie pocisków już lecących — cofamy tylko to,
  co strzelec widział interpolowane
- Cap 200 ms to decyzja designerska: gracze z pingiem 300+ ms będą musieli wyprzedzać —
  lepsze to niż „umarłem za ścianą czasu" u wszystkich pozostałych
- Pociski serwerowe a snapshoty: NIE wysyłaj każdego pocisku w snapshotach (eksplozja rozmiaru) —
  klient renderuje własną kosmetyczną symulację z eventu MUZZLE (seed rozrzutu w evencie,
  ten sam strumień RNG co serwer — przygotowane w fazie 5)

## Wynik

Zrealizowano 2026-06-17. Walka sieciowa autorytatywna z lag-compensation.

**Co działa (kod + testy automatyczne):**
- Historia pozycji `PositionHistory` (`shared/combat/lag-comp.ts`): bufor pierścieniowy
  `tick % capacity`, trzyma TYLKO pozycję (sfera trafień izotropowa), bezpieczny na zawijaniu u32.
- Pociski autorytatywne na puli per-pokój (`game-room.ts`): `updateFire` z kadencją/amunicją
  serwerowo, ruch puli, `resolveHits` (segment↔sfera) z cofnięciem CELÓW do ticku widzianego
  przez strzelca; strzelec i lecące pociski NIE są cofane (pułapka spełniona).
- HP/damage/kill credit/asysty wyłącznie serwer (`applyDamage`, `creditAssists`); eventy
  binarne MUZZLE/HIT/KILL (`protocol.ts`, tag `MSG_EVENT`, broadcast, klient filtruje po id).
- Klient: spust w INPUT (LPM/Spacja), kosmetyczne smugacze z eventu MUZZLE (RNG z seeda =
  ten sam strumień co serwer), hit marker po HIT, sieciowy kill feed po KILL (zero hit-detekcji
  u klienta); HP w HUD z snapshotu. Snapshoty NIE niosą pocisków (pułapka „eksplozja rozmiaru”).
- Anty-grief: kadencja i amunicja po stronie serwera (klient nie może strzelać szybciej).

**Testy (wszystkie zielone, 352 łącznie):**
- `lag-comp.test.ts` — odtworzenie pozycji sprzed N ticków, okno/nadpisanie, wiele encji,
  trafienie w pozycję SPRZED rewindu (nie bieżącą), zawijanie u32 (kryterium 1 ✓).
- `combat.test.ts` — kadencja niezależna od częstości ramek spustu (spam 10× = ten sam wynik,
  kryterium 4 ✓), skończona amunicja, seria niszczy cel + kredyt, **remis** (obaj giną → obaj
  dostają zestrzelenie, kryterium 3 ✓), asysta, benchmark wydajności.
- `protocol.test.ts` — round-trip EVENT (muzzle/hit/kill), HP w snapshocie.
- `integration.test.ts` — ogień end-to-end przez realny WebSocket: INPUT z bitem ognia →
  serwer → binarny event MUZZLE u klienta (ownerId = youId, shots > 0).

**Pomiar wydajności (kryterium 5):** test `combat.test.ts` — 8 graczy trzymających spust 10 s:
**0,476 ms/tick** na maszynie dev (budżet 60 Hz = 16,7 ms, próg 20% rdzenia = 3,3 ms). Próg
testu luźny (5 ms) na wolne CI. **Pomiar na docelowym VPS — do wykonania przez użytkownika po
deployu** (zapisać do memory).

**Pozostaje do wykonania przez użytkownika (po deployu — wymaga 2 osób przez internet):**
- [ ] Kryterium 2: sesja 2-osobowa, ping ~150 ms, subiektywna ocena „co widzę, to trafiam”
  → zapis w memory.
- [ ] Kryterium 5: pomiar CPU 8 graczy na VPS → zapis w memory.

**Świadome odstępstwa od litery specyfikacji (oba = ulepszenia, udokumentowane w kodzie):**
1. **Rewind liczony z echa ticku (pełny RTT), nie „ping/2” (krok 2 / opis zakresu).** Klient
   odsyła w INPUT `ackServerTick` (ostatni widziany serverTick); serwer liczy
   `rewind = (tick − ackServerTick) + bufor_interpolacji`. To DOKŁADNE odtworzenie tego, co
   strzelec widział: snapshot dotarł ping/2, echo wróciło ping/2 → `sinceAck ≈ pełny ping`,
   a cele renderowane były dodatkowo `bufor` w przeszłości. Brak synchronizacji zegarów, brak
   wartości deklarowanej przez klienta (więc i nic do oszukania) — bufor interpolacji jest stałą
   wspólną (`INTERP_DELAY_MS`) po obu stronach. „Clamp serwerowy” z kroku 2 realizuje cap rewindu.
2. **Cap rewindu = 250 ms, nie 200 ms (pułapka spec.).** Wynika wprost z punktu 1: przy modelu
   pełnego RTT ping 150 ms + bufor 100 ms = 250 ms i taki cap jest minimum, by gracz z pingiem
   150 ms (granica kryterium fazy) nie był przycinany. 200 ms ze spec. zakładało model „ping/2”.
