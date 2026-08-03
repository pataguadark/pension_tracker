/**
 * Implementación de EjecutorSql sobre node:sqlite.
 *
 * **Solo para pruebas y desarrollo.** No debe importarse desde código que
 * termine en el bundle del teléfono: allá el motor es
 * @capacitor-community/sqlite. Vive en src/ y no en una carpeta de tests
 * porque las pruebas de interoperabilidad lo cargan desde Python.
 */

import { createRequire } from 'node:module';

import type { EjecutorSql, ResultadoEscritura } from './ejecutor';
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
    return {
      cambios: Number(r.changes),
      ultimoId: r.lastInsertRowid === undefined ? null : Number(r.lastInsertRowid),
    };
  }

  async consultar<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    return this.bd.prepare(sql).all(...(params as never[])) as T[];
  }

  cerrar(): void {
    this.bd.close();
  }
}
