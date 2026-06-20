# Parytet MP ↔ SP — przewodnik

> Jeden punkt wejścia do całego wysiłku „dociągnięcia" trybu sieciowego (MP) do poziomu
> single‑playera (SP). Tu jest mapa i status; szczegóły każdego etapu — w plikach pod „Szczegóły".
>
> **Status na 2026-06-20: ZAMKNIĘTE i zacommitowane (404 testy zielone).** Zostaje deploy + smoke
> po stronie użytkownika (patrz „Otwarte sprawy"). Następna faza projektu: **19 — Bf 109 E**.

## Po co to było

Multiplayer powstawał osobno (fazy 8–13) jako autorytatywny **FFA deathmatch** i z założenia był
„surowy" — sam rdzeń sieciowy (protokół, predykcja, lobby, walka, boty, pętla meczu). Single‑player
(`packages/client/src/main.ts`) był znacznie bardziej dopracowany: warstwa wizualna/feedbacku, model
śmierci ze spadającym wrakiem, tryb obserwatora, kontrola strefy, tryb drużynowy, onboarding.

Decyzja użytkownika (2026-06-18): **pełny parytet MP↔SP PRZED kolejnym samolotem (Bf 109)**.
Wysiłek podzielił się na dwa etapy:

1. **Blok faz 14–18** — pięć „dużych" sesji przenoszących mechaniki SP do MP (wizualia → model
   śmierci → obserwator → strefa → drużyny).
2. **Domknięcie P1–P5** — porównawczy audyt `main.ts` ↔ `online-main.ts`/`game-room.ts` po bloku,
   który wychwycił **drobne pozostałe różnice** (m.in. FFA wciąż był deathmatchem, nie eliminacją).
   Plan i jego realizacja: [`parytet-mp-sp-domkniecie.md`](parytet-mp-sp-domkniecie.md).

Po obu etapach MP i SP mają ten sam model rozgrywki i tę samą warstwę odczuć.

## Status — co, gdzie, w jakim stanie

| Etap | Temat | Warstwa | Protokół | Stan | Szczegóły |
| --- | --- | --- | --- | --- | --- |
| **14** | Wizualia i HUD online | klient | **v3** (+1 B amunicja) | ✅ | [faza-14.md](phases/faza-14.md) |
| **15** | Model śmierci: kolizje + spadający wrak | serwer | bez zmian (`dying`/`collision` od f11) | ✅ | [faza-15.md](phases/faza-15.md) |
| **16** | Kliencka warstwa śmierci: obserwator + sterowany wrak | klient | bez zmian | ✅ | [faza-16.md](phases/faza-16.md) |
| **17** | Kontrola strefy KotH (dodatkowy warunek) | serwer + klient | addytywne JSON (v3) | ✅ | [faza-17.md](phases/faza-17.md) |
| **18** | Tryb drużynowy (opcja pokoju) | serwer + lobby + klient | addytywne JSON (v3) | ✅ | [faza-18.md](phases/faza-18.md) |
| **P1** | FFA jako tryb **eliminacyjny** (parytet SP) | serwer + klient + lobby | usunięcia (v3) | ✅ | [domknięcie §P1](parytet-mp-sp-domkniecie.md) |
| **P2** | Widoczna atrybucja CC-BY Spitfire | klient (lobby) | — | ✅ | [domknięcie §P2](parytet-mp-sp-domkniecie.md) |
| **P3** | Onboarding „JAK GRAĆ" w lobby | klient (lobby) | — | ✅ | [domknięcie §P3](parytet-mp-sp-domkniecie.md) |
| **P4** | Trzęsienie kamery przy buffecie | klient | — | ✅ | [domknięcie §P4](parytet-mp-sp-domkniecie.md) |
| **P5** | Sprzątanie (martwy kod, reset gazu, HUD) | klient + serwer | — | ✅ | [domknięcie §P5](parytet-mp-sp-domkniecie.md) |

**Protokół po całym bloku: `PROTOCOL_VERSION = 3`.** Tylko faza 14 bumpnęła wersję (2→3, +1 bajt
amunicji w snapshocie). Fazy 15–18 i P1–P5 nie ruszyły wersji — to addytywne pola JSON w `standings`
albo czyste usunięcia. **Klient i serwer trzeba deployować RAZEM** (niespójna wersja = błąd handshake).

## Mapa: mechanika SP → gdzie wylądowała w MP

