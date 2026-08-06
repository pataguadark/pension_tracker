<script lang="ts" module>
  /**
   * Las tres pantallas. La de edición necesita además saber QUÉ pago se
   * está editando; ese dato NO va dentro del tipo (`{ vista: 'edicion', id }`)
   * porque el Encabezado compara `vista` con cadenas para pintar el enlace
   * activo, y un objeto lo obligaría a mirar dentro. En su lugar el id vive
   * en su propio `$state` al lado, igual que el `<int:pago_id>` del
   * escritorio viaja en la URL y no en el nombre de la vista.
   */
  export type Vista = 'historial' | 'registro' | 'edicion';
</script>

<script lang="ts">
  import Edicion from './Edicion.svelte';
  import Encabezado from './Encabezado.svelte';
  import type { EstadoApp } from './estado.svelte';
  import Historial from './Historial.svelte';
  import Mensajes from './Mensajes.svelte';
  import Registro from './Registro.svelte';

  let {
    vistaInicial = 'historial' as Vista,
    estado = null,
  }: {
    vistaInicial?: Vista;
    /**
     * Lo inyecta quien abre la base de datos (main.ts, en la etapa que
     * cablea el almacenamiento). Mientras sea null el historial se ve como
     * uno sin pagos, que es lo que efectivamente hay.
     */
    estado?: EstadoApp | null;
  } = $props();
  let vista = $state<Vista>(vistaInicial);
  /** Pago que está abierto en la pantalla de edición. */
  let pagoEnEdicion = $state<number | null>(null);

  function editar(id: number): void {
    pagoEnEdicion = id;
    vista = 'edicion';
  }

  /**
   * El menú solo ofrece 'historial' y 'registro': a 'edicion' se entra por
   * el ✎ de una fila, así que al elegir del menú se suelta el pago abierto.
   */
  function cambiar(v: Vista): void {
    pagoEnEdicion = null;
    vista = v;
  }

  function volverAlHistorial(): void {
    pagoEnEdicion = null;
    vista = 'historial';
  }
</script>

<div class="bg-grid"></div>
<div class="bg-glow"></div>

<Encabezado {vista} alCambiar={cambiar} />

<Mensajes />

<main class="main-content">
  {#if vista === 'historial'}
    <Historial {estado} alRegistrar={() => cambiar('registro')} alEditar={editar} />
  {:else if vista === 'edicion' && pagoEnEdicion !== null}
    <!--
      La clave fuerza a remontar al cambiar de pago: Edicion lee el pago una
      sola vez al abrirse, así que sin esto pasar del ✎ de una fila al de
      otra dejaría el formulario con los datos del primero.
    -->
    {#key pagoEnEdicion}
      <Edicion {estado} pagoId={pagoEnEdicion} alVolver={volverAlHistorial} />
    {/key}
  {:else}
    <Registro {estado} alVolver={volverAlHistorial} />
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
