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
| `textures/terrain/grass.jpg` | Leafy Grass / Polyhaven | https://polyhaven.com/a/leafy_grass | CC0 (atrybucja niewymagana) | bez zmian; tekstura terenu (faza 20, triplanar — trawa) |
| `textures/terrain/rock.jpg` | Rock Face 03 / Polyhaven | https://polyhaven.com/a/rock_face_03 | CC0 (atrybucja niewymagana) | bez zmian; tekstura terenu (faza 20, triplanar — skała/klify) |
| `textures/terrain/snow.jpg` | Snow 02 / Polyhaven | https://polyhaven.com/a/snow_02 | CC0 (atrybucja niewymagana) | bez zmian; tekstura terenu (faza 20, triplanar — śnieg) |
| `textures/terrain/sand.jpg` | Coast Sand 05 / Polyhaven | https://polyhaven.com/a/coast_sand_05 | CC0 (atrybucja niewymagana) | bez zmian; tekstura terenu (faza 20, triplanar — plaża) |

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
