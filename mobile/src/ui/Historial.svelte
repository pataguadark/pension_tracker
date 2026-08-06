<!--
  Pantalla de historial: título, filtro por año, tarjetas de resumen y tabla.

  Port de templates/historial.html. Todo lo que se muestra sale de EstadoApp,
  que a su vez sale del core: acá no se calcula nada.

  Diferencias deliberadas con el escritorio, por alcance de esta etapa:
  - `.historial-actions` lleva solo "+ Nuevo pago": "Exportar CSV" y
    "Respaldar datos" son funciones que el móvil todavía no tiene.

  La confirmación de borrado vive acá y no en TablaPagos.svelte porque acá
  está el estado que hay que tocar. Es el equivalente del `[data-confirm]`
  de static/app.js:331-337, que en el escritorio también se engancha desde
  la página y no desde la fila.
-->
<script lang="ts">
  import type { EstadoApp } from './estado.svelte';
  import { eliminarPagoConConfirmacion } from './acciones';
  import { mensajes } from './mensajes.svelte';
  import TablaPagos from './TablaPagos.svelte';
  import TarjetasResumen from './TarjetasResumen.svelte';

  let {
    estado = null,
    alRegistrar = null,
    alEditar = null,
  }: {
    /**
     * Null mientras la app todavía no abrió la base (la conexión se cablea
     * en una etapa posterior): se ve igual que un historial sin pagos, que
     * es lo que efectivamente hay.
     */
    estado?: EstadoApp | null;
    alRegistrar?: (() => void) | null;
    /** Abre la pantalla de edición del pago cuyo id se pasa. */
    alEditar?: ((id: number) => void) | null;
  } = $props();

  const filas = $derived(estado?.filas ?? []);
  const resumen = $derived(estado?.resumen ?? null);
  const resumenUtm = $derived(estado?.resumenUtm ?? null);
  const aniosDisponibles = $derived(estado?.aniosDisponibles ?? []);
  const anioFiltro = $derived(estado?.anioFiltro ?? null);

  /**
   * Igual que `data-modo-desbalance` en el escritorio: arranca en UTM cuando
   * hay un desbalance ajustado que mostrar, y en valor cuando no lo hay.
   *
   * `$derived` y no `$state` para el arranque, más un `$state` que recuerda
   * la elección del usuario: sin esto, recalcular el resumen al filtrar por
   * año devolvería el conmutador a su posición inicial.
   */
  const hayAjustado = $derived(resumenUtm?.desbalanceAjustado != null);
  let elegido = $state<'valor' | 'utm' | null>(null);
  /**
   * Sin desbalance ajustado el modo es 'valor' pase lo que pase: el CSS
   * esconde `.valor-precio` en modo 'utm', así que quedar en 'utm' sin una
   * cifra en UTM que mostrar dejaría la tarjeta vacía.
   */
  const modo = $derived<'valor' | 'utm'>(hayAjustado ? (elegido ?? 'utm') : 'valor');

  function alternar(): void {
    elegido = modo === 'valor' ? 'utm' : 'valor';
  }

  function filtrar(anio: number | null): void {
    void estado?.filtrarPorAnio(anio);
  }

  function registrar(): void {
    alRegistrar?.();
  }

  /**
   * Port de `eliminar_pago` más la confirmación que el escritorio hace en
   * el navegador. La orquestación (comprobar el estado ANTES de confirmar,
   * confirmar, borrar, avisar) vive en `eliminarPagoConConfirmacion`
   * (formato.ts): así se puede probar el orden sin depender de un ✕ real en
   * el DOM, que con `estado` null no existe.
   */
  async function eliminar(id: number): Promise<void> {
    await eliminarPagoConConfirmacion(
      estado,
      id,
      (m) => window.confirm(m),
      (texto, tipo) => mensajes.agregar(texto, tipo),
    );
  }
</script>

<div class="page-historial" data-modo-desbalance={modo}>
  <div class="page-header page-header-row">
    <div>
      <h1 class="page-title">
        Historial
        {#if anioFiltro}<span class="page-title-anio">{anioFiltro}</span>{/if}
      </h1>
      <p class="page-subtitle">Registro completo de pagos y estado de cuenta.</p>
    </div>

    {#if aniosDisponibles.length > 0}
      <div class="year-filter">
        <!--
          Enlaces y no botones, como el escritorio, para que se vean igual.
          preventDefault() es obligatorio: acá no hay servidor al que navegar
          y un enlace suelto recargaría el WebView entero.
        -->
        <a
          href="#historial"
          class="year-btn {anioFiltro ? '' : 'active'}"
          onclick={(e) => { e.preventDefault(); filtrar(null); }}>Todos</a>
        {#each aniosDisponibles as anio (anio)}
          <a
            href="#historial-{anio}"
            class="year-btn {anioFiltro === anio ? 'active' : ''}"
            onclick={(e) => { e.preventDefault(); filtrar(anio); }}>{anio}</a>
        {/each}
      </div>
    {/if}
  </div>

  <!-- Con cero pagos el escritorio no muestra ninguna tarjeta, no cuatro en cero. -->
  {#if resumen && resumen.cantidadPagos}
    <TarjetasResumen {resumen} {resumenUtm} {modo} alAlternar={alternar} />
  {/if}

  {#if filas.length > 0}
    <TablaPagos
      {filas}
      alEditar={(id) => alEditar?.(id)}
      alEliminar={(id) => { void eliminar(id); }} />

    <div class="historial-actions">
      <a
        href="#registro"
        class="btn-nuevo"
        onclick={(e) => { e.preventDefault(); registrar(); }}>+ Nuevo pago</a>
    </div>
  {:else}
    <div class="empty-state">
      <div class="empty-icon">📋</div>
      <p class="empty-title">Sin pagos registrados</p>
      <p class="empty-sub">
        {#if anioFiltro}No hay pagos para el año {anioFiltro}.
        {:else}Aún no has registrado ningún pago.{/if}
      </p>
      <a
        href="#registro"
        class="btn-nuevo"
        onclick={(e) => { e.preventDefault(); registrar(); }}>+ Registrar primer pago</a>
    </div>
  {/if}
</div>
