/**
 * Parsing y formateo de números en formato chileno: miles con punto,
 * decimales con coma.
 *
 * Port de src/pensiontracker/formatters.py. Debe mantenerse en paridad
 * con esa implementación; las fixtures doradas verifican ambas.
 *
 * ## Diferencias conocidas y deliberadas
 *
 * - `fmtFactor(-0)` da `"0"` aquí y `"-0"` en Python: inalcanzable en la
 *   práctica porque el factor UTM siempre se valida positivo (> 0) antes
 *   de llegar a formatearse, así que nunca se formatea un -0.
 * - `redondear(NaN)` / `redondear(Infinity)` lanzan excepción aquí,
 *   mientras que `round()` de Python los devuelve tal cual: el
 *   guardarraíl es intencional y también inalcanzable, porque
 *   `limpiarFactor` rechaza los valores no finitos antes de que lleguen
 *   a redondear.
 */

import { redondear } from './redondeo';

/**
 * Convierte texto de factor UTM a número.
 *
 * Acepta punto o coma como separador decimal: en los teclados decimales
 * de celular el punto suele ser lo único disponible.
 *
 * Regla: el último separador presente es el decimal; los anteriores son
 * separadores de miles y se descartan. Un separador final suelto se
 * ignora, porque no delimita ninguna parte decimal.
 */
export function limpiarFactor(valor: string): number {
  if (!valor) {
    throw new Error('Valor vacío');
  }

  let limpio = valor.trim();
  while (limpio.length > 0 && (limpio.endsWith('.') || limpio.endsWith(','))) {
    limpio = limpio.slice(0, -1);
  }
  if (limpio.length === 0) {
    throw new Error('Valor vacío');
  }

  const corte = Math.max(limpio.lastIndexOf('.'), limpio.lastIndexOf(','));
  let entero: string;
  let decimales: string;
  if (corte === -1) {
    entero = limpio;
    decimales = '';
  } else {
    entero = limpio.slice(0, corte);
    decimales = limpio.slice(corte + 1);
  }

  entero = entero.replaceAll('.', '').replaceAll(',', '');
  const normalizado = decimales ? `${entero}.${decimales}` : entero;

  // Number() acepta cadena vacía como 0 y tolera espacios; se exige que
  // la cadena sea exactamente un número decimal.
  if (!/^-?\d*\.?\d+$/.test(normalizado)) {
    throw new Error(`Factor UTM inválido: ${JSON.stringify(valor)}`);
  }

  const resultado = Number(normalizado);
  if (!Number.isFinite(resultado)) {
    throw new Error(`Factor UTM inválido: ${JSON.stringify(valor)}`);
  }
  return resultado;
}

/**
 * Convierte texto formateado en Chile (miles con puntos) a entero.
 * Rechaza comas: en este campo no se permiten decimales.
 */
export function limpiarEntero(valor: string): number {
  if (!valor) {
    throw new Error('Valor vacío');
  }
  const limpio = valor.trim();
  if (limpio.includes(',')) {
    throw new Error('No se permiten decimales en este campo');
  }
  const sinPuntos = limpio.replaceAll('.', '');
  if (!/^-?\d+$/.test(sinPuntos)) {
    throw new Error(`Entero inválido: ${JSON.stringify(valor)}`);
  }
  return Number(sinPuntos);
}

/** Formatea un factor UTM para mostrar: 3.0561 → '3,0561', sin ceros de más. */
export function fmtFactor(n: number | null | undefined): string {
  if (n === null || n === undefined) {
    return '';
  }
  const s = n.toFixed(4).replace('.', ',');
  return s.includes(',') ? s.replace(/0+$/, '').replace(/,$/, '') : s;
}

/** Formatea un monto como moneda chilena: 68923.5 → '$68.924'. */
export function formatearPesos(monto: number): string {
  // redondear() mira la expansión decimal exacta del double en vez de
  // restar el piso y comparar contra 0.5: ese atajo fabrica empates que
  // no existen (ver el comentario de redondeo.ts) y hace divergir el
  // resultado de Python en valores como 1.4999999999999998.
  const entero = redondear(monto, 0);
  // El signo sale del monto original y no del entero redondeado: Python
  // conserva el "-" aunque la magnitud redondee a cero ("$-0"), y la
  // paridad con el escritorio manda sobre la estética.
  const signo = monto < 0 || Object.is(monto, -0) ? '-' : '';
  const digitos = Math.abs(entero).toString();
  const conPuntos = digitos.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `$${signo}${conPuntos}`;
}
