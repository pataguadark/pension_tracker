/**
 * La porción de `SQLiteDBConnection` (@capacitor-community/sqlite) que
 * consume el adaptador.
 *
 * Se declara acá en vez de importar el tipo del plugin para que las pruebas
 * puedan pasar un doble sin instalar ni cargar el plugin, que en Node no
 * tiene implementación. `SQLiteDBConnection` satisface esta interfaz
 * estructuralmente.
 */

/** Lo que devuelven `execute`, `run` y las llamadas de transacción. */
export interface CambiosSqlite {
  changes: {
    changes: number;
    /**
     * Id de la última fila insertada. El plugin devuelve -1 (y en algunas
     * plataformas 0) cuando no aplica, no `undefined`, así que quien lo lea
     * debe descartar los valores no positivos.
     */
    lastId?: number;
  };
}

export interface ConexionPluginSqlite {
  /** `transaction` por defecto es `true`: envuelve la sentencia en una transacción propia. */
  execute(statements: string, transaction?: boolean): Promise<CambiosSqlite>;
  run(statement: string, values?: unknown[], transaction?: boolean): Promise<CambiosSqlite>;
  query<T>(statement: string, values?: unknown[]): Promise<{ values?: T[] }>;
  beginTransaction(): Promise<CambiosSqlite>;
  commitTransaction(): Promise<CambiosSqlite>;
  rollbackTransaction(): Promise<CambiosSqlite>;
  isTransactionActive(): Promise<boolean>;
}
