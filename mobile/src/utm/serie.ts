/**
 * Parseo de la respuesta de mindicador.cl.
 *
 * Funciones puras: reciben el JSON ya decodificado. Se verifican contra la
 * implementación Python con las fixtures de shared/fixtures/serie-utm.json.
 *
 * **El año y el mes se sacan cortando el string, nunca con un Date.** Las
 * fechas vienen como la medianoche chilena expresada en UTC
 * ("2025-12-01T03:00:00.000Z"), con desfase variable por horario de verano.
 * `new Date(...).getMonth()` devolvería el mes según el huso del dispositivo:
 * en America/New_York esa fecha da noviembre, no diciembre. Un usuario fuera
 * de Chile terminaría con la UTM del mes equivocado, y con ella una cuota
 * equivocada.
 */

/** Año y mes de una fecha ISO, leídos del texto. Null si no es interpretable. */
function anioYMesDe(fecha: unknown): { anio: number; mes: number } | null {
  if (typeof fecha !== 'string' || fecha.length < 7) return null;
  const anio = Number(fecha.slice(0, 4));
  const mes = Number(fecha.slice(5, 7));
  if (!Number.isInteger(anio) || !Number.isInteger(mes)) return null;
  if (mes < 1 || mes > 12) return null;
  return { anio, mes };
}

/** Valor numérico y finito de un item, o null si no lo es. */
function valorFinito(valor: unknown): number | null {
  if (valor === null || valor === undefined) return null;
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
}

function serieDe(respuesta: unknown): unknown[] {
  if (typeof respuesta !== 'object' || respuesta === null) return [];
  const serie = (respuesta as { serie?: unknown }).serie;
  return Array.isArray(serie) ? serie : [];
}

/**
 * Valores publicados de un año, como {mes: valor}. Solo incluye los meses
 * presentes en la serie: los futuros o no publicados no aparecen.
 *
 * Descarta valores no finitos en vez de persistirlos: validar duro al
 * escribir. Ese mes queda como si no se hubiera publicado.
 */
export function extraerValoresDelAnio(respuesta: unknown, anio: number): Map<number, number> {
  const valores = new Map<number, number>();
  for (const item of serieDe(respuesta)) {
    if (typeof item !== 'object' || item === null) continue;
    const fecha = anioYMesDe((item as { fecha?: unknown }).fecha);
    if (fecha === null || fecha.anio !== anio) continue;
    const valor = valorFinito((item as { valor?: unknown }).valor);
    if (valor !== null) valores.set(fecha.mes, valor);
  }
  return valores;
}

/** Valor de un mes concreto dentro de una serie, o null si no está. */
export function buscarMesEnSerie(serie: unknown, anio: number, mes: number): number | null {
  const items = Array.isArray(serie) ? serie : [];
  for (const item of items) {
    if (typeof item !== 'object' || item === null) continue;
    const fecha = anioYMesDe((item as { fecha?: unknown }).fecha);
    if (fecha === null || fecha.anio !== anio || fecha.mes !== mes) continue;
    const valor = valorFinito((item as { valor?: unknown }).valor);
    if (valor !== null) return valor;
  }
  return null;
}
