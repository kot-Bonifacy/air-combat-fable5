# Faza 6 — Bot AI: pierwszy grywalny dogfight

**Zależy od:** Faza 5
**Cel:** KAMIEŃ MILOWY — pełnoprawna walka powietrzna 1v1 i 1v2 offline. Od tej fazy
projekt jest GRĄ.

## Zakres

W tej fazie:
- Bot w `shared` (od fazy 12 pobiegnie na serwerze!): steruje WYŁĄCZNIE przez interfejs
  instruktora (punkt celu + throttle + spust) — fizycznie nie umie więcej niż gracz
- FSM: `patrol` (krążenie po waypointach) → `engage` (pościg z atakiem) → `evade`
  (zrywanie pozycji gdy przeciwnik na ogonie) → `extend` (odbudowa energii gdy wolny);
  przejścia na podstawie geometrii (kąt, dystans, kto za kim) i energii
- Strzelanie z wyprzedzeniem: rozwiązanie punktu przecięcia toru celu i pocisku
  (iteracyjne, 2-3 kroki wystarczą); otwarcie ognia tylko w stożku + zasięgu
- Poziomy trudności przez degradację: czas reakcji, szum celowania, limit G bota,
  procent throttle — w JSON (`shared/src/ai/difficulty.json`)
- Tryb gry offline: ekran startowy → wybór 1v1/1v2/2v2 (skrzydłowy-bot) → walka → wynik
- Znaczniki przeciwników w HUD (strzałki kierunkowe poza ekranem, dystans)

Poza zakresem: sieć, osobowości botów, manewry nazwane (immelmann jako decyzja AI — backlog).

## Kroki

1. `shared/src/ai/geometry.ts`: kąty względne (aspect, off-boresight), pozycja ogonowa + testy
2. `shared/src/ai/lead.ts`: wyprzedzenie + test (cel po prostej = rozwiązanie analityczne)
3. `shared/src/ai/fsm.ts`: stany + przejścia + testy przejść (tabela warunków)
4. Unikanie ziemi: twardy override — poniżej wysokości bezpiecznej bot przerywa wszystko i wyrównuje
5. Klient: spawn botów, znaczniki HUD, ekran startowy i końcowy
6. Sesje testowe + strojenie trudności (bot „normalny" ma być pokonywalny po kilku próbach)

## Kryteria ukończenia

- [ ] Bot patroluje, atakuje, broni się; NIE wbija się w ziemię ani w granicę areny
  (test: 10 min symulacji bez gracza, 4 boty, zero crashy do terenu)
- [ ] Bot trafia manewrujący cel okazjonalnie (wyprzedzenie działa), nie aimbotuje na „łatwym"
- [ ] 1v1 na „normalnym": da się wygrać i da się przegrać; walka trwa > 60 s (nie natychmiastowy kill)
- [ ] FSM testowany jednostkowo (każde przejście ma test)
- [ ] Wydajność: 4 boty + gracz = nadal 60 fps
- [ ] typecheck + test + lint zielone; commit `faza-6`; memory zapisane

## Pułapki

- Bot przez instruktora dziedziczy kopertę — jeśli bot „lata lepiej niż fizyka pozwala",
  to bug interfejsu, nie feature
- Najczęstszy błąd botów dogfightowych: idealna wiedza → nieludzka celność. Szum i opóźnienie
  reakcji to nie kosmetyka, to rdzeń balansu
- Unikanie ziemi MUSI być nadrzędne nad FSM (osobna warstwa), inaczej evade w dolinie = crash

## Wynik (2026-06-14)

Zrealizowano kamień milowy — grywalny dogfight offline 1v1. Decyzje użytkownika: w tej fazie
**tylko 1v1** (1v2/2v2 → backlog), mecz **na punkty do 3 z respawnami**, strzelnica z fazy 5
zostaje jako tryb **„Trening"**.

**Rdzeń AI w `shared/src/ai/`** (od fazy 12 pobiegnie na serwerze), bot steruje WYŁĄCZNIE przez
interfejs instruktora — dziedziczy kopertę:
- `geometry.ts` — aspect / off-boresight / closure + predykaty pozycji ogonowej (+ testy).
- `lead.ts` — wyprzedzenie jako równanie kwadratowe w układzie strzelca, dokładne dla celu po
  prostej; brak rozwiązania → LOS (+ testy z rozwiązaniem analitycznym).
- `fsm.ts` — patrol → engage → evade → extend; CZYSTE przejścia, **każde z testem** (+ predykaty
  threat/offensive). Override unikania ziemi/areny jest osobną, nadrzędną warstwą (nie stanem).
- `difficulty.json` + `difficulty.ts` — poziomy łatwy/normalny/trudny przez degradację (czas
  reakcji, szum celowania, limit G, throttle, dyscyplina ognia) + wspólne progi FSM; walidacja+SI.
- `bot.ts` — orkiestracja: FSM → sterowanie per stan → degradacja → override'y bezpieczeństwa →
  instruktor. Limit G realizowany jako clamp kąta komendy nos→cel.

**Klient**: ekran startowy (wybór trybu + trudności) i końcowy (`menu.ts`), markery przeciwnika
w HUD — strzałka poza ekranem / ramka + dystans (`enemy-marker.ts`), pełne 1v1 w `main.ts`
(HP gracza, wzajemne obrażenia, wynik, respawny, kill feed). Strzelnica jako tryb treningowy.

### Kryteria
- [x] Bot patroluje/atakuje/broni się; NIE wbija się w ziemię ani w granicę areny —
  `ai-sim.test.ts`: 10 min, 4 boty, zero crashy, w granicach areny.
- [x] Bot trafia manewrujący cel okazjonalnie, nie aimbotuje na „łatwym" — `ai-gunnery.test.ts`:
  trudny trafia, łatwy istotnie rzadziej.
- [x] FSM testowany jednostkowo (każde przejście) — `fsm.test.ts`.
- [x] typecheck + test (203 testy) + lint zielone; build klienta i serwera OK; dev startuje czysto.
- [~] 1v1 „normalny" winnable/losable, walka > 60 s; 4 boty + gracz @ 60 fps — z konstrukcji
  (HP 120 / dmg 1.5 → kill = sekundy celnego ognia; mecz do 3 z respawnami; bot ~kilka op.
  wektorowych + 1 pilotStep). **Finalne „czucie" i balans do playtestu gracza.**

### Pułapki rozwiązane w trakcie
- Stromy nur w engage + niski roll rate przy dużym IAS (~14°/s) → instruktor wybierał roll 180°
  (split-S) → rozbicie. Rozwiązanie: ciągły sufit zniżania zależny od AGL (`maxDiveDeg=28`)
  + próbkowanie terenu z wyprzedzeniem wzdłuż prędkości (`lookaheadSurfaceM`).

Szczegóły: `memory/project_phase6_decisions.md`.
