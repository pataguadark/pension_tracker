/**
 * Acceso a la base de datos. Único lugar del proyecto que sabe SQL.
 *
 * Port de src/pensiontracker/database/db_manager.py. Los nombres de
 * columna van en snake_case porque el archivo .db se comparte con el
 * escritorio y no se pueden cambiar; la traducción a camelCase ocurre
 * acá y no sale de este archivo.
 */

import type { Pago } from '../core/tipos';
import type { EjecutorSql } from './ejecutor';

/** Una fila de `pagos` tal como la devuelve SQLite. */
interface FilaPago {
  id: number;
  fecha: string;
  mes_pago: number;
  anio_pago: number;
  utm_valor: number;
  cuota_pactada: number;
  monto_pagado: number;
  desbalance: number;
  utm_factor: number | null;
}

function aPago(fila: FilaPago): Pago {
  return {
    id: fila.id,
    fecha: fila.fecha,
    mesPago: fila.mes_pago,
    anioPago: fila.anio_pago,
    utmValor: fila.utm_valor,
    cuotaPactada: fila.cuota_pactada,
    montoPagado: fila.monto_pagado,
    desbalance: fila.desbalance,
    utmFactor: fila.utm_factor,
  };
}

const COLUMNAS_PAGO =
  'id, fecha, mes_pago, anio_pago, utm_valor, cuota_pactada, monto_pagado, desbalance, utm_factor';

export class RepositorioPagos {
  constructor(private readonly ejecutor: EjecutorSql) {}

  /** Inserta un pago y devuelve su id. */
  async insertarPago(pago: Omit<Pago, 'id'>): Promise<number> {
    const r = await this.ejecutor.correr(
      `INSERT INTO pagos
         (fecha, mes_pago, anio_pago, utm_valor, cuota_pactada,
          monto_pagado, desbalance, utm_factor)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        pago.fecha, pago.mesPago, pago.anioPago, pago.utmValor,
        pago.cuotaPactada, pago.montoPagado, pago.desbalance,
        pago.utmFactor ?? null,
      ],
    );
    if (r.ultimoId === null) {
      throw new Error('No se pudo insertar el pago: SQLite no devolvió un id.');
    }
    return r.ultimoId;
  }

  /** Todos los pagos, del más reciente al más antiguo. */
  async obtenerTodosLosPagos(): Promise<Pago[]> {
    const filas = await this.ejecutor.consultar<FilaPago>(
      `SELECT ${COLUMNAS_PAGO} FROM pagos ORDER BY anio_pago DESC, mes_pago DESC`,
    );
    return filas.map(aPago);
  }

  /** Un pago por su id, o null si no existe. */
  async obtenerPagoPorId(id: number): Promise<Pago | null> {
    const filas = await this.ejecutor.consultar<FilaPago>(
      `SELECT ${COLUMNAS_PAGO} FROM pagos WHERE id = ?`,
      [id],
    );
    return filas.length > 0 ? aPago(filas[0]!) : null;
  }
}
