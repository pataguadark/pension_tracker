import { beforeEach, describe, expect, it } from 'vitest';
import type { EjecutorSql, ResultadoEscritura } from './ejecutor';
import { EjecutorNode } from './ejecutor-node';
import { inicializarBd } from './esquema';
import { RepositorioConfiguracion, RepositorioPagos, RepositorioUtm } from './repositorio';

/**
 * Delega en un EjecutorNode real, pero lanza al llegar a la N-ésima
 * escritura (`correr`). Simula el proceso muriendo a mitad de un lote,
 * para verificar que guardarUtmBulk revierte lo que alcanzó a escribir.
 */
class EjecutorQueFallaAlEscribir implements EjecutorSql {
  private escrituras = 0;

  constructor(
    private readonly real: EjecutorSql,
    private readonly fallaEnLaEscritura: number,
  ) {}

  async ejecutar(sql: string): Promise<void> {
    return this.real.ejecutar(sql);
  }

  async correr(sql: string, params?: unknown[]): Promise<ResultadoEscritura> {
    this.escrituras += 1;
    if (this.escrituras === this.fallaEnLaEscritura) {
      throw new Error('fallo simulado en la escritura número ' + this.escrituras);
    }
    return this.real.correr(sql, params);
  }

  async consultar<T>(sql: string, params?: unknown[]): Promise<T[]> {
    return this.real.consultar<T>(sql, params);
  }
}

/**
 * Imita la restricción real de @capacitor-community/sqlite: cada `run`
 * (nuestro `correr`) viaja en su propia transacción implícita salvo que ya
 * haya una transacción explícita abierta, en cuyo caso debe correr DENTRO
 * de esa transacción sin intentar abrir la suya -el equivalente a pasarle
 * `transaction: false` al plugin real-. Fija el contrato documentado en
 * ejecutor.ts: intercepta BEGIN/COMMIT/ROLLBACK en `ejecutar()`, lleva un
 * flag de "hay una transacción abierta" y lo respeta en `correr()`.
 *
 * Sin ese seguimiento (el "mapeo ingenuo" que este archivo previene), cada
 * `correr()` intentaría su propio BEGIN mientras el de guardarUtmBulk ya
 * está abierto, y node:sqlite -igual que el plugin real- lo rechaza con
 * "cannot start a transaction within a transaction". Se verificó
 * quitando temporalmente el chequeo de `transaccionActiva` en `correr()`:
 * la prueba de abajo pasó a fallar con exactamente ese mensaje.
 */
class EjecutorQueImitaElPluginDeCapacitor implements EjecutorSql {
  private transaccionActiva = false;

  constructor(private readonly real: EjecutorSql) {}

  async ejecutar(sql: string): Promise<void> {
    const comando = sql.trim().toUpperCase();
    if (comando === 'BEGIN') {
      if (this.transaccionActiva) {
        throw new Error('cannot start a transaction within a transaction');
      }
      this.transaccionActiva = true;
    } else if (comando === 'COMMIT' || comando === 'ROLLBACK') {
      this.transaccionActiva = false;
    }
    return this.real.ejecutar(sql);
  }

  async correr(sql: string, params?: unknown[]): Promise<ResultadoEscritura> {
    // Ya hay una transacción explícita abierta: correr directo, como el
    // plugin real haría con `transaction: false`.
    if (this.transaccionActiva) {
      return this.real.correr(sql, params);
    }
    // Sin transacción explícita: cada `run` del plugin abre y cierra la
    // suya. Se modela igual para que la sentencia individual (guardarUtm
    // fuera de un lote) siga funcionando.
    await this.real.ejecutar('BEGIN');
    try {
      const r = await this.real.correr(sql, params);
      await this.real.ejecutar('COMMIT');
      return r;
    } catch (error) {
      await this.real.ejecutar('ROLLBACK');
      throw error;
    }
  }

  async consultar<T>(sql: string, params?: unknown[]): Promise<T[]> {
    return this.real.consultar<T>(sql, params);
  }
}