| Mechanika SP (`main.ts` + moduły) | Etap | Gdzie w MP |
| --- | --- | --- |
| Wybuchy, dym uszkodzeń, błysk luf | 14 | `online-main.ts`: `Explosions`/`SmokeTrails`/`MuzzleFlash` |
| Markery wrogów + spotting `SPOT_RANGE_M` | 14 | `EnemyMarker`, kolor FFA per id |
| Pełny HUD‑G (G‑LOC/stall/horyzont) | 14 | dane z lokalnej predykcji `Predictor.sim` |
| Spadający wrak (`'dying'` zamiast natychmiastowego `'dead'`) | 15 | serwer: `stepWreckPiloted`, `resolvePlaneCollisions` |
| Sterowanie własnym wrakiem + obserwator + kamera orbitalna | 16 | `online-main`: `DownedOverlay`, `OrbitCamera`, predykcja `'dying'` |
| Kontrola strefy KotH (warunek zwycięstwa) | 17 | serwer: `ZoneControl`; klient: `ZoneBar` |
| Tryb drużynowy (2 drużyny, eliminacja, friendly fire) | 18 | `shared/world/team.ts`, frakcje serwerowo |
| **FFA = eliminacja 1‑życiowa (last‑man‑standing)** | **P1** | serwer: `checkElimination`; usunięte `evaluateFfa`/limity |
| Widoczna atrybucja CC-BY modelu | P2 | `lobby-ui`: `attributionEl()` |
| Ekran „JAK GRAĆ" (sterowanie + cel) | P3 | `lobby-ui`: `ONLINE_CONTROL_ROWS` + auto‑pokaz |
| Trzęsienie kamery przy buffecie | P4 | `chaseCamera.update(..., buffetIntensity)` |
| Reset gazu (0.8) przy wejściu do gry | P5 | `online-main`: `enterPlaying()` |

## Decyzje użytkownika (zebrane)

- **2026-06-18** — pełny parytet MP↔SP PRZED Bf 109; kolejność: wizualia → kolizje/wrak → obserwator
  → strefa → drużyny. Fazy przesunięte (Bf 109→19, teren→20, dźwięk→21, uszkodzenia→22).
- **Faza 15** — wrak GRACZA może strzelać (parytet z SP; bot‑wrak nie). Wrak nie jest celem ani się
  nie zderza, ale broń działa.
- **Faza 17** — tylko `ZoneBar`, bez znacznika 3D strefy (szczyt góry = naturalny punkt orientacyjny).
- **Faza 18** — tryb drużynowy: auto‑balans serwera (bez wyboru drużyny w lobby), sztywno 1 życie i
  brak limitu czasu („jak SP, dopracowany wzór"); realizacja w 2 sesjach (serwer/lobby + klient).
- **P1 (Q1)** — wariant **(a) pełny parytet SP**: FFA bez limitu zestrzeleń ani czasu (nie wariant
  (b) z bezpiecznikiem czasu). Koniec FFA = **eliminacja albo przejęcie strefy**.

## Najważniejsze pułapki (skrót — pełne w plikach etapów)

- **Reconciliation a faza życia (f15/f16):** wspólny `stepWreckPiloted` w `shared` daje serwerowi i
  predykcji klienta ten sam krok wraku; `reconcile` musi rozróżniać ciągłość fazy (replay) od zmiany
  fazy (snap + reset), bo bufor inputów po `alive→dying` jest „żywy".
- **Koniec meczu gubi eventy (P1):** `endMatch()` czyści `pendingEvents`, a `sendSnapshots()` jest
  zbramkowane do stanu `'playing'` → zestrzelenie kończące mecz **2‑encjowy** gubi swój event KILL.
  W testach trzeba mieć żywych bystanderów; w grze 1v1 ostatni kill‑feed może nie mignąć (artefakt).
- **dead → 'respawning' niezależnie od żyć (P1):** `updateLifecycle` po `RESPAWN_DELAY_S` przełącza
  `dead→'respawning'` zawsze; to `spawn()` bramkuje `canRespawn`. Wyeliminowana encja „utyka" w
  `'respawning'` i nigdy nie wraca do `'alive'` (asercje testów: `.not.toBe('alive')`).

## Otwarte sprawy (po stronie użytkownika)

- **Deploy** front+back RAZEM (protokół v3; zmiana zachowania serwera w P1). Ponowny publiczny deploy
  po P1+P2 (parytet zachowania + compliance licencji).
- **Smoke online:** FFA (brak respawnu po zestrzeleniu → overlay obserwatora → ekran wyników, gdy
  zostaje 1) oraz drużynowy (auto‑balans, friendly fire, koniec przez eliminację/strefę, kolory
  markerów wróg/sojusznik).
- **Zaległe pomiary z faz 11/13:** sesja 2‑os. ping ~150 ms („co widzę, to trafiam"), `docker stats`
  / CPU 8 graczy na VPS → memory; tag `mp-1`.

## Powiązane dokumenty i ślady

- Szczegóły etapów: [`docs/phases/faza-14.md`](phases/faza-14.md) … [`faza-18.md`](phases/faza-18.md)
- Plan i realizacja domknięcia: [`docs/parytet-mp-sp-domkniecie.md`](parytet-mp-sp-domkniecie.md)
- Sekcja w planie projektu: „Parytet multiplayera (Fazy 14–18)" → „Domknięcie P1–P5" w `PLAN.md`
- Pamięć: `memory/parytet-domkniecie-p1-p5.md`, `memory/faza14-…` … `faza18-…`
- Commity: f14–f18 (`a6b20aa`, `f968cfb` i wcześniejsze); P4 `ccab4b5`, P2+P3 `8b91729`,
  P1+P5 `33b03c1`, P5.1+docs `3a37790`.
