import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  // assety repo (.glb, tekstury) serwowane pod / — model ładowany w runtime
  // z '/models/...'. Patrz niezmiennik: assety żyją w assets/ (CLAUDE.md).
  // Jedyna strona to gra MP (`index.html` → `online-main.ts`); tryb SP i strona
  // telemetrii usunięte (były tylko etapem rozwoju). Vite domyślnie bierze index.html.
  publicDir: resolve(__dirname, '../../assets'),
});
