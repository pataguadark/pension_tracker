import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    // capacitor.config.test.ts vive en la raíz de mobile/, junto al archivo
    // que prueba (capacitor.config.ts), no bajo src/.
    include: ['src/**/*.test.ts', 'capacitor.config.test.ts'],
  },
});
