<!--
  La tabla del historial.

  Port del bloque `<table class="tabla-pagos">` de templates/historial.html.

  Los `data-label` de cada celda NO son decorativos: bajo 768px el CSS oculta
  el <thead> y pinta el nombre del campo con
  `.tabla-pagos td[data-label]::before { content: attr(data-label) }`. Sin
  ellos, en el teléfono —que es el único lugar donde corre esta app— queda una
  columna de cifras sin ninguna etiqueta. jsdom no aplica media queries, así
  que solo una prueba que mire los atributos puede protegerlos.
-->
<script lang="ts">
  import { contarPorPeriodo, clavePeriodo } from '../core/agrupacion';
  import { factorDePagoTolerante, type FilaHistorial } from '../core/calculos';
  import { fmtFactor, formatearPesos } from '../core/formatters';
  import { claseSigno, etiquetaPeriodo, montoConSigno } from './formato';

  let {
    filas,
    alEditar = null,
    alEliminar = null,
  }: {
    filas: FilaHistorial[];
    /** Recibe el id de la BD del pago, no el número que se ve en la columna. */
    alEditar?: ((id: number) => void) | null;
    alEliminar?: ((id: number) => void) | null;
  } = $props();

  /**
   * El conteo se hace sobre las filas que se están mostrando (las del año
   * filtrado, si hay filtro), igual que la plantilla del escritorio, que
   * itera sobre el mismo `pagos` que después pinta.
   */
  const conteo = $derived(contarPorPeriodo(filas));

  const cuantos = (f: FilaHistorial) => conteo.get(clavePeriodo(f.anioPago, f.mesPago)) ?? 1;
</script>

<div class="tabla-wrapper">
  <table class="tabla-pagos">
    <thead>
      <tr>
        <th>#</th>
        <th>Período</th>
        <th>Fecha reg.</th>
        <th>Factor UTM</th>
        <th>UTM en $</th>
        <th>Cuota pactada</th>
        <th>Pagado</th>
        <th>Diferencia mes</th>
        <th>Saldo corrido</th>
        <!-- Vacío, sobre la columna de acciones: igual que historial.html:104. -->
        <th></th>
      </tr>
    </thead>
    <tbody>
      {#each filas as fila, i (fila.id ?? i)}
        {@const multiples = cuantos(fila) > 1}
        {@const factor = factorDePagoTolerante(fila)}
        <tr class="fila-pago {multiples ? 'fila-multipago' : ''}">
          <!--
            Numeración DESCENDENTE (`total_filas - loop.index0` en el
            escritorio): la fila de arriba, la más reciente, lleva el número
            mayor. No es el id de la base.
          -->
          <td class="td-id" data-label="N°">{filas.length - i}</td>
          <td class="td-periodo" data-label="Período">
            {etiquetaPeriodo(fila.anioPago, fila.mesPago)}
            {#if multiples}
              <span class="badge-multipago" title="Este mes tiene {cuantos(fila)} pagos registrados"
                >×{cuantos(fila)}</span>
            {/if}
          </td>
          <td class="td-fecha" data-label="Fecha reg.">{fila.fecha}</td>
          <td class="td-mono td-factor" data-label="Factor UTM">
            {factor ? fmtFactor(factor) : '—'}
          </td>
          <td class="td-mono" data-label="UTM en $">{formatearPesos(fila.utmValor)}</td>
          <td class="td-mono" data-label="Cuota pactada">{formatearPesos(fila.cuotaPactada)}</td>
          <td class="td-mono td-pagado" data-label="Pagado">{formatearPesos(fila.montoPagado)}</td>
          <td class="td-mono" data-label="Diferencia mes">
            <span class="valor-precio {claseSigno(fila.desbalance)}"
              >{montoConSigno(fila.desbalance)}</span>
            {#if fila.desbalanceUtmMesPesos !== null}
              <span class="valor-utm {claseSigno(fila.desbalanceUtmMesPesos)}"
                >{montoConSigno(fila.desbalanceUtmMesPesos)}</span>
            {/if}
          </td>
          <td class="td-mono td-corrido" data-label="Saldo corrido">
            <span class="valor-precio {claseSigno(fila.desbalanceCorrido)}"
              >{montoConSigno(fila.desbalanceCorrido)}</span>
            {#if fila.desbalanceUtmCorridoPesos !== null}
              <span class="valor-utm {claseSigno(fila.desbalanceUtmCorridoPesos)}"
                >{montoConSigno(fila.desbalanceUtmCorridoPesos)}</span>
            {/if}
          </td>
          <!--
            Acciones de la fila (historial.html:199-206). Sin data-label a
            propósito: el escritorio tampoco se lo pone, y bajo 768px el CSS
            alinea esta celda a la derecha con `.td-acciones` y le da 44px de
            lado a cada botón.

            El escritorio envía el borrado con un <form> POST y confirma en
            `[data-confirm]`; acá no hay servidor, así que el botón llama
            directo y la confirmación la pide Historial.svelte, que es quien
            tiene el estado. La clase `.btn-eliminar` se conserva porque es
            la que lleva la regla de los 44px.
          -->
          <td class="td-acciones">
            {#if fila.id != null}
              <a
                href="#editar-{fila.id}"
                class="btn-editar"
                title="Editar pago"
                aria-label="Editar pago #{fila.id}"
                onclick={(e) => { e.preventDefault(); alEditar?.(fila.id as number); }}>✎</a>
              <button
                type="button"
                class="btn-eliminar"
                title="Eliminar pago"
                aria-label="Eliminar pago #{fila.id}"
                onclick={() => alEliminar?.(fila.id as number)}>✕</button>
            {/if}
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>
