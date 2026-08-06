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
    errorArranque = null,
  }: {
    vistaInicial?: Vista;
    /**
     * Lo inyecta quien abre la base de datos (main.ts). Mientras sea null el
     * historial se ve como uno sin pagos, que es lo que efectivamente hay.
     */
    estado?: EstadoApp | null;
    /**
     * Fallo al ABRIR la base: acá no hay EstadoApp que construir, así que el
     * error no puede viajar en `estado.error`. Lo pasa main.ts.
     */
    errorArranque?: string | null;
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

  /**
   * El fallo que hay que gritar: o no se pudo abrir la base, o no se
   * pudieron leer los pagos.
   *
   * Sin esto `estado.error` no se pintaba en ninguna parte y un fallo de
   * carga dejaba en pantalla el estado vacío del historial —"Sin pagos
   * registrados"—, que en una app de pensión de alimentos es el peor
   * mensaje posible: parece que se perdieron los datos. El error tapa TODAS
   * las vistas a propósito: si no se pudo leer la base, dejar el formulario
   * de registro accesible invitaría a teclear un pago que tampoco se va a
   * poder guardar.
   */
  const mensajeDeError = $derived(errorArranque ?? estado?.error ?? null);

  function reintentar(): void {
    void estado?.cargar();
  }
</script>

<div class="bg-grid"></div>
<div class="bg-glow"></div>

<Encabezado {vista} alCambiar={cambiar} />

<Mensajes />

<main class="main-content">
  {#if mensajeDeError !== null}
    <div class="flash-container">
      <div class="flash flash-error" role="alert">
        <span class="flash-icon">✕</span>
        No se pudieron cargar tus pagos: {mensajeDeError}
      </div>
    </div>
    <div class="empty-state">
      <div class="empty-icon">⚠</div>
      <p class="empty-title">Error al leer la base de datos</p>
      <p class="empty-sub">
        Tus pagos <strong>no</strong> se han perdido: esto es un problema al
        leerlos, no un historial vacío. Cierra la aplicación y vuelve a abrirla.
      </p>
      {#if estado}
        <!-- `.btn-nuevo` es la clase que el escritorio usa para el botón del
             estado vacío (estilo.css:1068); no se inventa una nueva. -->
        <button type="button" class="btn-nuevo" onclick={reintentar}>Reintentar</button>
      {/if}
    </div>
  {:else if vista === 'historial'}
    <Historial {estado} alRegistrar={() => cambiar('registro')} alEditar={editar} />
  {:else if vista === 'edicion' && pagoEnEdicion !== null}
    <!--
      Sin `{#key}`: Edicion ya repuebla sus campos al cambiar de pago porque
      su `$effect` lee `pagoId` como dependencia (Edicion.svelte:89-103), y
      además el camino que un `{#key}` protegería es inalcanzable acá.
      `alEditar` (que fija `pagoEnEdicion`) solo lo ofrece Historial, que
      solo se pinta cuando `vista === 'historial'`; para llegar del ✎ de una
      fila al ✎ de otra hay que pasar antes por `cambiar()` o
      `volverAlHistorial()`, que sueltan `pagoEnEdicion` a null y desmontan
      este componente. Nunca se pasa de un id a otro con Edicion montado.
    -->
    <Edicion {estado} pagoId={pagoEnEdicion} alVolver={volverAlHistorial} />
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
