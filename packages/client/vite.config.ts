import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Three pages: the game (index.html), the content editor (editor.html) and the
// model viewer (models.html). All
// are served by the same dev server; /ws and /dev are proxied to the Bun server.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/ws': { target: 'ws://localhost:3000', ws: true },
      '/dev': { target: 'http://localhost:3000' },
    },
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        editor: resolve(import.meta.dirname, 'editor.html'),
        models: resolve(import.meta.dirname, 'models.html'),
      },
    },
  },
});
