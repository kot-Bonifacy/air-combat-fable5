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

## Wynik (uzupełnić po zakończeniu)

—
