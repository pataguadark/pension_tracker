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
