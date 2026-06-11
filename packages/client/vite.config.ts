import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    rollupOptions: {
      // dwie strony: gra (/) i wykresy rejestratora (/telemetry)
      input: {
        main: resolve(__dirname, 'index.html'),
        telemetry: resolve(__dirname, 'telemetry.html'),
      },
    },
  },
});
