# Faza 10 — Lobby i pokoje

**Zależy od:** Faza 9
**Cel:** dwie osoby z dwóch komputerów spotykają się w jednym meczu bez pomocy programisty.

## Zakres

W tej fazie:
- Ekran wejściowy: nick (sanityzowany, max 16 znaków) zapamiętany w localStorage
- Pokoje na serwerze: utwórz pokój (kod 4-literowy) / dołącz kodem / lista otwartych pokoi
  z liczbą graczy; max 8 graczy/pokój; pokój sprząta się po wyjściu ostatniego gracza
- Stany pokoju: `waiting` (poczekalnia z listą graczy, host ma przycisk Start) → `playing` → `ended`
- Komunikaty lobby JSON-owe (to nie hot path) — osobny typ ramki obok binarnych
- Late join: dołączenie do `playing` = spawn po 3 s (MVP — bez czekania na koniec meczu)
- Rozłączenie w trakcie: samolot znika z eventem, slot się zwalnia; prosty reconnect
  (ten sam nick + token sesji w localStorage, okno 60 s)
- UI: vanilla DOM nad canvasem (decyzja z PLAN.md — Preact tylko jeśli vanilla zacznie boleć)

Poza zakresem: matchmaking automatyczny, konta, czat (backlog), boty w pokojach (faza 12).

## Kroki

1. Serwer: `lobby.ts` (rejestr pokoi, kody, limity), rozszerzenie handshake o nick+token
2. Maszyna stanów pokoju + testy przejść (join/leave/start/end/reconnect we wszystkich stanach)
3. Klient: ekrany lobby (wejście → lista/kod → poczekalnia → gra), obsługa błędów
   (pokój pełny, kod nie istnieje, nick zajęty w pokoju)
4. Reconnect: token sesji, ponowne podpięcie do encji
5. Test ręczny z dwóch komputerów w LAN (lub komputer + telefon)

## Kryteria ukończenia

- [ ] Dwie osoby (2 urządzenia) tworzą i dołączają do pokoju kodem, host startuje mecz, obie latają
- [ ] Pokój pełny / zły kod / duplikat nicka → czytelne komunikaty
- [ ] F5 w trakcie meczu → powrót do własnego samolotu w < 10 s (reconnect)
- [ ] Wyjście wszystkich → pokój znika z listy (brak wycieku pokoi po 100 cyklach w teście)
- [ ] Testy maszyny stanów zielone
- [ ] typecheck + test + lint zielone; commit `faza-10`; memory zapisane

## Pułapki

- Sanityzacja nicka: whitelist znaków (litery/cyfry/podstawowe znaki), żadnego HTML —
  nick trafi do DOM innych graczy (XSS!)
- Token reconnect ≠ bezpieczeństwo kont — to tylko ułatwienie UX; nie udawać, że to auth
- Kod pokoju: alfabet bez O/0, I/1 (dyktowanie przez Discord)
- Stan `playing` nie może blokować pętli fizyki na operacje lobby (osobne ścieżki przetwarzania)

## Wynik (uzupełnić po zakończeniu)

—
