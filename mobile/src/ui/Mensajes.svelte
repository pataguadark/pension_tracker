<script lang="ts">
  import { mensajes } from './mensajes.svelte';

  const icono = { exito: '✓', error: '✕', aviso: '⚠' } as const;
  // Las clases del escritorio son flash-success / flash-error / flash-warning.
  const clase = { exito: 'success', error: 'error', aviso: 'warning' } as const;
</script>

{#if mensajes.lista.length > 0}
  <div class="flash-container">
    {#each mensajes.lista as mensaje (mensaje.id)}
      <div class="flash flash-{clase[mensaje.tipo]}">
        <span class="flash-icon">{icono[mensaje.tipo]}</span>
        {mensaje.texto}
        <button
          type="button"
          aria-label="Descartar mensaje"
          onclick={() => mensajes.descartar(mensaje.id)}>✕</button>
      </div>
    {/each}
  </div>
{/if}
