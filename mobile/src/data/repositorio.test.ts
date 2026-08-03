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
