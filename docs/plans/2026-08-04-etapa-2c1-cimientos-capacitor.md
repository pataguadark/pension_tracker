# Etapa 2c parte 1 — Cimientos de la app móvil

> **Para agentes:** SUB-SKILL OBLIGATORIA: usar superpowers:subagent-driven-development
> para ejecutar este plan tarea por tarea. Los pasos usan casillas (`- [ ]`).

**Objetivo:** dejar la capa de datos y el andamiaje de build listos para que la
etapa 2c parte 2 solo tenga que escribir pantallas.

**Arquitectura:** tres piezas independientes. (1) Un `EjecutorCapacitor` que
implementa la interfaz `EjecutorSql` ya existente sobre
`@capacitor-community/sqlite`, honrando el contrato de transacciones
documentado en `mobile/src/data/ejecutor.ts`. (2) La apertura y el ciclo de
vida de la conexión. (3) El toolchain Vite + Svelte y `capacitor.config.ts`
con `CapacitorHttp` habilitado.

**Stack:** TypeScript, vitest, Vite 5, Svelte 5, `@capacitor/core` 6,
`@capacitor-community/sqlite` 6.

## Restricciones globales

- **No se toca el escritorio (`src/pensiontracker/`) en esta etapa.** Cualquier
  cambio ahí es una divergencia, no una mejora.
- **Ninguna prueba sale a la red ni requiere un dispositivo.** La suite completa
  debe correr dentro de `unshare -rn`.
- **Comentarios y nombres en español**, igual que el resto de `mobile/src/`.
- **El bundle del teléfono nunca debe importar `ejecutor-node.ts`** (es solo
  para pruebas: usa `node:sqlite`).
- **No se genera el proyecto nativo `android/` en esta etapa.** Requiere JDK y
  Android SDK, que no están instalados; construir un APK que no se puede
  compilar aquí sería andamiaje no verificable. Va en la Etapa 4.
- El repositorio canónico es
  `/run/media/darkdiego/ssd_kingston480G/.darkprojects/dd.release/pension_tracker`
  (**con guion bajo**). El directorio `pensiontracker` sin guion bajo es un
  respaldo obsoleto: no se toca.

---

## Estructura de archivos

| Archivo | Responsabilidad | Tarea |
|---|---|---|
| `mobile/src/data/plugin-sqlite.ts` | Superficie mínima del plugin que consume el adaptador (tipos, sin lógica). | 1 |
| `mobile/src/data/ejecutor-capacitor.ts` | `EjecutorSql` sobre el plugin. | 1 |
| `mobile/src/data/plugin-falso.ts` | Doble del plugin sobre `node:sqlite` que imita sus restricciones reales. Solo pruebas. | 1 |
| `mobile/src/data/ejecutor-capacitor.test.ts` | Pruebas del adaptador. | 1 |
| `mobile/src/data/conexion.ts` | Apertura, reutilización y cierre de la conexión. | 2 |
| `mobile/src/data/conexion.test.ts` | Pruebas del ciclo de vida. | 2 |
| `mobile/capacitor.config.ts` | Configuración de Capacitor. | 3 |
| `mobile/capacitor.config.test.ts` | Fija que `CapacitorHttp` quede habilitado. | 3 |
| `mobile/vite.config.ts`, `mobile/index.html`, `mobile/src/ui/App.svelte`, `mobile/src/main.ts` | Toolchain y cáscara. | 3 |

---

### Tarea 1: Adaptador SQLite sobre @capacitor-community/sqlite

**Archivos:**
- Crear: `mobile/src/data/plugin-sqlite.ts`
- Crear: `mobile/src/data/ejecutor-capacitor.ts`
- Crear: `mobile/src/data/plugin-falso.ts`
- Crear: `mobile/src/data/ejecutor-capacitor.test.ts`
- Leer antes de empezar: `mobile/src/data/ejecutor.ts` (el contrato completo
  está en el comentario de `ejecutar()`), `mobile/src/data/ejecutor-node.ts`
  (la otra implementación de la misma interfaz).

