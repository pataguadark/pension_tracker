import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [svelte()],
  // Svelte publica un punto de entrada distinto para navegador y para
  // servidor. Sin esta condición, vitest toma el de servidor y los
  // componentes no reaccionan a los eventos en las pruebas.
  resolve: { conditions: ['browser'] },
  test: {
    globals: true,
    // El entorno NO se pone en jsdom globalmente: las pruebas de datos usan
    // node:sqlite y no necesitan un DOM. Cada prueba de componente declara
    // `// @vitest-environment jsdom` en su primera línea.
    setupFiles: ['src/ui/configuracion-pruebas.ts'],
    // capacitor.config.test.ts vive en la raíz de mobile/, junto al archivo
    // que prueba (capacitor.config.ts), no bajo src/.
    include: ['src/**/*.test.ts', 'capacitor.config.test.ts', 'configuracion-build.test.ts'],
  },
});
