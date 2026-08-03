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

export interface ResumenAnual {
  cantidadPagos: number;
  totalPagado: number;
  totalPactado: number;
  desbalanceAcumulado: number;
}

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

  /** Reemplaza los datos de un pago. Devuelve false si el id no existe. */
  async actualizarPago(id: number, pago: Omit<Pago, 'id'>): Promise<boolean> {
    const r = await this.ejecutor.correr(
      `UPDATE pagos SET
         fecha = ?, mes_pago = ?, anio_pago = ?, utm_valor = ?,
         cuota_pactada = ?, monto_pagado = ?, desbalance = ?, utm_factor = ?
       WHERE id = ?`,
      [
        pago.fecha, pago.mesPago, pago.anioPago, pago.utmValor,
        pago.cuotaPactada, pago.montoPagado, pago.desbalance,
        pago.utmFactor ?? null, id,
      ],
    );
    return r.cambios > 0;
  }

  /** Borra un pago. Devuelve false si el id no existe. */
  async eliminarPago(id: number): Promise<boolean> {
    const r = await this.ejecutor.correr('DELETE FROM pagos WHERE id = ?', [id]);
    return r.cambios > 0;
  }

  /**
   * Pagos de un año, de enero a diciembre.
   *
   * Orden ascendente a propósito: es el del escritorio
   * (db_manager.py:190), aunque obtenerTodosLosPagos ordene al revés.
   * Replicarlo mantiene idéntica la vista anual en ambas plataformas.
   */
  async obtenerPagosPorAnio(anio: number): Promise<Pago[]> {
    const filas = await this.ejecutor.consultar<FilaPago>(
      `SELECT ${COLUMNAS_PAGO} FROM pagos WHERE anio_pago = ? ORDER BY mes_pago ASC`,
      [anio],
    );
    return filas.map(aPago);
  }

  /**
   * Totales de un año.
   *
   * SUM() devuelve NULL cuando no hay filas, no 0. Se normaliza acá para
   * que ninguna capa de arriba tenga que recordarlo.
   */
  async obtenerResumenAnual(anio: number): Promise<ResumenAnual> {
    const filas = await this.ejecutor.consultar<{
      cantidad_pagos: number;
      total_pagado: number | null;
      total_pactado: number | null;
      desbalance_acumulado: number | null;
    }>(
      `SELECT COUNT(*)           AS cantidad_pagos,
              SUM(monto_pagado)  AS total_pagado,
              SUM(cuota_pactada) AS total_pactado,
              SUM(desbalance)    AS desbalance_acumulado
         FROM pagos WHERE anio_pago = ?`,
      [anio],
    );
    const f = filas[0]!;
    return {
      cantidadPagos: f.cantidad_pagos,
      totalPagado: f.total_pagado ?? 0,
      totalPactado: f.total_pactado ?? 0,
      desbalanceAcumulado: f.desbalance_acumulado ?? 0,
    };
  }
}

export interface UtmGuardada {
  anio: number;
  mes: number;
  utmValor: number;
  fechaRegistro: string;
}

interface FilaUtm {
  anio: number;
  mes: number;
  utm_valor: number;
  fecha_registro: string;
}

function aUtm(fila: FilaUtm): UtmGuardada {
  return {
    anio: fila.anio,
    mes: fila.mes,
    utmValor: fila.utm_valor,
    fechaRegistro: fila.fecha_registro,
  };
}

/** Momento actual en el formato que usa la columna fecha_registro. */
function ahoraPorDefecto(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
         `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export class RepositorioUtm {
  constructor(private readonly ejecutor: EjecutorSql) {}

  /** Guarda o reemplaza el valor UTM de un mes. */
  async guardarUtm(anio: number, mes: number, utmValor: number,
                   ahora: string = ahoraPorDefecto()): Promise<void> {
    await this.ejecutor.correr(
      `INSERT OR REPLACE INTO utm_historial (anio, mes, utm_valor, fecha_registro)
       VALUES (?, ?, ?, ?)`,
      [anio, mes, utmValor, ahora],
    );
  }

  /**
   * Guarda varios meses de un mismo año. mindicador.cl trae el año
   * completo en una petición, así que se cachea todo lo recibido en vez
   * de hacer una escritura por mes.
   */
  async guardarUtmBulk(anio: number, valores: Map<number, number>,
                       ahora: string = ahoraPorDefecto()): Promise<void> {
    if (valores.size === 0) return;
    for (const [mes, valor] of valores) {
      await this.guardarUtm(anio, mes, valor, ahora);
    }
  }

  /** UTM guardada de un mes, o null si no está. */
  async obtenerUtmGuardada(anio: number, mes: number): Promise<UtmGuardada | null> {
    const filas = await this.ejecutor.consultar<FilaUtm>(
      'SELECT anio, mes, utm_valor, fecha_registro FROM utm_historial WHERE anio = ? AND mes = ?',
      [anio, mes],
    );
    return filas.length > 0 ? aUtm(filas[0]!) : null;
  }

  /** La UTM del mes más reciente que haya guardado, o null si no hay ninguna. */
  async obtenerUltimaUtmGuardada(): Promise<UtmGuardada | null> {
    const filas = await this.ejecutor.consultar<FilaUtm>(
      `SELECT anio, mes, utm_valor, fecha_registro FROM utm_historial
       ORDER BY anio DESC, mes DESC LIMIT 1`,
    );
    return filas.length > 0 ? aUtm(filas[0]!) : null;
  }

  /**
   * Factor UTM del pago más reciente que tenga uno, o null.
   *
   * El desempate por `id DESC` importa: si hay dos pagos del mismo mes y
   * año, gana el registrado después. Es el criterio del escritorio
   * (db_manager.py:367) y omitirlo dejaría el resultado a merced del
   * orden físico de las filas.
   */
  async obtenerUltimoFactorUtm(): Promise<number | null> {
    const filas = await this.ejecutor.consultar<{ utm_factor: number }>(
      `SELECT utm_factor FROM pagos WHERE utm_factor IS NOT NULL
       ORDER BY anio_pago DESC, mes_pago DESC, id DESC LIMIT 1`,
    );
    return filas.length > 0 ? filas[0]!.utm_factor : null;
  }
}

export class RepositorioConfiguracion {
  constructor(private readonly ejecutor: EjecutorSql) {}

  async guardarConfiguracion(clave: string, valor: string): Promise<void> {
    await this.ejecutor.correr(
      'INSERT OR REPLACE INTO configuracion (clave, valor) VALUES (?, ?)',
      [clave, valor],
    );
  }

  async obtenerConfiguracion(clave: string): Promise<string | null> {
    const filas = await this.ejecutor.consultar<{ valor: string }>(
      'SELECT valor FROM configuracion WHERE clave = ?',
      [clave],
    );
    return filas.length > 0 ? filas[0]!.valor : null;
  }
}