const AHORA = '2025-06-15 10:30:00';

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

  it('actualiza todas las ocho columnas', async () => {
    // Inserta un pago con valores base
    const id = await repo.insertarPago(PAGO_BASE);

    // Define nuevos valores, todos distintos de PAGO_BASE en cada campo
    const pagoActualizado = {
      fecha: '2025-12-31',
      mesPago: 12,
      anioPago: 2024,
      utmValor: 99999,
      cuotaPactada: 500000.0,
      montoPagado: 450000,
      desbalance: 50000.0,
      utmFactor: 5.5,
    };

    // Actualiza
    await repo.actualizarPago(id, pagoActualizado);

    // Verifica que cada columna se actualizó correctamente
    const pago = await repo.obtenerPagoPorId(id);
    expect(pago!.fecha).toBe('2025-12-31');
    expect(pago!.mesPago).toBe(12);
    expect(pago!.anioPago).toBe(2024);
    expect(pago!.utmValor).toBe(99999);
    expect(pago!.cuotaPactada).toBe(500000.0);
    expect(pago!.montoPagado).toBe(450000);
    expect(pago!.desbalance).toBe(50000.0);
    expect(pago!.utmFactor).toBe(5.5);
  });

  it('no toca los demás pagos al actualizar', async () => {
    // Inserta dos pagos distinguibles
    const a = await repo.insertarPago({ ...PAGO_BASE, mesPago: 1 });
    const b = await repo.insertarPago({ ...PAGO_BASE, mesPago: 2 });

    // Guarda el estado original del segundo pago
    const pagoB_original = await repo.obtenerPagoPorId(b);

    // Actualiza solo el primero
    await repo.actualizarPago(a, {
      ...PAGO_BASE,
      mesPago: 6,
      montoPagado: 999999,
      desbalance: 123456.0,
    });

    // Verifica que el segundo pago no cambió
    const pagoB_final = await repo.obtenerPagoPorId(b);
    expect(pagoB_final).toEqual(pagoB_original);
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
    //
    // Se insertan los meses AL REVÉS (3 antes que 1) a propósito: si se
    // insertaran en orden ascendente, el orden físico de las filas
    // coincidiría con el ORDER BY esperado y la prueba pasaría igual sin
    // ningún ORDER BY -no fijaría nada-. Insertados al revés, quitar el
    // ORDER BY devolvería [3, 1] (orden físico) en vez de [1, 3].
    await repo.insertarPago({ ...PAGO_BASE, mesPago: 3, anioPago: 2025 });
    await repo.insertarPago({ ...PAGO_BASE, mesPago: 1, anioPago: 2025 });
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

describe('RepositorioUtm', () => {
  let utm: RepositorioUtm;
  beforeEach(() => { utm = new RepositorioUtm(ejecutor); });

  it('guarda y recupera el valor de un mes', async () => {
    await utm.guardarUtm(2025, 1, 67294, AHORA);
    expect(await utm.obtenerUtmGuardada(2025, 1)).toEqual({
      anio: 2025, mes: 1, utmValor: 67294, fechaRegistro: AHORA,
    });
  });

  it('un mes sin guardar devuelve null', async () => {
    expect(await utm.obtenerUtmGuardada(2099, 1)).toBeNull();
  });

  it('guardar dos veces el mismo mes reemplaza en vez de duplicar', async () => {
    await utm.guardarUtm(2025, 1, 67294, AHORA);
    await utm.guardarUtm(2025, 1, 68000, '2025-07-01 09:00:00');
    expect((await utm.obtenerUtmGuardada(2025, 1))!.utmValor).toBe(68000);
    const filas = await ejecutor.consultar<{ n: number }>(
      'SELECT COUNT(*) AS n FROM utm_historial',
    );
    expect(filas[0]!.n).toBe(1);
  });

  it('guardarUtmBulk escribe varios meses de una vez', async () => {
    await utm.guardarUtmBulk(2025, new Map([[1, 67294], [2, 67429], [3, 68034]]), AHORA);
    expect((await utm.obtenerUtmGuardada(2025, 2))!.utmValor).toBe(67429);
    const filas = await ejecutor.consultar<{ n: number }>(
      'SELECT COUNT(*) AS n FROM utm_historial',
    );
    expect(filas[0]!.n).toBe(3);
  });

  it('guardarUtmBulk revierte todo si una escritura de en medio falla', async () => {
    // Simula el proceso muriendo entre dos escrituras del lote (p. ej. la
    // app pasa a segundo plano en el teléfono). El escritorio garantiza una
    // sola transacción para todo el lote; el móvil debe igualar esa garantía.
    const ejecutorQueFalla = new EjecutorQueFallaAlEscribir(ejecutor, 2);
    const utmQueFalla = new RepositorioUtm(ejecutorQueFalla);

    await expect(
      utmQueFalla.guardarUtmBulk(
        2025,
        new Map([[1, 67294], [2, 67429], [3, 68034]]),
        AHORA,
      ),
    ).rejects.toThrow('fallo simulado en la escritura número 2');

    const filas = await ejecutor.consultar<{ n: number }>(
      'SELECT COUNT(*) AS n FROM utm_historial',
    );
    expect(filas[0]!.n).toBe(0);
  });

  it('guardarUtmBulk funciona contra un ejecutor que rechaza un BEGIN anidado, como el plugin real', async () => {
    // @capacitor-community/sqlite envuelve cada run/execute en su propia
    // transacción por defecto. Este ejecutor falso imita esa restricción
    // (ver su docstring más arriba); si guardarUtmBulk -o el mapeo que
    // haga un futuro adaptador de Capacitor- disparara un BEGIN anidado,
    // esta prueba lo detectaría con el mismo error que el plugin real.
    const ejecutorDelPlugin = new EjecutorQueImitaElPluginDeCapacitor(ejecutor);
    const utmDelPlugin = new RepositorioUtm(ejecutorDelPlugin);

    await utmDelPlugin.guardarUtmBulk(
      2025,
      new Map([[1, 67294], [2, 67429], [3, 68034]]),
      AHORA,
    );

    const filas = await ejecutor.consultar<{ n: number }>(
      'SELECT COUNT(*) AS n FROM utm_historial',
    );
    expect(filas[0]!.n).toBe(3);
  });

  it('guardarUtmBulk con un mapa vacío no hace nada ni falla', async () => {
    await utm.guardarUtmBulk(2025, new Map(), AHORA);
    const filas = await ejecutor.consultar<{ n: number }>(
      'SELECT COUNT(*) AS n FROM utm_historial',
    );
    expect(filas[0]!.n).toBe(0);
  });

  it('obtenerUltimaUtmGuardada devuelve la del mes más reciente', async () => {
    // El año más reciente lleva DOS meses a propósito: con uno solo, `mes
    // ASC` y `mes DESC` devuelven la misma fila y la prueba no fijaría el
    // desempate por mes -solo el de año-. Con dos, el mes mayor (2) debe
    // ganar; es de ahí que sale el valor UTM que alimenta la cuota pactada.
    await utm.guardarUtmBulk(2024, new Map([[11, 66000], [12, 66500]]), AHORA);
    await utm.guardarUtmBulk(2025, new Map([[1, 67294], [2, 67429]]), AHORA);
    expect(await utm.obtenerUltimaUtmGuardada()).toEqual({
      anio: 2025, mes: 2, utmValor: 67429, fechaRegistro: AHORA,
    });
  });

  it('sin ninguna UTM guardada devuelve null', async () => {
    expect(await utm.obtenerUltimaUtmGuardada()).toBeNull();
  });

  it('obtenerUltimoFactorUtm ignora los pagos sin factor', async () => {
    await repo.insertarPago({ ...PAGO_BASE, mesPago: 1, utmFactor: 3.0 });
    await repo.insertarPago({ ...PAGO_BASE, mesPago: 2, utmFactor: null });
    expect(await utm.obtenerUltimoFactorUtm()).toBe(3.0);
  });

  it('con dos pagos del mismo mes gana el registrado después', async () => {
    // El desempate por id DESC del escritorio; sin él, el resultado
    // dependería del orden físico de las filas.
    await repo.insertarPago({ ...PAGO_BASE, mesPago: 4, anioPago: 2025, utmFactor: 3.0 });
    await repo.insertarPago({ ...PAGO_BASE, mesPago: 4, anioPago: 2025, utmFactor: 4.25 });
    expect(await utm.obtenerUltimoFactorUtm()).toBe(4.25);
  });

  it('sin pagos con factor devuelve null', async () => {
    await repo.insertarPago({ ...PAGO_BASE, utmFactor: null });
    expect(await utm.obtenerUltimoFactorUtm()).toBeNull();
  });
});

describe('RepositorioConfiguracion', () => {
  let config: RepositorioConfiguracion;
  beforeEach(() => { config = new RepositorioConfiguracion(ejecutor); });

  it('guarda y recupera un valor', async () => {
    await config.guardarConfiguracion('factor_predeterminado', '3.0561');
    expect(await config.obtenerConfiguracion('factor_predeterminado')).toBe('3.0561');
  });

  it('una clave inexistente devuelve null', async () => {
    expect(await config.obtenerConfiguracion('no_existe')).toBeNull();
  });

  it('guardar dos veces la misma clave reemplaza el valor', async () => {
    await config.guardarConfiguracion('k', 'uno');
    await config.guardarConfiguracion('k', 'dos');
    expect(await config.obtenerConfiguracion('k')).toBe('dos');
  });
});
