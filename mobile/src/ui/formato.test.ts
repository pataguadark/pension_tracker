import { describe, expect, it, vi } from 'vitest';

import type { TipoMensaje } from './mensajes.svelte';
import {
  claseEstadoCard, claseSigno, descripcionDesbalanceMes, eliminarPagoConConfirmacion,
  etiquetaPeriodo, montoConSigno,
} from './formato';

describe('descripcionDesbalanceMes', () => {
  // Es el texto que el escritorio pega al flash de éxito tras registrar
  // ("✅ Pago registrado correctamente. {descripcion_mes}"), y lo escribe
  // calcular_desbalance_mensual, no la plantilla.
  it('con excedente dice cuánto se pagó de más', () => {
    expect(descripcionDesbalanceMes(20_000)).toBe('Pagó $20.000 de más este mes.');
  });

  it('con deuda dice cuánto se pagó de menos, sin signo negativo en la cifra', () => {
    expect(descripcionDesbalanceMes(-80_000)).toBe('Pagó $80.000 de menos este mes.');
  });

  it('con pago exacto no menciona ninguna cifra', () => {
    expect(descripcionDesbalanceMes(0)).toBe('Pago exacto. Sin diferencia.');
  });
});

describe('montoConSigno', () => {
  // El escritorio arma el signo FUERA del "$": la plantilla escribe
  // `{% if d > 0 %}+{% elif d < 0 %}-{% endif %}${{ format(d|abs) }}`, o sea
  // "-$80.000". formatearPesos() por sí solo daría "$-80.000" (el signo
  // adentro), que es exactamente la divergencia visible que este port existe
  // para evitar.
  it('antepone + a los montos positivos', () => {
    expect(montoConSigno(80_000)).toBe('+$80.000');
  });

  it('pone el menos ANTES del signo peso, como el escritorio', () => {
    expect(montoConSigno(-80_000)).toBe('-$80.000');
  });

  it('no pone signo cuando el monto es cero', () => {
    expect(montoConSigno(0)).toBe('$0');
  });

  it('trata el cero negativo como cero, sin arrastrar el menos', () => {
    // formatearPesos(-0) devuelve "$-0" por paridad con Python. Acá el signo
    // sale de la comparación (-0 no es > ni < que 0) y la magnitud de
    // Math.abs(), así que no queda ni "-$-0" ni "$-0".
    expect(montoConSigno(-0)).toBe('$0');
  });

  it('agrupa los miles con punto', () => {
    expect(montoConSigno(-1_234_567)).toBe('-$1.234.567');
  });
});

describe('claseSigno', () => {
  it('marca en positivo los montos a favor', () => {
    expect(claseSigno(1)).toBe('td-pos');
  });

  it('marca en negativo las deudas', () => {
    expect(claseSigno(-1)).toBe('td-neg');
  });

  it('marca neutro el cero', () => {
    expect(claseSigno(0)).toBe('td-zero');
  });
});

describe('claseEstadoCard', () => {
  it('EXCEDENTE pinta la tarjeta de excedente', () => {
    expect(claseEstadoCard('EXCEDENTE')).toBe('card-excedente');
  });

  it('DEUDA pinta la tarjeta de deuda', () => {
    expect(claseEstadoCard('DEUDA')).toBe('card-deuda');
  });

  it('EXACTO pinta la tarjeta de exacto', () => {
    expect(claseEstadoCard('EXACTO')).toBe('card-exacto');
  });
});

describe('etiquetaPeriodo', () => {
  it('usa la abreviatura de tres letras del mes, como el escritorio', () => {
    expect(etiquetaPeriodo(2025, 1)).toBe('Ene 2025');
    expect(etiquetaPeriodo(2025, 12)).toBe('Dic 2025');
  });

  it('el mes 1 es enero y no febrero (la lista es base cero)', () => {
    // Un off-by-one acá corre TODOS los meses del historial: el escritorio
    // indexa con `meses[p.mes_pago - 1]`.
    expect(etiquetaPeriodo(2025, 2)).toBe('Feb 2025');
    expect(etiquetaPeriodo(2025, 8)).toBe('Ago 2025');
  });
});

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
