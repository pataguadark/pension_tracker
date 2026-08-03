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
 * Error de validación de finitud: lo único que
 * desbalanceUtmMensualTolerante() debe tragarse (ver esa función). Una
 * clase dedicada, en vez de `Error` genérico, es lo que permite acotar
 * ese catch — de otro modo no habría forma de distinguir en runtime "un
 * dato no finito" de cualquier otro bug.
 */
class ErrorDatoNoFinito extends Error {}

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
    throw new ErrorDatoNoFinito(`${nombre} debe ser un valor finito.`);
  }
  return valor;
}

/**
 * Trata un valor no finito como una contribución nula al acumularlo.
 *
 * Antes de esta rama, calcularCuotaPactada() no comprobaba que el
 * producto utmFactor × utmValor fuera finito, así que una fila con
 * cuotaPactada infinita (y por lo tanto desbalance también infinito:
 * montoPagado - Infinity) pudo quedar persistida en una BD real. Un dato
 * ya guardado, por corrupto que sea, no debe tumbar el acumulado de las
 * demás filas (tolerar al leer) — pero tampoco debe "infectarlo" con
 * Infinity/NaN silenciosamente: sumar +Infinity una vez ya vuelve
 * infinito cualquier total futuro, y sumar +Infinity con -Infinity de
 * otra fila da NaN. Se trata como una contribución de 0 (equivalente a
 * que esa fila no aportara información al acumulado), igual criterio que
 * el lado Python (ver _finito_o_cero en calculation_service.py) y que ya
 * se usaba para utmFactor/utmValor en desbalanceUtmMensualTolerante. El
 * valor crudo de la fila (mostrado individualmente) no se toca acá.
 */
function finitoOCero(valor: number): number {
  return Number.isFinite(valor) ? valor : 0;
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
 * Igual que calcularDesbalanceUtmMensual(), pero para agregar sobre
 * MUCHAS filas ya persistidas: si una fila individual trae un
 * utmFactor/utmValor no finito (posible en datos guardados por una
 * versión anterior de la app, antes de que existiera esta validación),
 * no debe tumbar el cálculo agregado completo. Se trata esa fila como
 * si no tuviera dato UTM (null), igual que cuando falta directamente, y
 * el resto de las filas se calculan con normalidad.
 *
 * calcularDesbalanceUtmMensual() en sí sigue lanzando cuando se llama
 * directamente sobre un solo pago: eso es correcto y está cubierto por
 * las fixtures doradas (desbalance-utm.json, bloque "mensual"). Esta
 * función solo envuelve esa llamada para los dos lugares que iteran
 * sobre una lista completa de pagos (obtenerHistorialDesbalances y
 * calcularDesbalanceAcumuladoUtm), que es donde una fila corrupta no
 * debe poder tumbar la vista.
 *
 * El catch está acotado a ErrorDatoNoFinito, no es un `catch` desnudo:
 * un `catch` desnudo se traga CUALQUIER error, y en JavaScript eso es
 * más peligroso que en Python. `except ValueError` del lado Python no
 * atrapa otras excepciones (p. ej. AttributeError si `pago` no es un
 * dict) porque ValueError no es su clase base; el bug se ve. Pero en
 * JavaScript `TypeError` SÍ es subclase de `Error` (a diferencia de
 * Python, donde TypeError no es subclase de ValueError), así que ni
 * siquiera `catch (e) { if (e instanceof Error) ... }` bastaría para
 * distinguir "dato no finito" de un bug real (p. ej. una fila `null`
 * colada por error, que lanza TypeError al leer una propiedad). Por eso
 * se necesita una clase de error dedicada (ErrorDatoNoFinito) en vez de
 * apoyarse en el tipo de Error: es lo único que reproduce la misma
 * selectividad que tiene `except ValueError` en Python. Ver
 * calculos.test.ts para el caso que fija este comportamiento.
 */
function desbalanceUtmMensualTolerante(pago: Pago): number | null {
  try {
    return calcularDesbalanceUtmMensual(pago);
  } catch (error) {
    if (error instanceof ErrorDatoNoFinito) {
      return null;
    }
    throw error;
  }
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
    const diff = desbalanceUtmMensualTolerante(pago);
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
    acumuladoCorrido = redondear(acumuladoCorrido + finitoOCero(pago.desbalance), 2);

    const diffUtm = desbalanceUtmMensualTolerante(pago);
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
    pagos.reduce((suma, p) => suma + finitoOCero(p.montoPagado), 0), 2);
  const totalPactado = redondear(
    pagos.reduce((suma, p) => suma + finitoOCero(p.cuotaPactada), 0), 2);
  const desbalanceAcumulado = redondear(
    pagos.reduce((suma, p) => suma + finitoOCero(p.desbalance), 0), 2);

  return {
    cantidadPagos: pagos.length,
    totalPagado,
    totalPactado,
    desbalanceAcumulado,
    estado: estadoDe(desbalanceAcumulado),
  };
}
