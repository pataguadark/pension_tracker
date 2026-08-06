import { describe, expect, it, vi } from 'vitest';

import { eliminarPagoConConfirmacion } from './acciones';
import type { TipoMensaje } from './mensajes.svelte';

describe('eliminarPagoConConfirmacion', () => {
  // Historial.svelte solo pinta el ✕ de una fila cuando `estado` no es
  // null (sin base abierta no hay filas que pintar), así que un clic real
  // NUNCA llega a este código con `estado` null: el orden entre el aviso y
  // la confirmación no se puede probar montando la pantalla. Por eso la
  // orquestación se sacó a esta función pura, inyectando `confirmar` y
  // `avisar` en vez de leer `window.confirm`/`mensajes` directo.

  /** Registra las llamadas a `avisar`, como haría mensajes.agregar. */
  function avisosDe() {
    const avisos: { texto: string; tipo: TipoMensaje }[] = [];
    return { avisos, avisar: (texto: string, tipo: TipoMensaje) => avisos.push({ texto, tipo }) };
  }

  it('sin base abierta avisa y NO llega a pedir confirmación', async () => {
    const confirmar = vi.fn(() => true);
    const { avisos, avisar } = avisosDe();

    await eliminarPagoConConfirmacion(null, 7, confirmar, avisar);

    expect(confirmar).not.toHaveBeenCalled();
    expect(avisos).toEqual([
      { texto: 'Error al procesar el pago: la base de datos no está abierta.', tipo: 'error' },
    ]);
  });

  it('con base abierta pide confirmación con el texto del escritorio', async () => {
    const confirmar = vi.fn(() => false);
    const eliminarPago = vi.fn();
    const { avisar } = avisosDe();

    await eliminarPagoConConfirmacion({ eliminarPago }, 7, confirmar, avisar);

    expect(confirmar).toHaveBeenCalledWith(
      '¿Eliminar pago #7? Esta acción no se puede deshacer.',
    );
  });

  it('al cancelar la confirmación no borra ni avisa', async () => {
    const eliminarPago = vi.fn();
    const { avisos, avisar } = avisosDe();

    await eliminarPagoConConfirmacion({ eliminarPago }, 7, () => false, avisar);

    expect(eliminarPago).not.toHaveBeenCalled();
    expect(avisos).toEqual([]);
  });

  it('al confirmar, borra y avisa el éxito', async () => {
    const eliminarPago = vi.fn(async () => true);
    const { avisos, avisar } = avisosDe();

    await eliminarPagoConConfirmacion({ eliminarPago }, 7, () => true, avisar);

    expect(eliminarPago).toHaveBeenCalledWith(7);
    expect(avisos).toEqual([{ texto: 'Pago #7 eliminado correctamente.', tipo: 'exito' }]);
  });

  it('si el id ya no existe, avisa el error del escritorio', async () => {
    const eliminarPago = vi.fn(async () => false);
    const { avisos, avisar } = avisosDe();

    await eliminarPagoConConfirmacion({ eliminarPago }, 7, () => true, avisar);

    expect(avisos).toEqual([{ texto: 'No se encontró el pago #7.', tipo: 'error' }]);
  });
});
