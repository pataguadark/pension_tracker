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
  /**
   * Sentencias sin parámetros ni resultados: DDL, PRAGMA, control de
   * transacción (`BEGIN`, `COMMIT`, `ROLLBACK`).
   *
   * Contrato para BEGIN/COMMIT/ROLLBACK -obligatorio para cualquier
   * implementación sobre @capacitor-community/sqlite, no solo para
   * node:sqlite-:
   *
   * Ese plugin ejecuta cada `run`/`execute` dentro de su propia transacción
   * implícita por defecto. Si `ejecutar()` se limita a reenviar el texto
   * `"BEGIN"` tal cual (como hace EjecutorNode, porque node:sqlite acepta
   * BEGIN crudo), un `correr()` posterior -que en el plugin real invoca
   * `run()`- intenta abrir SU PROPIA transacción por encima de la ya
   * abierta y el plugin rechaza el anidamiento con
   * "cannot start a transaction within a transaction": el lote entero
   * (ver `guardarUtmBulk` en repositorio.ts) no se escribe.
   *
   * La interfaz no necesita cambiar para resolverlo. Lo que debe hacer
   * cualquier implementación de `EjecutorSql` sobre ese plugin:
   *
   *   1. Interceptar en `ejecutar()` las sentencias `"BEGIN"`, `"COMMIT"` y
   *      `"ROLLBACK"` -no reenviarlas como SQL crudo- y traducirlas a las
   *      llamadas de transacción propias del plugin
   *      (`beginTransaction()` / `commitTransaction()` /
   *      `rollbackTransaction()`, o el nombre que use esa versión del
   *      plugin), llevando internamente un flag de "hay una transacción
   *      abierta".
   *   2. Mientras ese flag esté activo, cada `correr()` debe invocar
   *      `run()` del plugin con `transaction: false`, para que el plugin
   *      no intente envolver esa sentencia en una transacción propia y
   *      choque con la ya abierta explícitamente.
   *
   * Sin este mapeo, cualquier código que abra una transacción explícita
   * con `ejecutar('BEGIN')` y después escriba con `correr()` -como
   * `guardarUtmBulk`- falla en el teléfono aunque pase todas las pruebas
   * contra node:sqlite. Ver el ejecutor falso en repositorio.test.ts que
   * fija este contrato imitando esa restricción del plugin real.
   */
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
