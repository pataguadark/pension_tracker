/**
 * La frontera entre el repositorio y el motor SQLite.
 *
 * El repositorio no conoce Capacitor: habla con esta interfaz. En el
 * teléfono la implementa @capacitor-community/sqlite; en las pruebas la
 * implementa node:sqlite. Así el SQL de producción se ejecuta contra un
 * SQLite real en cada corrida de tests, sin emulador ni dispositivo.
 */

export interface ResultadoEscritura {
  /** Filas afectadas por la sentencia. */
  cambios: number;
  /** Id de la última fila insertada, o null si la sentencia no insertó. */
  ultimoId: number | null;
}

export interface EjecutorSql {
  /** Sentencias sin parámetros ni resultados: DDL, PRAGMA, control de transacción. */
  ejecutar(sql: string): Promise<void>;

  /** Escrituras con parámetros: INSERT, UPDATE, DELETE. */
  correr(sql: string, params?: unknown[]): Promise<ResultadoEscritura>;

  /** Lecturas: SELECT. */
  consultar<T>(sql: string, params?: unknown[]): Promise<T[]>;
}
