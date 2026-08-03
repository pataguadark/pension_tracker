# Etapa 2a — Repositorio SQLite del móvil

> **Para agentes:** SUB-SKILL REQUERIDA: usar superpowers:subagent-driven-development
> (recomendado) o superpowers:executing-plans para implementar tarea por tarea.
> Los pasos usan casillas (`- [ ]`) para seguimiento.

**Goal:** Portar la capa de persistencia a TypeScript con un esquema compatible
con el del escritorio, de modo que el archivo `.db` sea intercambiable entre las
dos plataformas.

**Architecture:** El repositorio no habla con Capacitor directamente: habla con
una interfaz `EjecutorSql` de tres métodos. En producción esa interfaz la
implementa `@capacitor-community/sqlite`; en las pruebas la implementa
`node:sqlite`, que viene con Node 22. Así el SQL real se ejecuta contra un SQLite
real en cada corrida de tests, sin emulador ni dispositivo.

**Tech Stack:** TypeScript, vitest, `node:sqlite` (tests), Python 3.12 + pytest
(para las pruebas de interoperabilidad).

## Global Constraints

- Cero datos personales: valores sintéticos y redondos.
- Nombres, comentarios y docstrings en **español**; `camelCase` en TypeScript
  conservando los nombres en español.
- `mobile/src/core/` sigue siendo puro: **el core no importa nada de `data/`**.
  La dependencia va en un solo sentido, `data/` → `core/`.
- `mobile/src/data/` no importa nada del DOM ni de Svelte.
- Verde en `uv run pytest -q`, `npm test --prefix mobile` y
  `npm run typecheck --prefix mobile`.
- El SQL se escribe **siempre** con parámetros (`?`), nunca interpolando valores.

---

## Contexto

La app Android será autónoma: su propia base de datos en el teléfono, sin
sincronización. El único puente con el escritorio es el archivo `.db`, que se
exporta de un lado y se importa en el otro. Ese puente **solo funciona si el
esquema es compatible en ambas direcciones**, y es también la única vía de
migración que tendrá un usuario que quiera pasar de la versión de F-Droid a la
de GitHub Releases, porque las firmas distintas obligan a desinstalar.

Por eso esta etapa no termina cuando el repositorio funciona, sino cuando está
demostrado que una base escrita por Python se lee desde TypeScript y viceversa.

### El detalle del esquema que hay que conocer

El escritorio crea la tabla `pagos` **sin** la columna `utm_factor` y la agrega
después con `ALTER TABLE` (`db_manager.py:89-96`), porque esa columna llegó en
una versión posterior. El esquema resultante es:

```sql
CREATE TABLE pagos (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    fecha         TEXT    NOT NULL,
    mes_pago      INTEGER NOT NULL,
    anio_pago     INTEGER NOT NULL,
    utm_valor     REAL    NOT NULL,
    cuota_pactada REAL    NOT NULL,
    monto_pagado  REAL    NOT NULL,
    desbalance    REAL    NOT NULL
, utm_factor REAL)
```

**Decisión de diseño:** el móvil crea la tabla con `utm_factor` incluida al
final, en un solo `CREATE TABLE`. El texto guardado en `sqlite_master` no queda
idéntico al del escritorio, pero **la estructura sí**: mismas columnas, mismos
tipos, mismo orden, mismas restricciones.

La consecuencia es una regla que hay que respetar de ahora en adelante,
incluyendo la validación de importación de la Etapa 3: **comparar estructura con
`pragma_table_info`, nunca comparar el texto del `CREATE TABLE`.** Dos bases
funcionalmente idénticas tienen textos distintos según cuál las creó, y una
validación textual rechazaría archivos perfectamente válidos.

---

## Estructura de archivos

```
mobile/src/data/
├── ejecutor.ts          # la interfaz EjecutorSql y sus tipos
├── ejecutor-node.ts     # implementación sobre node:sqlite, SOLO para tests
├── esquema.ts           # DDL e inicialización
├── repositorio.ts       # todas las consultas
└── *.test.ts
```

---

## Task 1: Interfaz del ejecutor, esquema e interoperabilidad desde el día uno

**Files:**
- Create: `mobile/src/data/ejecutor.ts`, `mobile/src/data/ejecutor-node.ts`
- Create: `mobile/src/data/esquema.ts`, `mobile/src/data/esquema.test.ts`
- Create: `tests/test_interoperabilidad_db.py`

**Interfaces:**
- Produces:
  - `interface EjecutorSql { ejecutar(sql): Promise<void>; correr(sql, params?): Promise<ResultadoEscritura>; consultar<T>(sql, params?): Promise<T[]> }`
  - `interface ResultadoEscritura { cambios: number; ultimoId: number | null }`
  - `class EjecutorNode implements EjecutorSql` — con `cerrar()` y constructor que recibe la ruta del archivo (o `":memory:"`)
  - `inicializarBd(ejecutor: EjecutorSql): Promise<void>`
  - `TABLAS_ESPERADAS: Record<string, string[]>` — nombres de columna por tabla

La prueba de interoperabilidad va en la **primera** tarea a propósito: si el
esquema no calza, conviene descubrirlo antes de escribir quince consultas
encima.

- [ ] **Step 1: Escribir los tests que fallan**

