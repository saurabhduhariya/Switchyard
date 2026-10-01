import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte()],
  build: {
    outDir: '../dist/webview',
    emptyOutDir: true,
    cssCodeSplit: false,
    rollupOptions: {
      input: 'src/main.ts',
      output: {
        format: 'iife',
        entryFileNames: 'main.js',
        assetFileNames: 'main[extname]',
      },
      onwarn(warning, warn) {
        // Suppress harmless EMPTY_IMPORT_META from Vite's preload helper
        if (warning.code === 'EMPTY_IMPORT_META') return;
        warn(warning);
      },
    },
  },
});
