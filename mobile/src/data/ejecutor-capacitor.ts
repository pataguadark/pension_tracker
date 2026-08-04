/**
 * Implementación de EjecutorSql sobre @capacitor-community/sqlite.
 *
 * Es la implementación de producción: la que corre en el teléfono. Cumple el
 * contrato de transacciones documentado en ejecutor.ts, que existe porque el
 * plugin envuelve cada escritura en una transacción implícita y rechaza el
 * anidamiento.
 */

import { esSentenciaInsert, type EjecutorSql, type ResultadoEscritura } from './ejecutor';
import type { ConexionPluginSqlite } from './plugin-sqlite';

/**
 * `BEGIN`, `BEGIN TRANSACTION`, `BEGIN IMMEDIATE`, `BEGIN DEFERRED`,
 * `BEGIN EXCLUSIVE`, `BEGIN IMMEDIATE TRANSACTION`, `COMMIT;`, `ROLLBACK`…
 * en cualquier caja.
 *
 * Ancla la cadena completa (`^...$`) a propósito: así NO matchea
 * `CREATE TRIGGER a BEGIN ... END` (empieza con CREATE, no con una de estas
 * palabras), ni `ROLLBACK TO SAVEPOINT x` / `SAVEPOINT x` / `RELEASE x`
 * (les sobra texto después del comando que la cadena no consume antes del
 * `$`). Ver ejecutor-capacitor.test.ts para las pruebas que fijan ambos
 * lados: lo que sí debe reconocer y lo que no.
 */
const CONTROL_DE_TRANSACCION =
  /^\s*(begin|commit|rollback|end)\b(\s+(?:immediate|deferred|exclusive)\b)?(\s+transaction\b)?\s*;?\s*$/i;

export class EjecutorCapacitor implements EjecutorSql {
  /**
   * Espejo local de si hay una transacción explícita abierta.
   *
   * No se consulta `isTransactionActive()` antes de cada escritura porque
   * cada llamada cruza el puente nativo; se comprueba una sola vez al abrir,
   * que es el mismo patrón que usa `executeTransaction` dentro del plugin.
   *
   * Limitación conocida: el estado es del objeto, no de la conexión, así que
   * dos transacciones simultáneas sobre el mismo ejecutor se pisarían. La app
   * escribe desde un solo hilo de JS y nunca abre dos a la vez; si eso
   * cambia, esto necesita revisión.
   */
  private enTransaccion = false;

  constructor(private readonly conexion: ConexionPluginSqlite) {}

  async ejecutar(sql: string): Promise<void> {
    const comando = CONTROL_DE_TRANSACCION.exec(sql)?.[1]?.toUpperCase();

    if (comando === 'BEGIN') {
      await this.conexion.beginTransaction();
      // `isTransactionActive()` devuelve `{ result?: boolean }`, no un
      // booleano. Negar el objeto directo (`!await ...`) da siempre `false`
      // y convertía esta guarda en código muerto: hay que leer `result`.
      // Un `result` ausente cuenta como "no la abrió": si el plugin no
      // confirma, no se puede dar por abierta una transacción de la que
      // dependen escrituras.
      if ((await this.conexion.isTransactionActive()).result !== true) {
        throw new Error('El plugin no abrió la transacción tras beginTransaction');
      }
      this.enTransaccion = true;
      return;
    }

    if (comando === 'COMMIT' || comando === 'END') {
      await this.conexion.commitTransaction();
      this.enTransaccion = false;
      return;
    }

    if (comando === 'ROLLBACK') {
      // El flag baja aunque el rollback falle: si no se pudo deshacer, la
      // transacción tampoco sigue siendo nuestra para escribir dentro.
      this.enTransaccion = false;
      await this.conexion.rollbackTransaction();
      return;
    }

    await this.conexion.execute(sql, !this.enTransaccion);
  }

  async correr(sql: string, params: unknown[] = []): Promise<ResultadoEscritura> {
    const r = await this.conexion.run(sql, params, !this.enTransaccion);
    const cambios = r.changes?.changes;
    // El plugin declara `changes` opcional. En la práctica siempre viene;
    // si faltara, no se puede decir cuántas filas se afectaron, y devolver 0
    // sería indistinguible de "no escribió nada" -que es justo lo que quien
    // llama usa para decidir-. Antes de mentir, falla.
    if (typeof cambios !== 'number') {
      throw new Error('El plugin no informó cuántas filas afectó la sentencia');
    }
    const id = r.changes?.lastId;
    // El plugin devuelve -1 (o 0) cuando no hay id que informar, así que no
    // basta con que venga definido: tiene que ser positivo y venir de un
    // INSERT que de verdad afectó una fila. Mismo criterio que EjecutorNode.
    const ultimoId =
      esSentenciaInsert(sql) && cambios > 0 && typeof id === 'number' && id > 0 ? id : null;
    return { cambios, ultimoId };
  }

  async consultar<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    const r = await this.conexion.query<T>(sql, params);
    return r.values ?? [];
  }
}