**Interfaces:**
- Consume: `EjecutorSql`, `ResultadoEscritura`, `esSentenciaInsert` de
  `./ejecutor`.
- Produce: `class EjecutorCapacitor implements EjecutorSql`, con constructor
  `(conexion: ConexionPluginSqlite)`. La tarea 2 lo instancia.

**Por qué existe esta tarea.** El comentario de `ejecutar()` en `ejecutor.ts`
advierte de un fallo que *pasa todas las pruebas contra `node:sqlite` y falla en
el teléfono*: el plugin envuelve cada `run`/`execute` en su propia transacción
implícita, así que un `BEGIN` crudo seguido de un `correr()` produce
`"cannot start a transaction within a transaction"` y `guardarUtmBulk` no
escribe nada. El adaptador debe traducir; el doble debe reproducir la
restricción para que las pruebas la detecten.

Este es el patrón que usa el propio plugin en su `executeTransaction`:
`beginTransaction()`, comprobar `isTransactionActive()`, y ejecutar todo lo de
adentro con `transaction: false`.

- [ ] **Paso 1: Escribir la superficie del plugin**

`mobile/src/data/plugin-sqlite.ts`:

```typescript
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
```

- [ ] **Paso 2: Escribir el doble del plugin**

`mobile/src/data/plugin-falso.ts`. Se apoya en `EjecutorNode` para tener un
SQLite real detrás, y agrega encima las restricciones del plugin:

```typescript
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
```

- [ ] **Paso 3: Escribir las pruebas que fallan**

`mobile/src/data/ejecutor-capacitor.test.ts`. Cada `it` cubre una obligación
distinta del contrato; ninguno es decorativo:

