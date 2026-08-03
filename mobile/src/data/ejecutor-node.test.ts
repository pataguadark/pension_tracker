/**
 * Contrato de `correr()`: `ultimoId` debe ser null cuando la sentencia no
 * insertó ninguna fila.
 *
 * node:sqlite nunca deja `lastInsertRowid` en `undefined`: entrega 0 o el id
 * de la última fila insertada en la conexión, que persiste entre sentencias.
 * Un UPDATE o DELETE que no toca ninguna fila "hereda" así el id de un
 * INSERT anterior si no se corrige explícitamente.
 */
import { describe, expect, it } from 'vitest';
import { EjecutorNode } from './ejecutor-node';

async function bdConfiguracion(): Promise<EjecutorNode> {
  const ejecutor = new EjecutorNode(':memory:');
  await ejecutor.ejecutar(`
    CREATE TABLE configuracion (
      id    INTEGER PRIMARY KEY AUTOINCREMENT,
      clave TEXT NOT NULL,
      valor TEXT NOT NULL
    )
  `);
  return ejecutor;
}

describe('EjecutorNode.correr: contrato de ultimoId', () => {
  it('INSERT que inserta una fila: cambios=1 y ultimoId con el id nuevo', async () => {
    const bd = await bdConfiguracion();
    const r = await bd.correr('INSERT INTO configuracion (clave, valor) VALUES (?,?)', [
      'a',
      '1',
    ]);
    expect(r.cambios).toBe(1);
    expect(r.ultimoId).toBe(1);
    bd.cerrar();
  });

  it('UPDATE que afecta filas: cambios>0 y ultimoId null (no insertó nada)', async () => {
    const bd = await bdConfiguracion();
    await bd.correr('INSERT INTO configuracion (clave, valor) VALUES (?,?)', ['a', '1']);
    const r = await bd.correr('UPDATE configuracion SET valor = ? WHERE clave = ?', ['2', 'a']);
    expect(r.cambios).toBe(1);
    expect(r.ultimoId).toBeNull();
    bd.cerrar();
  });

  it('UPDATE que no afecta ninguna fila: cambios=0 y ultimoId null', async () => {
    const bd = await bdConfiguracion();
    await bd.correr('INSERT INTO configuracion (clave, valor) VALUES (?,?)', ['a', '1']);
    const r = await bd.correr('UPDATE configuracion SET valor = ? WHERE clave = ?', [
      '2',
      'no-existe',
    ]);
    expect(r.cambios).toBe(0);
    expect(r.ultimoId).toBeNull();
    bd.cerrar();
  });

  it('DELETE que borra una fila: cambios=1 y ultimoId null (no insertó nada)', async () => {
    const bd = await bdConfiguracion();
    await bd.correr('INSERT INTO configuracion (clave, valor) VALUES (?,?)', ['a', '1']);
    const r = await bd.correr('DELETE FROM configuracion WHERE clave = ?', ['a']);
    expect(r.cambios).toBe(1);
    expect(r.ultimoId).toBeNull();
    bd.cerrar();
  });

  it('DELETE sin coincidencias: cambios=0 y ultimoId null', async () => {
    const bd = await bdConfiguracion();
    await bd.correr('INSERT INTO configuracion (clave, valor) VALUES (?,?)', ['a', '1']);
    const r = await bd.correr('DELETE FROM configuracion WHERE clave = ?', ['no-existe']);
    expect(r.cambios).toBe(0);
    expect(r.ultimoId).toBeNull();
    bd.cerrar();
  });
});