`mobile/src/data/esquema.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { EjecutorNode } from './ejecutor-node';
import { TABLAS_ESPERADAS, inicializarBd } from './esquema';

async function bdEnMemoria(): Promise<EjecutorNode> {
  const ejecutor = new EjecutorNode(':memory:');
  await inicializarBd(ejecutor);
  return ejecutor;
}

describe('inicializarBd', () => {
  it('crea las tres tablas del esquema', async () => {
    const bd = await bdEnMemoria();
    const filas = await bd.consultar<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    );
    expect(filas.map((f) => f.name)).toEqual(['configuracion', 'pagos', 'utm_historial']);
    bd.cerrar();
  });

  it.each(Object.entries(TABLAS_ESPERADAS))(
    'la tabla %s tiene exactamente las columnas esperadas',
    async (tabla, columnas) => {
      const bd = await bdEnMemoria();
      const filas = await bd.consultar<{ name: string }>(
        `SELECT name FROM pragma_table_info('${tabla}')`,
      );
      expect(filas.map((f) => f.name)).toEqual(columnas);
      bd.cerrar();
    },
  );

  it('es idempotente: correrla dos veces no falla ni duplica tablas', async () => {
    const bd = await bdEnMemoria();
    await inicializarBd(bd);
    const filas = await bd.consultar<{ n: number }>(
      "SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='pagos'",
    );
    expect(filas[0]!.n).toBe(1);
    bd.cerrar();
  });

  it('utm_historial rechaza dos filas del mismo mes y año', async () => {
    const bd = await bdEnMemoria();
    await bd.correr(
      'INSERT INTO utm_historial (anio, mes, utm_valor, fecha_registro) VALUES (?,?,?,?)',
      [2025, 1, 67294, '2025-01-01 00:00:00'],
    );
    await expect(
      bd.correr(
        'INSERT INTO utm_historial (anio, mes, utm_valor, fecha_registro) VALUES (?,?,?,?)',
        [2025, 1, 99999, '2025-01-02 00:00:00'],
      ),
    ).rejects.toThrow();
    bd.cerrar();
  });
});

describe('EjecutorNode', () => {
  it('correr informa cuántas filas cambió y el último id insertado', async () => {
    const bd = await bdEnMemoria();
    const r = await bd.correr(
      'INSERT INTO configuracion (clave, valor) VALUES (?,?)',
      ['factor_predeterminado', '3.0561'],
    );
    expect(r.cambios).toBe(1);
    expect(r.ultimoId).not.toBeNull();
    bd.cerrar();
  });

  it('consultar devuelve las filas como objetos', async () => {
    const bd = await bdEnMemoria();
    await bd.correr('INSERT INTO configuracion (clave, valor) VALUES (?,?)', ['a', '1']);
    const filas = await bd.consultar<{ clave: string; valor: string }>(
      'SELECT clave, valor FROM configuracion',
    );
    expect(filas).toEqual([{ clave: 'a', valor: '1' }]);
    bd.cerrar();
  });

  it('usa parámetros y no interpola: una comilla en el valor no rompe nada', async () => {
    const bd = await bdEnMemoria();
    await bd.correr('INSERT INTO configuracion (clave, valor) VALUES (?,?)', [
      'raro',
      "3'); DROP TABLE pagos; --",
    ]);
    const tablas = await bd.consultar<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='pagos'",
    );
    expect(tablas).toHaveLength(1);
    bd.cerrar();
  });
});
```

`tests/test_interoperabilidad_db.py`:

```python
"""
test_interoperabilidad_db.py
----------------------------
El archivo .db es el único puente entre el escritorio y el móvil: no hay
sincronización, se exporta de un lado y se importa en el otro. Estas
pruebas verifican que el esquema que crea cada plataforma sea legible por
la otra.

Se comparan **estructuras**, no el texto del CREATE TABLE: el escritorio
crea `pagos` sin `utm_factor` y la agrega con ALTER, así que el SQL
guardado difiere aunque las columnas sean idénticas. Una comparación
textual rechazaría archivos perfectamente válidos.
"""

import json
import shutil
import sqlite3
import subprocess
from pathlib import Path

import pytest

from pensiontracker.database import db_manager

RAIZ = Path(__file__).resolve().parent.parent
MOBILE = RAIZ / "mobile"


def estructura(ruta_db: Path) -> dict:
    """Tablas y columnas de una base, en forma comparable entre plataformas."""
    conn = sqlite3.connect(ruta_db)
    try:
        tablas = [
            fila[0]
            for fila in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table' "
                "AND name NOT LIKE 'sqlite_%' ORDER BY name"
            )
        ]
        return {
            tabla: [c[1] for c in conn.execute(f"PRAGMA table_info('{tabla}')")]
            for tabla in tablas
        }
    finally:
        conn.close()


@pytest.fixture
def db_del_escritorio(tmp_path, monkeypatch) -> Path:
    ruta = tmp_path / "escritorio.db"
    monkeypatch.setattr(db_manager, "DB_PATH", ruta)
    db_manager.inicializar_db()
    return ruta


@pytest.fixture
def db_del_movil(tmp_path) -> Path:
    """Crea una base con el esquema del móvil, ejecutando el TypeScript real."""
    ruta = tmp_path / "movil.db"
    script = (
        "import { EjecutorNode } from './src/data/ejecutor-node.ts';"
        "import { inicializarBd } from './src/data/esquema.ts';"
        f"const e = new EjecutorNode({json.dumps(str(ruta))});"
        "await inicializarBd(e); e.cerrar();"
    )
    resultado = subprocess.run(
        ["npx", "vite-node", "-e", script],
        cwd=MOBILE, capture_output=True, text=True,
    )
    assert resultado.returncode == 0, (
        f"No se pudo crear la BD del móvil:\n{resultado.stdout}\n{resultado.stderr}"
    )
    return ruta


def test_ambas_plataformas_crean_la_misma_estructura(db_del_escritorio, db_del_movil):
    assert estructura(db_del_movil) == estructura(db_del_escritorio)


def test_el_escritorio_lee_una_base_creada_por_el_movil(db_del_movil, monkeypatch):
    monkeypatch.setattr(db_manager, "DB_PATH", db_del_movil)
    pago_id = db_manager.insertar_pago(
        fecha="2025-01-05", mes_pago=1, anio_pago=2025, utm_valor=67294,
        cuota_pactada=201882.0, monto_pagado=200000, desbalance=-1882.0,
        utm_factor=3.0,
    )
    pagos = db_manager.obtener_todos_los_pagos()
    assert len(pagos) == 1
    assert pagos[0]["id"] == pago_id
    assert pagos[0]["utm_factor"] == 3.0


def test_el_escritorio_no_migra_una_base_del_movil(db_del_movil, monkeypatch):
    """La migración de utm_factor debe verla ya presente y no volver a agregarla."""
    monkeypatch.setattr(db_manager, "DB_PATH", db_del_movil)
    db_manager.inicializar_db()
    columnas = estructura(db_del_movil)["pagos"]
    assert columnas.count("utm_factor") == 1
```

- [ ] **Step 2: Ver fallar los tests**

Ejecutar: `npm test --prefix mobile`
Esperado: FAIL, no existen `./ejecutor-node` ni `./esquema`.

Ejecutar: `uv run pytest tests/test_interoperabilidad_db.py -v`
Esperado: FAIL, la fixture `db_del_movil` no puede ejecutar el TypeScript.

`vite-node` ya viene con vitest (verificado: 2.1.9), así que `npx vite-node` funciona
desde `mobile/` sin instalar nada.

- [ ] **Step 3: Implementar**

`mobile/src/data/ejecutor.ts`:

```typescript
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
```

`mobile/src/data/ejecutor-node.ts`:

```typescript
/**
 * Implementación de EjecutorSql sobre node:sqlite.
 *
 * **Solo para pruebas y desarrollo.** No debe importarse desde código que
 * termine en el bundle del teléfono: allá el motor es
 * @capacitor-community/sqlite. Vive en src/ y no en una carpeta de tests
 * porque las pruebas de interoperabilidad lo cargan desde Python.
 */

import { DatabaseSync } from 'node:sqlite';

import type { EjecutorSql, ResultadoEscritura } from './ejecutor';

export class EjecutorNode implements EjecutorSql {
  private readonly bd: DatabaseSync;

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
```

