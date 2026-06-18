# Faza 15 — Parytet MP cz.2: model śmierci na serwerze (kolizje + spadający wrak)

**Zależy od:** Faza 14
**Cel:** Domknąć różnicę w MODELU ŚMIERCI między online a single-player po stronie SERWERA
(autorytet — niezmiennik nr 5). Po tej fazie zestrzelenie w powietrzu nie kończy encji od razu
(`'dead'`), tylko czyni z niej spadający wrak (`'dying'`, `stepWreck`) — jak w SP; serwer wykrywa
też zderzenia samolot↔samolot i emituje `KillCause 'collision'` (dotąd martwy kod protokołu).
Warstwa kliencka spadającego wraku (render, obserwator, sterowanie) to Faza 16.

## Zakres

W tej fazie (TYLKO serwer, BEZ bumpu protokołu — `'dying'`/`'collision'` już w protokole od f11):
- **`prevPos` per encja** — pozycja na początku ticku; po zawinięciu torusa korygowana do obrazu
  najbliższego pozycji końcowej (`nearestToroidalImage`), żeby zamiatany odcinek kolizji nie objął
  całej areny po przeniesieniu.
- **`resolvePlaneCollisions`** — zamiatany test `planesCollide` (prevPos→pozycja) dla par ŻYWYCH,
  nietykalnych płatowców; zwarcie → oba stają się spadającymi wrakami, event `KILL cause 'collision'`
  bez kredytu (jak rozbicie) + asysty wcześniejszych napastników.
- **Model `'dying'` serwerowo** — zestrzelenie w powietrzu (pocisk/kolizja) → `enterWreck`
  (`life='dying'`, śmierć liczona TERAZ, jak w SP); `stepWreck` (silnik martwy, ster ograniczony)
  gna wrak w dół; gracz steruje wrakiem wychyleniami z inputu (bot-wrak leci neutralnie).
- **`wreckImpact` → `dead`** — po dotknięciu ziemi `updateLifecycle` zwraca `wreckImpact` i ustawia
  `'dead'`; dopiero wtedy rusza odliczanie respawnu (buchalteria była przy zestrzeleniu — bez
  podwójnego liczenia).
- **Wrak GRACZA może strzelać** (decyzja: parytet z SP) — wrak nie jest CELEM ani się nie zderza,
  ale broń wciąż działa; bot-wrak nie strzela.

Poza zakresem: render spadającego wraku + dym wraku, lokalna predykcja `stepWreck` dla `'dying'`,
sterowanie wrakiem + `DownedOverlay` (obserwator/koniec), tryb obserwatora, wybuch na `dying→dead` —
to Faza 16. Strefa KotH (17), drużyny (18).

## Kroki

1. `server/game-room.ts`: `prevPos` w `ServerPlayer` (+init); przechwycenie na początku
   `stepPlayer`/`stepBot`, korekta `fixWrapPrev` po fizyce.
2. Gałąź `'dying'` w `stepPlayer`/`stepBot` → `stepWreckEntity` (gracz: `keyboardDemands` z inputu;
   bot: neutralnie) + `updateLifecycle` (wreckImpact → dead).
3. `resolvePlaneCollisions` w pętli `step` (po ruchu, przed historią/ogniem); `enterWreck`,
   `onCollisionDeath` (cause `'collision'`); `onAirKill` przerobiony na `enterWreck` (`'dying'`).
4. `fireWeapon`: dopuszczenie ognia dla wraku GRACZA (`'dying' && !isBot`).
5. `shared/physics/state.ts`: aktualizacja komentarza-niezmiennika fazy `'dying'` (wrak STRZELA,
   ale nie jest celem i się nie zderza).
6. Testy: `server/collision.test.ts` (kolizje + model wraku); aktualizacja `bots.test.ts`
   (zestrzelony bot = `'dying'`, nie `'dead'`).

## Kryteria ukończenia

