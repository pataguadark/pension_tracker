<!--
  Banner de UTM del encabezado de registro.

  Port de templates/registro_pago.html:13-42 (el marcado y los cuatro
  estados de `utm_fuente`) más `refrescarUtm` de static/app.js:92-133 (el ↻,
  que en el escritorio pega a POST /utm/refrescar y reescribe el banner sin
  recargar la página).

  El marcado se copia de la plantilla, no se reinventa: dos mitades
  `.utm-banner-left` / `.utm-banner-right` dentro de un `.utm-banner` que es
  flex con space-between, y un botón con la clase `.utm-refresh` cuyo icono
  va en su propio `<span class="utm-refresh-icon">`. Las tres piezas las
  exige el CSS y dos de ellas solo se notan en un teléfono:
  `@media (max-width: 768px)` sube el botón a 44px táctiles por su clase
  (estilo.css:1382-1385), y la animación de carga gira el span interior
  (estilo.css:531-533). jsdom mide 1024px y no aplica ninguna @media, así
  que BannerUtm.test.ts comprueba el mecanismo, no el resultado visual.

  Lo que NO se porta de la plantilla: `data-url` y `data-csrf`. Acá no hay
  ruta HTTP ni token que enviar; el ↻ llama a `estado.refrescarUtm()`, que
  es donde vive el equivalente de la ruta.
-->
<script lang="ts" module>
  /**
   * Los mismos valores de `utm_fuente` que maneja la plantilla, más los dos
   * que en el escritorio solo existen del lado del navegador
   * (static/app.js:120-128): el refresco que respondió sin dato y el que ni
   * siquiera llegó a responder.
   */
  export type FuenteBanner =
    | 'mindicador'
    | 'base_de_datos_actual'
    | 'base_de_datos'
    | 'no_disponible'
    | 'refresco_sin_dato'
    | 'refresco_caido';
</script>

<script lang="ts">
  import type { EstadoApp } from './estado.svelte';
  import { formatearMiles } from './formulario';

  let {
    estado = null,
    alActualizarValor = null,
  }: {
    /** Null mientras la app no abrió la base: no hay nada que refrescar. */
    estado?: EstadoApp | null;
    /**
     * Se avisa con el valor nuevo tras un refresco exitoso, para que la
     * pantalla que hospeda el banner actualice su campo "Valor UTM"
     * (static/app.js:113-115 hace lo mismo sobre el input `utm_valor`).
     */
    alActualizarValor?: ((utm: number) => void) | null;
  } = $props();

  const hoy = new Date();
  const mesActual = hoy.getMonth() + 1;
  const anioActual = hoy.getFullYear();

  /**
   * Resultado del último refresco manual, o null si todavía no hubo
   * ninguno. Mientras sea null la fuente se deriva del estado, igual que
   * `registro()` la deriva de `obtener_utm_referencia` en cada GET.
   */
  let trasRefrescar = $state<FuenteBanner | null>(null);
  let refrescando = $state(false);

  const utm = $derived(estado?.utmReferencia ?? null);
  const esActual = $derived(estado?.utmReferenciaEsActual ?? false);

  const fuente = $derived<FuenteBanner>(
    trasRefrescar
    ?? (utm === null || !Number.isFinite(utm)
      ? 'no_disponible'
      : esActual ? 'base_de_datos_actual' : 'base_de_datos'),
  );

  // Misma expresión que la plantilla (registro_pago.html:15): 'mindicador' y
  // 'base_de_datos_actual' comparten el verde.
  const claseBanner = $derived(
    fuente === 'mindicador' || fuente === 'base_de_datos_actual'
      ? 'utm-ok'
      : fuente === 'base_de_datos' ? 'utm-warn' : 'utm-error',
  );

  const claseFuente = $derived(
    fuente === 'base_de_datos'
      ? 'utm-source utm-source-warn'
      : claseBanner === 'utm-error' ? 'utm-source utm-source-error' : 'utm-source',
  );

  const textoFuente = $derived(
    {
      mindicador: '● Fuente: mindicador.cl',
      base_de_datos_actual: `● UTM ${mesActual}/${anioActual} verificada`,
      base_de_datos: '● Usando UTM guardada (no es del mes actual)',
      no_disponible: '● UTM no disponible',
      refresco_sin_dato: '● No se pudo obtener la UTM',
      refresco_caido: '● Error de conexión',
    }[fuente],
  );

  /**
   * `_fmt_entero` del escritorio hace `int(n)`, o sea TRUNCA. Se replica con
   * Math.trunc, igual que la precarga del campo en Registro.svelte.
   */
  const valorFmt = $derived(
    utm !== null && Number.isFinite(utm) ? `$ ${formatearMiles(String(Math.trunc(utm)))}` : null,
  );

  /**
   * El ↻. Ni la rama de éxito ni la de fallo tocan el valor mostrado más
   * allá de lo que haga `refrescarUtm`: en el escritorio la rama de error
   * tampoco escribe `utmValor` (static/app.js:120-128), y perder la UTM
   * guardada por un fallo de red sería peor que no refrescar.
   */
  async function refrescar(): Promise<void> {
    if (!estado || refrescando) return;
    refrescando = true;
    try {
      const { ok, utm: valor } = await estado.refrescarUtm();
      if (ok && valor !== null) {
        trasRefrescar = 'mindicador';
        alActualizarValor?.(valor);
      } else {
        trasRefrescar = 'refresco_sin_dato';
      }
    } catch {
      // `refrescarUtm` solo puede lanzar si falla la ESCRITURA en la base
      // (el servicio de UTM nunca lanza). Se informa igual que el
      // escritorio informa un fetch caído, sin tocar el valor.
      trasRefrescar = 'refresco_caido';
    } finally {
      refrescando = false;
    }
  }
</script>

<div class="utm-banner {claseBanner}">
  <div class="utm-banner-left">
    <span class="utm-label">UTM {mesActual}/{anioActual}</span>
    {#if valorFmt !== null}
      <span class="utm-valor">{valorFmt}</span>
    {:else}
      <span class="utm-valor utm-nd">No disponible</span>
    {/if}
  </div>
  <div class="utm-banner-right">
    <span class={claseFuente}>{textoFuente}</span>
    <button
      type="button"
      class="utm-refresh"
      class:loading={refrescando}
      disabled={estado === null || refrescando}
      title="Obtener la UTM actual desde mindicador.cl"
      aria-label="Actualizar UTM"
      onclick={() => { void refrescar(); }}>
      <span class="utm-refresh-icon">↻</span>
    </button>
  </div>
</div>
