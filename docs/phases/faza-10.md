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

## Wynik (2026-06-16)

Zrealizowane. Serwer przeszedł z pojedynczego globalnego pokoju na **rejestr wielu pokoi**
(`packages/server/src/lobby.ts`) + maszynę stanów per pokój w `GameRoom`
(`waiting`/`playing`/`ended`). Kluczowe decyzje i pułapki:

- **Protokół (shared/net):** osobny kanał tekstowy/JSON dla lobby (niezmiennik nr 6).
  Nowe wiadomości: `listRooms`/`createRoom`/`joinRoom`/`quickPlay`/`startMatch`/`leaveRoom`
  (klient→serwer) oraz `roomList`/`roomJoined`/`roomUpdate`/`matchStarted` (serwer→klient).
  `WelcomeMessage` straciło `playerId` (id jest per-pokój → `roomJoined.youId`) i zyskało
  `sessionToken`. `sanitizeNick` (whitelist `\p{L}\p{N} ._-`, max 16, fallback „Pilot" — XSS!),
  `isValidRoomCode` (alfabet bez O/0/I/1).
- **GameRoom:** krok fizyki tylko w `playing` (w `waiting` no-op, `tick` stoi). Pierwszy gracz
  = host; host migruje przy wyjściu/rozłączeniu (tylko do PODŁĄCZONEGO gracza). Late join w
  `playing` = `life='dead'` z wyzerowanym timerem → `RESPAWN_DELAY_S`(=3 s) i spawn (MVP, bez
  czekania na koniec meczu). Pokój zna członków przez interfejs `RoomMember` (przecina cykl
  importu z Connection) i sam koduje/rozsyła snapshoty per-gracz oraz wiadomości lobby.
- **Reconnect:** token sesji → mapa `token→kod` w Lobby. Po rozłączeniu slot trzymany
  (`detachMember`), `lobby.maintain` zwalnia po `RECONNECT_WINDOW_MS`(=60 s) i usuwa pusty
  pokój — **brak wycieku pokoi** (test: 100 cykli utwórz→rozłącz→wygaśnięcie → 0 pokoi).
  To UX, nie auth (pułapka: token ≠ bezpieczeństwo kont).
- **Klient:** **leniwe łączenie** — `NetClient` powstaje przy pierwszej akcji w lobby, więc
  hello niesie aktualny nick (zmiana nicka po połączeniu = reconnect). Token w localStorage,
  przy reloadzie próba reconnectu z fallbackiem do lobby po 1,5 s. Render/input/predykcja
  tylko w fazie `playing`; ekrany lobby to vanilla DOM nad canvasem (`net/lobby-ui.ts`),
  poczekalnia na tle `dogfight-splash.jpg`. Nicki innych graczy renderowane przez
  `textContent` (XSS). „Szybka gra" dołącza do otwartego pokoju (preferuje trwający mecz)
  albo tworzy nowy.

Wszystkie kryteria spełnione w kodzie i testach (maszyna stanów, reconnect, brak wycieku,
pełny/zły kod). `typecheck` + `test` (335) + `lint` + `build` zielone.

**Do zrobienia ręcznie przed deployem:** wrzucić plik tła `assets/dogfight-splash.jpg`
(grafika promo „Dogfight") — kod ładuje go z `/dogfight-splash.jpg`.
