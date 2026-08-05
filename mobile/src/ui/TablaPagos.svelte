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

  let { filas }: { filas: FilaHistorial[] } = $props();

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
        </tr>
      {/each}
    </tbody>
  </table>
</div>