- [x] Zestrzelenie w powietrzu czyni z ofiary spadający wrak (`'dying'`), nie od razu `'dead'`;
  śmierć/kredyt/asysty liczone w chwili zestrzelenia (jak SP)
- [x] Serwer wykrywa zderzenia samolot↔samolot (zamiatany `planesCollide` na `prevPos`→pozycja) i
  emituje `KillCause 'collision'` — oba płatowce → wrak, bez kredytu
- [x] Nietykalni po respawnie (`protectionTimerS`) nie zderzają się (anty-spawn-kill obejmuje kolizje)
- [x] `prevPos` korygowane po zawinięciu torusa (`nearestToroidalImage`) — brak fałszywych kolizji
  z odległymi maszynami po przeniesieniu
- [x] Wrak spada (`stepWreck`), a po uderzeniu w ziemię (`wreckImpact`) przechodzi w `'dead'`;
  respawn rusza dopiero wtedy
- [x] Wrak GRACZA może strzelać (parytet z SP); bot-wrak nie strzela; wrak nie jest celem ani się
  nie zderza
- [x] typecheck + test (388, +7) + lint zielone; build (Vite + esbuild) przechodzi; commit
- [ ] **(użytkownik)** smoke online: zestrzelić wroga i zobaczyć spadający wrak; zderzyć się czołowo;
  obejrzeć kill feed „kolizja" (klient f14 już to obsługuje)

## Pułapki

- **Brak bumpu protokołu** — `'dying'`/`'collision'` istnieją od f11; klient f14 obsługuje encję
  `'dying'` (widoczny mesh, brak markera, interpolacja spadania) i feed „kolizja". Serwer f15 jest
  zgodny z klientem f14 (bez crasha). ALE lokalny wrak gracza u klienta f14 jest DEGRADED: predykcja
  no-opuje dla nie-żywych, więc render skacze 30 Hz (twardy snap) i bez sterowania — pełna płynność
  i kontrola dopiero z klientem f16. **Zalecenie: deploy f15+f16 razem** (server-only f15 też działa).
- **Zawinięcie torusa a kolizje** — `prevPos` (przed) i pozycja (po) różnią się o ~arenę przy
  przeniesieniu; bez korekty `nearestToroidalImage` zamiatany odcinek dawałby fałszywe zderzenia.
  Korekta in-place jest bezpieczna (argumenty `.set` liczone przed zapisem). Pary rozdzielone szwem
  areny i tak się nie zderzą (znane ograniczenie `collision.ts`, identyczne jak pociski).
- **Zmiana timingu respawnu** — z `'dying'` respawn następuje po (czas spadania + `RESPAWN_DELAY_S`),
  nie od razu. To CEL (parytet z SP), ale wrak z dużej wysokości spada kilkanaście sekund — bez
  sterowania (klient f14) ten czas jest „martwy"; klient f16 czyni go interaktywnym (sterowanie/
  obserwator). Testy respawnu po zestrzeleniu MUSZĄ uwzględnić uderzenie wraku w ziemię.
- **Kolejność w `step`** — kolizje PRZED historią/ogniem, by encja zderzona w tym ticku nie była
  celem (`resolveHits` pomija nie-żywych), nie weszła do `history` (rewind) i — gdyby trzeba —
  zachowała spójność z lag-comp. Wrak GRACZA może strzelać już w ticku zderzenia (akceptowalne).
- **`wreckImpact` nie liczy buchalterii** — zwracane przez `updateLifecycle` zdarzenie tylko ustawia
  `'dead'`; serwer go nie obsługuje osobno (śmierć/kredyt były przy zestrzeleniu). `onGroundDeath`
  (rozbicie żywego o teren) bez zmian — tam `'crashed'` ustawia `'dead'` od razu.

## Wynik

**Zrealizowane (2026-06-18).** Model śmierci MP zrównany z SP po stronie serwera (autorytet).
Zestrzelenie w powietrzu i zderzenie nie kończą encji natychmiast — czynią z niej spadający wrak.