```typescript
import { describe, expect, it } from 'vitest';

import { EjecutorCapacitor } from './ejecutor-capacitor';
import { EjecutorNode } from './ejecutor-node';
import { ConexionPluginFalsa } from './plugin-falso';
import { inicializarBd } from './esquema';
import { RepositorioUtm } from './repositorio';

function nuevoEjecutor(): { ejecutor: EjecutorCapacitor; plugin: ConexionPluginFalsa } {
  const plugin = new ConexionPluginFalsa(new EjecutorNode(':memory:'));
  return { ejecutor: new EjecutorCapacitor(plugin), plugin };
}

describe('EjecutorCapacitor', () => {
  it('traduce BEGIN a beginTransaction en vez de reenviarlo como SQL', async () => {
    const { ejecutor, plugin } = nuevoEjecutor();
    await ejecutor.ejecutar('BEGIN');
    expect(plugin.llamadas).toEqual([['beginTransaction', undefined]]);
  });

  it('traduce COMMIT y ROLLBACK, y reconoce las variantes con TRANSACTION y punto y coma', async () => {
    const { ejecutor, plugin } = nuevoEjecutor();
    await ejecutor.ejecutar('begin transaction;');
    await ejecutor.ejecutar('  COMMIT ;');
    await ejecutor.ejecutar('BEGIN');
    await ejecutor.ejecutar('rollback');
    expect(plugin.llamadas.map(([m]) => m)).toEqual([
      'beginTransaction', 'commitTransaction', 'beginTransaction', 'rollbackTransaction',
    ]);
  });

  it('dentro de una transacción explícita escribe con transaction:false', async () => {
    const { ejecutor, plugin } = nuevoEjecutor();
    await ejecutor.ejecutar('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)');
    await ejecutor.ejecutar('BEGIN');
    await ejecutor.correr('INSERT INTO t (v) VALUES (?)', ['a']);
    await ejecutor.ejecutar('COMMIT');
    expect(plugin.llamadas).toContainEqual(['run', false]);
  });

  it('fuera de una transacción deja que el plugin ponga la suya', async () => {
    const { ejecutor, plugin } = nuevoEjecutor();
    await ejecutor.ejecutar('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)');
    await ejecutor.correr('INSERT INTO t (v) VALUES (?)', ['a']);
    expect(plugin.llamadas).toContainEqual(['run', true]);
  });

  it('informa ultimoId solo cuando un INSERT insertó de verdad', async () => {
    const { ejecutor } = nuevoEjecutor();
    await ejecutor.ejecutar('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)');
    const alta = await ejecutor.correr('INSERT INTO t (v) VALUES (?)', ['a']);
    expect(alta.ultimoId).toBe(1);
    expect(alta.cambios).toBe(1);

    const sinEfecto = await ejecutor.correr('UPDATE t SET v = ? WHERE id = ?', ['b', 99]);
    expect(sinEfecto.ultimoId).toBeNull();
    expect(sinEfecto.cambios).toBe(0);
  });

  it('descarta el lastId centinela que el plugin devuelve cuando no aplica', async () => {
    // El plugin real no dice "no inserté nada": devuelve -1, y en algunas
    // plataformas 0. Tomarlo tal cual pondría un id inválido en un campo
    // que el repositorio usa como clave.
    const plugin = {
      run: async () => ({ changes: { changes: 1, lastId: -1 } }),
      execute: async () => ({ changes: { changes: 0 } }),
      query: async () => ({ values: [] }),
      beginTransaction: async () => ({ changes: { changes: 0 } }),
      commitTransaction: async () => ({ changes: { changes: 0 } }),
      rollbackTransaction: async () => ({ changes: { changes: 0 } }),
      isTransactionActive: async () => false,
    };
    const ejecutor = new EjecutorCapacitor(plugin);
    const r = await ejecutor.correr('INSERT INTO t (v) VALUES (?)', ['a']);
    expect(r.ultimoId).toBeNull();
  });

  it('consultar devuelve [] cuando el plugin omite values', async () => {
    // El plugin real omite `values` en vez de mandar un arreglo vacío.
    const plugin = {
      run: async () => ({ changes: { changes: 0 } }),
      execute: async () => ({ changes: { changes: 0 } }),
      query: async () => ({}),
      beginTransaction: async () => ({ changes: { changes: 0 } }),
      commitTransaction: async () => ({ changes: { changes: 0 } }),
      rollbackTransaction: async () => ({ changes: { changes: 0 } }),
      isTransactionActive: async () => false,
    };
    const ejecutor = new EjecutorCapacitor(plugin);
    expect(await ejecutor.consultar('SELECT 1')).toEqual([]);
  });

  it('guardarUtmBulk escribe el lote completo a través del adaptador', async () => {
    // Ésta es la prueba que motiva todo el contrato: contra el plugin real,
    // un BEGIN reenviado como texto haría fallar el lote entero.
    const { ejecutor } = nuevoEjecutor();
    await inicializarBd(ejecutor);
    const repo = new RepositorioUtm(ejecutor);
    await repo.guardarUtmBulk(2025, new Map([[1, 65_000], [2, 66_000], [3, 67_000]]));
    const filas = await ejecutor.consultar<{ n: number }>(
      'SELECT COUNT(*) AS n FROM utm_historial',
    );
    expect(filas[0].n).toBe(3);
  });

  it('un lote que falla a la mitad no deja filas a medio escribir', async () => {
    const { ejecutor } = nuevoEjecutor();
    await inicializarBd(ejecutor);
    await ejecutor.ejecutar('BEGIN');
    await ejecutor.correr(
      'INSERT INTO utm_historial (anio, mes, utm_valor, fecha_registro) VALUES (?,?,?,?)',
      [2025, 1, 65_000, '2025-01-01'],
    );
    await ejecutor.ejecutar('ROLLBACK');
    const filas = await ejecutor.consultar<{ n: number }>(
      'SELECT COUNT(*) AS n FROM utm_historial',
    );
    expect(filas[0].n).toBe(0);
  });
});
```

- [ ] **Paso 4: Correr las pruebas y verificar que fallan**