`mobile/src/data/esquema.ts`:

```typescript
/**
 * Esquema de la base de datos local.
 *
 * Debe ser compatible con el del escritorio (src/pensiontracker/database/
 * db_manager.py), porque el archivo .db se intercambia entre ambas
 * plataformas: es la única vía de migración que tiene un usuario.
 *
 * El escritorio crea `pagos` sin `utm_factor` y la agrega con ALTER TABLE,
 * así que su texto guardado en sqlite_master difiere del de acá. Lo que
 * coincide —y lo único que hay que comparar— es la estructura: mismas
 * columnas, mismos tipos, mismo orden.
 */

import type { EjecutorSql } from './ejecutor';

/** Columnas de cada tabla, en orden. Referencia para validar compatibilidad. */
export const TABLAS_ESPERADAS: Record<string, string[]> = {
  pagos: [
    'id', 'fecha', 'mes_pago', 'anio_pago', 'utm_valor',
    'cuota_pactada', 'monto_pagado', 'desbalance', 'utm_factor',
  ],
  utm_historial: ['id', 'anio', 'mes', 'utm_valor', 'fecha_registro'],
  configuracion: ['clave', 'valor'],
};

const DDL = [
  `CREATE TABLE IF NOT EXISTS pagos (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    fecha         TEXT    NOT NULL,
    mes_pago      INTEGER NOT NULL,
    anio_pago     INTEGER NOT NULL,
    utm_valor     REAL    NOT NULL,
    cuota_pactada REAL    NOT NULL,
    monto_pagado  REAL    NOT NULL,
    desbalance    REAL    NOT NULL,
    utm_factor    REAL
  )`,
  `CREATE TABLE IF NOT EXISTS utm_historial (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    anio           INTEGER NOT NULL,
    mes            INTEGER NOT NULL,
    utm_valor      REAL    NOT NULL,
    fecha_registro TEXT    NOT NULL,
    UNIQUE(anio, mes)
  )`,
  `CREATE TABLE IF NOT EXISTS configuracion (
    clave TEXT PRIMARY KEY,
    valor TEXT NOT NULL
  )`,
];

/** Crea las tablas si no existen. Es idempotente. */
export async function inicializarBd(ejecutor: EjecutorSql): Promise<void> {
  for (const sentencia of DDL) {
    await ejecutar_(ejecutor, sentencia);
  }
}

async function ejecutar_(ejecutor: EjecutorSql, sql: string): Promise<void> {
  await ejecutor.ejecutar(sql);
}
```

- [ ] **Step 4: Ver pasar los tests**

Ejecutar: `npm test --prefix mobile`, `npm run typecheck --prefix mobile` y
`uv run pytest -q`. Los tres en verde.

Si `test_ambas_plataformas_crean_la_misma_estructura` falla, **el problema es el
esquema y no el test**: compara las dos salidas y corrige el DDL del móvil para
que coincida con el del escritorio, que es la referencia.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/data/ mobile/package.json mobile/package-lock.json tests/test_interoperabilidad_db.py
git commit -m "Etapa 2a: interfaz del ejecutor, esquema y prueba de interoperabilidad del .db

El repositorio habla con una interfaz de tres métodos en vez de con
Capacitor, para que las pruebas ejecuten el SQL real contra node:sqlite.
La interoperabilidad se prueba desde la primera tarea: si el esquema no
calza con el del escritorio, conviene saberlo antes de escribir las
consultas encima."
```

---

## Task 2: Pagos — insertar y leer

**Files:**
- Create: `mobile/src/data/repositorio.ts`, `mobile/src/data/repositorio.test.ts`

**Interfaces:**
- Consumes: `EjecutorSql` (Task 1), el tipo `Pago` de `../core/tipos`.
- Produces:
  - `class RepositorioPagos` con constructor `(ejecutor: EjecutorSql)`
  - `insertarPago(pago: Omit<Pago, 'id'>): Promise<number>`
  - `obtenerTodosLosPagos(): Promise<Pago[]>` — del más reciente al más antiguo
  - `obtenerPagoPorId(id: number): Promise<Pago | null>`

**Correspondencia de nombres.** La base usa `snake_case` (herencia del
escritorio, y no se puede cambiar sin romper el intercambio del `.db`); el
código TypeScript usa `camelCase`. La traducción vive **solo** en el repositorio:
ninguna otra capa debe ver un `snake_case`.

- [ ] **Step 1: Escribir los tests que fallan**

`mobile/src/data/repositorio.test.ts`:

```typescript
import { beforeEach, describe, expect, it } from 'vitest';
import { EjecutorNode } from './ejecutor-node';
import { inicializarBd } from './esquema';
import { RepositorioPagos } from './repositorio';

const PAGO_BASE = {
  fecha: '2025-01-05',
  mesPago: 1,
  anioPago: 2025,
  utmValor: 67294,
  cuotaPactada: 201882.0,
  montoPagado: 200000,
  desbalance: -1882.0,
  utmFactor: 3.0,
};

let ejecutor: EjecutorNode;
let repo: RepositorioPagos;

beforeEach(async () => {
  ejecutor = new EjecutorNode(':memory:');
  await inicializarBd(ejecutor);
  repo = new RepositorioPagos(ejecutor);
});

describe('insertarPago', () => {
  it('devuelve el id de la fila insertada', async () => {
    const id = await repo.insertarPago(PAGO_BASE);
    expect(id).toBeGreaterThan(0);
  });

  it('guarda todos los campos y los devuelve en camelCase', async () => {
    const id = await repo.insertarPago(PAGO_BASE);
    const pago = await repo.obtenerPagoPorId(id);
    expect(pago).toEqual({ ...PAGO_BASE, id });
  });

  it('acepta un pago sin factor UTM', async () => {
    const id = await repo.insertarPago({ ...PAGO_BASE, utmFactor: null });
    const pago = await repo.obtenerPagoPorId(id);
    expect(pago!.utmFactor).toBeNull();
  });
});

describe('obtenerTodosLosPagos', () => {
  it('sin pagos devuelve una lista vacía', async () => {
    expect(await repo.obtenerTodosLosPagos()).toEqual([]);
  });

  it('devuelve del más reciente al más antiguo, como el escritorio', async () => {
    await repo.insertarPago({ ...PAGO_BASE, mesPago: 1, anioPago: 2025 });
    await repo.insertarPago({ ...PAGO_BASE, mesPago: 3, anioPago: 2024 });
    await repo.insertarPago({ ...PAGO_BASE, mesPago: 2, anioPago: 2025 });
    const pagos = await repo.obtenerTodosLosPagos();
    expect(pagos.map((p) => [p.anioPago, p.mesPago])).toEqual([
      [2025, 2], [2025, 1], [2024, 3],
    ]);
  });
});

