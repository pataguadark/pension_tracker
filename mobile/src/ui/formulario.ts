/**
 * Lógica del formulario de pago (registro y edición): formateo mientras se
 * teclea, preview en vivo y validación antes de guardar.
 *
 * Port de tres piezas del escritorio que en el móvil van juntas porque no
 * hay servidor: `formatearMiles`/`formatearFactor`/`calcularPreview` de
 * `static/app.js`, y `_validar_formulario_pago` de `routes/pagos.py`. Es
 * lógica pura, sin componentes ni DOM: los componentes la consumen después.
 *
 * El parseo de números NO se reimplementa acá: se delega en
 * `limpiarFactor`/`limpiarEntero` de `core/formatters`, que ya están
 * portados y probados contra las fixtures compartidas con Python.
 */

import { calcularCuotaPactada, estadoDe } from '../core/calculos';
import { formatearPesos, limpiarEntero, limpiarFactor } from '../core/formatters';
import type { Estado } from '../core/tipos';

/**
 * Deja solo dígitos y los agrupa de a tres con punto, como
 * `Number(...).toLocaleString('es-CL')` en el escritorio. Vacío si no
 * queda ningún dígito.
 */
export function formatearMiles(texto: string): string {
  const soloDigitos = texto.replace(/\D/g, '');
  if (soloDigitos === '') {
    return '';
  }
  return Number(soloDigitos).toLocaleString('es-CL');
}

/**
 * Normaliza lo que se teclea en el campo de factor UTM: acepta punto
 * además de coma (en los teclados decimales de celular el punto suele ser
 * lo único disponible) y lo convierte a coma, el separador chileno.
 *
 * Con varios separadores el último manda (los anteriores eran de miles),
 * salvo que el último quede vacío, en cuyo caso se ignora. Corta a un
 * máximo de 4 decimales. Réplica literal de `formatearFactor` de
 * `static/app.js`, sin la parte que toca el DOM.
 */
export function formatearFactorTecleado(texto: string): string {
  let val = texto.replace(/[^0-9.,]/g, '').replace(/\./g, ',');

  const partes = val.split(',');
  if (partes.length > 2) {
    if (partes[partes.length - 1] === '') {
      // Separador suelto al final: se ignora y el primero pasa a ser el
      // decimal. Al teclear nunca hay más de una coma, así que este caso
      // solo se alcanza pegando texto con varios separadores.
      val = `${partes[0]},${partes.slice(1).join('')}`;
    } else {
      val = `${partes.slice(0, -1).join('')},${partes[partes.length - 1]}`;
    }
  }

  const [entero, decimales] = val.split(',');
  if (decimales !== undefined && decimales.length > 4) {
    val = `${entero},${decimales.slice(0, 4)}`;
  }

  return val;
}

export interface CamposPreview {
  factor: string;
  utmValor: string;
  montoPagado: string;
}

export interface ResultadoPreview {
  cuota: string;
  pagado: string;
  diferencia: string;
  estado: Estado | null;
}

const GUION = '—';

/** Intenta limpiar un factor; cualquier entrada inválida cuenta como 0. */
function factorOCero(texto: string): number {
  try {
    return limpiarFactor(texto);
  } catch {
    return 0;
  }
}

/** Intenta limpiar un entero; cualquier entrada inválida cuenta como 0. */
function enteroOCero(texto: string): number {
  try {
    return limpiarEntero(texto);
  } catch {
    return 0;
  }
}

/**
 * Preview en vivo de un pago, igual que `calcularPreview()` de
 * `static/app.js` pero devolviendo los textos en vez de escribirlos en el
 * DOM.
 *
 * Todo queda en "—" mientras el factor o la UTM no sean positivos. El
 * monto pagado se muestra "—" mientras sea 0, pero la cuota se calcula
 * igual: sirve para previsualizar antes de teclear el pago.
 *
 * La diferencia lleva el signo ANTES del "$" ("+$20.000", "-$80.000"), y
 * a diferencia de `montoConSigno()` de `ui/formato.ts` un empate exacto
 * también lleva "+" ("+$0"): así lo escribe `app.js`
 * (`(diff >= 0 ? '+' : '') + fmtPesos(diff)`), y `montoConSigno()` no sirve
 * acá porque para un monto en cero no antepone signo (ver su propio test).
 */
export function calcularPreview(campos: CamposPreview): ResultadoPreview {
  const factor = factorOCero(campos.factor);
  const utm = enteroOCero(campos.utmValor);
  const pagado = enteroOCero(campos.montoPagado);

  if (!(factor > 0) || !(utm > 0)) {
    return {
      cuota: GUION, pagado: GUION, diferencia: GUION, estado: null,
    };
  }

  let cuota: number;
  try {
    cuota = calcularCuotaPactada(factor, utm);
  } catch {
    // Factor descomunal cuyo producto con la UTM desborda a Infinito:
    // mismo tratamiento que un factor/UTM inválidos, para no tumbar el
    // preview mientras el usuario todavía está tecleando.
    return {
      cuota: GUION, pagado: GUION, diferencia: GUION, estado: null,
    };
  }

  const cuotaTexto = formatearPesos(cuota);

  if (!(pagado > 0)) {
    return {
      cuota: cuotaTexto, pagado: GUION, diferencia: GUION, estado: null,
    };
  }

  const diferencia = pagado - cuota;
  const signo = diferencia >= 0 ? '+' : '-';
  const diferenciaTexto = `${signo}${formatearPesos(Math.abs(diferencia))}`;

  return {
    cuota: cuotaTexto,
    pagado: formatearPesos(pagado),
    diferencia: diferenciaTexto,
    estado: estadoDe(diferencia),
  };
}

