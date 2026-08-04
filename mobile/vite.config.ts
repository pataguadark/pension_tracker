import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [svelte()],
  // Rutas relativas: el WebView de Android sirve desde file:// y las
  // absolutas no resuelven -con `base: '/'` la app arranca en blanco-.
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // Sin subcarpeta para los assets: el CSS queda en la raíz de dist/, al
    // mismo nivel que `fonts/` (que Vite copia desde public/). Así el
    // `url('fonts/...')` de estilo.css resuelve, y estilo.css puede seguir
    // siendo copia byte a byte del CSS del escritorio -donde el mismo
    // relativo funciona porque style.css y fonts/ son hermanos-.
    // Con el 'assets' por defecto, el CSS quedaba en dist/assets/ y las
    // cuatro fuentes daban 404 en el teléfono, en silencio.
    assetsDir: '',
  },
});
