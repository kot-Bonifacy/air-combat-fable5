# Faza 4 — decyzje i pułapki (świat: ocean + wyspa + kolizje)

## Decyzje użytkownika (pytania uzupełniające przed implementacją)

1. **Wyspa górzysta ze śnieżnym szczytem** (~5.5 km średnicy ekwiwalentnej, szczyt ~1140 m)
   — wyraźny landmark, pełna paleta pasm wysokości, góra zagraża w dogfightach nisko.
2. **Noise z pakietu npm `simplex-noise`** (jedyna zależność `shared` poza `three`),
   seedowany naszym `createRng` (mulberry32) — deterministyczny klient/serwer.
3. **Respawn w stałym punkcie startowym** (0, 800, −7000), nosem na wyspę;
   losowy spawn dopiero przy multiplayerze (faza 8+).

## Decyzje techniczne nieoczywiste z kodu

- **Rozstaw siatki heightmapy = 48 m (FP-dokładny: 3·2⁴), 251×251 węzłów = region 12×12 km.**
  Dzięki temu współrzędne węzłów są całkowite i `heightAt()` w węźle zwraca `===` wartość
  siatki, z której klient buduje mesh — kryterium zgodności mesh↔kolizja przechodzi bez epsilonów.
  Poza regionem teren to stałe dno (−60 m); maska wyspy wygasza noise do zera na brzegu regionu,
  więc nie ma uskoku.
- **Wysokość = SEABED + m·((CORE−SEABED)·m + AMP·fbm)**, m = smoothstep(1 − r/4000 m).
  Środek (fbm(0,0)=0) daje deterministycznie 1010 m — test szczytu nie wisi na szczęściu seeda.
- **Cykl życia w `shared/world/lifecycle.ts` tylko SYGNALIZUJE** (`crashed`/`respawnReady`),
  nie teleportuje — o miejscu respawnu decyduje właściciel stanu (teraz klient, od fazy 8 serwer).
  `respawning` to stan „czekam na autorytet", nie odliczanie.
- **Autopilot zawracający = zwykły instruktor z celem poziomym na środek areny** + histereza
  (wejście: edge < 0, wyjście: edge ≥ 500 m). W trakcie autopilota cel myszy jest trzymany
  na nosie (`alignTo` co tick), żeby oddanie sterów nie szarpnęło.
- **Kamera clampowana do powierzchni+3 m w pętli renderu** — bez tego kraksa na zboczu
  wbijała kamerę pościgową w teren (widok od środka mesha).

## Pułapki

- `noUncheckedIndexedAccess`: odczyty z `Float32Array` wymagają strażników — konwencja repo
  to `?? FALLBACK` z komentarzem „nieosiągalne" przy indeksach po clampie.
- Vitest domyślnie ukrywa `console.log` — sondy uruchamiać z `--disable-console-intercept`.
- Headless Edge (`channel: 'msedge'`) crashuje przy starcie na tej maszynie; headless
  Chrome (`channel: 'chrome'`) działa — przydatne do screenshotowej weryfikacji klienta.
- Mesh wyspy: indexed BufferGeometry + `flatShading: true` wystarcza (WebGL2 liczy normalne
  ścian w shaderze) — nie trzeba `toNonIndexed()`/`computeVertexNormals()`.

## Backlog / znane ograniczenia (zaakceptowane w timeboxie)

- Widok po kraksie na zboczu to zbliżenie skalnej ściany (kamera tuż nad powierzchnią);
  ładniejsza kamera śmierci (orbit wokół wraku) — kiedyś przy polish.
- Cząstki eksplozji to kwadraty `PointsMaterial` bez tekstury — wystarczające na fazę 4.
