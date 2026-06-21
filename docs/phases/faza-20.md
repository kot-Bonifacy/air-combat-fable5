# Faza 20 — Teren v2 (TWARDY TIMEBOX: jedna sesja)

**Zależy od:** Faza 19
**Cel:** ładniejszy świat bez regresji wydajności. To faza „nice to have" — gra jest już
kompletna; tu wolno TYLKO ulepszać, nigdy przebudowywać.

## ⚠️ Reguły specjalne tej fazy

Poprzedni projekt (opus4-7) umarł dokładnie na tym etapie (LOD + splatting + chmury).
Dlatego:
1. **Timebox: jedna sesja.** Co nie weszło — zostaje w backlogu bez żalu.
2. Każdy punkt zakresu to OSOBNY commit — przerwanie w dowolnym momencie zostawia projekt zdrowym.
3. Kolejność od najtańszego efektu wizualnego do najdroższego.
4. `terrainHeight()` w `shared` NIE ZMIENIA SIĘ (kolizje i boty od niej zależą) —
   upiększanie jest wyłącznie po stronie renderera.

## Zakres (w kolejności wykonywania)

1. **Tani wygrany efekt**: lepsza paleta vertex colors + delikatny noise koloru, poprawione
   światło (godzina złota), mocniejsza mgła dystansowa, prosty efekt słońca (lens flare/glow)
2. **Chmury billboardowe**: 50–150 sprite'ów na 2 warstwach wysokości (taktycznie ważne —
   można się w nich chować! widoczność encji przez chmurę ograniczona po stronie klienta)
3. **Woda v2**: normal map scrollowana + odbicie nieba (bez planar reflections!)
4. **Geometria w 2 poziomach**: pełna siatka < 8 km, rzadsza dalej (JEDEN przeskok,
   nie system LOD; granica ukryta we mgle)
5. (tylko jeśli został czas) Druga wyspa mała / skały przybrzeżne z prymitywów

Poza zakresem NA ZAWSZE w tej fazie: streaming chunków, splatting tekstur, drzewa,
chmury wolumetryczne, dynamiczna pogoda.

## Kryteria ukończenia

