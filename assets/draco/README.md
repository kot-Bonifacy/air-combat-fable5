# Dekoder Draco (serwowany z `/draco/`)

`bf109-web.glb` ma geometrię spakowaną kompresją **KHR_draco_mesh_compression**
(150 MB → 2,72 MB, faza 19b). `GLTFLoader` musi mieć podpięty `DRACOLoader`, a ten
pobiera w runtime pliki dekodera spod ścieżki ustawionej `setDecoderPath('/draco/')`
(patrz `packages/client/src/plane-mesh.ts` → `makeGltfLoader`).

## Pliki

| Plik | Rola |
| ---- | ---- |
| `draco_wasm_wrapper.js` | wrapper ładujący moduł WASM |
| `draco_decoder.wasm`    | właściwy dekoder (ścieżka WASM, używana przez nowoczesne przeglądarki) |

Skopiowane z `node_modules/three/examples/jsm/libs/draco/gltf/` (build dla glTF).

## ⚠️ Sprzężenie z wersją `three`

Te pliki MUSZĄ pasować do zainstalowanej wersji `three`. **Po bumpie `three` skopiuj je
ponownie**:

```bash
cp node_modules/three/examples/jsm/libs/draco/gltf/draco_wasm_wrapper.js assets/draco/
cp node_modules/three/examples/jsm/libs/draco/gltf/draco_decoder.wasm    assets/draco/
```

## Licencja

Apache License 2.0 — Google (https://github.com/google/draco). Wpis w `assets/LICENSES.md`.
