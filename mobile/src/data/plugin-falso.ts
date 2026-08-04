/**
 * Doble de `SQLiteDBConnection` sobre node:sqlite, con las restricciones del
 * plugin real encima. **Solo para pruebas.**
 *
 * Lo que imita, y por qué importa:
 *
 *   - `run()` y `execute()` abren su propia transacción salvo que se les pase
 *     `transaction: false`. Un SQLite crudo acepta escrituras sueltas sin
 *     chistar, así que sin esta imitación el adaptador podría reenviar
 *     `BEGIN` como texto y las pruebas seguirían verdes mientras el teléfono
 *     falla.
 *   - Una transacción anidada es un error, con el mensaje del plugin real.
 */

import { EjecutorNode } from './ejecutor-node';
import type { CambiosSqlite, ConexionPluginSqlite } from './plugin-sqlite';

const ERROR_ANIDADO = 'cannot start a transaction within a transaction';

export class ConexionPluginFalsa implements ConexionPluginSqlite {
  private activa = false;
  /** Cada llamada registrada como `[metodo, transaction]`, para las aserciones. */
  readonly llamadas: Array<[string, boolean | undefined]> = [];

  constructor(private readonly motor: EjecutorNode) {}

  private async abrirImplicita(): Promise<void> {
    if (this.activa) throw new Error(ERROR_ANIDADO);
    this.activa = true;
    await this.motor.ejecutar('BEGIN');
  }

  private async cerrarImplicita(): Promise<void> {
    await this.motor.ejecutar('COMMIT');
    this.activa = false;
  }

  async execute(statements: string, transaction?: boolean): Promise<CambiosSqlite> {
    this.llamadas.push(['execute', transaction]);
    const propia = transaction !== false;
    if (propia) await this.abrirImplicita();
    try {
      await this.motor.ejecutar(statements);
    } catch (error) {
      if (propia) {
        await this.motor.ejecutar('ROLLBACK');
        this.activa = false;
      }
      throw error;
    }
    if (propia) await this.cerrarImplicita();
    return { changes: { changes: 0 } };
  }

  async run(statement: string, values: unknown[] = [],
            transaction?: boolean): Promise<CambiosSqlite> {
    this.llamadas.push(['run', transaction]);
    const propia = transaction !== false;
    if (propia) await this.abrirImplicita();
    try {
      const r = await this.motor.correr(statement, values);
      if (propia) await this.cerrarImplicita();
      return { changes: { changes: r.cambios, lastId: r.ultimoId ?? -1 } };
    } catch (error) {
      if (propia) {
        await this.motor.ejecutar('ROLLBACK');
        this.activa = false;
      }
      throw error;
    }
  }

  async query<T>(statement: string, values: unknown[] = []): Promise<{ values?: T[] }> {
    this.llamadas.push(['query', undefined]);
    return { values: await this.motor.consultar<T>(statement, values) };
  }

  async beginTransaction(): Promise<CambiosSqlite> {
    this.llamadas.push(['beginTransaction', undefined]);
    if (this.activa) throw new Error(ERROR_ANIDADO);
    this.activa = true;
    await this.motor.ejecutar('BEGIN');
    return { changes: { changes: 0 } };
  }

  async commitTransaction(): Promise<CambiosSqlite> {
    this.llamadas.push(['commitTransaction', undefined]);
    await this.motor.ejecutar('COMMIT');
    this.activa = false;
    return { changes: { changes: 0 } };
  }

  async rollbackTransaction(): Promise<CambiosSqlite> {
    this.llamadas.push(['rollbackTransaction', undefined]);
    await this.motor.ejecutar('ROLLBACK');
    this.activa = false;
    return { changes: { changes: 0 } };
  }

  async isTransactionActive(): Promise<boolean> {
    return this.activa;
  }
}
