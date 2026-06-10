# Faza 1 — decyzje i pułapki (2026-06-10)

## Decyzje nieoczywiste z kodu

- **Mapowanie rate'ów pilota → ω_body** (loop.ts): przy konwencji +Z nos / +Y góra / +X lewe
  skrzydło wychodzi `ω = (−pitch, −yaw, +roll)`. Wyprowadzone z `δv = θ·a×v`; pomyłka znaku
  objawia się jako „odwrócone stery" — test 4 orientacji w frame.test.ts ma to łapać.
- **Tolerancja 0.1% w teście spadku swobodnego wymaga h0 ≥ ~500 m** — semi-implicit Euler
  ma błąd bezwzględny ½·g·dt·t (~0.41 m po 5 s @ 60 Hz); przy małym h0 błąd względny
  przekroczy próg i test będzie fałszywie czerwony. Test używa h0=1000 m.
- **Rzut ukośny mierzony z interpolacją przecięcia y=0** między tickami — bez tego błąd
  dyskretyzacji lądowania (±1 tick) zjada całą tolerancję.
- **Scratch-wektory na poziomie modułu** w integratorze (zero alokacji w hot path) —
  bezpieczne, bo symulacja jest jednowątkowa; NIE wynosić stanu między wywołaniami.
- **FixedStepLoop clampuje akumulator** (maxStepsPerFrame=10) — uśpiona karta przeglądarki
  nie wywoła spirali śmierci po wznowieniu.
- **F3 wymaga preventDefault** — w Chrome/Firefox otwiera wyszukiwanie na stronie.

## Pułapki

- `q.multiply(dq)` w three = q ⊗ dq (delta w body frame — to jest to, czego chcemy);
  `premultiply` byłoby deltą w world frame. Łatwo pomylić.
- HUD i strzałki czytają stan fizyki bezpośrednio (curr), mesh — interpolację prev/curr;
  przy 10 Hz (F4) widać różnicę i o to chodzi.

## Celowo odłożone

- `throttle`, `iasMs`, `loadFactor`, `stalled` w PlaneState są martwe do fazy 2 —
  wpisane teraz, bo definiują kontrakt typów dla faz 2–3 (schemat z fizyka-lotu.md rozdz. 3).
