/**
 * Agrupación de pagos por período (año + mes).
 *
 * Port del bloque `{% set ns = namespace(conteo={}) %}` de
 * templates/historial.html, que cuenta cuántos registros hay por período
 * para decidir qué filas llevan el badge ×N. En el escritorio ese conteo
 * vive dentro de la plantilla; acá vive en el core porque es lógica, no
 * presentación, y así se puede probar sin montar la pantalla.
 */

import type { Pago } from './tipos';

/**
 * Clave de período: año y mes, con separador.
 *
 * El separador no es decorativo: sin él, `2025` + `11` y `202` + `511`
 * producirían la misma clave `202511` y dos períodos distintos se
 * contarían como uno.
 */
export function clavePeriodo(anio: number, mes: number): string {
  return `${anio}-${mes}`;
}

/**
 * Cuántos pagos hay en cada período. Alimenta el badge ×N del historial.
 *
 * Se cuenta sobre el conjunto que se está mostrando (el filtrado por año,
 * si hay filtro), igual que la plantilla del escritorio, que itera sobre
 * el mismo `pagos` que después pinta.
 */
export function contarPorPeriodo(pagos: Pago[]): Map<string, number> {
  const conteo = new Map<string, number>();
  for (const p of pagos) {
    const clave = clavePeriodo(p.anioPago, p.mesPago);
    conteo.set(clave, (conteo.get(clave) ?? 0) + 1);
  }
  return conteo;
}
