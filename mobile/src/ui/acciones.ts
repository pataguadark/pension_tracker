/**
 * Acciones de las pantallas: los flujos que coordinan confirmación, escritura
 * y aviso.
 *
 * Viven fuera de los .svelte para poder probar el ORDEN de sus pasos sin
 * montar la pantalla. No van en formato.ts, que es solo presentación.
 */

import type { EstadoApp } from './estado.svelte';
import type { TipoMensaje } from './mensajes.svelte';

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