```bash
npm test --prefix mobile -- ejecutor-capacitor
```

Esperado: FAIL, por no existir `./ejecutor-capacitor`.

- [ ] **Paso 5: Escribir el adaptador**

`mobile/src/data/ejecutor-capacitor.ts`:

```typescript
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

/** `BEGIN`, `BEGIN TRANSACTION`, `COMMIT;`, `ROLLBACK`… en cualquier caja. */
const CONTROL_DE_TRANSACCION = /^\s*(begin|commit|rollback|end)\b(\s+transaction\b)?\s*;?\s*$/i;

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
      if (!(await this.conexion.isTransactionActive())) {
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
    const cambios = r.changes.changes;
    const id = r.changes.lastId;
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
```

- [ ] **Paso 6: Correr las pruebas y verificar que pasan**

```bash
npm test --prefix mobile -- ejecutor-capacitor
npm run typecheck --prefix mobile
```

Esperado: PASS las 9, tipos limpios.

- [ ] **Paso 7: Correr la suite completa**

```bash
npm test --prefix mobile
```

Esperado: todo verde, sin regresiones.

- [ ] **Paso 8: Commit**

```bash
git add mobile/src/data/
git commit -m "Adaptador SQLite sobre Capacitor con el contrato de transacciones"
```

---

### Tarea 2: Apertura y ciclo de vida de la conexión

**Archivos:**
- Crear: `mobile/src/data/conexion.ts`
- Crear: `mobile/src/data/conexion.test.ts`

**Interfaces:**
- Consume: `EjecutorCapacitor` (tarea 1), `ConexionPluginSqlite` (tarea 1),
  `inicializarBd` de `./esquema`.
- Produce: `abrirBaseDeDatos(fabrica: FabricaDeConexiones): Promise<EjecutorCapacitor>`
  y `cerrarBaseDeDatos(fabrica: FabricaDeConexiones): Promise<void>`. La parte 2
  de la etapa 2c los llama al arrancar la app.

**Contexto.** `SQLiteConnection` de Capacitor lleva un diccionario de conexiones
en JS que puede quedar desincronizado del estado nativo cuando Android mata y
recrea el WebView. El plugin expone `checkConnectionsConsistency()` para eso: si
devuelve `false`, el diccionario JS se vació y hay que crear la conexión de
nuevo en vez de recuperarla. Saltarse ese paso es el motivo habitual de
`"Connection ... does not exist"` al volver a abrir la app.

- [ ] **Paso 1: Escribir las pruebas que fallan**

