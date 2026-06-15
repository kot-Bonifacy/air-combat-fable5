import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  // assety repo (.glb, tekstury) serwowane pod / — model ładowany w runtime
  // z '/models/...'. Patrz niezmiennik: assety żyją w assets/ (CLAUDE.md).
  publicDir: resolve(__dirname, '../../assets'),
  build: {
    rollupOptions: {
      // strony: gra offline (/), tryb online faza 8 (/online), wykresy rejestratora (/telemetry)
      input: {
        main: resolve(__dirname, 'index.html'),
        online: resolve(__dirname, 'online.html'),
        telemetry: resolve(__dirname, 'telemetry.html'),
      },
    },
  },
});
