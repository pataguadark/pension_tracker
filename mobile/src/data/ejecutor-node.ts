/**
 * Implementación de EjecutorSql sobre node:sqlite.
 *
 * **Solo para pruebas y desarrollo.** No debe importarse desde código que
 * termine en el bundle del teléfono: allá el motor es
 * @capacitor-community/sqlite. Vive en src/ y no en una carpeta de tests
 * porque las pruebas de interoperabilidad lo cargan desde Python.
 */

import { createRequire } from 'node:module';

import { esSentenciaInsert, type EjecutorSql, type ResultadoEscritura } from './ejecutor';
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';

// `node:sqlite` se carga con require() y no con un `import` estático a
// propósito: vite-node 2.1.9 (el motor detrás de vitest y del `vite-node`
// que usa la prueba de interoperabilidad en Python) no reconoce todavía
// este módulo experimental como builtin de Node -su lista viene de
// `builtinModules`, que aún no lo incluye- y al reescribir el `import`
// termina pidiendo el paquete npm "sqlite" (inexistente) en vez del núcleo
// de Node. `require`, al ser una llamada de función común, no pasa por esa
// reescritura y resuelve el módulo real.
const DatabaseSync = createRequire(import.meta.url)('node:sqlite')
  .DatabaseSync as typeof DatabaseSyncType;

export class EjecutorNode implements EjecutorSql {
  private readonly bd: DatabaseSyncType;

  constructor(ruta: string) {
    this.bd = new DatabaseSync(ruta);
    this.bd.exec('PRAGMA foreign_keys = ON');
  }

  async ejecutar(sql: string): Promise<void> {
    this.bd.exec(sql);
  }

  async correr(sql: string, params: unknown[] = []): Promise<ResultadoEscritura> {
    const r = this.bd.prepare(sql).run(...(params as never[]));
    const cambios = Number(r.changes);
    // node:sqlite nunca deja `lastInsertRowid` en `undefined`: entrega 0 o
    // el id de la última fila insertada en esta conexión, que persiste
    // entre sentencias. Un UPDATE/DELETE que no inserta nada "heredaría" así
    // el id de un INSERT anterior si se lo tomara tal cual. Por eso solo se
    // reporta `ultimoId` cuando la sentencia era un INSERT y de verdad
    // afectó una fila (ver `esSentenciaInsert` en ejecutor.ts).
    const ultimoId = esSentenciaInsert(sql) && cambios > 0 ? Number(r.lastInsertRowid) : null;
    return { cambios, ultimoId };
  }

  async consultar<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    return this.bd.prepare(sql).all(...(params as never[])) as T[];
  }

  cerrar(): void {
    this.bd.close();
  }
}
