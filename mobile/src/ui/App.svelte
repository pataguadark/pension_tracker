<script lang="ts">
  // Cáscara mínima: la etapa 2c parte 2 la reemplaza por las pantallas.
  // El bloque <script> no es decorativo — sin él, svelte-check no puede
  // tipar el componente y `npm run check` falla al importarlo desde main.ts.
  const titulo = 'Pensión Tracker';
</script>

<main class="contenedor">
  <h1>{titulo}</h1>
</main>
