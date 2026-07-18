# Projekt refaktoringu — air-combat-fable5

**Data utworzenia:** 2026-07-15 · **Stan gry:** fizyka v2 domknięta (R0–R5), protokół v10, ~780 testów zielonych
**Tryb pracy:** jeden etap = jedna sesja (vibecoding, wykonawca: Claude). Decyzje niejednoznaczne → AskUserQuestion.

## 1. Cel

Refaktoring **bez rozwoju funkcjonalności**: kod ma po nim (a) zachowywać się tak samo (wyjątki jawnie
opisane), (b) być podzielony na moduły o czytelnych granicach, (c) wyglądać spójnie (nazewnictwo,
komentarze, konwencje), (d) mieć **otwarte szwy** pod późniejszy rozwój: nowe mapy, nowe samoloty,
lądowanie na lotniskach, loadouty/uzbrojenie podwieszane (decyzja usera 2026-07-15: przygotować OBA
szwy — lądowanie i loadouty). Po drodze naprawiamy dwa zgłoszone błędy (duch gracza, komunikat
u obserwowanego) i utwardzamy bezpieczeństwo sieciowe.

**Rygor (decyzja usera 2026-07-15):** bumpy protokołu dozwolone (deploy front+back RAZEM), drobne
świadome zmiany zachowania dozwolone — ale każda **jawnie opisana w sekcji „Wynik" etapu** i wypisana
userowi do playtestu. Domyślnie każdy etap jest zachowawczy.

## 2. Stan zastany (diagnoza 2026-07-15)

Metryki (produkcyjne `.ts`, bez testów): **~23,5 tys. linii**, 83 pliki testów (~780 testów), brak CI
(wszystko lokalnie). Największe pliki — to one są przedmiotem rozbioru:

| Plik | Linie | Problem |
| --- | --- | --- |
| `client/src/online-main.ts` | 2724 | god-file klienta: pętla gry, maszyna faz, sieć+reconnect, stan śmierci/obserwatora, kamery, efekty wraków, HUD-wiring, sonda E2E |
| `server/src/game-room.ts` | 2329 | god-file serwera: maszyna stanów pokoju, rejestr graczy/slotów, spawn, walka (hity+lag-comp), systemy (pożar/przegrzanie/flutter/klapy), snapshoty, boty-glue |
| `shared/src/net/protocol.ts` | 1188 | wszystkie domeny wiadomości w jednym pliku |
| `client/src/net/lobby-ui.ts` | 1021 | całe UI poczekalni: roster, sloty RTS, ustawienia, czat, karty |
| `shared/src/planes/loader.ts` | 939 | walidacja ręczna pole-po-polu; dodanie samolotu = edycje w kilku miejscach |
| `client/src/plane-mesh.ts` | 822 | rejestr meshy + materiały + char/restore wraków |
| `shared/src/ai/bot.ts` | 728 | FSM + percepcja + zachowania asa w jednym |

Co jest **dobre i zostaje**: podział na workspace'y shared/client/server, fizyka w `shared`
sterowana JSON-ami (niezmiennik nr 3), golden testy fizyki (v2), binarny protokół z rezerwami bitów,
kultura „testy przed commitem". Fizyka lotu jest **poza zakresem** refaktoringu (świeżo skalibrowana
— czerwona linia, patrz §5).

## 3. Znane błędy do naprawy (zakres refaktoringu)

### 3.1 Duch gracza (etap RF1)

**Objaw (user):** po odświeżeniu strony (F5) w poczekalni/grze pojawia się drugi identyczny gracz;
przy starcie meczu dostaje samolot, którym nikt nie steruje (leci na auto-stabilizacji).

**Zidentyfikowana przyczyna-wzmacniacz (pewna, z kodu):** `server/src/lobby.ts` `maintain()` woła
`pruneExpiredReconnects` **tylko gdy `room.connectedCount === 0`**. W pokoju, w którym ktokolwiek
siedzi, slot rozłączonego gracza (`member === null`) **nigdy nie wygasa** — zamiast obiecanych 60 s
(`RECONNECT_WINDOW_MS`) wisi wiecznie: widnieje w poczekalni, przy starcie dostaje samolot
(pilotless → autopilot z 2026-06-25), zbiera sloty.

**Przyczyna-zalążek (do potwierdzenia repro):** czemu F5 nie wznawia sesji tokenem, tylko tworzy
NOWEGO gracza. Kandydaci: (a) świeże wejście po F5 ma `attemptingResume=false`, więc `onWelcome`
**nadpisuje zapisany token świeżym** zanim dojdzie do wznowienia (zatrucie tokenu — analogiczne do
buga naprawionego 2026-06-26, ale w ścieżce przeładowania strony); (b) wyścig hello↔close starego
socketa; (c) resume działa tylko z fazy 'playing'. Etap RF1 zaczyna się od deterministycznej
reprodukcji (dwa konteksty przeglądarki, wspólny localStorage).

