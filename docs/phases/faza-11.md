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

## Wynik (uzupełnić po zakończeniu)

—