export interface CamposFormulario {
  factor: string;
  utmValor: string;
  montoPagado: string;
  mesPago: string;
  anioPago: string;
  fecha: string;
}

export interface ValoresFormulario {
  utmFactor: number;
  utmValor: number;
  montoPagado: number;
  mesPago: number;
  anioPago: number;
  fecha: string;
}

export interface ResultadoValidacion {
  valores: ValoresFormulario | null;
  errores: string[];
}

/**
 * Réplica de `int()` de Python para `mes_pago`/`anio_pago`: en
 * `pagos.py` esos dos campos se parsean con `int(form.get(...))` directo,
 * no con `formatters.limpiar_entero` (eso solo se usa para utm_valor y
 * monto_pagado, que sí admiten puntos de miles). Por eso acá tampoco se
 * delega en `limpiarEntero`: admitir puntos de miles en el año o el mes
 * sería más permisivo que el escritorio.
 */
function parsearEnteroComoPython(texto: string): number {
  const limpio = texto.trim();
  if (!/^[+-]?\d+$/.test(limpio)) {
    throw new Error(`Entero inválido: ${JSON.stringify(texto)}`);
  }
  return Number(limpio);
}

/** Fecha de hoy en formato YYYY-MM-DD, en hora local (igual que Python `date.today()`). */
function fechaHoyIso(): string {
  const hoy = new Date();
  const anio = hoy.getFullYear();
  const mes = String(hoy.getMonth() + 1).padStart(2, '0');
  const dia = String(hoy.getDate()).padStart(2, '0');
  return `${anio}-${mes}-${dia}`;
}

/**
 * Valida y parsea los campos del formulario de pago, igual que
 * `_validar_formulario_pago` de `pagos.py` (registro y edición comparten
 * exactamente esta validación en el escritorio).
 *
 * Junta todos los errores en vez de parar en el primero, en el mismo
 * orden que el escritorio: factor, UTM, monto, mes, año. `valores` es
 * `null` en cuanto hay algún error; si no hay ninguno, incluye `fecha`
 * usando la de hoy cuando viene vacía (igual que `registro_post`).
 */
export function validarFormulario(campos: CamposFormulario): ResultadoValidacion {
  const errores: string[] = [];

  let utmFactor: number | null;
  try {
    utmFactor = limpiarFactor(campos.factor);
    if (!(utmFactor > 0)) {
      throw new Error('Factor no positivo');
    }
  } catch {
    errores.push('El factor UTM debe ser un número positivo (ej: 3,0561).');
    utmFactor = null;
  }

  let utmValor: number | null;
  try {
    utmValor = limpiarEntero(campos.utmValor);
    if (!(utmValor > 0)) {
      throw new Error('UTM no positiva');
    }
  } catch {
    errores.push('El valor UTM debe ser un número entero positivo (ej: 69.889).');
    utmValor = null;
  }

  // Un factor y una UTM individualmente válidos (finitos) pueden seguir
  // desbordando la cuota al multiplicarse (factor desmedido). El
  // escritorio lo rechaza dentro de calcular_cuota_pactada; acá debe
  // rechazarse antes de guardar, así que se comprueba apenas ambos
  // campos pasan su propia validación.
  if (utmFactor !== null && utmValor !== null) {
    try {
      calcularCuotaPactada(utmFactor, utmValor);
    } catch {
      // Literal del escritorio: calculation_service.calcular_cuota_pactada
      // lanza este mismo texto, y registro_post lo muestra al usuario.
      // No culpa al factor porque el desborde puede venir de cualquiera
      // de los dos operandos.
      errores.push('La cuota pactada calculada no es un valor finito.');
      utmFactor = null;
    }
  }

  let montoPagado: number | null;
  try {
    montoPagado = limpiarEntero(campos.montoPagado);
    if (montoPagado < 0) {
      throw new Error('Monto negativo');
    }
  } catch {
    errores.push('El monto pagado debe ser un número entero positivo.');
    montoPagado = null;
  }

  let mesPago: number | null;
  try {
    mesPago = parsearEnteroComoPython(campos.mesPago);
    if (!(mesPago >= 1 && mesPago <= 12)) {
      throw new Error('Mes fuera de rango');
    }
  } catch {
    errores.push('El mes debe ser un número entre 1 y 12.');
    mesPago = null;
  }

  let anioPago: number | null;
  try {
    anioPago = parsearEnteroComoPython(campos.anioPago);
    if (anioPago < 2000) {
      throw new Error('Año anterior a 2000');
    }
  } catch {
    errores.push('El año debe ser un número válido (ej: 2024).');
    anioPago = null;
  }

  if (errores.length > 0) {
    return { valores: null, errores };
  }

  return {
    valores: {
      utmFactor: utmFactor as number,
      utmValor: utmValor as number,
      montoPagado: montoPagado as number,
      mesPago: mesPago as number,
      anioPago: anioPago as number,
      fecha: campos.fecha || fechaHoyIso(),
    },
    errores: [],
  };
}