### 3.2 Komunikat u obserwowanego gracza (etap RF2)

**Objaw (user):** graczowi obserwowanemu przez innego (tryb obserwatora) pojawia się komunikat
w rodzaju „…‹nick› kontroluje kursor w trybie obserwatora". **Taki tekst NIE istnieje w kodzie gry**
(zweryfikowane grep-em 2026-07-15). User nie pamięta dokładnej postaci/miejsca.

**Aktualizacja 2026-07-18 (nowe zgłoszenie usera → hipoteza nr 1 praktycznie potwierdzona):** znajomy
usera zrelacjonował komunikat „**‹tatang/tatangas› przejął kontrolę nad twoim samolotem**". Ponowny grep
całego kodu: takiego napisu NADAL nie ma, a input steruje wyłącznie własną encją (jedyne „przejęcie" to
`reconnectByToken` = odzyskanie WŁASNEGO slotu tokenem-sekretem z localStorage; rozłączony leci autopilotem).
Kluczowe: „**tatanga**" = domena `dogfight.tatanga.eu`, którą przeglądarka wpisuje w dymek pointer-locka —
NIE nick gracza. „kontroluje kursor" → sparafrazowane jako „przejął samolot" (myszą się lata). To domyka
diagnozę na rzecz hipotezy nr 1.

**Hipotezy (kolejność prawdopodobieństwa):**
1. **Natywny dymek przeglądarki o pointer locku** („dogfight.tatanga.eu kontroluje teraz kursor" —
   Chrome pokazuje go przy KAŻDYM ponownym przejęciu kursora). Od commitu `cc0c887` lock trwa cały
   lot i jest wznawiany po Esc/menu/utracie fokusu → dymek może wyskakiwać w trakcie walki i zbiegać
   się czasowo z byciem obserwowanym (korelacja pozorna). „Nick" w relacji = adres strony. **← zgłoszenie
   2026-07-18 z dosłownym „tatanga" mocno to potwierdza.**
2. Alert gry `OBSERWUJESZ: ‹nick›` renderowany na złym kliencie — wymagałby `playerDeath==='spectating'`
   u żywego gracza (podejrzane ścieżki: respawn/reconnect nie zeruje stanu obserwatora).
3. Efekt uboczny ducha z §3.1 (dwa byty o tym samym nicku mieszają stany).

Etap RF2: reprodukcja dwoma klientami E2E (jeden ginie i obserwuje drugiego; scenariusze z Esc,
utratą fokusu, respawnem), nazwanie przyczyny, naprawa, test regresyjny.

## 4. Architektura docelowa (mapa modułów)

Zasada: **żaden plik produkcyjny > 800 linii**; moduł = jedna odpowiedzialność; granice warstw
egzekwowane lintem (RF11), nie tylko konwencją. Docelowo:

```
packages/shared/src/
  net/protocol/          # RF7: domeny (handshake, lobby, input, snapshot, events) + rejestr tagów
  planes/                # RF8: registry.ts (manifest: JSON + assety + atrybucja), loader tabelaryczny
  world/maps/            # RF8: kanal.json — obecna mapa jako DANE (seed, morze, spawn ring, strefa, AA, waypointy)
  (aero/physics/combat/ai/instructor/math/testing — bez zmian koncepcyjnych)

packages/client/src/
  session/               # RF3: maszyna faz (lobby/waiting/playing/results), handlery sieci, reconnect, token
  game/                  # RF4: pętla renderu, kamery (chase/orbit), efekty świata (wraki/eksplozje/dym), encje zdalne
  ui/                    # RF2+RF9: alerty/overlaye (jeden menedżer warstw), HUD, lobby (podzielone), onboarding
  audio/  net/           # bez zmian miejsca (prediction/interpolation/net-client zostają w net/)
  online-main.ts         # kompozycja: bootstrap + spięcie modułów (cel: < 500 linii)

packages/server/src/
  room/                  # RF6: maszyna stanów pokoju, rejestr graczy/slotów/tokenów, spawn, frakcje, roster
  combat/                # RF5: resolveHits + lag-comp, systemy per-tick (pożar, przegrzanie, flutter, klapy, AA)
  connection.ts lobby.ts server.ts  # cieńsze po wyprowadzce logiki
```

Technika przenoszenia (obowiązuje we wszystkich etapach): **move-and-delegate** — funkcje przenoszone
bez zmiany treści, stare miejsce deleguje/re-eksportuje w ramach etapu, importy domykane w tym samym
etapie (bez wiecznych shimów). Stan modułowy (`let` w online-main) przechodzi do jawnych obiektów
stanu przekazywanych parametrem — to główne ryzyko, stąd podział klienta na dwa etapy.

