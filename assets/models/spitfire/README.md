# Model 3D — Supermarine Spitfire Mk.IIa

Tu trafia model wizualny samolotu gracza. **Plik modelu nie jest w repo** — trzeba go
pobrać ręcznie (Sketchfab wymaga zalogowania), a potem rozpakować tutaj.

## Wybrany model

- **Spitfire Mk.IIa** — autor `barking_dogo`
- Licencja: **CC-BY 4.0** (wymaga atrybucji — wpis już jest w `assets/LICENSES.md`)
- ~41,8k trójkątów, wariant zgodny z fizyką (`shared/src/planes/spitfire-mk2.json`)
- URL: https://sketchfab.com/3d-models/supermarine-spitfire-mkiia-a49be5ab6d624e75b55231948a31b1b3

## Jak wgrać

1. Zaloguj się na Sketchfab (darmowe konto) i na stronie modelu kliknij **Download 3D Model**.
2. Wybierz format **glTF** (autoconverted).
3. Rozpakuj ZIP **do tego katalogu**, tak aby powstał plik:
   ```
   assets/models/spitfire/scene.gltf
   assets/models/spitfire/scene.bin
   assets/models/spitfire/textures/...
   ```
   (Loader klienta domyślnie ładuje `/models/spitfire/scene.gltf`.)
4. Uruchom `npm run dev:client` i odśwież grę — bryła z prymitywów zamieni się na model.

## Jeśli model jest źle ustawiony

Skala dobiera się automatycznie (do rozpiętości skrzydeł z fizyki). Jeśli samolot
leci bokiem / tyłem / do góry nogami — popraw `MODEL_FIX_EULER_DEG`
w `packages/client/src/plane-mesh.ts` (ściąga ze stopniami jest w komentarzu).

## Pojedynczy plik .glb (opcjonalnie)

Zamiast wielu plików możesz wrzucić jeden `spitfire.glb` i ustawić `MODEL_URL`
w `plane-mesh.ts` na `'/models/spitfire.glb'`. Kompresja Draco zmniejszy rozmiar:
```
npx @gltf-transform/cli optimize scene.gltf spitfire.glb --compress draco
```
(wymaga wtedy DRACOLoader w kliencie — na razie nie skonfigurowany).
