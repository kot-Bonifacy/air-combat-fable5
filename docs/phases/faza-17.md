# Faza 17 — Parytet MP cz.4: kontrola strefy KotH (serwer + klient)

**Zależy od:** Fazy 13 (pętla meczu FFA, standings) i 14 (HUD online).
**Cel:** Wprowadzić główny cel gry — kontrolę strefy (King-of-the-Hill) — także do trybu online,
jako DODATKOWY warunek zwycięstwa obok limitu zestrzeleń i czasu (jak w SP). Strefę liczy
autorytatywnie serwer (niezmiennik nr 5); klient pokazuje pasek `ZoneBar` (parytet z SP) i czas
kontroli w tabeli wyników. Bez znacznika 3D (decyzja użytkownika: dokładny parytet z SP — szczyt
góry w centrum jest punktem orientacyjnym).

## Zakres

Serwer + klient; protokół = TYLKO addytywne pola JSON w `standings` (BEZ bumpu `PROTOCOL_VERSION` —
jak +scoreLimit/standings w fazie 13; binarne INPUT/SNAPSHOT/EVENT bez zmian, wciąż v3):
- **Serwer (`game-room.ts`)** — `ZoneControl` z `shared/world/zone` liczony co tick po ruchu i
  kolizjach (`updateZone`): okupanci = ŻYWI gracze, frakcja = `id` (FFA; faza 18 wprowadzi drużyny),
  pozycja x/z. Akumulacja czasu WYŁĄCZNEJ kontroli (sporna/pusta pauzuje, bez cofania). Przejęcie
  (`ZONE_CAPTURE_SECONDS = 180 s`) = natychmiastowe zwycięstwo frakcji — `checkMatchEnd` sprawdza
  strefę PRZED limitem zestrzeleń/czasu i kończy mecz z `reason 'zone'`. Reset w `start()`.
- **Protokół (`net/protocol.ts`)** — `MatchEndReason += 'zone'`; `StandingRow += zoneSeconds`
  (sekundy wyłącznej kontroli frakcji gracza); `StandingsMessage += zone: ZoneStatus`
  (`controlling`/`occupied` — bieżąca okupacja do statusu paska).
- **Klient (`online-main.ts`)** — `ZoneBar` (reużyty z SP): fronty z autorytatywnych
  `standings.rows.zoneSeconds` (własny vs najlepszy wróg), status (przejmujesz/wróg/sporna/wolna)
  z `standings.zone`. Ukryty na ekranie wyników i poza meczem.
- **Tabela wyników (`net/match-ui.ts`)** — kolumna „Strefa" (czas kontroli MM:SS) w scoreboardzie
  i na ekranie końca; baner powodu `'zone'` = „przejęto strefę kontroli".

Boty kontestują strefę BEZ zmian (`bot-manager.ts` ma już `PATROL_WAYPOINTS = [środek strefy]`
od fazy 12 — bot bez pilnego celu ciąży ku centrum).

Poza zakresem: tryb drużynowy (18; wtedy frakcja = drużyna, nie id), znacznik strefy w 3D.

## Kroki

1. `protocol.ts`: `MatchEndReason += 'zone'`, `StandingRow.zoneSeconds`, `ZoneStatus`,
   `StandingsMessage.zone`.
2. `game-room.ts`: pole `zone = new ZoneControl()` + bufor okupantów + `zoneControlling`/
   `zoneOccupied`; reset w `start()`; `updateZone(dtS)` w `step()` (po kolizjach); priorytet strefy
   w `checkMatchEnd()`; `zoneSeconds` w `buildStandings()`; `zone` w `broadcastStandings()`.
3. `online-main.ts`: instancja `ZoneBar`, ukrycie w `hideCombatOverlays`, `updateZoneBar()` w
   `updateHudOverlays`.
4. `match-ui.ts`: kolumna „Strefa" (header + wiersz + CSS grid 7 kolumn), tekst powodu `'zone'`.
5. Testy: `server/zone-control.test.ts` (+3).

## Kryteria ukończenia

- [x] Serwer liczy `ZoneControl` autorytatywnie co tick; wyłączna kontrola przez
  `ZONE_CAPTURE_SECONDS` kończy mecz z `reason 'zone'`, zwycięzca = frakcja okupanta
- [x] Strefa sporna (≥2 frakcje) / pusta pauzuje liczniki (KotH bez cofania), mecz trwa
- [x] `standings` niosą `zoneSeconds` per gracz + `zone` (controlling/occupied); BEZ bumpu protokołu
- [x] Klient pokazuje `ZoneBar` z autorytatywnych standings (parytet z SP); ukryty poza meczem i
  na ekranie wyników