describe('obtenerPagoPorId', () => {
  it('devuelve null si el id no existe', async () => {
    expect(await repo.obtenerPagoPorId(9999)).toBeNull();
  });
});
```

- [ ] **Step 2: Ver fallar los tests**

Ejecutar: `npm test --prefix mobile`
Esperado: FAIL, no existe `./repositorio`.

- [ ] **Step 3: Implementar**

`mobile/src/data/repositorio.ts`:

```typescript
/**
 * Acceso a la base de datos. Único lugar del proyecto que sabe SQL.
 *
 * Port de src/pensiontracker/database/db_manager.py. Los nombres de
 * columna van en snake_case porque el archivo .db se comparte con el
 * escritorio y no se pueden cambiar; la traducción a camelCase ocurre
 * acá y no sale de este archivo.
 */

import type { Pago } from '../core/tipos';
import type { EjecutorSql } from './ejecutor';

/** Una fila de `pagos` tal como la devuelve SQLite. */
interface FilaPago {
  id: number;
  fecha: string;
  mes_pago: number;
  anio_pago: number;
  utm_valor: number;
  cuota_pactada: number;
  monto_pagado: number;
  desbalance: number;
  utm_factor: number | null;
}

function aPago(fila: FilaPago): Pago {
  return {
    id: fila.id,
    fecha: fila.fecha,
    mesPago: fila.mes_pago,
    anioPago: fila.anio_pago,
    utmValor: fila.utm_valor,
    cuotaPactada: fila.cuota_pactada,
    montoPagado: fila.monto_pagado,
    desbalance: fila.desbalance,
    utmFactor: fila.utm_factor,
  };
}

const COLUMNAS_PAGO =
  'id, fecha, mes_pago, anio_pago, utm_valor, cuota_pactada, monto_pagado, desbalance, utm_factor';

export class RepositorioPagos {
  constructor(private readonly ejecutor: EjecutorSql) {}

