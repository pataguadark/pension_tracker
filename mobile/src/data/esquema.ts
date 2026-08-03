/**
 * Esquema de la base de datos local.
 *
 * Debe ser compatible con el del escritorio (src/pensiontracker/database/
 * db_manager.py), porque el archivo .db se intercambia entre ambas
 * plataformas: es la única vía de migración que tiene un usuario.
 *
 * El escritorio crea `pagos` sin `utm_factor` y la agrega con ALTER TABLE,
 * así que su texto guardado en sqlite_master difiere del de acá. Lo que
 * coincide —y lo único que hay que comparar— es la estructura: mismas
 * columnas, mismos tipos, mismo orden.
 */

import type { EjecutorSql } from './ejecutor';

/** Columnas de cada tabla, en orden. Referencia para validar compatibilidad. */
export const TABLAS_ESPERADAS: Record<string, string[]> = {
  pagos: [
    'id', 'fecha', 'mes_pago', 'anio_pago', 'utm_valor',
    'cuota_pactada', 'monto_pagado', 'desbalance', 'utm_factor',
  ],
  utm_historial: ['id', 'anio', 'mes', 'utm_valor', 'fecha_registro'],
  configuracion: ['clave', 'valor'],
};

const DDL = [
  `CREATE TABLE IF NOT EXISTS pagos (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    fecha         TEXT    NOT NULL,
    mes_pago      INTEGER NOT NULL,
    anio_pago     INTEGER NOT NULL,
    utm_valor     REAL    NOT NULL,
    cuota_pactada REAL    NOT NULL,
    monto_pagado  REAL    NOT NULL,
    desbalance    REAL    NOT NULL,
    utm_factor    REAL
  )`,
  `CREATE TABLE IF NOT EXISTS utm_historial (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    anio           INTEGER NOT NULL,
    mes            INTEGER NOT NULL,
    utm_valor      REAL    NOT NULL,
    fecha_registro TEXT    NOT NULL,
    UNIQUE(anio, mes)
  )`,
  `CREATE TABLE IF NOT EXISTS configuracion (
    clave TEXT PRIMARY KEY,
    valor TEXT NOT NULL
  )`,
];

/** Crea las tablas si no existen. Es idempotente. */
export async function inicializarBd(ejecutor: EjecutorSql): Promise<void> {
  for (const sentencia of DDL) {
    await ejecutar_(ejecutor, sentencia);
  }
  await migrarUtmFactorSiFalta(ejecutor);
}

async function ejecutar_(ejecutor: EjecutorSql, sql: string): Promise<void> {
  await ejecutor.ejecutar(sql);
}

/**
 * Replica la migración que hace el escritorio al arrancar (db_manager.py:
 * 88-97): una base creada por una versión anterior a `utm_factor` tiene
 * `pagos` con 8 columnas, sin esa. El `CREATE TABLE IF NOT EXISTS` de
 * arriba es un no-op sobre esa tabla -ya existe-, así que sin este paso el
 * móvil la abre con un esquema incompleto y cualquier lectura o escritura
 * sobre `pagos` falla con "no such column: utm_factor".
 *
 * Idempotente: si la columna ya está (base nueva, o esta misma migración
 * ya corrió antes), `pragma_table_info` la ve y no se repite el ALTER
 * -repetirlo fallaría con "duplicate column name".
 */
async function migrarUtmFactorSiFalta(ejecutor: EjecutorSql): Promise<void> {
  const filas = await ejecutor.consultar<{ n: number }>(
    "SELECT COUNT(*) AS n FROM pragma_table_info('pagos') WHERE name='utm_factor'",
  );
  if (filas[0]!.n === 0) {
    await ejecutor.ejecutar('ALTER TABLE pagos ADD COLUMN utm_factor REAL');
  }
}