- [x] Tabela wyników (Tab + ekran końca) ma kolumnę „Strefa"; baner końca rozróżnia powód `'zone'`
- [x] Boty kontestują strefę (waypoint patrolu już istnieje) — bez zmian w `bot-manager.ts`
- [x] `start()` (rewanż) zeruje liczniki i przejęcie strefy
- [x] typecheck + test (397, +3) + lint zielone; build (Vite + esbuild) przechodzi; commit
- [ ] **(użytkownik)** smoke online: utrzymać strefę solo z botami (kontestują), zobaczyć pasek
  rosnący/pauzujący, wygrać przez przejęcie (baner „przejęto strefę kontroli")

## Pułapki

- **FFA: frakcja = id gracza.** `ZoneOccupant.faction = player.id` — w gęstym FFA strefa jest
  prawie zawsze sporna (każdy to osobna frakcja), więc wygrana przez strefę wymaga chwili samotności
  w promieniu 3 km. To zgodne z SP (każdy bot = osobna frakcja). Faza 18 zmieni frakcję na drużynę.
- **Kolejność w `step`: `updateZone` PO kolizjach.** Świeży wrak (`'dying'` po zderzeniu w tym
  ticku) NIE może trzymać strefy — dlatego `updateZone` biegnie po `resolvePlaneCollisions`,
  a okupant liczy się tylko gdy `life === 'alive'`.
- **Priorytet strefy w `checkMatchEnd`.** `zone.captured` sprawdzane PRZED `evaluateFfa` — przejęcie
  ma pierwszeństwo nad jednoczesnym (skrajnie rzadkim) dobiciem limitu zestrzeleń.
- **Status paska perspektywa-niezależny.** `standings.zone.controlling` to frakcja (FFA: id); klient
  porównuje ze swoim `localId`. Fronty liczy z `zoneSeconds` wierszy (własny vs `max` wroga). Dzięki
  temu jeden broadcast standings (2 Hz) obsługuje wszystkich graczy bez wersji per-odbiorca.
- **Pasek = 2 Hz (standings), ale wygrana = 60 Hz.** Status/fronty paska odświeżają się z częstością
  standings (slow progress nad 180 s — bez znaczenia), ale rozstrzygnięcie meczu liczy się co tick
  na serwerze (autorytet). To celowe (PLAN: „stan strefy w JSON standings").
- **Bez bumpu protokołu.** Zmiana to addytywne pola JSON w `standings`/`matchEnded` — stary klient
  je ignoruje, handshake `v` zostaje 3. Deploy frontend+backend i tak razem (jak f15+f16).

## Wynik

**Zrealizowane (2026-06-19).** Kontrola strefy KotH działa online jako dodatkowy warunek zwycięstwa,
autorytatywnie po stronie serwera; bez bumpu protokołu (addytywne pola JSON, wciąż v3).

**`net/protocol.ts`:** `MatchEndReason` = `'score' | 'time' | 'zone'`; `StandingRow.zoneSeconds`
(sekundy wyłącznej kontroli frakcji = id w FFA); `ZoneStatus` (`controlling`/`occupied`);
`StandingsMessage.zone`.

**`server/game-room.ts`:** `ZoneControl` + bufor okupantów wielokrotnego użytku (zero alokacji);
`updateZone(dtS)` po ruchu/kolizjach (frakcja = `player.id`, tylko żywi); `checkMatchEnd` sprawdza
`zone.captured` PRZED limitem zestrzeleń/czasu → `endMatch(captured, 'zone')`; `buildStandings`
dokłada `zoneSeconds = round(zone.seconds(id))`; `broadcastStandings` dokłada `zone =
{controlling, occupied}`; `start()` woła `zone.reset()`.

**`client/online-main.ts`:** `ZoneBar` (własny DOM, jak w SP — `online.html` bez zmian); ukryty w
`hideCombatOverlays`; `updateZoneBar()` liczy stan (own/enemy/contested/neutral) z `standings.zone`
i fronty z `zoneSeconds` (własny vs najlepszy wróg); ukryty na ekranie wyników (`matchResultsShown`)
i poza meczem (`latestStandings` null).

**`client/net/match-ui.ts`:** kolumna „Strefa" (MM:SS) w scoreboardzie i na ekranie końca (CSS grid
6→7 kolumn); baner powodu `'zone'` = „przejęto strefę kontroli".

**Walidacja:** `npm run typecheck` + `npm test` (397, +3: przejęcie kończy mecz + rewanż resetuje,
sporna pauzuje, standings niosą sekundy/status — `server/zone-control.test.ts`) + `npm run lint`
zielone; `npm run build` przechodzi (klient online 40,2 → 40,7 kB; serwer 563,5 → 567,3 kB).

**Otwarte (użytkownik):** smoke online po deployu — utrzymać strefę solo z botami (kontestują),
obserwować pasek rosnący/pauzujący/sporny, wygrać przez przejęcie (baner „przejęto strefę kontroli").
Następna: Faza 18 — tryb drużynowy (opcja pokoju; frakcja = drużyna, friendly fire wg drużyn,
scoreboard drużynowy).
