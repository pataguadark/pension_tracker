import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [svelte()],
  // Rutas relativas: el WebView de Android sirve desde file:// y las
  // absolutas no resuelven.
  base: './',
  build: { outDir: 'dist', emptyOutDir: true },
});