`mobile/src/data/conexion.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';

import { abrirBaseDeDatos, cerrarBaseDeDatos, NOMBRE_BD } from './conexion';
import { EjecutorNode } from './ejecutor-node';
import { ConexionPluginFalsa } from './plugin-falso';

/** Doble de `SQLiteConnection`: el objeto que fabrica conexiones. */
class FabricaFalsa {
  readonly llamadas: string[] = [];
  conexion: ConexionPluginFalsa & { open: () => Promise<void>; close: () => Promise<void> };
  abierta = false;

  constructor(public consistente = true, public existe = false) {
    const plugin = new ConexionPluginFalsa(new EjecutorNode(':memory:'));
    this.conexion = Object.assign(plugin, {
      open: async () => { this.abierta = true; },
      close: async () => { this.abierta = false; },
    });
  }

  async checkConnectionsConsistency() {
    this.llamadas.push('checkConnectionsConsistency');
    return { result: this.consistente };
  }
  async isConnection(_bd: string, _ro: boolean) {
    this.llamadas.push('isConnection');
    return { result: this.existe };
  }
  async retrieveConnection(_bd: string, _ro: boolean) {
    this.llamadas.push('retrieveConnection');
    return this.conexion;
  }
  async createConnection(_bd: string, _e: boolean, _m: string, _v: number, _ro: boolean) {
    this.llamadas.push('createConnection');
    return this.conexion;
  }
  async closeConnection(_bd: string, _ro: boolean) {
    this.llamadas.push('closeConnection');
  }
}

describe('abrirBaseDeDatos', () => {
  it('crea la conexión cuando no existe', async () => {
    const fabrica = new FabricaFalsa(true, false);
    await abrirBaseDeDatos(fabrica);
    expect(fabrica.llamadas).toContain('createConnection');
    expect(fabrica.llamadas).not.toContain('retrieveConnection');
    expect(fabrica.abierta).toBe(true);
  });

  it('reutiliza la conexión existente en vez de crear otra', async () => {
    const fabrica = new FabricaFalsa(true, true);
    await abrirBaseDeDatos(fabrica);
    expect(fabrica.llamadas).toContain('retrieveConnection');
    expect(fabrica.llamadas).not.toContain('createConnection');
  });

  it('crea de nuevo cuando el diccionario de conexiones quedó inconsistente', async () => {
    // Android mató el WebView: el plugin dice que existe, pero el
    // diccionario JS ya se vació. Recuperarla lanzaría "does not exist".
    const fabrica = new FabricaFalsa(false, true);
    await abrirBaseDeDatos(fabrica);
    expect(fabrica.llamadas).toContain('createConnection');
    expect(fabrica.llamadas).not.toContain('retrieveConnection');
  });

  it('comprueba la consistencia antes de decidir', async () => {
    const fabrica = new FabricaFalsa(true, true);
    await abrirBaseDeDatos(fabrica);
    expect(fabrica.llamadas[0]).toBe('checkConnectionsConsistency');
  });

  it('deja el esquema creado y utilizable', async () => {
    const fabrica = new FabricaFalsa();
    const ejecutor = await abrirBaseDeDatos(fabrica);
    const tablas = await ejecutor.consultar<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
    );
    expect(tablas.map((t) => t.name)).toEqual(
      expect.arrayContaining(['configuracion', 'pagos', 'utm_historial']),
    );
  });

  it('cerrarBaseDeDatos cierra la conexión del plugin', async () => {
    const fabrica = new FabricaFalsa();
    await abrirBaseDeDatos(fabrica);
    await cerrarBaseDeDatos(fabrica);
    expect(fabrica.llamadas).toContain('closeConnection');
  });

  it('el nombre de la base no lleva extensión .db', async () => {
    // El plugin le agrega "SQLite.db" al nombre; pasarle "algo.db" produce
    // un archivo distinto del que abre al reiniciar.
    expect(NOMBRE_BD.endsWith('.db')).toBe(false);
  });
});
```

- [ ] **Paso 2: Correr y verificar que fallan**

```bash
npm test --prefix mobile -- conexion
```

Esperado: FAIL, por no existir `./conexion`.

- [ ] **Paso 3: Escribir la implementación**

`mobile/src/data/conexion.ts`:

```typescript
/**
 * Apertura y cierre de la base de datos local en el teléfono.
 *
 * Es el único lugar que conoce el nombre del archivo y el orden en que hay
 * que hablarle a `SQLiteConnection`.
 */

import { EjecutorCapacitor } from './ejecutor-capacitor';
import { inicializarBd } from './esquema';
import type { ConexionPluginSqlite } from './plugin-sqlite';

/** Sin extensión: el plugin le agrega el sufijo `SQLite.db` por su cuenta. */
export const NOMBRE_BD = 'pensiontracker';

type ConexionAbrible = ConexionPluginSqlite & {
  open(): Promise<void>;
  close(): Promise<void>;
};

/** La porción de `SQLiteConnection` que se usa acá. */
export interface FabricaDeConexiones {
  checkConnectionsConsistency(): Promise<{ result: boolean }>;
  isConnection(database: string, readonly: boolean): Promise<{ result?: boolean }>;
  retrieveConnection(database: string, readonly: boolean): Promise<ConexionAbrible>;
  createConnection(
    database: string, encrypted: boolean, mode: string, version: number, readonly: boolean,
  ): Promise<ConexionAbrible>;
  closeConnection(database: string, readonly: boolean): Promise<void>;
}

/**
 * Deja la base abierta, migrada y lista para usar.
 *
 * El orden importa: primero `checkConnectionsConsistency`, porque cuando
 * Android recrea el WebView el diccionario de conexiones de JS puede afirmar
 * que la conexión existe mientras el lado nativo ya la perdió. Recuperarla en
 * ese estado falla con "Connection ... does not exist".
 */
export async function abrirBaseDeDatos(
  fabrica: FabricaDeConexiones,
): Promise<EjecutorCapacitor> {
  const consistencia = await fabrica.checkConnectionsConsistency();
  const yaExiste = (await fabrica.isConnection(NOMBRE_BD, false)).result === true;

  const conexion =
    consistencia.result && yaExiste
      ? await fabrica.retrieveConnection(NOMBRE_BD, false)
      : await fabrica.createConnection(NOMBRE_BD, false, 'no-encryption', 1, false);

  await conexion.open();

  const ejecutor = new EjecutorCapacitor(conexion);
  await inicializarBd(ejecutor);
  return ejecutor;
}

export async function cerrarBaseDeDatos(fabrica: FabricaDeConexiones): Promise<void> {
  await fabrica.closeConnection(NOMBRE_BD, false);
}
```

- [ ] **Paso 4: Correr y verificar que pasan**

```bash
npm test --prefix mobile -- conexion
npm run typecheck --prefix mobile
```

Esperado: PASS las 7.

- [ ] **Paso 5: Commit**

```bash
git add mobile/src/data/conexion.ts mobile/src/data/conexion.test.ts
git commit -m "Apertura de la base con reconstruccion tras perder el WebView"
```

---

### Tarea 3: Toolchain Vite + Svelte y configuración de Capacitor

**Archivos:**
- Modificar: `mobile/package.json`
- Crear: `mobile/vite.config.ts`, `mobile/index.html`, `mobile/src/main.ts`,
  `mobile/src/ui/App.svelte`, `mobile/capacitor.config.ts`,
  `mobile/capacitor.config.test.ts`
- Modificar: `mobile/tsconfig.json`, `mobile/.gitignore`
- Modificar: `.github/workflows/tests.yml`

**Interfaces:**
- Produce: el script `npm run build --prefix mobile`, que deja el bundle en
  `mobile/dist/`. La parte 2 de la etapa 2c escribe pantallas dentro de
  `mobile/src/ui/`.

**Contexto.** Sin `CapacitorHttp` habilitado, el `fetch` de `ClienteHttpFetch`
(`mobile/src/utm/cliente-http.ts`) sale desde el WebView como una petición de
navegador y mindicador.cl la bloquea por CORS: la app quedaría sin valor de UTM
en el teléfono aunque las 289 pruebas sigan verdes. El plugin parcha `fetch`
para que vaya por la capa nativa, donde CORS no aplica. Por eso la
configuración lleva su propia prueba: es un booleano en un archivo que nadie
mira, y perderlo rompe la app sin romper ninguna prueba.

- [ ] **Paso 1: Instalar dependencias**

```bash
npm install --prefix mobile --save-dev vite @sveltejs/vite-plugin-svelte svelte svelte-check
npm install --prefix mobile @capacitor/core @capacitor/cli @capacitor-community/sqlite
```

- [ ] **Paso 2: Escribir la prueba de configuración que falla**

`mobile/capacitor.config.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';

import config from './capacitor.config';

describe('capacitor.config', () => {
  it('habilita CapacitorHttp', () => {
    // Sin esto, fetch sale del WebView como petición de navegador y
    // mindicador.cl la rechaza por CORS: la app se queda sin UTM en el
    // teléfono, sin que ninguna otra prueba lo note.
    expect(config.plugins?.CapacitorHttp?.enabled).toBe(true);
  });

  it('sirve el bundle que produce Vite', () => {
    expect(config.webDir).toBe('dist');
  });

  it('usa el identificador de aplicación del proyecto', () => {
    expect(config.appId).toBe('cl.pensiontracker.app');
  });
});
```