**`game-room.ts`:**
- `ServerPlayer.prevPos` (Vector3) — pozycja na początku ticku, przechwytywana w `stepPlayer`/
  `stepBot`; `fixWrapPrev` (`nearestToroidalImage(prevPos, pozycja, prevPos)`) koryguje ją po
  ewentualnym zawinięciu torusa, żeby zamiatany odcinek kolizji pozostał krótki.
- `resolvePlaneCollisions()` w `step` (po ruchu, przed historią): scratch żywych+nietykalnych encji,
  pary i<j, `planesCollide(a.prevPos, a.pos, r, b.prevPos, b.pos, r)` (r=`collisionRadiusM`=3 m);
  zwarcie → `onCollisionDeath` na obu (break po śmierci `a`). Pominięci: nie-żywi i pod ochroną
  respawnu (`protectionTimerS > 0`).
- `enterWreck(victim)` — `life='dying'`, `lifeTimerS=0`, `deaths++` (wspólne dla zestrzelenia i
  kolizji). `onAirKill` woła `enterWreck` + KILL `'air'` + kredyt; `onCollisionDeath` woła
  `enterWreck` + KILL `'collision'` (NO_KILLER) + asysty.
- Gałąź `'dying'` w `stepPlayer`/`stepBot`: `stepWreckEntity` + `fixWrapPrev` + `updateLifecycle`
  (wreckImpact → `'dead'`; zdarzenie nieobsługiwane osobno — buchalteria była przy zestrzeleniu).
- `stepWreckEntity(player, dtS)` — wrak GRACZA steruje się jak klawiaturą (`keyboardDemands` z
  inputu, bez instruktora/myszy; `lastProcessedSeq` ack też tu — pod reconciliation wraku w f16);
  wrak BOTA leci neutralnie (czysty opad); `stepWreck` (throttle 0) + `wrapToArena` + `validatePlaneState`.
- `fireWeapon`: ogień dla `'alive'` LUB wraku GRACZA (`'dying' && !isBot`) — parytet z SP; wrak nie
  jest celem (`resolveHits` pomija nie-żywych) ani się nie zderza, ale broń działa z bieżącej pozy.

**`shared/physics/state.ts`:** komentarz fazy `'dying'` poprawiony — wrak nie jest CELEM (nie celują,
nie zderza się), ale broń wciąż działa (gracz strzela z wraku do uderzenia w ziemię).

**Decyzja projektowa (2026-06-18, uzgodniona z użytkownikiem):** spadający wrak GRACZA może strzelać
(parytet z SP), mimo że pierwotny komentarz `state.ts` mówił „nie strzela". Bot-wrak nie strzela
(jak w SP — AI nie myśli w stanie `'dying'`).

**Walidacja:** `npm run typecheck` + `npm test` (388, +7 w `collision.test.ts`: kolizja→2 wraki+cause
`collision`, brak fałszywych kolizji, ochrona vs kolizja, air-kill→`'dying'`, wrak→uderzenie→`'dead'`→
respawn, wrak gracza strzela, wrak bota nie) + `npm run lint` zielone; `npm run build` (klient online
37,91 kB bez zmian — faza serwerowa; serwer 563,8 kB) przechodzi. `bots.test.ts` zaktualizowany
(zestrzelony bot = `'dying'`; respawn po przyspieszonym opadnięciu wraku).

**Otwarte (użytkownik):** smoke online po deployu backendu — zestrzelić wroga (spadający wrak),
zderzyć się czołowo (oba wraki + feed „kolizja"). Klient f14 pokazuje spadające obce wraki i feed
poprawnie; lokalny wrak gracza będzie w pełni grywalny dopiero z klientem f16 (deploy f15+f16 razem).
Następna: Faza 16 — kliencka warstwa śmierci (render wraku + dym, predykcja `stepWreck`, sterowanie
wrakiem + `DownedOverlay`, tryb obserwatora, wybuch na `dying→dead`).
