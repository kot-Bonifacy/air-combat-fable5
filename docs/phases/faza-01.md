# Faza 1 — Fundament fizyki + obserwowalność

**Zależy od:** Faza 0
**Czytaj najpierw:** `docs/fizyka-lotu.md` (rozdz. 3, 8, 11)
**Cel:** pętla fizyki ze stałym krokiem i komplet narzędzi do patrzenia jej na ręce —
ZANIM powstanie jakakolwiek aerodynamika. To jest faza, która ma uniemożliwić powtórkę
z debugowania „dziwnego latania" na ślepo.

## Zakres

W tej fazie (wszystko w `shared`, render w `client`):
- `PlaneState` (position, velocity, orientation, angularRates, throttle) — na razie używany przez „sześcian testowy"
- Pętla fizyki: akumulator czasu, stały krok 1/60 s, semi-implicit Euler, interpolacja renderu
- Helpery osi `frame.ts`: `getForward/getUp/getRight` + testy 4 orientacji bazowych
- Strażnik NaN (walidacja stanu po ticku, wyjątek z dumpem w dev)
- Strzałki sił 3D (`ArrowHelper` per siła, skala log, toggle F3)
- Telemetria HUD (tekstowa nakładka: pozycja, V, energia)
- Złote testy analityczne:
  - sześcian spada swobodnie: `h(t) = h0 − ½gt²` z tolerancją < 0.1% po 5 s
  - rzut ukośny: zasięg zgodny z wzorem analitycznym < 0.1%
  - kwaternion po 4× obrocie o 90° wraca do identyczności (normalizacja nie dryfuje)

Poza zakresem: siły aerodynamiczne, model samolotu, input gracza (poza throttle do testów).

## Kroki

1. `shared/src/physics/state.ts`, `loop.ts` (integrator + akumulator), `forces.ts` (na razie tylko grawitacja)
2. `shared/src/math/frame.ts` + testy
3. Strażnik NaN jako wrapper kroku fizyki (włączany flagą dev)
4. Klient: scena z ziemią-siatką, sześcian sterowany stanem fizyki, strzałki, HUD tekstowy
5. Złote testy w Vitest (bez DOM — czysty `shared`)

## Kryteria ukończenia

- [ ] Wszystkie złote testy zielone z tolerancjami jak wyżej
- [ ] Sześcian upuszczony w scenie spada, strzałka grawitacji widoczna, F3 działa
- [ ] Sztucznie wstrzyknięty NaN (test) → wyjątek z czytelnym dumpem stanu
- [ ] Render płynny przy sztucznie obniżonym fps fizyki (interpolacja działa)
- [ ] typecheck + test + lint zielone; commit `faza-1`; memory zapisane

## Pułapki / lekcje z opus4-7

- Circular import physics ↔ aero: siły zwracają zwykłe obiekty `{force: Vector3}`,
  moduły sił importują tylko `state.ts` — nigdy siebie nawzajem
- Strict TS: `array[0]` ma typ `T | undefined` — guard clauses zamiast `!`
- `three` w Node: importować z `three` (klasy math nie dotykają DOM) — jeden test w `shared`
  uruchamiany przez Node potwierdza, że działa poza przeglądarką

## Wynik (uzupełnić po zakończeniu)

Ukończona 2026-06-10. Kryteria:

- Złote testy zielone: spadek swobodny <0.1% (h0=1000 m — patrz memory: błąd Eulera wymaga
  dużego h0), rzut ukośny <0.1% (interpolacja przecięcia y=0), kwaternion 4×90° → identyczność,
  norma stabilna po 60 000 ticków
- Scena: sześcian spada z 80 m na siatkę, strzałka grawitacji (skala log), F3 toggle,
  F4 przełącza tick 60↔10 Hz (wizualny test interpolacji — mesh lerp/slerp prev↔curr), R reset
- Strażnik NaN: wstrzyknięty NaN/Infinity → `PhysicsError` z listą pól i dumpem stanu (test)
- typecheck + test (13) + lint zielone; commit `faza-1`

Nowe moduły `shared`: `errors.ts`, `math/frame.ts` (getForward/getUp/getRight),
`physics/{state,forces,loop,nan-guard}.ts`. Klient: `hud.ts`, `force-arrows.ts`, `net-status.ts`.
