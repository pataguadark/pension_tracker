/**
 * Formateo de presentación compartido por los componentes del historial.
 *
 * No es un port de formatters.py: en el escritorio estas tres cosas viven
 * dentro de la plantilla Jinja (el signo pegado antes del "$", la clase
 * td-pos/td-neg/td-zero, la lista de meses abreviados). Acá se sacan del
 * .svelte para poder probarlas sin montar la pantalla y para que
 * TarjetasResumen y TablaPagos no tengan dos copias que puedan divergir.
 *
 * El formateo de los montos en sí NO se reimplementa: se delega en
 * formatearPesos() de core/formatters.ts.
 */

import { estadoDe } from '../core/calculos';
import { formatearPesos } from '../core/formatters';
import type { Estado } from '../core/tipos';
import type { EstadoApp } from './estado.svelte';
import type { TipoMensaje } from './mensajes.svelte';

/**
 * Monto con el signo ANTES del símbolo de peso: "-$80.000", "+$20.000".
 *
 * Así lo escribe historial.html
 * (`{% if d > 0 %}+{% elif d < 0 %}-{% endif %}${{ format(d|abs) }}`).
 * formatearPesos() por sí solo pone el signo adentro ("$-80.000") por
 * paridad con Python, que es correcto para esa función y equivocado para
 * esta pantalla.
 */
export function montoConSigno(monto: number): string {
  const signo = monto > 0 ? '+' : monto < 0 ? '-' : '';
  // Math.abs() además normaliza el -0, que formatearPesos() rendería como
  // "$-0" (deliberado allá, no acá).
  return `${signo}${formatearPesos(Math.abs(monto))}`;
}

/**
 * Frase que describe el desbalance de un mes: la que el escritorio mete en
 * el flash de "Pago registrado correctamente".
 *
 * Literal de `calcular_desbalance_mensual` (calculation_service.py:91-99).
 * En el móvil vive acá y no en `core/calculos.ts` porque ese módulo dejó
 * fuera las descripciones a propósito ("son presentación y se arman en la
 * capa de interfaz").
 */
export function descripcionDesbalanceMes(diferencia: number): string {
  if (diferencia > 0) {
    return `Pagó ${formatearPesos(diferencia)} de más este mes.`;
  }
  if (diferencia < 0) {
    return `Pagó ${formatearPesos(Math.abs(diferencia))} de menos este mes.`;
  }
  return 'Pago exacto. Sin diferencia.';
}

/** Clase de color de una cifra en la tabla, según su signo. */
export function claseSigno(monto: number): string {
  return CLASES_SIGNO[estadoDe(monto)];
}

const CLASES_SIGNO: Record<Estado, string> = {
  EXCEDENTE: 'td-pos',
  DEUDA: 'td-neg',
  EXACTO: 'td-zero',
};

/** Clase de estado de la tarjeta de desbalance. */
export function claseEstadoCard(estado: Estado): string {
  return CLASES_CARD[estado];
}

const CLASES_CARD: Record<Estado, string> = {
  EXCEDENTE: 'card-excedente',
  DEUDA: 'card-deuda',
  EXACTO: 'card-exacto',
};

/** Meses abreviados, en el mismo orden y con la misma grafía del escritorio. */
const MESES = [
  'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun',
  'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic',
];

/** Período de un pago: "Ago 2025". El mes viene en base uno. */
export function etiquetaPeriodo(anio: number, mes: number): string {
  return `${MESES[mes - 1] ?? mes} ${anio}`;
}

/**
 * Orquesta el borrado de un pago desde Historial: comprueba que haya una
 * base abierta ANTES de pedir confirmación —igual que Registro y Edicion,
 * que avisan sin confirmar nada si la base está cerrada—, confirma, borra y
 * avisa. El texto del `confirm` es literal del `data-confirm` de
 * historial.html:203; el de los avisos, literal de los dos flash de
 * routes/pagos.py:307-309.
 *
 * Se saca de Historial.svelte (y `confirmar`/`avisar` se reciben inyectados
 * en vez de leer `window.confirm`/`mensajes` directo) para poder probar el
 * ORDEN sin depender de un ✕ real en el DOM: con `estado` null no hay filas
 * que pintar, así que un clic real jamás llega a este código.
 */
export async function eliminarPagoConConfirmacion(
  estado: Pick<EstadoApp, 'eliminarPago'> | null,
  id: number,
  confirmar: (mensaje: string) => boolean,
  avisar: (texto: string, tipo: TipoMensaje) => void,
): Promise<void> {
  if (!estado) {
    avisar('Error al procesar el pago: la base de datos no está abierta.', 'error');
    return;
  }
  if (!confirmar(`¿Eliminar pago #${id}? Esta acción no se puede deshacer.`)) {
    return;
  }
  if (await estado.eliminarPago(id)) {
    avisar(`Pago #${id} eliminado correctamente.`, 'exito');
  } else {
    avisar(`No se encontró el pago #${id}.`, 'error');
  }
}
