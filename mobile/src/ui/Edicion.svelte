<!--
  Pantalla de edición de un pago existente.

  Port de templates/editar_pago.html y de las dos rutas que la sirven:
  `editar_pago()` (precarga, con el factor derivado cuando el pago no lo
  trae guardado) y `editar_pago_post()` (recálculo, actualización, guardado
  de la UTM del período y vuelta al historial).

  Los seis campos y el preview vienen de FormularioPago.svelte. El enlace de
  cancelar se le pasa como snippet `acciones` para que quede DENTRO de
  `.edit-actions` junto al botón de enviar, igual que en la plantilla: ese
  contenedor es el que el CSS invierte con `column-reverse` bajo 768px.
-->
<script lang="ts">
  import { fmtFactor } from '../core/formatters';
  import { redondear } from '../core/redondeo';
  import type { Pago } from '../core/tipos';
  import type { EstadoApp } from './estado.svelte';
  import { formatearMiles, type CamposFormulario, type ValoresFormulario } from './formulario';
  import FormularioPago from './FormularioPago.svelte';
  import { mensajes } from './mensajes.svelte';

  let {
    estado = null,
    pagoId,
    alVolver,
  }: {
    estado?: EstadoApp | null;
    /** Id del pago a editar, el mismo que el `<int:pago_id>` de la ruta. */
    pagoId: number;
    /** Vuelta al historial: tras guardar, al cancelar o si el pago no existe. */
    alVolver: () => void;
  } = $props();

  /** El pago tal como está en la base; sirve de respaldo para la fecha. */
  let pago = $state<Pago | null>(null);
  /**
   * `campos` arranca vacío y solo se muestra cuando `listo` pasa a true:
   * la lectura del pago es asíncrona y pintar el formulario antes dejaría
   * ver un instante de campos en blanco que no son los del pago.
   */
  let campos = $state<CamposFormulario>({
    factor: '', utmValor: '', montoPagado: '', mesPago: '1', anioPago: '', fecha: '',
  });
  let listo = $state(false);

  /**
   * Factor a mostrar: el guardado si lo hay, y si no el derivado de la
   * cuota. Literal de routes/pagos.py:234-240, incluida la comprobación por
   * veracidad (`if pago.get("utm_factor")`), que trata un 0 guardado igual
   * que un factor ausente.
   *
   * El `else` final devuelve null en vez de dividir por cero: con
   * utm_valor 0 el escritorio no calcula nada y deja el campo vacío.
   */
  function factorDeEdicion(p: Pago): number | null {
    if (p.utmFactor) {
      return redondear(p.utmFactor, 4);
    }
    if (p.utmValor && p.utmValor > 0) {
      return redondear(p.cuotaPactada / p.utmValor, 4);
    }
    return null;
  }

  /** Entero con puntos de miles, como el `"{:,.0f}"` de editar_pago.html. */
  function enteroConPuntos(n: number | null | undefined): string {
    if (!n || !Number.isFinite(n)) return '';
    return formatearMiles(String(redondear(n, 0)));
  }

  function camposDe(p: Pago): CamposFormulario {
    const factor = factorDeEdicion(p);
    return {
      factor: factor === null ? '' : fmtFactor(factor),
      utmValor: enteroConPuntos(p.utmValor),
      montoPagado: enteroConPuntos(p.montoPagado),
      mesPago: String(p.mesPago),
      anioPago: String(p.anioPago),
      fecha: p.fecha,
    };
  }

  /**
   * Equivalente del GET /editar/<id>. Un id inexistente da el mismo aviso
   * que el flash del escritorio y devuelve al historial, en vez de dejar un
   * formulario vacío que al enviarse no actualizaría nada.
   */
  $effect(() => {
    const id = pagoId;
    const app = estado;
    void (async () => {
      const encontrado = app ? await app.obtenerPago(id) : null;
      if (!encontrado) {
        mensajes.agregar(`No se encontró el pago #${id}.`, 'error');
        alVolver();
        return;
      }
      pago = encontrado;
      campos = camposDe(encontrado);
      listo = true;
    })();
  });

  /**
   * Equivalente de `editar_pago_post`. La fecha vacía cae a la del pago y
   * NO a la de hoy (`fecha = request.form.get("fecha") or pago["fecha"]`):
   * validarFormulario ya sustituyó la de hoy pensando en el registro, así
   * que acá se corrige mirando el campo en crudo.
   */
  async function guardar(valores: ValoresFormulario): Promise<void> {
    if (!estado || !pago) {
      mensajes.agregar('Error al procesar el pago: la base de datos no está abierta.', 'error');
      return;
    }
    const fecha = campos.fecha ? valores.fecha : pago.fecha;
    try {
      const actualizado = await estado.actualizarPago(pagoId, { ...valores, fecha });
      if (!actualizado) {
        mensajes.agregar(`No se encontró el pago #${pagoId}.`, 'error');
      } else {
        mensajes.agregar(`✅ Pago #${pagoId} actualizado correctamente.`, 'exito');
      }
      alVolver();
    } catch (e) {
      // Mismo try/except que editar_pago_post: un factor descomunal hace
      // que la cuota desborde y allá eso responde 302 con error, no 500.
      mensajes.agregar(
        `Error al procesar el pago: ${e instanceof Error ? e.message : String(e)}`,
        'error',
      );
    }
  }

  function cancelar(e: Event): void {
    // Obligatorio: acá no hay servidor al que navegar y un enlace suelto
    // recargaría el WebView entero (mismo motivo que en Historial.svelte).
    e.preventDefault();
    alVolver();
  }
</script>

<div class="page-registro">

  <div class="page-header">
    <h1 class="page-title">
      Editar Pago
      <span class="page-title-anio">#{pagoId}</span>
    </h1>
    <p class="page-subtitle">
      Modifica los datos del registro. El desbalance se recalcula automáticamente.
    </p>
  </div>

  {#if listo}
    <FormularioPago
      bind:campos
      alEnviar={(v) => { void guardar(v); }}
      pistaFactor="Guardado en el registro"
      pistaUtm="En pesos chilenos"
      pistaMonto="Lo que se transfirió"
      textoBoton="Guardar cambios →">
      {#snippet acciones()}
        <a href="#historial" class="btn-cancelar" onclick={cancelar}>← Cancelar</a>
      {/snippet}
    </FormularioPago>
  {/if}
</div>
