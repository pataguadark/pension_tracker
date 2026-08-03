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

/**
 * Valida un dato opcional que, de estar presente, debe ser finito.
 *
 * `null`/`undefined` se retorna tal cual: un dato ausente es legítimo
 * (ver docstrings de factorDePago / calcularDesbalanceAcumuladoUtm).
 * Pero un `NaN` o `Infinity` no es "ausente": es dato corrupto.
 * Comprobar solo con veracidad (`if (valor)`) no lo detecta porque
 * `Boolean(NaN)` es `false` en JavaScript — por eso se exige
 * Number.isFinite explícitamente, en vez de depender de la veracidad
 * como hacía el código anterior.
 */
function validarFinitoOpcional(
  valor: number | null | undefined,
  nombre: string,
): number | null | undefined {
  if (valor !== null && valor !== undefined && !Number.isFinite(valor)) {
    throw new Error(`${nombre} debe ser un valor finito.`);
  }
  return valor;
}

/** Factor UTM de un pago: el guardado, o derivado de cuota / valor UTM. */
export function factorDePago(pago: Pago): number | null {
  const utmFactor = validarFinitoOpcional(pago.utmFactor, 'El factor UTM del pago');
  if (utmFactor) {
    return utmFactor;
  }
  const utmValor = validarFinitoOpcional(pago.utmValor, 'El valor UTM del pago');
  if (utmValor && utmValor > 0) {
    return pago.cuotaPactada / utmValor;
  }
  return null;
}

/**
 * Diferencia de un pago en unidades UTM, a la tasa de ese mes.
 * Mismo signo que el desbalance en pesos. Null si faltan datos.
 */
export function calcularDesbalanceUtmMensual(pago: Pago): number | null {
  const factor = factorDePago(pago);
  const utmValor = validarFinitoOpcional(pago.utmValor, 'El valor UTM del pago');
  if (factor === null || !utmValor) {
    return null;
  }
  return pago.montoPagado / utmValor - factor;
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
  utmValorActual = validarFinitoOpcional(utmValorActual, 'El valor UTM vigente') ?? null;

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

export interface FilaHistorial extends Pago {
  desbalanceCorrido: number;
  estadoCorrido: Estado;
  desbalanceUtmMesPesos: number | null;
  desbalanceUtmCorridoPesos: number | null;
  estadoUtmMes: Estado | null;
  estadoUtmCorrido: Estado | null;
}

/**
 * Enriquece los pagos con el desbalance acumulado corrido mes a mes,
 * en pesos históricos y en UTM convertida a pesos de hoy.
 *
 * Acumula del más antiguo al más reciente y retorna del más reciente al
 * más antiguo, que es el orden en que la interfaz los muestra.
 */
export function obtenerHistorialDesbalances(
  pagos: Pago[],
  utmValorActual: number | null = null,
): FilaHistorial[] {
  const ordenados = [...pagos].sort(
    (a, b) => a.anioPago - b.anioPago || a.mesPago - b.mesPago,
  );

  let acumuladoCorrido = 0;
  let acumuladoUtmCorrido = 0;
  const historial: FilaHistorial[] = [];

  for (const pago of ordenados) {
    acumuladoCorrido = redondear(acumuladoCorrido + pago.desbalance, 2);

    const diffUtm = calcularDesbalanceUtmMensual(pago);
    if (diffUtm !== null) {
      acumuladoUtmCorrido += diffUtm;
    }

    const fila: FilaHistorial = {
      ...pago,
      desbalanceCorrido: acumuladoCorrido,
      estadoCorrido: estadoDe(acumuladoCorrido),
      desbalanceUtmMesPesos: null,
      desbalanceUtmCorridoPesos: null,
      estadoUtmMes: null,
      estadoUtmCorrido: null,
    };

    if (diffUtm !== null && utmValorActual) {
      const mesPesos = redondear(diffUtm * utmValorActual, 2);
      const corridoPesos = redondear(acumuladoUtmCorrido * utmValorActual, 2);
      fila.desbalanceUtmMesPesos = mesPesos;
      fila.desbalanceUtmCorridoPesos = corridoPesos;
      fila.estadoUtmMes = estadoDe(mesPesos);
      fila.estadoUtmCorrido = estadoDe(corridoPesos);
    }

    historial.push(fila);
  }

  return historial.reverse();
}

/** Totales y desbalance acumulado del conjunto de pagos. */
export function resumirEstadoCuenta(pagos: Pago[]): {
  cantidadPagos: number;
  totalPagado: number;
  totalPactado: number;
  desbalanceAcumulado: number;
  estado: Estado;
} {
  if (pagos.length === 0) {
    return {
      cantidadPagos: 0,
      totalPagado: 0,
      totalPactado: 0,
      desbalanceAcumulado: 0,
      estado: 'EXACTO',
    };
  }

  const totalPagado = redondear(
    pagos.reduce((suma, p) => suma + p.montoPagado, 0), 2);
  const totalPactado = redondear(
    pagos.reduce((suma, p) => suma + p.cuotaPactada, 0), 2);
  const desbalanceAcumulado = redondear(
    pagos.reduce((suma, p) => suma + p.desbalance, 0), 2);

  return {
    cantidadPagos: pagos.length,
    totalPagado,
    totalPactado,
    desbalanceAcumulado,
    estado: estadoDe(desbalanceAcumulado),
  };
}
