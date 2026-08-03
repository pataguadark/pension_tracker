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
import type { Estado, Pago } from './tipos';

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

/** Factor UTM de un pago: el guardado, o derivado de cuota / valor UTM. */
export function factorDePago(pago: Pago): number | null {
  if (pago.utmFactor) {
    return pago.utmFactor;
  }
  if (pago.utmValor && pago.utmValor > 0) {
    return pago.cuotaPactada / pago.utmValor;
  }
  return null;
}

/**
 * Diferencia de un pago en unidades UTM, a la tasa de ese mes.
 * Mismo signo que el desbalance en pesos. Null si faltan datos.
 */
export function calcularDesbalanceUtmMensual(pago: Pago): number | null {
  const factor = factorDePago(pago);
  if (factor === null || !pago.utmValor) {
    return null;
  }
  return pago.montoPagado / pago.utmValor - factor;
}

/**
 * Suma las diferencias mensuales en UTM y expresa el total en pesos a
 * utmValorActual — así calculan la deuda los Tribunales de Familia.
 *
 * El ajuste en pesos se calcula sobre el total SIN redondear, para que
 * coincida centavo a centavo con la última fila del historial corrido.
 * El total en UTM se redondea a 4 decimales solo para mostrar.
 */
export function calcularDesbalanceAcumuladoUtm(
  utmValorActual: number | null,
  pagos: Pago[],
): { desbalanceAcumuladoUtm: number; desbalanceAjustado: number | null; estado: Estado } {
  let totalUtm = 0;
  for (const pago of pagos) {
    const diff = calcularDesbalanceUtmMensual(pago);
    if (diff !== null) {
      totalUtm += diff;
    }
  }

  const desbalanceAjustado = utmValorActual
    ? redondear(totalUtm * utmValorActual, 2)
    : null;

  return {
    desbalanceAcumuladoUtm: redondear(totalUtm, 4),
    desbalanceAjustado,
    estado: estadoDe(totalUtm),
  };
}