## 5. Czerwone linie (obowiązują w KAŻDYM etapie)

1. **Golden testy fizyki nie zmieniają ani jednej liczby.** Fizyka v2 jest skalibrowana i domknięta;
   refaktoring nie dotyka `shared/physics`, `shared/aero`, JSON-ów samolotów (poza przeniesieniem
   pól do manifestu w RF8 — wartości bit-w-bit te same).
2. **Format wire zmieniamy tylko świadomie** (bump wersji + deploy front+back razem + wpis w CLAUDE.md).
   Reorganizacja `protocol.ts` w RF7 celuje w **zero zmian bajtów** — bump tylko, jeśli konsolidacja
   naprawdę tego wymaga.
3. **Serwer pozostaje autorytetem** (niezmiennik 5); reconcile/predykcji nie „ulepszamy" przy okazji.
4. **Żadnych nowych zależności produkcyjnych** bez pytania usera (walidacja/schematy: własna,
   tabelaryczna — nie zod/io-ts).
5. **Asset/licencje:** przenosiny plików nie mogą zgubić wpisów `assets/LICENSES.md` (niezmiennik 8).

## 6. Definicja ukończenia etapu (DoD — każda sesja)

1. `npm run check` zielony (skrypt z RF0: typecheck + test + lint + build).
2. Gdy etap dotyka klienta w runtime: **smoke E2E** (dev-serwer + przeglądarka: lobby → mecz z botem →
   śmierć → obserwator → wyniki → poczekalnia; sonda `__acDebug` tam, gdzie trzeba liczb).
