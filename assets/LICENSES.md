# Licencje assetów

Każdy asset CC-BY (lub inny wymagający atrybucji) MUSI mieć tu wpis **w tym samym commicie**,
w którym trafia do repo (niezmiennik nr 8 z CLAUDE.md).

| Plik w `assets/` | Nazwa / autor | Źródło (URL) | Licencja | Zmiany |
| ---------------- | ------------- | ------------ | -------- | ------ |
| `models/spitfire/` | Supermarine Spitfire Mk.IIa / barking_dogo | https://sketchfab.com/3d-models/supermarine-spitfire-mkiia-a49be5ab6d624e75b55231948a31b1b3 | CC-BY 4.0 | auto-skala do rozpiętości i reorientacja osi przy imporcie (kod, nie plik) |
| `models/bf109/` | Messerschmitt BF 109 / Jankenstein | https://sketchfab.com/3d-models/messerschmitt-bf-109-5a14d8cc4ee14c9bbd5ba13a38f44f44 | CC-BY 4.0 | optymalizacja do `bf109-web.glb` (2,72 MB); auto-skala do rozpiętości i reorientacja osi przy imporcie (faza 19b) |
| `dogfight-splash.jpg` | Grafika promo „Dogfight" / Tatanga (własna) | — (materiał projektu) | własny (©, all rights reserved) | tło ekranu poczekalni lobby (faza 10) |
| `draco/` | Dekoder Draco / Google | https://github.com/google/draco | Apache-2.0 | bez zmian; skopiowane z `three` (`examples/jsm/libs/draco/gltf/`) do dekompresji `bf109-web.glb`; odświeżać po bumpie `three` (patrz `assets/draco/README.md`) |
| `textures/waternormals.jpg` | Mapa normalnych wody / projekt three.js | https://github.com/mrdoob/three.js/blob/master/examples/textures/waternormals.jpg | MIT (three.js) | bez zmian; własny shader wody (faza 20, scroll normalnej + odbicie nieba, BEZ planar reflection) |
| `textures/lensflare0.png` | Tarcza lens flare / projekt three.js | https://github.com/mrdoob/three.js/blob/master/examples/textures/lensflare/lensflare0.png | MIT (three.js) | bez zmian; efekt słońca (faza 20, addon `Lensflare`) |
| `textures/lensflare3.png` | Duchy lens flare / projekt three.js | https://github.com/mrdoob/three.js/blob/master/examples/textures/lensflare/lensflare3.png | MIT (three.js) | bez zmian; efekt słońca (faza 20, addon `Lensflare`) |
| `textures/terrain/grass.jpg` | Rocky Terrain 02 / Polyhaven | https://polyhaven.com/a/rocky_terrain_02 | CC0 (atrybucja niewymagana) | bez zmian (plik); 2K; tekstura terenu (triplanar — zielona łąka górska; doszlif 2026-06-21, zastąpił `leafy_grass`) |
| `textures/terrain/rock.jpg` | Gray Rocks / Polyhaven | https://polyhaven.com/a/gray_rocks | CC0 (atrybucja niewymagana) | bez zmian (plik); 2K; tekstura terenu (triplanar — szary alpejski piarg; zastąpił brązowy `rock_face_03` 2026-06-22, by góra wyglądała naturalniej) |
| `models/fir/fir-web.glb` | Fir Tree 01 / Polyhaven | https://polyhaven.com/a/fir_tree_01 | CC0 (atrybucja niewymagana) | odchudzony z oryginału (skan 478 MB, ~7 mln tr.) do ~4,1 MB: gltf-transform simplify ~1% + tekstury 1024 px WebP q92 + Draco; las mieszany instancingowany na zboczach (doszlif 2026-06-22) |
| `models/pine/pine-web.glb` | Pine Tree 01 / Polyhaven | https://polyhaven.com/a/pine_tree_01 | CC0 (atrybucja niewymagana) | odchudzony z oryginału (skan 905 MB) do ~4,8 MB: gltf-transform simplify + tekstury 1024 px WebP q92 + Draco; las mieszany (doszlif 2026-06-22) |
| `models/broadleaf/broadleaf-web.glb` | Tree Small 02 / Polyhaven | https://polyhaven.com/a/tree_small_02 | CC0 (atrybucja niewymagana) | odchudzony z oryginału (skan 91 MB) do ~2,3 MB: gltf-transform simplify + tekstury 1024 px WebP q92 + Draco; las mieszany (doszlif 2026-06-22) |
| `textures/terrain/snow.jpg` | Snow 02 / Polyhaven | https://polyhaven.com/a/snow_02 | CC0 (atrybucja niewymagana) | bez zmian (plik); podbicie 1K→2K (doszlif 2026-06-21); tekstura terenu (triplanar — śnieg) |
| `textures/terrain/sand.jpg` | Aerial Beach 01 / Polyhaven | https://polyhaven.com/a/aerial_beach_01 | CC0 (atrybucja niewymagana) | bez zmian (plik); 2K; tekstura terenu (triplanar — plaża z góry; ocieplana w shaderze; doszlif 2026-06-21, zastąpił `sand_01`) |

## Pełne uznania autorstwa (formuła wymagana przez autora)

**`models/spitfire/`** — model 3D Spitfire'a:

> This work is based on "Supermarine Spitfire Mk.IIa"
> (https://sketchfab.com/3d-models/supermarine-spitfire-mkiia-a49be5ab6d624e75b55231948a31b1b3)
> by barking_dogo (https://sketchfab.com/barking_dogo)
> licensed under CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)

Oryginał formuły i licencji: `assets/models/spitfire/license.txt`.

**`models/bf109/`** — model 3D Messerschmitta Bf 109 (drugi samolot, faza 19b):

> This work is based on "Messerschmitt BF 109"
> (https://sketchfab.com/3d-models/messerschmitt-bf-109-5a14d8cc4ee14c9bbd5ba13a38f44f44)
> by Jankenstein (https://sketchfab.com/Jankenstein)
> licensed under CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)

Oryginał formuły i licencji: `assets/models/bf109/license.txt`. Atrybucja widoczna też na ekranie
wejściowym lobby (wymóg CC-BY przy publicznym deployu).
