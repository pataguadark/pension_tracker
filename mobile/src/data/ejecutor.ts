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

/**
 * Indica si una sentencia es un INSERT (incluye "INSERT INTO",
 * "INSERT OR REPLACE", "INSERT OR IGNORE", etc.).
 *
 * Existe para que cada implementación de `EjecutorSql` pueda calcular
 * `ultimoId` sin apoyarse en un detalle propio de su motor: ni node:sqlite
 * ni @capacitor-community/sqlite marcan de forma explícita "esta sentencia
 * no insertó nada" -devuelven el id de la última fila insertada en la
 * conexión, que persiste entre sentencias-, así que el criterio se arma con
 * lo único que cualquier motor entrega: el texto de la sentencia y las
 * filas que afectó (`cambios`). Solo un INSERT que de verdad afectó una
 * fila puede haber insertado una fila nueva.
 */
export function esSentenciaInsert(sql: string): boolean {
  return /^\s*insert\b/i.test(sql);
}