3. Liczba testów **nie maleje**; nowe granice modułów mają testy charakteryzacyjne PRZED przeniesieniem.
4. Sekcja „Wynik RFn" w tym dokumencie wypełniona: co przeniesiono, **lista zmian zachowania**
   (może być „brak"), pułapki, metryki (linie plików przed/po).
5. Wpis w `memory/` + linia w statusie CLAUDE.md + commit (jeden etap = jeden commit, opis po polsku).
6. Etap wymagający deployu ma to wypisane WIELKIMI literami w „Wyniku" (front+back RAZEM czy nie).

## 7. Etapy (jeden na sesję)

Kolejność: najpierw siatka bezpieczeństwa (RF0), potem błędy widoczne dla graczy (RF1–RF2, przy
okazji pierwsze wydzielenia), potem rozbiór monolitów od najgroźniejszego (klient RF3–RF4, serwer
RF5–RF6), następnie warstwy danych (RF7–RF8) — one otwierają szwy przyszłości, na końcu UI, audyt
bezpieczeństwa i domknięcie spójności. Kolejne etapy zakładają ukończenie poprzednich, ale każdy
zostawia repo w stanie zdatnym do gry i deployu.

---

### RF0 — Fundament: siatka bezpieczeństwa i baseline (bez zmian produkcyjnych)

**Cel:** zanim cokolwiek ruszymy, mieć twardy grunt: mierzalny stan wyjściowy + testy przyszpilające
zachowania, które będą przenoszone najwcześniej.

**Zakres:**
- Skrypt `npm run check` = typecheck + test + lint + build (jedno polecenie na DoD).
- **Testy charakteryzacyjne cyklu życia sesji** (poziom `Lobby`+`GameRoom`+`connection` z fake
  `RoomMember`, bez prawdziwych socketów): join → detach → okno reconnectu; resume tokenem z fazy
  waiting/playing/ended; wejście nowym połączeniem gdy stary slot wisi; duplikat nicku. To baza pod
  RF1 — utrwalamy CO ROBI kod dziś (łącznie z bugiem — test z komentarzem `// BUG RF1:`).
- Baseline metryk do tego dokumentu (linie największych plików, liczba testów, czas `npm run check`).
- Przegląd i aktualizacja mapy docelowej §4 po głębszym czytaniu kodu (poprawki mile widziane —
  to dokument roboczy).
- Inwentarz martwych eksportów `shared` (raport, NIE usuwanie — decyzje w RF11).

**Kryteria:** zero zmian produkcyjnych; nowe testy zielone; baseline wpisany. **Deploy:** brak.

### RF1 — Duch gracza: cykl życia slotów graczy

**Cel:** duch znika — slot rozłączonego gracza żyje dokładnie `RECONNECT_WINDOW_MS`, F5 wraca do
WŁASNEGO samolotu, a rozłączony gracz jest w poczekalni uczciwie oznaczony.

**Zakres:**
- Reprodukcja E2E (dwa konteksty przeglądarki, wspólny localStorage; F5 = zamknięcie i ponowne
  otwarcie strony) — potwierdzenie ścieżki zalążka z §3.1.
- **Fix wzmacniacza:** `lobby.maintain` sprząta wygasłe sloty ZAWSZE (nie tylko przy pustym pokoju).
  Uwaga na skutki w trakcie meczu: `removePlayer` żywej encji → sprawdzić spójność snapshotów,
  standings, eliminacji i hostId (testy!).
- **Fix zalążka** wg wyniku repro (najpewniej: ścieżka welcome po F5 nie może nadpisywać tokenu,
  dopóki serwer nie odpowiedział na próbę wznowienia; resume-first przy świeżym połączeniu z tokenem).
- **Zmiana zachowania (jawna):** gracz w oknie reconnectu widoczny w poczekalni/rosterze jako
  „‹nick› (rozłączony)" zamiast udawania obecnego.
- Testy: prune w zajętym pokoju (waiting i playing), F5-resume, zombie-close po przejęciu slotu
  (regresja fixu 2026-06-26), duch nie dostaje samolotu na starcie meczu.

**Ryzyka:** prune w 'playing' usuwa encję w locie — przejść po wszystkich konsumentach `players`.
**Deploy:** backend + front (roster) RAZEM. Playtest usera po etapie: scenariusz F5.

### RF2 — Komunikat u obserwowanego + menedżer alertów/overlayów

**Cel:** przyczyna komunikatu nazwana i usunięta; przy okazji pierwsza wydzielina z online-main:
jedna warstwa zarządzająca alertami/nakładkami zamiast drabinki if-ów.

**Zakres:**
- Reprodukcja E2E z dwoma klientami (A żyje, B ginie i obserwuje A): scenariusze Esc/menu, utrata
  i powrót fokusu, respawn B, reconnect A. Sprawdzenie hipotez z §3.2 po kolei.
- Naprawa wg wyniku: (1) dymek przeglądarki → ograniczyć liczbę ponownych `requestPointerLock`
  (lock tylko przy realnej utracie, nie „na zapas") i/lub wpis w onboardingu; (2) alert gry →
  naprawić maszynę `playerDeath` (reset przy respawn/reconnect) + test.
- **Wydzielenie `client/src/ui/alerts.ts`:** priorytetyzowany alert pełnoekranowy (obserwator > wrak >
  śmierć > granica mapy > przegrzanie/Vne) — dziś rozsiane po pętli renderu; overlaye (downed, results,
  conn, pause) rejestrowane w jednym miejscu z jawnym porządkiem. Czysta zmiana strukturalna.

**Kryteria:** repro udokumentowana w „Wyniku" (nawet jeśli winna przeglądarka), test regresyjny,
alerty przechodzą przez jeden moduł. **Deploy:** front (backend tylko jeśli repro wskaże serwer).

### RF3 — Klient cz. 1: stan sesji i sieci (`client/src/session/`)

**Cel:** z `online-main.ts` wychodzi wszystko, co NIE jest pętlą renderu: maszyna faz, handlery
wiadomości, reconnect-watchdog, tokeny, wejście/wyjście z meczu.

**Zakres:**
- Nowe moduły: `session/phase.ts` (maszyna lobby/waiting/playing + przejścia enterWaiting/
  enterPlaying/…), `session/net-handlers.ts` (onWelcome/onRoomJoined/onRoomUpdate/onMatchStarted/
  onMatchEnded/onKill/…), `session/reconnect.ts` (watchdog + token store), `session/state.ts`
  (jawny obiekt stanu zamiast ~30 modułowych `let`).
- online-main deleguje; zachowania bez zmian. Bramki przeciw wyrzuceniu z tabeli wyników
  (2026-06-28) i guardy reconnectu przenoszą się Z komentarzami — to pole minowe, przenosić 1:1.
- Testy charakteryzacyjne przejść fazowych PRZED przeniesieniem (czysta logika — da się bez DOM).

**Kryteria:** online-main lżejszy o ≥800 linii; pełny smoke E2E (w tym: F5 w meczu → powrót, koniec
meczu → tabela → poczekalnia). **Deploy:** front-only.

### RF4 — Klient cz. 2: pętla gry, kamery, efekty świata (`client/src/game/`)

**Cel:** online-main = kompozycja (<500 linii). Pętla renderu rozbita na fazy o jasnych zależnościach.

**Zakres:**
- `game/render-loop.ts` (kolejność krokow jawna: input → predykcja → interpolacja → kamery → HUD →
  efekty), `game/cameras.ts` (chase/orbit + pointer-lock polityka z RF2), `game/remote-entities.ts`
  (meshe, interpolator-glue, głosy audio per encja, cleanup), `game/wrecks.ts` (burning/sinking/char
  + woda/ląd), `game/effects.ts` (eksplozje, tracery, muzzle).
- Sonda `__acDebug` zostaje, przypięta do nowych modułów (E2E nie może osłabnąć).

**Kryteria:** zero zmian zachowania; smoke E2E + porównanie fps (RTX, scena 8 samolotów) bez regresu;
online-main <500 linii. **Deploy:** front-only.

### RF5 — Serwer cz. 1: walka i systemy per-tick (`server/src/combat/`)

**Cel:** z `game-room.ts` wychodzą: hit detection + lag-comp, systemy stanu (pożar, przegrzanie,
flutter, urwanie klap), AA.

**Zakres:**
- `combat/hits.ts` (resolveHits, broad/narrow-phase, lag-comp rewind), `combat/systems.ts` lub
  osobne pliki per system (`stepFireDamage`, `stepOverheatDamage`, `stepFlutterDamage`,
  `stepFlapRipDamage` — jednolity interfejs „system(dt, player)"), `combat/aa.ts` (stanowiska flak).
- Kill credit / KillCause przechodzą przez jeden moduł (dziś rozsiane) — bez zmiany semantyki.
- Testy integracyjne serwera (combat/overheat/flutter/flaps-rip/zone-damage) muszą przejść
  **bez zmiany asercji** — to jest miara „bez zmian zachowania".

**Kryteria:** game-room.ts −~800 linii; testy bez modyfikacji. **Deploy:** backend-only (bez zmiany wire).

### RF6 — Serwer cz. 2: maszyna pokoju i rejestr graczy (`server/src/room/`)

**Cel:** `game-room.ts` zostaje koordynatorem; stany pokoju i rejestr graczy w osobnych modułach.

**Zakres:**
- `room/match-state.ts` (waiting/playing/pendingEnd/ended + warunki końca, zwłoki, wraki-przed-końcem),
  `room/players.ts` (rejestr: sloty, tokeny, reconnect — spójne z RF1, frakcje/WYSIWYG, gotowość,
  sloty botów hosta), `room/spawn.ts` (ring, assignStartSlots, ochrona 3 s), `room/roster.ts`
  (`roomPlayers()` + broadcasty).
- Boty: glue `BotManager` zostaje; NIE ruszamy `shared/ai` (zachowania asów świeżo strojone).

**Kryteria:** game-room.ts <~700 linii; wszystkie testy pokojowe/meczowe bez zmiany asercji.
**Deploy:** backend-only.

### RF7 — Protokół: domeny, rejestr wiadomości, odporność dekoderów

**Cel:** `protocol.ts` podzielony per domena; dekodery odporne na śmieci; struktura gotowa na
addytywne rozszerzenia (mapy/loadouty) bez kolejnych „+1 bajt w trzech miejscach".

**Zakres:**
- Podział: `net/protocol/handshake.ts` (JSON + wersja), `lobby.ts` (wiadomości sterujące),
  `input.ts`, `snapshot.ts`, `events.ts`, wspólny `registry.ts` (tagi, rozmiary, wersja).
  **Cel: identyczne bajty na wire** (testy porównują pack() starego i nowego kodu na korpusie
  przykładów ZANIM stary zniknie).
- **Testy round-trip** (generator losowych stanów → pack → unpack → deepEqual) dla każdej wiadomości.
- **Fuzz dekoderów:** losowe/obcięte bufory NIE mogą crashować procesu — oczekiwany `NetError`
  (to też element bezpieczeństwa: pakiet z sieci = wejście niezaufane, niezmiennik 11).
- Projekt (sam szkielet, bez funkcji): `matchConfig` w handshake'u startu meczu — miejsce na
  `mapId`, przyszłe pola loadoutu. Jeśli da się addytywnie w JSON startu — BEZ bumpu.

**Kryteria:** bajty wire niezmienione (lub bump v11 z uzasadnieniem); fuzz zielony. **Deploy:**
bez bumpu — dowolny; z bumpem — front+back RAZEM.

### RF8 — Dane jako sterownik: rejestr samolotów + mapa jako dane

**Cel:** otwarcie głównych szwów przyszłości — dodanie samolotu/mapy ma być zmianą danych, nie kodu.

**Zakres:**
- **Rejestr samolotów:** manifest per samolot (JSON parametrów + ścieżki modelu/audio + atrybucja +
  kod wire). `PLANE_TYPES` i kody wire pozostają **append-only** (test pilnujący, jak dziś KILL_CAUSES).
  Loader: walidacja tabelaryczna (deklaracja pól+zakresów zamiast 900 linii if-ów) — komunikaty
  błędów nie gorsze niż obecne. Rozproszone `Record<PlaneType,…>` w kliencie (MODEL_SPECS,
  SFX_FILES, ENGINE_GAIN_MUL, pitch broni…) schodzą się do manifestu.
- **Mapa jako dane:** `shared/src/world/maps/kanal.json` — seed terenu, rozmiar areny, poziom morza,
  spawn ring, strefa KotH, stanowiska AA, waypointy patrolu botów. Klient i serwer czytają ten sam
  plik (jak JSON-y samolotów). `matchConfig.mapId` (szkielet z RF7) niesie wybór — dziś zawsze
  `kanal`, selektor map NIE powstaje (to rozwój, nie refaktoring).
- **Przepis w docs:** „jak dodać samolot / jak dodać mapę" — lista plików do dotknięcia (cel: ≤3).
- Szwy przyszłości dokumentowane, NIE implementowane: lądowanie (kontakt z ziemią dziś = śmierć
  w `handleSurfaceImpact`/serwerowym odpowiedniku → zostawić jeden punkt decyzji „co znaczy dotknąć
  ziemi"; bajt flag INPUT ma jeszcze ~4 wolne bity — kandydat na podwozie), loadouty (grupy broni
  już są per-JSON; loadout = wariant uzbrojenia w manifeście + pole wyboru w lobby + bajt w spawn).

**Kryteria:** golden testy fizyki bit-w-bit bez zmian; zachowanie identyczne (te same wartości,
inne miejsce); przepisy w docs. **Deploy:** front+back RAZEM (wspólne dane), wire bez zmian.

### RF9 — UI klienta: lobby i HUD w spójnym systemie

**Cel:** `lobby-ui.ts` (1021 linii) i warstwa HUD podzielone; jeden sposób budowania DOM i overlayów.

**Zakres:**
- Lobby: `ui/lobby/` — roster+sloty RTS, ustawienia pokoju, czat, karty samolotów, atrybucje;
  wspólne helpery DOM (tworzenie elementów, przycinanie nicków, escHtml — dziś powielane).
- HUD: `hud.ts` + `damage-hud.ts` + zone-bar + roster-overlay pod wspólną konwencją (update(data),
  bez sięgania do stanu globalnego); style w index.html pogrupowane per moduł (komentarze-sekcje).
- Nakładki z RF2 (alerts) obejmują całość: pause-menu, downed, results, onboarding, conn-banner.

**Kryteria:** wygląd bez zmian (screenshot-diff ręczny w E2E; drobne poprawki spójności dozwolone,
wypisane); smoke lobby (sloty botów, gotowość, czat, karty). **Deploy:** front-only.

### RF10 — Audyt bezpieczeństwa sieciowego

**Cel:** systematyczne przejście niezmiennika 11 po refaktoringu + utwardzenie. (Częściowo zrobi to
RF7 fuzzem dekoderów — tu domykamy resztę.)

**Zakres — checklista:**
- [ ] Każda wiadomość JSON i binarna: walidacja zakresów, rozmiaru, typu — test per wiadomość.
- [ ] Rate limiting: input flood (więcej niż 60 Hz + margines), czat (już jest sanitizeChat — dołożyć
      limit częstości), join/create spam, wznowienia tokenem (brute-force tokenów: UUID → OK, ale
      limit prób per połączenie).
- [ ] Limity zasobów: maks. pokoi, maks. rozmiar pakietu WS (`ws` maxPayload), maks. długość nicku/
      czatu (jest? potwierdzić testem), timeout martwych socketów (ping/pong).
- [ ] Tokeny sesji: nigdy w logach, nigdy w broadcastach (tylko do właściciela) — test.
- [ ] Przegląd `deploy/` (nginx: nagłówki bezpieczeństwa, limity body, wss-only — niezmiennik 10).
- [ ] `npm audit` zależności produkcyjnych + decyzje.
- Fixy w tej samej sesji; co za duże → jawnie do backlogu z oceną ryzyka.

**Kryteria:** checklista odhaczona w „Wyniku", testy nowych limitów zielone. **Deploy:** backend
(+nginx na VPS — instrukcja dla usera).

### RF11 — Spójność i domknięcie

**Cel:** kod „wygląda spójnie" i granice są egzekwowane maszynowo, nie pamięcią.

**Zakres:**
- ESLint: reguły granic (zakaz importów client↔server, zakaz Node API i DOM w shared — dziś
  konwencja, ma być błąd lintu; zakaz cykli importów), `no-restricted-imports` per warstwa.
- Nazewnictwo i komentarze: audyt spójności (PL w komentarzach, konwencja WHY-only, kebab-case
  plików — wyłapać odstępstwa), jednolite nagłówki modułów (1–3 zdania „czym jest ten plik").
- Martwy kod: decyzje nad raportem z RF0 (eksporty shared bez użyć produkcyjnych — usunąć albo
  skomentować „używane przez testy X świadomie").
- Raport końcowy: tabela metryk przed/po (linie, liczba plików >800 linii = 0, liczba testów,
  czas checku), aktualizacja CLAUDE.md (mapa katalogów, status) i `docs/`.

**Kryteria:** `npm run check` zielony z nowymi regułami; raport w „Wyniku". **Deploy:** brak
(chyba że zaległe z poprzednich etapów).

---

## 8. Obserwacje poboczne (backlog — NIE rozszerzać etapów po cichu)

Zauważone przy rozpoznaniu 2026-07-15; do decyzji usera osobno:
- Paliwo obcych samolotów jest w snapshocie (v7), ale klient go nie używa (silnik obcego gra do
  śmierci) — znana luka, wpięcie do interpolatora to osobny temat.
- Audio silnika gra mimo poziomu uszkodzenia 3 (silnik stop) — pre-existing z fazy przegrzewania.
- `favicon.ico` 404 (kosmetyka, jedna linia w index.html + plik).
- Boty w Zero latają w „betonowym" reżimie prędkości (obserwacja z 2026-07-09; częściowo zaadresowane
  knobem asa `rollAuthorityMinFrac` — niższe poziomy nadal nie).

## 9. Ryzyka globalne

| Ryzyko | Mitygacja |
| --- | --- |
| Rozbiór online-main psuje pointer lock / fokus / kolejność DOM (najbardziej kruche miejsce projektu) | dwa osobne etapy (RF3/RF4), smoke E2E po każdym, przenoszenie komentarzy-pułapek 1:1 |
| „Przy okazji" zmieniona semantyka reconcile/predykcji | czerwona linia §5.3; testy prediction.test.ts jako charakteryzacja |
| Rozjazd wersji klient↔serwer na produkcji w trakcie serii etapów | deploy zawsze front+back razem; etapy oznaczają wymóg deployu w „Wyniku"; produkcję można aktualizować rzadziej (repo zawsze spójne) |
| Vibecoding bez drugiej pary oczu | DoD §6 (check+E2E), AskUserQuestion przy decyzjach, playtesty usera po RF1/RF2/RF4/RF9 |
| Etap nie mieści się w sesji | zasada z faz: zamknąć co działa (kompilowalne, testy zielone), resztę jawnie przenieść na kontynuację — NIGDY nie zostawiać repo w stanie połowicznym |

## 10. Status etapów

| Etap | Temat | Stan |
| --- | --- | --- |
| RF0 | Siatka bezpieczeństwa + baseline | ⬜ |
| RF1 | Duch gracza (cykl życia slotów) | ✅ (fix bugu; podział plików = później) |
| RF2 | Komunikat obserwatora + menedżer alertów | ⬜ |
| RF3 | Klient: sesja i sieć | ⬜ |
| RF4 | Klient: pętla gry i efekty | ⬜ |
| RF5 | Serwer: walka i systemy | ⬜ |
| RF6 | Serwer: pokój i rejestr graczy | ⬜ |
| RF7 | Protokół: domeny + odporność | ⬜ |
| RF8 | Rejestr samolotów + mapa jako dane | ⬜ |
| RF9 | UI: lobby + HUD | ⬜ |
| RF10 | Audyt bezpieczeństwa | ⬜ |
| RF11 | Spójność i domknięcie | ⬜ |

Sekcje „Wynik RFn" dopisywane pod spodem po każdej sesji (wzorem `docs/fizyka-v2-rekalibracja.md`).

---

## Wynik RF1 (2026-07-18) — sesja punktowa (sam fix bugu, BEZ podziału plików)

Zrealizowano zakres błędowy etapu RF1 (duch gracza). Podział monolitów z §4 pozostaje na osobne etapy —
to była sesja naprawcza na życzenie usera, nie pełny etap refaktoringu.

**Reprodukcja (chrome-devtools, dev) — potwierdzone OBIE warstwy z §3.1:**

1. **Zalążek (przyczyna źródłowa) — POTWIERDZONY: desync tokenu w kliencie.** Log serwera pokazał różnicę:
   czysty F5 tuż po `createRoom` daje `rozłączony → reconnect gracza` (wznawia slot ✅), ale F5 po sekwencji
   „nieudane wznowienie → utworzenie/dołączenie pokoju" daje `rozłączony → gracz w lobby` (BRAK wznowienia →
   duch). Mechanizm: po nieudanym resumie `onWelcome` świadomie NIE zapisuje świeżego tokenu (żeby nie zatruć
   — fix z 2026-06-26), ale gdy potem gracz założy/dołączy pokój na TYM połączeniu, slot dostaje token
   połączenia (`net.sessionToken`), którego **nie ma w localStorage**. F5 wznawia STARYM, nieaktualnym tokenem
   → `tryReconnect` = null → nowy gracz w lobby, a stary slot wisi jako duplikat = duch. (Wcześniejsza teza
   „resume zawsze działa" była błędna — działa tylko przy zsynchronizowanym tokenie.)
2. **Wzmacniacz — POTWIERDZONY: `lobby.maintain()` prune tylko przy `connectedCount === 0`.** Empirycznie: gracz
   rozłączony (zamknięta karta) w pokoju z drugim POŁĄCZONYM graczem wisiał w rosterze **>113 s**, mimo okna
   60 s — bo drugi gracz trzymał `connectedCount ≥ 1`. Taki duch przy starcie meczu dostawał samolot na
   autopilocie (feature 2026-06-25), nieodróżnialny od żywego.

Fix zalążka usuwa ducha U ŹRÓDŁA (F5 wraca do własnego slotu, duplikat nie powstaje); fix wzmacniacza to
siatka bezpieczeństwa (każdy osierocony slot — genuine leave, zerwanie sieci, edge — znika po 60 s). Pomysł
usera „kasuj starego przy wejściu" świadomie ODRZUCONY (gorszy: nick nie jest kluczem tożsamości; dedup po
tokenie już robi `reconnectByToken`, a właściwe rozwiązanie to nie tworzyć duplikatu).

**Decyzje usera (AskUserQuestion 2026-07-18):** (1) po wygaśnięciu okna 60 s usuwać slot WSZĘDZIE, także
w trakcie meczu (samolot-widmo znika, przestaje liczyć się do eliminacji) — spójne z pierwotną intencją
okna; (2) w oknie 60 s oznaczać rozłączonego w rosterze jako „(rozłączony)".

**Zmiany:**
- **`client/src/online-main.ts` `onRoomJoined` (FIX ŹRÓDŁA):** `if (net?.sessionToken) saveToken(net.sessionToken)`
  na wejściu do pokoju — token AKTYWNEGO połączenia (wskazujący NASZ slot) trafia do localStorage. Domyka
  desync: na udanym wznowieniu to ten sam token (idempotentne), a po utworzeniu/dołączeniu pokoju z
  „lobbowym" tokenem — zapisujemy właściwy, więc F5 wznawia slot zamiast tworzyć ducha.
- **`server/src/lobby.ts` `maintain`:** `pruneExpiredReconnects` wołane **ZAWSZE** (skreślony warunek
  `connectedCount === 0`). Okno `RECONNECT_WINDOW_MS` (60 s) egzekwowane niezależnie od zajętości pokoju.
- **`server/src/game-room.ts` `pruneExpiredReconnects`:** zwraca teraz **tokeny usuniętych sesji**
  (`string[]`) zamiast liczby — `maintain` czyści po nich mapę `sessions` (koniec drobnego wycieku
  token→pokój przy prune w zajętym pokoju). Bezpieczeństwo prune w trakcie meczu zweryfikowane: `checkElimination`
  czyta `players` świeżo co tick, a metoda woła `rebuildSnapshotSources()`+`broadcastRoomUpdate()` — usunięcie
  encji jest równoważne wyjściu gracza.
- **`server/src/game-room.ts` `roomPlayers()` + `RoomPlayer` (shared):** addytywne pole `disconnected?: boolean`
  (obecne tylko dla człowieka z `member === null`; boty/połączeni — brak). BEZ bumpu protokołu binarnego
  (roster to JSON).
- **`client/src/net/lobby-ui.ts` `buildPlayerRow`:** rozłączony człowiek → wiersz wyszarzony (`is-disconnected`,
  opacity 0.5) + kursywa „(rozłączony)" zamiast wskaźnika gotowości/kontrolek. CSS w tym samym pliku.
- **Testy (+2, łącznie 784 zielone):** `game-room.test.ts` — prune w pokoju z połączonym graczem + marker
  `disconnected` w rosterze (oraz istniejący test zaktualizowany na zwracane tokeny); `lobby.test.ts` — pełna
  ścieżka `maintain` czyści ducha w zajętym pokoju i sprząta sesję (token nie wskrzesza slotu).

**Weryfikacja E2E (chrome-devtools):** (a) **Wzmacniacz:** dwa konteksty (OTHER host + LEAVER). LEAVER
zamyka kartę → w oknie „LEAVER (rozłączony)" (wyszarzony) → po >60 s **znika z rosteru**, choć OTHER wciąż
połączony. (b) **Źródło:** odtworzono desync (localStorage token nieaktualny wobec slotu) — F5 dawał
`gracz w lobby` (log) + ekran wejściowy z własnym pokojem jako „obcym"; po fixie token przy `createRoom`
zmienia się na token slotu (zweryfikowane odczytem localStorage), a F5 daje `reconnect gracza` (log) i wraca
prosto do poczekalni własnego pokoju, jeden wpis. typecheck/784 testy/lint/build zielone. Konsola czysta
(jedyny błąd = pre-existing `favicon.ico` 404, §8).

**DEPLOY: front + back RAZEM** (semantyka rosteru: serwer wysyła `disconnected`, klient je renderuje;
protokół binarny v10 NIEZMIENIONY — pole addytywne JSON). **NIEZACOMMITOWANE.** ⏳ user: smoke na produkcji
(znajomy zamyka kartę/traci sieć w pokoju → po ~60 s znika, nie wisi jako duch; w oknie widać „(rozłączony)").
