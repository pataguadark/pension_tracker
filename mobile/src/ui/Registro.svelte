<!--
  Pantalla de registro de un pago.

  Port de templates/registro_pago.html y de las dos mitades de
  routes/pagos.py que la sirven: `registro()` (precarga) y `registro_post()`
  (guardado, mensaje y redirección al historial).

  Los seis campos y el preview vienen enteros de FormularioPago.svelte; acá
  van solo el encabezado, la precarga y qué hacer con los valores validados.

  El banner de UTM (registro_pago.html:13-42) sí va, en BannerUtm.svelte,
  con su ↻ contra mindicador.cl.

  Diferencia deliberada que QUEDA con el escritorio: no se portan los otros
  dos botones de acción del formulario —el ★ de "guardar factor
  predeterminado" (líneas 64-70) y el 🔗 de "vincular UTM al mes" (líneas
  88-95)—, que dependen de escribir en `configuracion` y de la ruta
  `utm.utm_historico`. El factor predeterminado SÍ se lee: si el escritorio
  lo dejó guardado en la base compartida, el teléfono lo respeta aunque
  todavía no pueda escribirlo.
-->
<script lang="ts">
  import { fmtFactor } from '../core/formatters';
  import BannerUtm from './BannerUtm.svelte';
  import type { EstadoApp } from './estado.svelte';
  import { descripcionDesbalanceMes } from './formato';
  import { formatearMiles, type CamposFormulario, type ValoresFormulario } from './formulario';
  import FormularioPago from './FormularioPago.svelte';
  import { mensajes } from './mensajes.svelte';

  let {
    estado = null,
    alVolver,
  }: {
    /**
     * Null mientras la app todavía no abrió la base: el formulario se ve
     * igual, sin precarga, y al enviar avisa en vez de fingir que guardó.
     */
    estado?: EstadoApp | null;
    /** Se llama tras guardar: la app vuelve al historial, como el redirect. */
    alVolver: () => void;
  } = $props();

  /** Fecha de hoy en YYYY-MM-DD local, igual que `date.today()` en Python. */
  function fechaHoy(hoy: Date): string {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${hoy.getFullYear()}-${p(hoy.getMonth() + 1)}-${p(hoy.getDate())}`;
  }

  /**
   * Precarga de `registro()`: factor (predeterminado o último usado) y UTM
   * de referencia, con el mes y el año de hoy.
   *
   * `_fmt_entero` del escritorio hace `int(n)`, o sea TRUNCA; se replica con
   * Math.trunc en vez de redondear. Un valor no finito guardado por una
   * versión vieja se trata como ausente, no como texto basura en el campo.
   */
  function camposIniciales(): CamposFormulario {
    const hoy = new Date();
    const utm = estado?.utmReferencia ?? null;
    const factor = estado?.factorPrecargado ?? null;
    return {
      factor: factor !== null && Number.isFinite(factor) ? fmtFactor(factor) : '',
      utmValor: utm !== null && Number.isFinite(utm) ? formatearMiles(String(Math.trunc(utm))) : '',
      montoPagado: '',
      mesPago: String(hoy.getMonth() + 1),
      anioPago: String(hoy.getFullYear()),
      fecha: fechaHoy(hoy),
    };
  }

  // Se calcula una sola vez, al montar. El escritorio hace lo mismo: la
  // precarga es lo que trae el GET, y a partir de ahí manda lo que el
  // usuario teclee. Recalcularla con $derived pisaría lo tecleado cada vez
  // que EstadoApp se recargara.
  let campos = $state<CamposFormulario>(camposIniciales());

  /**
   * Refrescar la UTM desde el banner también reescribe el campo "Valor UTM",
   * igual que static/app.js:113-115. Si el campo se quedara con el valor
   * viejo, el banner mostraría una UTM y el pago se guardaría con otra.
   *
   * Se reasigna el objeto entero por gusto, no por necesidad: `campos` es
   * `$state` sobre un objeto literal, así que Svelte 5 lo envuelve en un
   * proxy profundo y `campos.utmValor = ...` reaccionaría igual (se
   * comprobó mutando esta línea: la suite sigue en verde con las dos
   * formas). La regla de "hay que reasignar" vale para objetos planos que
   * NO pasaron por `$state`, que no es el caso acá.
   */
  function utmRefrescada(utm: number): void {
    campos = { ...campos, utmValor: formatearMiles(String(Math.trunc(utm))) };
  }

  /**
   * Equivalente de `registro_post`: guarda, avisa y vuelve al historial.
   *
   * El try/except del escritorio se conserva tal cual: si el guardado
   * revienta, se avisa y NO se vuelve al historial, para que el usuario no
   * crea que el pago quedó registrado.
   */
  async function guardar(valores: ValoresFormulario): Promise<void> {
    if (!estado) {
      mensajes.agregar('Error al procesar el pago: la base de datos no está abierta.', 'error');
      return;
    }
    try {
      const { desbalance } = await estado.registrarPago(valores);
      mensajes.agregar(
        `✅ Pago registrado correctamente. ${descripcionDesbalanceMes(desbalance)}`,
        'exito',
      );
      alVolver();
    } catch (e) {
      mensajes.agregar(
        `Error al procesar el pago: ${e instanceof Error ? e.message : String(e)}`,
        'error',
      );
    }
  }
</script>

<div class="page-registro">

  <div class="page-header">
    <h1 class="page-title">Registrar Pago</h1>
    <p class="page-subtitle">Ingresa los datos del pago mensual de pensión.</p>
  </div>

  <BannerUtm {estado} alActualizarValor={utmRefrescada} />

  <FormularioPago bind:campos alEnviar={(v) => { void guardar(v); }} />
</div>
