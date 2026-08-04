// Configuración de Svelte, separada de vite.config.ts porque `svelte-check`
// la lee desde acá: sin este archivo no encuentra el preprocesador y no puede
// verificar los componentes -falla con "No Svelte configuration found".
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

export default {
  // Habilita TypeScript dentro de los bloques <script lang="ts">.
  preprocess: vitePreprocess(),
};
