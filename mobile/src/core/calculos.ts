/**
 * Toda la lógica de cálculo del tracker.
 *
 * Port de src/pensiontracker/services/calculation_service.py, con una
 * diferencia deliberada: acá las funciones son puras. En Python varias
 * consultan la base de datos por dentro, lo que obliga a montar una BD
 * para probarlas. Acá reciben los pagos como argumento.
 *
 * Las cadenas de descripción no se portan: son presentación y se arman
 * en la capa de interfaz.
 */

import { redondear } from './redondeo';
import type { Estado } from './tipos';

/** Determina el estado según el signo de un desbalance. */
export function estadoDe(valor: number): Estado {
  if (valor > 0) return 'EXCEDENTE';
  if (valor < 0) return 'DEUDA';
  return 'EXACTO';
}

/** Monto en pesos que corresponde pagar: factor UTM x valor de la UTM. */
export function calcularCuotaPactada(utmFactor: number, utmValor: number): number {
  if (!(utmFactor > 0)) {
    throw new Error('El factor UTM debe ser un número positivo.');
  }
  if (!(utmValor > 0)) {
    throw new Error('El valor de la UTM debe ser un número positivo.');
  }
  return redondear(utmFactor * utmValor, 2);
}

/** Desbalance de un pago individual: lo pagado menos lo pactado. */
export function calcularDesbalanceMensual(
  montoPagado: number,
  cuotaPactada: number,
): { diferencia: number; estado: Estado } {
  const diferencia = redondear(montoPagado - cuotaPactada, 2);
  return { diferencia, estado: estadoDe(diferencia) };
}