- [⏳] 60 fps na nowoczesnym GPU (NVIDIA RTX) — zmierzone PRZED i PO (brak regresji > 5%); cel
  sprzętowy zmieniony 2026-06-20 (porzucony budżet zintegrowanej grafiki, patrz PLAN.md ryzyko #7)
  — **pomiar po stronie usera** (brak GPU/przeglądarki w sesji); patrz „Otwarte" niżej
- [x] Zero zmian w `shared/world/terrain.ts` (git diff pusty dla tego pliku)
- [x] Wszystkie testy zielone bez modyfikacji (460/460)
- [x] Chmury: schowanie się w chmurze utrudnia namiar (znacznik HUD przygasa) — `cloudCoverAt` + `setOpacity`
- [x] Każdy podpunkt zakresu = osobny commit; sesja zakończona o czasie niezależnie od postępu
- [x] typecheck + test + lint zielone; memory zapisane (w tym: co poszło do backlogu)

## Pułapki

- Przezroczystość chmur × sortowanie = klasyczne artefakty Three.js; sprite'y sortowane
  ręcznie po dystansie albo `depthWrite: false` i akceptacja niedoskonałości
- „Jeszcze tylko dodam shadery wody" — NIE. Timebox. Backlog.

## Wynik (2026-06-21)

Zrealizowane podpunkty 1–4 z zakresu, **każdy osobnym commitem** (projekt zdrowy w każdym punkcie):

1. **Złota godzina lekka** (`eb92464`) — ocieplona paleta wyspy + deterministyczny szum jasności
   per-węzeł; ciepły horyzont/mgła (`FOG_FAR` 15→12.5 km), głębszy zenit; jedno źródło `SUN_DIR`
   dla światła kierunkowego, glow nieba i **lens flare** (addon three.js + `lensflare0/3.png`, MIT).
   Światła scentralizowane w `createWorld` (usunięte z `main.ts`/`online-main.ts`).
2. **Chmury billboardowe** (`7ee53cd`) — 130 sprite'ów (proceduralny puff w canvasie) na 2 warstwach
   (~720 m / ~1500 m), dryf wiatru z zawijaniem, `depthWrite:false`. `World.cloudCoverAt(point)` +
   `EnemyMarker.setOpacity()` → znacznik HUD przygasa, gdy cel kryje się w chmurze (oba tryby).
3. **Woda v2** (`5d94ecb`) — własny `ShaderMaterial`: `waternormals.jpg` (MIT) scrollowana w 2 warstwach,
   odbicie **analitycznego** nieba (ten sam gradient+glow co kopuła), fresnel, błysk słońca, mgła
   liniowa spójna z `scene.fog`. **BEZ planar reflection** (zakaz fazy; addon `Water` celowo pominięty).
4. **Teren w 2 poziomach gęstości** (`e5fe92b`) — `buildTerrainChunk` (podsiatka + predykat komórek):
   pełna rozdzielczość w boksie ±3.6 km (cały ląd nad wodą — wizualnie identyczny z fazą 4), rzadki
   pierścień co 5. węzeł na zewnątrz (JEDEN przeskok). Granica pod nieprzezroczystym oceanem i we
   mgle → pęknięcia niewidoczne. ~125k → ~48k trójkątów. `shared/world/terrain.ts` NIETKNIĘTY.

**Assety**: `waternormals.jpg`, `lensflare0/3.png` (three.js examples, MIT) — wpisy w `assets/LICENSES.md`
w tych samych commitach (niezmiennik #8). Chmury **proceduralne** (canvas) — bez assetu, bez ryzyka.

**Do backlogu** (świadomie, koniec timeboxu): podpunkt 5 (druga wyspa / skały przybrzeżne),
realny sprite chmur (CC0) jako swap, strojenie palety/fal po playteście — patrz PLAN.md.

**⏳ Otwarte po stronie usera** (brak GPU/przeglądarki w sesji):
- pomiar 60 fps na RTX PRZED/PO (brak regresji > 5%) — kryterium wydajności fazy;
- weryfikacja wzrokowa: złota godzina (czy planety/samoloty PBR czytelne pod ciepłym światłem —
  ambient zostawiony na 0.4, by nie rozstroić tuningu Spitfire/Bf 109), lens flare, fale wody,
  przygaszanie znacznika w chmurze, brak widocznych pęknięć terenu przy brzegu.

## Doszlif wizualny (2026-06-21, po zamknięciu fazy — 460 testów zielone)

Po playteście usera, poza timeboxem fazy (czysto kosmetyczne; `shared/world/terrain.ts` dalej NIETKNIĘTY):

1. **Tekstury terenu v3 (2K)**: trawa `leafy_grass`→`rocky_terrain_02` (zielona łąka górska), piasek
   →`aerial_beach_01` (plaża z góry, ocieplana w shaderze); skała `rock_face_03` i śnieg `snow_02`
   podbite 1K→2K. Wszystkie 2048². Wpisy w `assets/LICENSES.md` (Polyhaven CC0).
2. **Anti-tiling 3-warstwowy** (koniec „kraty" na zboczach): większy okres kafla (45–50 m zam. 18–40 m),
   druga oddalona+przesunięta skala tekstury (×0.37, offset świata), proceduralny value-noise jasności
   (period ~600/220 m, bez próbek tekstur). Zielony przefarb trawy 0.62→0.22 (nowa tekstura już zielona).
3. **Koniec migotania brzegu (z-fighting woda↔ląd)**: `logarithmicDepthBuffer: true` w obu rendererach
   (`main.ts`, `online-main.ts`) + chunki `logdepthbuf_*` wpięte w 3 własne `ShaderMaterial`
   (teren/niebo/woda — własne shadery nie dostają ich automatycznie). polygonOffset wody z powrotem 1/1.
   Sam polygonOffset (próby 2→6) NIE wystarczył — precyzja głębi przy `far 30 km`. Zweryfikowane wzrokowo (brzeg czysty).
4. **Drzewa — próbowano i odrzucono**: instancing low-poly (iglak + liściaste kępy) na zielonym pasie;
   user ocenił, że źle wygląda → USUNIĘTE. Nie wracać do tego podejścia bez nowego pomysłu (realne modele/impostory).
