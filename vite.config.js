import { defineConfig } from 'vite';
import { resolve } from 'node:path';

const root = import.meta.dirname;
/** CHAINMATE_TARGET=android: the copy the Android wrapper ships (tools/apk.mjs) — the game page alone, beside dist/. */
const android = process.env.CHAINMATE_TARGET === 'android';

export default defineConfig({
  base: './',
  server: {
    host: '127.0.0.1',
    port: 5190,
    strictPort: true,
    // Only the game's sources change under the server. The engine sources, references, oracle dumps
    // and captures are tens of thousands of files a watcher would churn through (and the tools write
    // screenshots there while a page runs): still served, never watched.
    watch: { ignored: ['**/_build/**', '**/_ref/**', '**/_oracle/**', '**/_original/**', '**/native/**', '**/.cache/**', '**/dist/**'] },
  },
  // HarfBuzz finds its .wasm next to its own module (new URL(…, import.meta.url)): keep it unbundled.
  optimizeDeps: { exclude: ['harfbuzzjs'] },
  preview: { host: '127.0.0.1', port: 4190, strictPort: true },
  build: {
    target: 'es2022',
    outDir: android ? 'dist-android/www' : 'dist',
    emptyOutDir: true,
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 2048,
    rollupOptions: {
      input: android
        ? { main: resolve(root, 'index.html') }
        : { main: resolve(root, 'index.html'), smoke: resolve(root, 'smoke.html') },
    },
  },
});
