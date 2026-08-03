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
}

async function ejecutar_(ejecutor: EjecutorSql, sql: string): Promise<void> {
  await ejecutor.ejecutar(sql);
}