  /** Inserta un pago y devuelve su id. */
  async insertarPago(pago: Omit<Pago, 'id'>): Promise<number> {
    const r = await this.ejecutor.correr(
      `INSERT INTO pagos
         (fecha, mes_pago, anio_pago, utm_valor, cuota_pactada,
          monto_pagado, desbalance, utm_factor)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        pago.fecha, pago.mesPago, pago.anioPago, pago.utmValor,
        pago.cuotaPactada, pago.montoPagado, pago.desbalance,
        pago.utmFactor ?? null,
      ],
    );
    if (r.ultimoId === null) {
      throw new Error('No se pudo insertar el pago: SQLite no devolvió un id.');
    }
    return r.ultimoId;
  }

  /** Todos los pagos, del más reciente al más antiguo. */
  async obtenerTodosLosPagos(): Promise<Pago[]> {
    const filas = await this.ejecutor.consultar<FilaPago>(
      `SELECT ${COLUMNAS_PAGO} FROM pagos ORDER BY anio_pago DESC, mes_pago DESC`,
    );
    return filas.map(aPago);
  }

  /** Un pago por su id, o null si no existe. */
  async obtenerPagoPorId(id: number): Promise<Pago | null> {
    const filas = await this.ejecutor.consultar<FilaPago>(
      `SELECT ${COLUMNAS_PAGO} FROM pagos WHERE id = ?`,
      [id],
    );
    return filas.length > 0 ? aPago(filas[0]!) : null;
  }
}
```

- [ ] **Step 4: Ver pasar los tests y comprobar el orden contra el escritorio**

Ejecutar: `npm test --prefix mobile` y `npm run typecheck --prefix mobile`.

Comprobar que el orden coincide con el del escritorio ejecutando su consulta:

```bash
grep -n "ORDER BY" src/pensiontracker/database/db_manager.py
```

Si el escritorio ordena distinto, **el correcto es el del escritorio**: ajusta el
TypeScript y anótalo en el reporte.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/data/
git commit -m "Etapa 2a: repositorio de pagos, insertar y leer"
```

---

## Task 3: Pagos — actualizar, eliminar, consultas por año

**Files:**
- Modify: `mobile/src/data/repositorio.ts`, `mobile/src/data/repositorio.test.ts`

**Interfaces:**
- Produces, en `RepositorioPagos`:
  - `actualizarPago(id: number, pago: Omit<Pago, 'id'>): Promise<boolean>` — `false` si el id no existe
  - `eliminarPago(id: number): Promise<boolean>` — `false` si el id no existe
  - `obtenerPagosPorAnio(anio: number): Promise<Pago[]>`
  - `obtenerResumenAnual(anio: number): Promise<ResumenAnual>`
  - `interface ResumenAnual { cantidadPagos: number; totalPagado: number; totalPactado: number; desbalanceAcumulado: number }`

**El detalle que importa.** La consulta de resumen del escritorio usa `SUM(...)`,
que en SQLite devuelve **`NULL`, no `0`**, cuando no hay filas. El escritorio
devuelve ese `None` tal cual y el llamador lo maneja
(`calculation_service.py:323` hace `or 0.0`). En TypeScript hay que decidir y
fijarlo con un test: **normaliza los nulos a `0`** en el repositorio, para que
ninguna capa de arriba tenga que acordarse. `cantidadPagos` viene de `COUNT(*)`,
que sí devuelve `0`.

- [ ] **Step 1: Escribir los tests que fallan**

Agregar a `mobile/src/data/repositorio.test.ts`:

```typescript
describe('actualizarPago', () => {
  it('modifica los campos y devuelve true', async () => {
    const id = await repo.insertarPago(PAGO_BASE);
    const ok = await repo.actualizarPago(id, {
      ...PAGO_BASE, montoPagado: 210000, desbalance: 8118.0,
    });
    expect(ok).toBe(true);
    const pago = await repo.obtenerPagoPorId(id);
    expect(pago!.montoPagado).toBe(210000);
    expect(pago!.desbalance).toBe(8118.0);
  });

  it('devuelve false si el id no existe', async () => {
    expect(await repo.actualizarPago(9999, PAGO_BASE)).toBe(false);
  });

  it('permite dejar el factor UTM en nulo', async () => {
    const id = await repo.insertarPago(PAGO_BASE);
    await repo.actualizarPago(id, { ...PAGO_BASE, utmFactor: null });
    expect((await repo.obtenerPagoPorId(id))!.utmFactor).toBeNull();
  });
});

describe('eliminarPago', () => {
  it('borra el pago y devuelve true', async () => {
    const id = await repo.insertarPago(PAGO_BASE);
    expect(await repo.eliminarPago(id)).toBe(true);
    expect(await repo.obtenerPagoPorId(id)).toBeNull();
  });

  it('devuelve false si el id no existe', async () => {
    expect(await repo.eliminarPago(9999)).toBe(false);
  });

  it('no toca los demás pagos', async () => {
    const a = await repo.insertarPago({ ...PAGO_BASE, mesPago: 1 });
    const b = await repo.insertarPago({ ...PAGO_BASE, mesPago: 2 });
    await repo.eliminarPago(a);
    const pagos = await repo.obtenerTodosLosPagos();
    expect(pagos.map((p) => p.id)).toEqual([b]);
  });
});

describe('obtenerPagosPorAnio', () => {
  it('filtra por año y ordena de mes ASCENDENTE, al revés que obtenerTodosLosPagos', async () => {
    // No es una inconsistencia introducida acá: el escritorio ordena así
    // (db_manager.py:190, `ORDER BY mes_pago ASC`) mientras
    // obtener_todos_los_pagos ordena descendente. Se replica tal cual para
    // que las dos plataformas muestren el historial anual en el mismo orden.
    await repo.insertarPago({ ...PAGO_BASE, mesPago: 1, anioPago: 2025 });
    await repo.insertarPago({ ...PAGO_BASE, mesPago: 3, anioPago: 2025 });
    await repo.insertarPago({ ...PAGO_BASE, mesPago: 2, anioPago: 2024 });
    const pagos = await repo.obtenerPagosPorAnio(2025);
    expect(pagos.map((p) => p.mesPago)).toEqual([1, 3]);
  });

  it('un año sin pagos devuelve lista vacía', async () => {
    expect(await repo.obtenerPagosPorAnio(2099)).toEqual([]);
  });
});

describe('obtenerResumenAnual', () => {
  it('suma los pagos del año', async () => {
    await repo.insertarPago({
      ...PAGO_BASE, mesPago: 1, montoPagado: 200000,
      cuotaPactada: 201882.0, desbalance: -1882.0,
    });
    await repo.insertarPago({
      ...PAGO_BASE, mesPago: 2, montoPagado: 210000,
      cuotaPactada: 204102.0, desbalance: 5898.0,
    });
    expect(await repo.obtenerResumenAnual(2025)).toEqual({
      cantidadPagos: 2,
      totalPagado: 410000,
      totalPactado: 405984.0,
      desbalanceAcumulado: 4016.0,
    });
  });

  it('un año sin pagos devuelve ceros, no nulos', async () => {
    // SUM() de SQLite devuelve NULL sin filas; el repositorio lo normaliza
    // a 0 para que ninguna capa de arriba tenga que acordarse.
    expect(await repo.obtenerResumenAnual(2099)).toEqual({
      cantidadPagos: 0,
      totalPagado: 0,
      totalPactado: 0,
      desbalanceAcumulado: 0,
    });
  });
});
```

- [ ] **Step 2: Ver fallar los tests**

Ejecutar: `npm test --prefix mobile`
Esperado: FAIL, los métodos no existen.

- [ ] **Step 3: Implementar**

Agregar a `mobile/src/data/repositorio.ts`:

```typescript
export interface ResumenAnual {
  cantidadPagos: number;
  totalPagado: number;
  totalPactado: number;
  desbalanceAcumulado: number;
}
```

Y, dentro de `RepositorioPagos`:

```typescript
  /** Reemplaza los datos de un pago. Devuelve false si el id no existe. */
  async actualizarPago(id: number, pago: Omit<Pago, 'id'>): Promise<boolean> {
    const r = await this.ejecutor.correr(
      `UPDATE pagos SET
         fecha = ?, mes_pago = ?, anio_pago = ?, utm_valor = ?,
         cuota_pactada = ?, monto_pagado = ?, desbalance = ?, utm_factor = ?
       WHERE id = ?`,
      [
        pago.fecha, pago.mesPago, pago.anioPago, pago.utmValor,
        pago.cuotaPactada, pago.montoPagado, pago.desbalance,
        pago.utmFactor ?? null, id,
      ],
    );
    return r.cambios > 0;
  }

  /** Borra un pago. Devuelve false si el id no existe. */
  async eliminarPago(id: number): Promise<boolean> {
    const r = await this.ejecutor.correr('DELETE FROM pagos WHERE id = ?', [id]);
    return r.cambios > 0;
  }

  /**
   * Pagos de un año, de enero a diciembre.
   *
   * Orden ascendente a propósito: es el del escritorio
   * (db_manager.py:190), aunque obtenerTodosLosPagos ordene al revés.
   * Replicarlo mantiene idéntica la vista anual en ambas plataformas.
   */
  async obtenerPagosPorAnio(anio: number): Promise<Pago[]> {
    const filas = await this.ejecutor.consultar<FilaPago>(
      `SELECT ${COLUMNAS_PAGO} FROM pagos WHERE anio_pago = ? ORDER BY mes_pago ASC`,
      [anio],
    );
    return filas.map(aPago);
  }

  /**
   * Totales de un año.
   *
   * SUM() devuelve NULL cuando no hay filas, no 0. Se normaliza acá para
   * que ninguna capa de arriba tenga que recordarlo.
   */
  async obtenerResumenAnual(anio: number): Promise<ResumenAnual> {
    const filas = await this.ejecutor.consultar<{
      cantidad_pagos: number;
      total_pagado: number | null;
      total_pactado: number | null;
      desbalance_acumulado: number | null;
    }>(
      `SELECT COUNT(*)           AS cantidad_pagos,
              SUM(monto_pagado)  AS total_pagado,
              SUM(cuota_pactada) AS total_pactado,
              SUM(desbalance)    AS desbalance_acumulado
         FROM pagos WHERE anio_pago = ?`,
      [anio],
    );
    const f = filas[0]!;
    return {
      cantidadPagos: f.cantidad_pagos,
      totalPagado: f.total_pagado ?? 0,
      totalPactado: f.total_pactado ?? 0,
      desbalanceAcumulado: f.desbalance_acumulado ?? 0,
    };
  }
```

- [ ] **Step 4: Ver pasar los tests**

Ejecutar: `npm test --prefix mobile`, `npm run typecheck --prefix mobile` y
`uv run pytest -q`.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/data/
git commit -m "Etapa 2a: repositorio de pagos, actualizar, eliminar y consultas por año"
```

---

## Task 4: UTM y configuración

**Files:**
- Modify: `mobile/src/data/repositorio.ts`, `mobile/src/data/repositorio.test.ts`

**Interfaces:**
- Produces:
  - `class RepositorioUtm` con `(ejecutor: EjecutorSql)`
    - `guardarUtm(anio, mes, utmValor, ahora?): Promise<void>`
    - `guardarUtmBulk(anio, valores: Map<number, number>, ahora?): Promise<void>`
    - `obtenerUtmGuardada(anio, mes): Promise<UtmGuardada | null>`
    - `obtenerUltimaUtmGuardada(): Promise<UtmGuardada | null>`
    - `obtenerUltimoFactorUtm(): Promise<number | null>`
  - `class RepositorioConfiguracion` con `guardarConfiguracion(clave, valor)` y
    `obtenerConfiguracion(clave): Promise<string | null>`
  - `interface UtmGuardada { anio: number; mes: number; utmValor: number; fechaRegistro: string }`

**La fecha se inyecta, no se toma del reloj.** El escritorio hace
`datetime.now()` dentro de la función, lo que obliga a congelar el tiempo para
probarlo. Acá el parámetro `ahora` es opcional y por defecto usa la hora actual,
pero los tests pasan un valor fijo. Es más simple que simular relojes.

- [ ] **Step 1: Escribir los tests que fallan**

Agregar a `mobile/src/data/repositorio.test.ts`:

```typescript
import { RepositorioConfiguracion, RepositorioUtm } from './repositorio';

const AHORA = '2025-06-15 10:30:00';

describe('RepositorioUtm', () => {
  let utm: RepositorioUtm;
  beforeEach(() => { utm = new RepositorioUtm(ejecutor); });

  it('guarda y recupera el valor de un mes', async () => {
    await utm.guardarUtm(2025, 1, 67294, AHORA);
    expect(await utm.obtenerUtmGuardada(2025, 1)).toEqual({
      anio: 2025, mes: 1, utmValor: 67294, fechaRegistro: AHORA,
    });
  });

  it('un mes sin guardar devuelve null', async () => {
    expect(await utm.obtenerUtmGuardada(2099, 1)).toBeNull();
  });

  it('guardar dos veces el mismo mes reemplaza en vez de duplicar', async () => {
    await utm.guardarUtm(2025, 1, 67294, AHORA);
    await utm.guardarUtm(2025, 1, 68000, '2025-07-01 09:00:00');
    expect((await utm.obtenerUtmGuardada(2025, 1))!.utmValor).toBe(68000);
    const filas = await ejecutor.consultar<{ n: number }>(
      'SELECT COUNT(*) AS n FROM utm_historial',
    );
    expect(filas[0]!.n).toBe(1);
  });

  it('guardarUtmBulk escribe varios meses de una vez', async () => {
    await utm.guardarUtmBulk(2025, new Map([[1, 67294], [2, 67429], [3, 68034]]), AHORA);
    expect((await utm.obtenerUtmGuardada(2025, 2))!.utmValor).toBe(67429);
    const filas = await ejecutor.consultar<{ n: number }>(
      'SELECT COUNT(*) AS n FROM utm_historial',
    );
    expect(filas[0]!.n).toBe(3);
  });

  it('guardarUtmBulk con un mapa vacío no hace nada ni falla', async () => {
    await utm.guardarUtmBulk(2025, new Map(), AHORA);
    const filas = await ejecutor.consultar<{ n: number }>(
      'SELECT COUNT(*) AS n FROM utm_historial',
    );
    expect(filas[0]!.n).toBe(0);
  });

  it('obtenerUltimaUtmGuardada devuelve la del mes más reciente', async () => {
    await utm.guardarUtmBulk(2024, new Map([[11, 66000], [12, 66500]]), AHORA);
    await utm.guardarUtmBulk(2025, new Map([[1, 67294]]), AHORA);
    expect(await utm.obtenerUltimaUtmGuardada()).toEqual({
      anio: 2025, mes: 1, utmValor: 67294, fechaRegistro: AHORA,
    });
  });

  it('sin ninguna UTM guardada devuelve null', async () => {
    expect(await utm.obtenerUltimaUtmGuardada()).toBeNull();
  });

  it('obtenerUltimoFactorUtm ignora los pagos sin factor', async () => {
    await repo.insertarPago({ ...PAGO_BASE, mesPago: 1, utmFactor: 3.0 });
    await repo.insertarPago({ ...PAGO_BASE, mesPago: 2, utmFactor: null });
    expect(await utm.obtenerUltimoFactorUtm()).toBe(3.0);
  });

  it('con dos pagos del mismo mes gana el registrado después', async () => {
    // El desempate por id DESC del escritorio; sin él, el resultado
    // dependería del orden físico de las filas.
    await repo.insertarPago({ ...PAGO_BASE, mesPago: 4, anioPago: 2025, utmFactor: 3.0 });
    await repo.insertarPago({ ...PAGO_BASE, mesPago: 4, anioPago: 2025, utmFactor: 4.25 });
    expect(await utm.obtenerUltimoFactorUtm()).toBe(4.25);
  });

  it('sin pagos con factor devuelve null', async () => {
    await repo.insertarPago({ ...PAGO_BASE, utmFactor: null });
    expect(await utm.obtenerUltimoFactorUtm()).toBeNull();
  });
});

describe('RepositorioConfiguracion', () => {
  let config: RepositorioConfiguracion;
  beforeEach(() => { config = new RepositorioConfiguracion(ejecutor); });

  it('guarda y recupera un valor', async () => {
    await config.guardarConfiguracion('factor_predeterminado', '3.0561');
    expect(await config.obtenerConfiguracion('factor_predeterminado')).toBe('3.0561');
  });

  it('una clave inexistente devuelve null', async () => {
    expect(await config.obtenerConfiguracion('no_existe')).toBeNull();
  });

  it('guardar dos veces la misma clave reemplaza el valor', async () => {
    await config.guardarConfiguracion('k', 'uno');
    await config.guardarConfiguracion('k', 'dos');
    expect(await config.obtenerConfiguracion('k')).toBe('dos');
  });
});
```

- [ ] **Step 2: Ver fallar los tests**

Ejecutar: `npm test --prefix mobile`
Esperado: FAIL, las clases no existen.

- [ ] **Step 3: Implementar**

Antes de escribir el SQL, **lee las funciones equivalentes del escritorio** para
copiar su semántica exacta: `guardar_utm`, `guardar_utm_bulk`,
`obtener_utm_guardada`, `obtener_ultima_utm_guardada`, `obtener_ultimo_factor_utm`,
`guardar_configuracion` y `obtener_configuracion` en
`src/pensiontracker/database/db_manager.py`. En particular, comprueba con qué
criterio ordena `obtener_ultima_utm_guardada` y cuál es el `ORDER BY` de
`obtener_ultimo_factor_utm`, y replícalos.

Agregar a `mobile/src/data/repositorio.ts`:

```typescript
export interface UtmGuardada {
  anio: number;
  mes: number;
  utmValor: number;
  fechaRegistro: string;
}

interface FilaUtm {
  anio: number;
  mes: number;
  utm_valor: number;
  fecha_registro: string;
}

function aUtm(fila: FilaUtm): UtmGuardada {
  return {
    anio: fila.anio,
    mes: fila.mes,
    utmValor: fila.utm_valor,
    fechaRegistro: fila.fecha_registro,
  };
}

/** Momento actual en el formato que usa la columna fecha_registro. */
function ahoraPorDefecto(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
         `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export class RepositorioUtm {
  constructor(private readonly ejecutor: EjecutorSql) {}

  /** Guarda o reemplaza el valor UTM de un mes. */
  async guardarUtm(anio: number, mes: number, utmValor: number,
                   ahora: string = ahoraPorDefecto()): Promise<void> {
    await this.ejecutor.correr(
      `INSERT OR REPLACE INTO utm_historial (anio, mes, utm_valor, fecha_registro)
       VALUES (?, ?, ?, ?)`,
      [anio, mes, utmValor, ahora],
    );
  }

  /**
   * Guarda varios meses de un mismo año. mindicador.cl trae el año
   * completo en una petición, así que se cachea todo lo recibido en vez
   * de hacer una escritura por mes.
   */
  async guardarUtmBulk(anio: number, valores: Map<number, number>,
                       ahora: string = ahoraPorDefecto()): Promise<void> {
    if (valores.size === 0) return;
    for (const [mes, valor] of valores) {
      await this.guardarUtm(anio, mes, valor, ahora);
    }
  }

  /** UTM guardada de un mes, o null si no está. */
  async obtenerUtmGuardada(anio: number, mes: number): Promise<UtmGuardada | null> {
    const filas = await this.ejecutor.consultar<FilaUtm>(
      'SELECT anio, mes, utm_valor, fecha_registro FROM utm_historial WHERE anio = ? AND mes = ?',
      [anio, mes],
    );
    return filas.length > 0 ? aUtm(filas[0]!) : null;
  }

  /** La UTM del mes más reciente que haya guardado, o null si no hay ninguna. */
  async obtenerUltimaUtmGuardada(): Promise<UtmGuardada | null> {
    const filas = await this.ejecutor.consultar<FilaUtm>(
      `SELECT anio, mes, utm_valor, fecha_registro FROM utm_historial
       ORDER BY anio DESC, mes DESC LIMIT 1`,
    );
    return filas.length > 0 ? aUtm(filas[0]!) : null;
  }

  /**
   * Factor UTM del pago más reciente que tenga uno, o null.
   *
   * El desempate por `id DESC` importa: si hay dos pagos del mismo mes y
   * año, gana el registrado después. Es el criterio del escritorio
   * (db_manager.py:367) y omitirlo dejaría el resultado a merced del
   * orden físico de las filas.
   */
  async obtenerUltimoFactorUtm(): Promise<number | null> {
    const filas = await this.ejecutor.consultar<{ utm_factor: number }>(
      `SELECT utm_factor FROM pagos WHERE utm_factor IS NOT NULL
       ORDER BY anio_pago DESC, mes_pago DESC, id DESC LIMIT 1`,
    );
    return filas.length > 0 ? filas[0]!.utm_factor : null;
  }
}

export class RepositorioConfiguracion {
  constructor(private readonly ejecutor: EjecutorSql) {}

  async guardarConfiguracion(clave: string, valor: string): Promise<void> {
    await this.ejecutor.correr(
      'INSERT OR REPLACE INTO configuracion (clave, valor) VALUES (?, ?)',
      [clave, valor],
    );
  }

  async obtenerConfiguracion(clave: string): Promise<string | null> {
    const filas = await this.ejecutor.consultar<{ valor: string }>(
      'SELECT valor FROM configuracion WHERE clave = ?',
      [clave],
    );
    return filas.length > 0 ? filas[0]!.valor : null;
  }
}
```

- [ ] **Step 4: Ver pasar los tests y comparar el orden con el escritorio**

Ejecutar: `npm test --prefix mobile`, `npm run typecheck --prefix mobile` y
`uv run pytest -q`.

Compara los `ORDER BY` que escribiste contra los del escritorio. Si alguno
difiere, **el correcto es el del escritorio**: ajústalo y anótalo en el reporte.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/data/
git commit -m "Etapa 2a: repositorios de UTM y configuración"
```

---

## Task 5: Interoperabilidad completa de datos, no solo de esquema

**Files:**
- Modify: `tests/test_interoperabilidad_db.py`

Esta tarea cierra la etapa demostrando lo que la justifica: que un `.db` escrito
por una plataforma se lee correctamente en la otra, y que **los cálculos dan lo
mismo sobre los mismos datos**. Es la promesa que le hacemos al usuario cuando le
decimos que puede migrar exportando su respaldo.

- [ ] **Step 1: Escribir los tests que fallan**

Agregar a `tests/test_interoperabilidad_db.py`:

```python
PAGOS_SINTETICOS = [
    # (mes, anio, utm_valor, cuota_pactada, monto_pagado, desbalance, utm_factor)
    (1, 2025, 67294, 201882.0, 200000, -1882.0, 3.0),
    (2, 2025, 67429, 202287.0, 202287, 0.0, 3.0),
    (3, 2025, 68034, 204102.0, 210000, 5898.0, 3.0),
    (11, 2024, 66000, 198000.0, 198000, 0.0, 3.0),
]


def _leer_con_typescript(ruta_db: Path) -> dict:
    """Lee la base con el repositorio TypeScript y devuelve lo que ve."""
    script = (
        "import { EjecutorNode } from './src/data/ejecutor-node.ts';"
        "import { RepositorioPagos, RepositorioUtm } from './src/data/repositorio.ts';"
        "import { obtenerHistorialDesbalances, resumirEstadoCuenta } from './src/core/calculos.ts';"
        f"const e = new EjecutorNode({json.dumps(str(ruta_db))});"
        "const repo = new RepositorioPagos(e);"
        "const utm = new RepositorioUtm(e);"
        "const pagos = await repo.obtenerTodosLosPagos();"
        "const salida = {"
        "  pagos: pagos.map(p => [p.anioPago, p.mesPago, p.montoPagado, p.desbalance, p.utmFactor]),"
        "  resumen: resumirEstadoCuenta(pagos),"
        "  historial: obtenerHistorialDesbalances(pagos, 70000)"
        "    .map(f => [f.anioPago, f.mesPago, f.desbalanceCorrido, f.desbalanceUtmCorridoPesos]),"
        "  ultimoFactor: await utm.obtenerUltimoFactorUtm(),"
        "};"
        "console.log('__JSON__' + JSON.stringify(salida)); e.cerrar();"
    )
    r = subprocess.run(["npx", "vite-node", "-e", script],
                       cwd=MOBILE, capture_output=True, text=True)
    assert r.returncode == 0, f"El TypeScript falló:\n{r.stdout}\n{r.stderr}"
    marca = [ln for ln in r.stdout.splitlines() if ln.startswith("__JSON__")]
    assert marca, f"No se encontró la salida JSON:\n{r.stdout}"
    return json.loads(marca[0][len("__JSON__"):])


def test_typescript_lee_los_pagos_que_escribio_el_escritorio(db_del_escritorio, monkeypatch):
    monkeypatch.setattr(db_manager, "DB_PATH", db_del_escritorio)
    for mes, anio, utm, cuota, pagado, desb, factor in PAGOS_SINTETICOS:
        db_manager.insertar_pago(
            fecha=f"{anio}-{mes:02d}-05", mes_pago=mes, anio_pago=anio,
            utm_valor=utm, cuota_pactada=cuota, monto_pagado=pagado,
            desbalance=desb, utm_factor=factor,
        )

    visto = _leer_con_typescript(db_del_escritorio)

    esperado = [
        [anio, mes, float(pagado), desb, factor]
        for mes, anio, _u, _c, pagado, desb, factor in PAGOS_SINTETICOS
    ]
    esperado.sort(key=lambda p: (p[0], p[1]), reverse=True)
    assert visto["pagos"] == esperado


def test_los_calculos_coinciden_sobre_la_misma_base(db_del_escritorio, monkeypatch):
    """Misma base, mismos números: es la promesa que sostiene el .db intercambiable."""
    from pensiontracker.services import calculation_service

    monkeypatch.setattr(db_manager, "DB_PATH", db_del_escritorio)
    for mes, anio, utm, cuota, pagado, desb, factor in PAGOS_SINTETICOS:
        db_manager.insertar_pago(
            fecha=f"{anio}-{mes:02d}-05", mes_pago=mes, anio_pago=anio,
            utm_valor=utm, cuota_pactada=cuota, monto_pagado=pagado,
            desbalance=desb, utm_factor=factor,
        )

    visto = _leer_con_typescript(db_del_escritorio)

    pagos_py = db_manager.obtener_todos_los_pagos()
    resumen_py = calculation_service.resumir_estado_cuenta(pagos_py)
    historial_py = calculation_service.obtener_historial_desbalances(70000, pagos_py)

    assert visto["resumen"]["cantidadPagos"] == resumen_py["cantidad_pagos"]
    assert visto["resumen"]["totalPagado"] == pytest.approx(resumen_py["total_pagado"])
    assert visto["resumen"]["desbalanceAcumulado"] == pytest.approx(
        resumen_py["desbalance_acumulado"])
    assert visto["resumen"]["estado"] == resumen_py["estado"]

    assert len(visto["historial"]) == len(historial_py)
    for fila_ts, fila_py in zip(visto["historial"], historial_py):
        assert fila_ts[0] == fila_py["anio_pago"]
        assert fila_ts[1] == fila_py["mes_pago"]
        assert fila_ts[2] == pytest.approx(fila_py["desbalance_corrido"])
        assert fila_ts[3] == pytest.approx(fila_py["desbalance_utm_corrido_pesos"])

    assert visto["ultimoFactor"] == pytest.approx(
        db_manager.obtener_ultimo_factor_utm())


def test_el_escritorio_lee_los_pagos_que_escribio_typescript(db_del_movil, monkeypatch):
    """La dirección contraria: móvil escribe, escritorio lee."""
    script = (
        "import { EjecutorNode } from './src/data/ejecutor-node.ts';"
        "import { RepositorioPagos } from './src/data/repositorio.ts';"
        f"const e = new EjecutorNode({json.dumps(str(db_del_movil))});"
        "const repo = new RepositorioPagos(e);"
        "await repo.insertarPago({ fecha: '2025-05-05', mesPago: 5, anioPago: 2025,"
        "  utmValor: 68785, cuotaPactada: 206355.0, montoPagado: 200000,"
        "  desbalance: -6355.0, utmFactor: 3.0 });"
        "e.cerrar();"
    )
    r = subprocess.run(["npx", "vite-node", "-e", script],
                       cwd=MOBILE, capture_output=True, text=True)
    assert r.returncode == 0, f"El TypeScript falló:\n{r.stdout}\n{r.stderr}"

    monkeypatch.setattr(db_manager, "DB_PATH", db_del_movil)
    pagos = db_manager.obtener_todos_los_pagos()
    assert len(pagos) == 1
    p = pagos[0]
    assert (p["mes_pago"], p["anio_pago"]) == (5, 2025)
    assert p["monto_pagado"] == 200000
    assert p["desbalance"] == pytest.approx(-6355.0)
    assert p["utm_factor"] == pytest.approx(3.0)
```

Nota: `resumir_estado_cuenta` es la función pura que se extrajo en la Etapa 1;
confirma su nombre y firma exactos en `calculation_service.py` antes de usarla.

- [ ] **Step 2: Ver fallar los tests**

Ejecutar: `uv run pytest tests/test_interoperabilidad_db.py -v`
Esperado: FAIL mientras el repositorio TypeScript no esté completo.

- [ ] **Step 3: Hacerlos pasar**

No debería hacer falta código nuevo: si algo falla, es una diferencia real entre
las dos implementaciones. **Corrige el lado TypeScript**, que es el port, salvo
que descubras un defecto en el escritorio; en ese caso detente y repórtalo en vez
de replicarlo.

- [ ] **Step 4: Verificar el conjunto**

Ejecutar: `uv run pytest -q`, `npm test --prefix mobile` y
`npm run typecheck --prefix mobile`. Los tres en verde.

- [ ] **Step 5: Commit**

```bash
git add tests/test_interoperabilidad_db.py
git commit -m "Etapa 2a: interoperabilidad completa del .db entre escritorio y móvil

Una base escrita por una plataforma se lee en la otra, y los cálculos dan
los mismos números sobre los mismos datos. Es la promesa que sostiene el
respaldo intercambiable, que además es la única vía de migración entre los
canales de F-Droid y GitHub Releases, cuyas firmas distintas obligan a
desinstalar."
```

---

## Verificación de cierre de la etapa

1. Las tres verificaciones en verde.
2. `mobile/src/core/` no importa nada de `mobile/src/data/`.
3. Una base creada por el escritorio se lee desde TypeScript y viceversa, y los
   cálculos coinciden.
4. Ninguna consulta interpola valores en el SQL: todas usan `?`.
5. `ejecutor-node.ts` no se importa desde ningún archivo que vaya al bundle del
   teléfono.

## Etapas siguientes (planes aparte)

- **Etapa 2b — Cliente UTM** sobre `CapacitorHttp`, con caché por año y fallback
  offline.
- **Etapa 2c — Interfaz Svelte** sobre el `style.css` existente, y el andamiaje
  de Capacitor.
- **Etapa 3 — Importar y restaurar respaldos** en escritorio y móvil.
- **Etapa 4 — Distribución**: firma del APK, GitHub Releases y envío a F-Droid.