- [ ] **Paso 3: Correr y verificar que falla**

```bash
npm test --prefix mobile -- capacitor.config
```

Esperado: FAIL, por no existir `./capacitor.config`.

- [ ] **Paso 4: Escribir la configuración**

`mobile/capacitor.config.ts`:

```typescript
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'cl.pensiontracker.app',
  appName: 'Pensión Tracker',
  webDir: 'dist',
  plugins: {
    // Hace que `fetch` vaya por la capa nativa. Sin esto, la consulta a
    // mindicador.cl muere por CORS dentro del WebView. Ver el comentario en
    // capacitor.config.test.ts.
    CapacitorHttp: { enabled: true },
  },
};

export default config;
```

- [ ] **Paso 5: Escribir el toolchain**

`mobile/vite.config.ts`:

```typescript
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [svelte()],
  // Rutas relativas: el WebView de Android sirve desde file:// y las
  // absolutas no resuelven.
  base: './',
  build: { outDir: 'dist', emptyOutDir: true },
});
```

`mobile/index.html`:

```html
<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>Pensión Tracker</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

`mobile/src/main.ts`:

```typescript
import { mount } from 'svelte';

import App from './ui/App.svelte';
import './ui/estilo.css';

export default mount(App, { target: document.getElementById('app')! });
```

`mobile/src/ui/App.svelte` — cáscara mínima; la parte 2 la reemplaza por las
pantallas:

```svelte
<main class="contenedor">
  <h1>Pensión Tracker</h1>
</main>
```

`mobile/src/ui/estilo.css`: copiar `src/pensiontracker/static/style.css` tal
cual con `cp`. **No editarlo en esta tarea**: adaptarlo es trabajo de la parte
2, y mezclarlo acá esconde qué cambió respecto del escritorio.

```bash
cp src/pensiontracker/static/style.css mobile/src/ui/estilo.css
```

- [ ] **Paso 6: Actualizar package.json, tsconfig y .gitignore**

En `mobile/package.json`, agregar a `scripts`:

```json
"build": "vite build",
"dev": "vite"
```

En `mobile/tsconfig.json`, asegurar que `include` cubra `capacitor.config.ts` y
`src/**/*.svelte`, y que `compilerOptions` tenga `"types": ["vite/client"]`
además de lo que ya tenga. No quitar nada de lo existente.

En `mobile/.gitignore`, agregar `dist/` y `.vite/`.

- [ ] **Paso 7: Verificar que todo pasa y que el bundle se construye**

```bash
npm test --prefix mobile
npm run typecheck --prefix mobile
npm run build --prefix mobile
```

Esperado: las 3 pruebas nuevas en verde, la suite completa sin regresiones,
tipos limpios, y `mobile/dist/index.html` existente.

- [ ] **Paso 8: Agregar el build al CI**

En `.github/workflows/tests.yml`, dentro del job `typescript`, después del paso
de tests:

```yaml
      - name: Construir el bundle
        run: npm run build --prefix mobile
```

- [ ] **Paso 9: Commit**

```bash
git add mobile/ .github/workflows/tests.yml
git commit -m "Toolchain Vite + Svelte y configuracion de Capacitor con CapacitorHttp"
```

---

## Fuera de alcance (queda anotado)

- **Proyecto nativo `android/`** y compilación del APK: requieren JDK y Android
  SDK, que no están instalados en esta máquina. Etapa 4.
- **Pantallas**: etapa 2c parte 2.
- **`PRAGMA foreign_keys`** no está en el contrato de `EjecutorSql`.
  `EjecutorNode` lo activa en su constructor y el adaptador de Capacitor no.
  Hoy no cambia nada porque el esquema no tiene claves foráneas; si alguna vez
  las tiene, las dos implementaciones divergirían en silencio.
