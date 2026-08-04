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
