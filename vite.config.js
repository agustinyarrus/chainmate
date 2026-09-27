import { defineConfig } from 'vite';
import { resolve } from 'node:path';

const root = import.meta.dirname;

export default defineConfig({
  base: './',
  server: { host: '127.0.0.1', port: 5190, strictPort: true },
  // HarfBuzz finds its .wasm next to its own module (new URL(…, import.meta.url)): keep it unbundled.
  optimizeDeps: { exclude: ['harfbuzzjs'] },
  preview: { host: '127.0.0.1', port: 4190, strictPort: true },
  build: {
    target: 'es2022',
    outDir: 'dist',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 2048,
    rollupOptions: {
      input: {
        main: resolve(root, 'index.html'),
        smoke: resolve(root, 'smoke.html'),
      },
    },
  },
});
