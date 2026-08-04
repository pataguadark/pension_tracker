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

  it('reconoce END como sinónimo de COMMIT', async () => {
    // Nadie en esta base de código emite END hoy, pero es SQL válido
    // (sinónimo real de COMMIT en SQLite) y el adaptador ya lo traduce
    // -ver el `comando === 'COMMIT' || comando === 'END'` en
    // ejecutor-capacitor.ts-, así que se deja documentado con una prueba en
    // vez de quitarlo por YAGNI: el costo de mantenerlo cubierto es mínimo.
    const { ejecutor, plugin } = nuevoEjecutor();
    await ejecutor.ejecutar('BEGIN');
    await ejecutor.ejecutar('END');
    expect(plugin.llamadas.map(([m]) => m)).toEqual(['beginTransaction', 'commitTransaction']);
  });

  it.each(['BEGIN IMMEDIATE', 'BEGIN DEFERRED', 'BEGIN EXCLUSIVE', 'BEGIN IMMEDIATE TRANSACTION'])(
    'reconoce "%s" como apertura de transacción',
    async (sql) => {
      const { ejecutor, plugin } = nuevoEjecutor();
      await ejecutor.ejecutar(sql);
      expect(plugin.llamadas).toEqual([['beginTransaction', undefined]]);
    },
  );

  it.each([
    'CREATE TRIGGER trg AFTER INSERT ON t BEGIN SELECT 1; END',
    'ROLLBACK TO SAVEPOINT x',
    'SAVEPOINT x',
    'RELEASE x',
  ])('NO trata "%s" como control de transacción', async (sql) => {
    const { ejecutor, plugin } = nuevoEjecutor();
    // No importa si el motor real acepta o rechaza el SQL (algunas de estas
    // sentencias fallan sin una tabla o un savepoint previo existente): lo
    // que fija esta prueba es que la regex NO la clasificó como BEGIN/
    // COMMIT/ROLLBACK, así que cae a `execute()` en vez de a una de las
    // llamadas de transacción del plugin.
    await ejecutor.ejecutar(sql).catch(() => {});
    expect(plugin.llamadas).toEqual([['execute', true]]);
  });

  it('dentro de una transacción explícita escribe con transaction:false', async () => {
    const { ejecutor, plugin } = nuevoEjecutor();
    await ejecutor.ejecutar('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)');
    await ejecutor.ejecutar('BEGIN');
    await ejecutor.correr('INSERT INTO t (v) VALUES (?)', ['a']);
    await ejecutor.ejecutar('COMMIT');
    expect(plugin.llamadas).toContainEqual(['run', false]);
  });

  it('dentro de una transacción explícita, una sentencia no-control usa transaction:false', async () => {
    // La rama `execute` de `ejecutar()` corre el mismo riesgo que `correr()`
    // (ver el contrato en ejecutor.ts), pero antes de esta prueba solo
    // `correr()` estaba cubierto: si se invertía el `!this.enTransaccion`
    // de la llamada a `execute()`, ninguna prueba lo notaba.
    const { ejecutor, plugin } = nuevoEjecutor();
    await ejecutor.ejecutar('BEGIN');
    await ejecutor.ejecutar('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)');
    await ejecutor.ejecutar('COMMIT');
    expect(plugin.llamadas).toContainEqual(['execute', false]);
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

  it('un UPDATE que sí afecta filas no hereda el id del INSERT anterior', async () => {
    // A diferencia de la prueba anterior (UPDATE sin efecto, cambios=0),
    // acá el UPDATE sí afecta una fila: `cambios > 0` no basta para
    // descartar el id heredado. Con el doble fiel (ConexionPluginFalsa ya
    // no filtra `lastId`), el plugin devuelve el rowid crudo -el del INSERT
    // anterior, que persiste en la conexión- y solo el chequeo
    // `esSentenciaInsert(sql)` en ejecutor-capacitor.ts lo descarta. Si se
    // quitara ese chequeo, esta prueba moriría.
    const { ejecutor } = nuevoEjecutor();
    await ejecutor.ejecutar('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)');
    const alta = await ejecutor.correr('INSERT INTO t (v) VALUES (?)', ['a']);
    expect(alta.ultimoId).toBe(1);

    const actualizado = await ejecutor.correr('UPDATE t SET v = ? WHERE id = ?', ['b', 1]);
    expect(actualizado.cambios).toBe(1);
    expect(actualizado.ultimoId).toBeNull();
  });

  it('un INSERT que no inserta nada no informa el id de la fila anterior', async () => {
    // El otro flanco del filtro: acá `esSentenciaInsert` sí acierta, y lo
    // único que descarta el id rancio de la conexión es `cambios > 0`. Hoy
    // el repositorio solo emite INSERT INTO e INSERT OR REPLACE, que siempre
    // afectan una fila; esto queda fijado para el día en que alguien agregue
    // un INSERT OR IGNORE o un ON CONFLICT DO NOTHING.
    const { ejecutor } = nuevoEjecutor();
    await ejecutor.ejecutar('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT UNIQUE)');
    const alta = await ejecutor.correr('INSERT INTO t (v) VALUES (?)', ['a']);
    expect(alta.ultimoId).toBe(1);

    const ignorado = await ejecutor.correr('INSERT OR IGNORE INTO t (v) VALUES (?)', ['a']);
    expect(ignorado.cambios).toBe(0);
    expect(ignorado.ultimoId).toBeNull();
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
      isTransactionActive: async () => ({ result: false }),
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
      isTransactionActive: async () => ({ result: false }),
    };
    const ejecutor = new EjecutorCapacitor(plugin);
    expect(await ejecutor.consultar('SELECT 1')).toEqual([]);
  });

  it('lanza si el plugin no confirma que la transacción quedó abierta', async () => {
    // Guard deliberado: tras beginTransaction() se vuelve a preguntar
    // isTransactionActive() antes de confiar en que la transacción abrió.
    // Un doble cuyo isTransactionActive() miente (devuelve false) debe
    // hacer que el adaptador aborte en vez de seguir como si nada.
    const plugin = {
      run: async () => ({ changes: { changes: 0 } }),
      execute: async () => ({ changes: { changes: 0 } }),
      query: async () => ({ values: [] }),
      beginTransaction: async () => ({ changes: { changes: 0 } }),
      commitTransaction: async () => ({ changes: { changes: 0 } }),
      rollbackTransaction: async () => ({ changes: { changes: 0 } }),
      isTransactionActive: async () => ({ result: false }),
    };
    const ejecutor = new EjecutorCapacitor(plugin);
    await expect(ejecutor.ejecutar('BEGIN')).rejects.toThrow(
      'El plugin no abrió la transacción tras beginTransaction',
    );
  });

  it('tras COMMIT, la siguiente escritura vuelve a pedir su propia transacción', async () => {
    // El flag interno `enTransaccion` debe bajar tras COMMIT: una escritura
    // posterior no debe seguir asumiendo que hay una transacción explícita
    // abierta y volver a usar transaction:true.
    const { ejecutor, plugin } = nuevoEjecutor();
    await ejecutor.ejecutar('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)');
    await ejecutor.ejecutar('BEGIN');
    await ejecutor.correr('INSERT INTO t (v) VALUES (?)', ['a']);
    await ejecutor.ejecutar('COMMIT');
    await ejecutor.correr('INSERT INTO t (v) VALUES (?)', ['b']);
    expect(plugin.llamadas.at(-1)).toEqual(['run', true]);
  });

  it('el flag de transacción baja aunque rollbackTransaction() falle', async () => {
    // Decisión deliberada documentada en el comentario de la rama ROLLBACK
    // en ejecutor-capacitor.ts: el flag baja ANTES de invocar
    // rollbackTransaction(), así que baja incluso si el plugin no logra
    // deshacer. Si no se pudo deshacer, la transacción tampoco sigue siendo
    // "nuestra" para escribir dentro.
    const llamadas: Array<[string, boolean | undefined]> = [];
    const plugin = {
      run: async () => ({ changes: { changes: 0 } }),
      execute: async (sql: string, transaction?: boolean) => {
        llamadas.push(['execute', transaction]);
        return { changes: { changes: 0 } };
      },
      query: async () => ({ values: [] }),
      beginTransaction: async () => ({ changes: { changes: 0 } }),
      commitTransaction: async () => ({ changes: { changes: 0 } }),
      rollbackTransaction: async () => {
        throw new Error('el plugin no pudo deshacer');
      },
      isTransactionActive: async () => ({ result: true }),
    };
    const ejecutor = new EjecutorCapacitor(plugin);
    await ejecutor.ejecutar('BEGIN');
    await expect(ejecutor.ejecutar('ROLLBACK')).rejects.toThrow('el plugin no pudo deshacer');

    await ejecutor.ejecutar('CREATE TABLE t (id INTEGER PRIMARY KEY)');
    expect(llamadas).toEqual([['execute', true]]);
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
    expect(filas[0]!.n).toBe(3);
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
    expect(filas[0]!.n).toBe(0);
  });
});
