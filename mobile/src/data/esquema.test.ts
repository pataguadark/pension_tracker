import { describe, expect, it } from 'vitest';
import { EjecutorNode } from './ejecutor-node';
import { TABLAS_ESPERADAS, inicializarBd } from './esquema';

async function bdEnMemoria(): Promise<EjecutorNode> {
  const ejecutor = new EjecutorNode(':memory:');
  await inicializarBd(ejecutor);
  return ejecutor;
}

describe('inicializarBd', () => {
  it('crea las tres tablas del esquema', async () => {
    const bd = await bdEnMemoria();
    const filas = await bd.consultar<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    );
    expect(filas.map((f) => f.name)).toEqual(['configuracion', 'pagos', 'utm_historial']);
    bd.cerrar();
  });

  it.each(Object.entries(TABLAS_ESPERADAS))(
    'la tabla %s tiene exactamente las columnas esperadas',
    async (tabla, columnas) => {
      const bd = await bdEnMemoria();
      const filas = await bd.consultar<{ name: string }>(
        `SELECT name FROM pragma_table_info('${tabla}')`,
      );
      expect(filas.map((f) => f.name)).toEqual(columnas);
      bd.cerrar();
    },
  );

  it('es idempotente: correrla dos veces no falla ni duplica tablas', async () => {
    const bd = await bdEnMemoria();
    await inicializarBd(bd);
    const filas = await bd.consultar<{ n: number }>(
      "SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='pagos'",
    );
    expect(filas[0]!.n).toBe(1);
    bd.cerrar();
  });

  it('migra una tabla pagos legacy (8 columnas, sin utm_factor)', async () => {
    // Simula una base creada por una versión del escritorio anterior a
    // utm_factor: mismas 8 columnas, sin esa. inicializarBd debe agregarla,
    // igual que el ALTER TABLE condicional del escritorio (db_manager.py:
    // 88-97), en vez de dejar la tabla como un no-op de CREATE TABLE IF
    // NOT EXISTS.
    const bd = new EjecutorNode(':memory:');
    await bd.ejecutar(`
      CREATE TABLE pagos (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        fecha         TEXT    NOT NULL,
        mes_pago      INTEGER NOT NULL,
        anio_pago     INTEGER NOT NULL,
        utm_valor     REAL    NOT NULL,
        cuota_pactada REAL    NOT NULL,
        monto_pagado  REAL    NOT NULL,
        desbalance    REAL    NOT NULL
      )
    `);
    await bd.correr(
      `INSERT INTO pagos
         (fecha, mes_pago, anio_pago, utm_valor, cuota_pactada, monto_pagado, desbalance)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ['2024-05-05', 5, 2024, 65000, 195000.0, 195000, 0.0],
    );

    await inicializarBd(bd);

    const columnas = await bd.consultar<{ name: string }>(
      "SELECT name FROM pragma_table_info('pagos')",
    );
    expect(columnas.map((c) => c.name)).toContain('utm_factor');

    const filas = await bd.consultar<{ utm_factor: number | null }>(
      'SELECT utm_factor FROM pagos',
    );
    expect(filas).toEqual([{ utm_factor: null }]);
    bd.cerrar();
  });

  it('migrar una base legacy dos veces no falla ni duplica la columna', async () => {
    const bd = new EjecutorNode(':memory:');
    await bd.ejecutar(`
      CREATE TABLE pagos (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        fecha         TEXT    NOT NULL,
        mes_pago      INTEGER NOT NULL,
        anio_pago     INTEGER NOT NULL,
        utm_valor     REAL    NOT NULL,
        cuota_pactada REAL    NOT NULL,
        monto_pagado  REAL    NOT NULL,
        desbalance    REAL    NOT NULL
      )
    `);

    await inicializarBd(bd);
    await inicializarBd(bd);

    const columnas = await bd.consultar<{ name: string }>(
      "SELECT name FROM pragma_table_info('pagos')",
    );
    expect(columnas.filter((c) => c.name === 'utm_factor')).toHaveLength(1);
    bd.cerrar();
  });

  it('utm_historial rechaza dos filas del mismo mes y año', async () => {
    const bd = await bdEnMemoria();
    await bd.correr(
      'INSERT INTO utm_historial (anio, mes, utm_valor, fecha_registro) VALUES (?,?,?,?)',
      [2025, 1, 67294, '2025-01-01 00:00:00'],
    );
    await expect(
      bd.correr(
        'INSERT INTO utm_historial (anio, mes, utm_valor, fecha_registro) VALUES (?,?,?,?)',
        [2025, 1, 99999, '2025-01-02 00:00:00'],
      ),
    ).rejects.toThrow();
    bd.cerrar();
  });
});

describe('EjecutorNode', () => {
  it('correr informa cuántas filas cambió y el último id insertado', async () => {
    const bd = await bdEnMemoria();
    const r = await bd.correr(
      'INSERT INTO configuracion (clave, valor) VALUES (?,?)',
      ['factor_predeterminado', '3.0561'],
    );
    expect(r.cambios).toBe(1);
    expect(r.ultimoId).not.toBeNull();
    bd.cerrar();
  });

  it('consultar devuelve las filas como objetos', async () => {
    const bd = await bdEnMemoria();
    await bd.correr('INSERT INTO configuracion (clave, valor) VALUES (?,?)', ['a', '1']);
    const filas = await bd.consultar<{ clave: string; valor: string }>(
      'SELECT clave, valor FROM configuracion',
    );
    expect(filas).toEqual([{ clave: 'a', valor: '1' }]);
    bd.cerrar();
  });

  it('usa parámetros y no interpola: una comilla en el valor no rompe nada', async () => {
    const bd = await bdEnMemoria();
    await bd.correr('INSERT INTO configuracion (clave, valor) VALUES (?,?)', [
      'raro',
      "3'); DROP TABLE pagos; --",
    ]);
    const tablas = await bd.consultar<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='pagos'",
    );
    expect(tablas).toHaveLength(1);
    bd.cerrar();
  });
});
