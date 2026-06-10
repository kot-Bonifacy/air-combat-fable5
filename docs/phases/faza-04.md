# Faza 4 — Świat minimalny: ocean + wyspa + kolizje

**Zależy od:** Faza 3
**Cel:** kontekst przestrzenny do walki (punkt odniesienia wysokości i prędkości) przy
MINIMALNYM koszcie. Teren „ładny" to faza 15 — nie tu.

## Zakres

W tej fazie:
- Arena 20×20 km: płaszczyzna oceanu + jedna wyspa (heightmap z simplex noise, seed stały)
- Wyspa: JEDEN mesh, vertex colors (plaża/trawa/skała/śnieg wg wysokości), flat shading —
  zero tekstur, zero LOD, zero splattingu
- Niebo: gradient (shader lub duża sfera) + kierunkowe światło słońca + mgła dystansowa
- Kolizja: wysokość terenu z heightmapy (bilinear) + poziom morza; zderzenie → wybuch
  (prosty particle burst) + respawn po 3 s w powietrzu
- Granice areny: ostrzeżenie HUD od 1 km do granicy, miękkie zawracanie (utrata kontroli
  na rzecz autopilota zawracającego) poza granicą
- Funkcja `terrainHeight(x, z)` w `shared` (serwer będzie jej używał od fazy 8!)

Poza zakresem: LOD, tekstury, chmury, drzewa, budynki, woda z falami. ZAPISANE w fazie 15.

## Kroki

1. `shared/src/world/terrain.ts`: heightmapa proceduralna (seed w constants), `terrainHeight()` + testy
2. Klient: mesh wyspy generowany z tej samej heightmapy, ocean, niebo, mgła
3. Kolizja w pętli fizyki (`position.y <= terrainHeight + margines` → event crash)
4. Wybuch + respawn (stan `alive/dead/respawning` w PlaneState)
5. Granice + autopilot zawracający
6. Pomiar wydajności: licznik fps w HUD dev, test na zintegrowanej grafice

## Kryteria ukończenia

- [ ] Stabilne 60 fps przy locie nad wyspą (zintegrowana grafika, 1080p)
- [ ] Lot w wodę i w górę → wybuch, respawn po 3 s, stan fizyki czysty (testy z fazy 2-3 zielone)
- [ ] `terrainHeight()` w `shared` przechodzi test zgodności: 100 losowych punktów
  identycznych z wartościami użytymi do mesha
- [ ] Wylot za granicę → ostrzeżenie, potem zawrócenie
- [ ] typecheck + test + lint zielone; commit `faza-4`; memory zapisane

## Pułapki / lekcje z opus4-7

- **TU UMARŁ POPRZEDNI PROJEKT.** Faza 6 opus4-7 (LOD+splatting+chmury) okazała się bagnem.
  Ta faza ma timebox: jeśli coś z zakresu nie mieści się w jednej sesji — wycinaj do fazy 15,
  nie przedłużaj
- Heightmapa licząca się w `shared` musi być tania (serwer wywoła ją do kolizji botów) —
  prekomputowana siatka + bilinear zamiast liczenia noise per zapytanie
- Mgła dystansowa maskuje brak LOD — to feature, nie oszustwo

## Wynik (uzupełnić po zakończeniu)

—
