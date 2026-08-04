/**
 * La porción de `SQLiteDBConnection` (@capacitor-community/sqlite) que
 * consume el adaptador.
 *
 * Se declara acá en vez de reexportar el tipo del plugin para que las pruebas
 * puedan pasar un doble mínimo, sin implementar la clase entera ni cargar el
 * plugin (que en Node no tiene implementación nativa).
 *
 * Estos tipos deben seguir siendo un subconjunto fiel de los reales. No es
 * una promesa de buena voluntad: `compatibilidad-plugin.ts` afirma la
 * asignabilidad contra los `.d.ts` del plugin, así que `tsc` falla si esto
 * se desalinea. Se escribió después de descubrir que la declaración original
 * daba `isTransactionActive()` devolviendo un booleano cuando el plugin
 * devuelve un objeto, lo que convertía una guarda de seguridad en código
 * muerto.
 */

/**
 * Lo que devuelven `execute`, `run` y las llamadas de transacción.
 *
 * Todo es opcional porque así lo declara `capSQLiteChanges` del plugin. En la
 * práctica siempre viene, pero el tipo permite que falte y el adaptador tiene
 * que decidir qué hacer en ese caso en vez de asumir.
 */
export interface CambiosSqlite {
  changes?: {
    changes?: number;
    /**
     * Id de la última fila insertada. El plugin devuelve -1 (y en algunas
     * plataformas 0) cuando no aplica, así que quien lo lea debe descartar
     * los valores no positivos.
     */
    lastId?: number;
  };
}

/** Lo que devuelven `isTransactionActive` y compañía: `capSQLiteResult`. */
export interface ResultadoSqlite {
  result?: boolean;
}

export interface ConexionPluginSqlite {
  /** `transaction` por defecto es `true`: envuelve la sentencia en una transacción propia. */
  execute(statements: string, transaction?: boolean): Promise<CambiosSqlite>;
  run(statement: string, values?: unknown[], transaction?: boolean): Promise<CambiosSqlite>;
  query<T>(statement: string, values?: unknown[]): Promise<{ values?: T[] }>;
  beginTransaction(): Promise<CambiosSqlite>;
  commitTransaction(): Promise<CambiosSqlite>;
  rollbackTransaction(): Promise<CambiosSqlite>;
  /** Devuelve un objeto, no un booleano: negarlo directo siempre da `false`. */
  isTransactionActive(): Promise<ResultadoSqlite>;
}
