<script lang="ts" module>
  export type Vista = 'historial' | 'registro';
</script>

<script lang="ts">
  import Encabezado from './Encabezado.svelte';
  import Mensajes from './Mensajes.svelte';

  let { vistaInicial = 'historial' as Vista } = $props();
  let vista = $state<Vista>(vistaInicial);
</script>

<div class="bg-grid"></div>
<div class="bg-glow"></div>

<Encabezado {vista} alCambiar={(v) => (vista = v)} />

<Mensajes />

<main class="main-content">
  {#if vista === 'historial'}
    <p>Historial</p>
  {:else}
    <p>Registrar Pago</p>
  {/if}
</main>

<footer class="site-footer">
  <p>Pensión Tracker &mdash; uso personal &mdash; datos almacenados localmente</p>
  <p class="footer-links">
    <a href="https://github.com/pataguadark/pension_tracker" target="_blank" rel="noopener noreferrer">Código fuente</a>
    <span class="footer-sep">&middot;</span>
    <a href="https://link.mercadopago.cl/pension_tracker" target="_blank" rel="noopener noreferrer">Donar (MercadoPago)</a>
    <span class="footer-sep">&middot;</span>
    <a href="https://www.paypal.com/donate/?hosted_button_id=2PFWY58A55FQE" target="_blank" rel="noopener noreferrer">Donar (PayPal)</a>
  </p>
</footer>
