import { beforeEach, describe, expect, it } from 'vitest';
import { EjecutorNode } from './ejecutor-node';
import { inicializarBd } from './esquema';
import { RepositorioPagos } from './repositorio';

const PAGO_BASE = {
  fecha: '2025-01-05',
  mesPago: 1,
  anioPago: 2025,
  utmValor: 67294,
  cuotaPactada: 201882.0,
  montoPagado: 200000,
  desbalance: -1882.0,
  utmFactor: 3.0,
};

let ejecutor: EjecutorNode;
let repo: RepositorioPagos;

beforeEach(async () => {
  ejecutor = new EjecutorNode(':memory:');
  await inicializarBd(ejecutor);
  repo = new RepositorioPagos(ejecutor);
});

describe('insertarPago', () => {
  it('devuelve el id de la fila insertada', async () => {
    const id = await repo.insertarPago(PAGO_BASE);
    expect(id).toBeGreaterThan(0);
  });

  it('guarda todos los campos y los devuelve en camelCase', async () => {
    const id = await repo.insertarPago(PAGO_BASE);
    const pago = await repo.obtenerPagoPorId(id);
    expect(pago).toEqual({ ...PAGO_BASE, id });
  });

  it('acepta un pago sin factor UTM', async () => {
    const id = await repo.insertarPago({ ...PAGO_BASE, utmFactor: null });
    const pago = await repo.obtenerPagoPorId(id);
    expect(pago!.utmFactor).toBeNull();
  });
});

describe('obtenerTodosLosPagos', () => {
  it('sin pagos devuelve una lista vacía', async () => {
    expect(await repo.obtenerTodosLosPagos()).toEqual([]);
  });

  it('devuelve del más reciente al más antiguo, como el escritorio', async () => {
    await repo.insertarPago({ ...PAGO_BASE, mesPago: 1, anioPago: 2025 });
    await repo.insertarPago({ ...PAGO_BASE, mesPago: 3, anioPago: 2024 });
    await repo.insertarPago({ ...PAGO_BASE, mesPago: 2, anioPago: 2025 });
    const pagos = await repo.obtenerTodosLosPagos();
    expect(pagos.map((p) => [p.anioPago, p.mesPago])).toEqual([
      [2025, 2], [2025, 1], [2024, 3],
    ]);
  });
});

describe('obtenerPagoPorId', () => {
  it('devuelve null si el id no existe', async () => {
    expect(await repo.obtenerPagoPorId(9999)).toBeNull();
  });
});

describe('actualizarPago', () => {
  it('modifica los campos y devuelve true', async () => {
    const id = await repo.insertarPago(PAGO_BASE);
    const ok = await repo.actualizarPago(id, {
      ...PAGO_BASE, montoPagado: 210000, desbalance: 8118.0,
    });
    expect(ok).toBe(true);
    const pago = await repo.obtenerPagoPorId(id);
    expect(pago!.montoPagado).toBe(210000);
    expect(pago!.desbalance).toBe(8118.0);
  });

  it('devuelve false si el id no existe', async () => {
    expect(await repo.actualizarPago(9999, PAGO_BASE)).toBe(false);
  });

  it('permite dejar el factor UTM en nulo', async () => {
    const id = await repo.insertarPago(PAGO_BASE);
    await repo.actualizarPago(id, { ...PAGO_BASE, utmFactor: null });
    expect((await repo.obtenerPagoPorId(id))!.utmFactor).toBeNull();
  });
});

describe('eliminarPago', () => {
  it('borra el pago y devuelve true', async () => {
    const id = await repo.insertarPago(PAGO_BASE);
    expect(await repo.eliminarPago(id)).toBe(true);
    expect(await repo.obtenerPagoPorId(id)).toBeNull();
  });

  it('devuelve false si el id no existe', async () => {
    expect(await repo.eliminarPago(9999)).toBe(false);
  });

  it('no toca los demás pagos', async () => {
    const a = await repo.insertarPago({ ...PAGO_BASE, mesPago: 1 });
    const b = await repo.insertarPago({ ...PAGO_BASE, mesPago: 2 });
    await repo.eliminarPago(a);
    const pagos = await repo.obtenerTodosLosPagos();
    expect(pagos.map((p) => p.id)).toEqual([b]);
  });
});

describe('obtenerPagosPorAnio', () => {
  it('filtra por año y ordena de mes ASCENDENTE, al revés que obtenerTodosLosPagos', async () => {
    // No es una inconsistencia introducida acá: el escritorio ordena así
    // (db_manager.py:190, `ORDER BY mes_pago ASC`) mientras
    // obtener_todos_los_pagos ordena descendente. Se replica tal cual para
    // que las dos plataformas muestren el historial anual en el mismo orden.
    await repo.insertarPago({ ...PAGO_BASE, mesPago: 1, anioPago: 2025 });
    await repo.insertarPago({ ...PAGO_BASE, mesPago: 3, anioPago: 2025 });
    await repo.insertarPago({ ...PAGO_BASE, mesPago: 2, anioPago: 2024 });
    const pagos = await repo.obtenerPagosPorAnio(2025);
    expect(pagos.map((p) => p.mesPago)).toEqual([1, 3]);
  });

  it('un año sin pagos devuelve lista vacía', async () => {
    expect(await repo.obtenerPagosPorAnio(2099)).toEqual([]);
  });
});

describe('obtenerResumenAnual', () => {
  it('suma los pagos del año', async () => {
    await repo.insertarPago({
      ...PAGO_BASE, mesPago: 1, montoPagado: 200000,
      cuotaPactada: 201882.0, desbalance: -1882.0,
    });
    await repo.insertarPago({
      ...PAGO_BASE, mesPago: 2, montoPagado: 210000,
      cuotaPactada: 204102.0, desbalance: 5898.0,
    });
    expect(await repo.obtenerResumenAnual(2025)).toEqual({
      cantidadPagos: 2,
      totalPagado: 410000,
      totalPactado: 405984.0,
      desbalanceAcumulado: 4016.0,
    });
  });

  it('un año sin pagos devuelve ceros, no nulos', async () => {
    // SUM() de SQLite devuelve NULL sin filas; el repositorio lo normaliza
    // a 0 para que ninguna capa de arriba tenga que acordarse.
    expect(await repo.obtenerResumenAnual(2099)).toEqual({
      cantidadPagos: 0,
      totalPagado: 0,
      totalPactado: 0,
      desbalanceAcumulado: 0,
    });
  });
});
