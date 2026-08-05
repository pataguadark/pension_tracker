<!--
  Las cuatro tarjetas de resumen del historial.

  Port del bloque `{% if resumen and resumen.cantidad_pagos %}` de
  templates/historial.html. Quien decide si se muestran o no es Historial.svelte,
  igual que en el escritorio: con cero pagos NO se muestra ninguna (cuatro
  tarjetas en cero donde el computador no muestra nada sería una divergencia
  visible de inmediato).
-->
<script lang="ts">
  import { estadoDe, type calcularDesbalanceAcumuladoUtm, type resumirEstadoCuenta } from '../core/calculos';
  import { formatearPesos } from '../core/formatters';
  import { claseEstadoCard, montoConSigno } from './formato';

  type Resumen = ReturnType<typeof resumirEstadoCuenta>;
  type ResumenUtm = ReturnType<typeof calcularDesbalanceAcumuladoUtm>;

  let {
    resumen,
    resumenUtm,
    modo,
    alAlternar,
  }: {
    resumen: Resumen;
    resumenUtm: ResumenUtm | null;
    modo: 'valor' | 'utm';
    alAlternar: () => void;
  } = $props();

  const d = $derived(resumen.desbalanceAcumulado);
  /** El desbalance ajustado por UTM, o null si no hubo UTM de referencia. */
  const dUtm = $derived(resumenUtm?.desbalanceAjustado ?? null);

  const claseEstadoValor = $derived(claseEstadoCard(estadoDe(d)));
  const claseEstadoUtm = $derived(
    dUtm !== null && resumenUtm ? claseEstadoCard(resumenUtm.estado) : '',
  );
  /**
   * La tarjeta se recolorea al alternar porque el estado puede diferir entre
   * los dos modos (toggleModoDesbalance() en static/app.js hace lo mismo
   * quitando y poniendo la clase a mano).
   */
  const claseEstado = $derived(modo === 'utm' && claseEstadoUtm ? claseEstadoUtm : claseEstadoValor);
</script>

<div class="resumen-grid">
  <div class="resumen-card">
    <span class="resumen-label">Pagos registrados</span>
    <span class="resumen-valor">{resumen.cantidadPagos}</span>
  </div>

  <div class="resumen-card">
    <span class="resumen-label">Total pagado</span>
    <span class="resumen-valor">{formatearPesos(resumen.totalPagado)}</span>
  </div>

  <div class="resumen-card">
    <span class="resumen-label">Total pactado</span>
    <span class="resumen-valor">{formatearPesos(resumen.totalPactado)}</span>
  </div>

  <div
    class="resumen-card resumen-card-estado {claseEstado}"
    id="cardDesbalance"
    data-estado-valor={claseEstadoValor}
    data-estado-utm={claseEstadoUtm}>
    <div class="resumen-card-header">
      <span class="resumen-label">Desbalance acumulado</span>
      {#if dUtm !== null}
        <button
          type="button"
          class="desbalance-toggle"
          title="Alternar entre Valor y Valor UTM"
          aria-label="Cambiar tipo de cálculo del desbalance"
          onclick={alAlternar}>⇄</button>
      {/if}
    </div>
    <span class="resumen-valor valor-precio">{montoConSigno(d)}</span>
    <span class="resumen-estado valor-precio">{estadoDe(d)} NOMINAL</span>
    {#if dUtm !== null && resumenUtm}
      <span class="resumen-valor valor-utm">{montoConSigno(dUtm)}</span>
      <span class="resumen-estado valor-utm">{resumenUtm.estado} AJUSTADO UTM</span>
    {/if}
    <span class="resumen-legend valor-precio">
      Suma de las diferencias mes a mes, cada una calculada con la UTM vigente en su propio mes.
    </span>
    {#if dUtm !== null}
      <span class="resumen-legend valor-utm">
        Convierte cada diferencia a UTM y las suma; el total se expresa en pesos a la UTM vigente hoy
        — así calculan los Tribunales de Familia.
      </span>
    {:else}
      <span class="resumen-legend resumen-legend-warn">
        No se pudo calcular el valor UTM: no hay una UTM de referencia disponible.
      </span>
    {/if}
  </div>
</div>
