import { describe, expect, it } from 'vitest';

import { abrirBaseDeDatos, cerrarBaseDeDatos, NOMBRE_BD } from './conexion';
import { EjecutorNode } from './ejecutor-node';
import { ConexionPluginFalsa } from './plugin-falso';

/**
 * Doble de `SQLiteConnection`: el objeto que fabrica conexiones.
 *
 * Registra los argumentos y no solo el nombre del método: `readonly` y el
 * nombre de la base son parámetros posicionales, y un doble que los ignora
 * deja pasar en silencio una conexión abierta en modo solo lectura, donde
 * toda escritura del ejecutor fallaría en el teléfono.
 */
class FabricaFalsa {
  readonly llamadas: Array<{ metodo: string; bd?: string; soloLectura?: boolean }> = [];
  conexion: ConexionPluginFalsa & { open: () => Promise<void>; close: () => Promise<void> };
  abierta = false;

  constructor(public consistente = true, public existe = false) {
    const plugin = new ConexionPluginFalsa(new EjecutorNode(':memory:'));
    this.conexion = Object.assign(plugin, {
      open: async () => { this.abierta = true; },
      close: async () => { this.abierta = false; },
    });
  }

  /** Los nombres de método en orden, para las aserciones de secuencia. */
  get metodos(): string[] {
    return this.llamadas.map((l) => l.metodo);
  }

  async checkConnectionsConsistency() {
    this.llamadas.push({ metodo: 'checkConnectionsConsistency' });
    return { result: this.consistente };
  }
  async isConnection(bd: string, ro: boolean) {
    this.llamadas.push({ metodo: 'isConnection', bd, soloLectura: ro });
    return { result: this.existe };
  }
  async retrieveConnection(bd: string, ro: boolean) {
    this.llamadas.push({ metodo: 'retrieveConnection', bd, soloLectura: ro });
    return this.conexion;
  }
  async createConnection(bd: string, _e: boolean, _m: string, _v: number, ro: boolean) {
    this.llamadas.push({ metodo: 'createConnection', bd, soloLectura: ro });
    return this.conexion;
  }
  async closeConnection(bd: string, ro: boolean) {
    this.llamadas.push({ metodo: 'closeConnection', bd, soloLectura: ro });
  }
}

describe('abrirBaseDeDatos', () => {
  it('crea la conexión cuando no existe', async () => {
    const fabrica = new FabricaFalsa(true, false);
    await abrirBaseDeDatos(fabrica);
    expect(fabrica.metodos).toContain('createConnection');
    expect(fabrica.metodos).not.toContain('retrieveConnection');
    expect(fabrica.abierta).toBe(true);
  });

  it('reutiliza la conexión existente en vez de crear otra', async () => {
    const fabrica = new FabricaFalsa(true, true);
    await abrirBaseDeDatos(fabrica);
    expect(fabrica.metodos).toContain('retrieveConnection');
    expect(fabrica.metodos).not.toContain('createConnection');
  });

  it('crea de nuevo cuando el diccionario de conexiones quedó inconsistente', async () => {
    // Android mató el WebView: el plugin dice que existe, pero el
    // diccionario JS ya se vació. Recuperarla lanzaría "does not exist".
    const fabrica = new FabricaFalsa(false, true);
    await abrirBaseDeDatos(fabrica);
    expect(fabrica.metodos).toContain('createConnection');
    expect(fabrica.metodos).not.toContain('retrieveConnection');
  });

  it('comprueba la consistencia antes de decidir', async () => {
    const fabrica = new FabricaFalsa(true, true);
    await abrirBaseDeDatos(fabrica);
    expect(fabrica.metodos[0]).toBe('checkConnectionsConsistency');
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
    expect(fabrica.metodos).toContain('closeConnection');
  });

  it('abre siempre en modo lectura-escritura, nunca de solo lectura', async () => {
    // `readonly` es un parámetro posicional entre otros booleanos, así que
    // un `true` de más pasa desapercibido a la vista. En el teléfono eso
    // abre la base en solo lectura y toda escritura falla: la app arranca
    // bien y recién revienta al registrar el primer pago.
    const fabrica = new FabricaFalsa(true, true);
    await abrirBaseDeDatos(fabrica);
    await cerrarBaseDeDatos(fabrica);
    for (const llamada of fabrica.llamadas) {
      if (llamada.soloLectura !== undefined) {
        expect(llamada.soloLectura, `${llamada.metodo} pidió solo lectura`).toBe(false);
      }
    }
    // Sin esto, una fábrica que no registrara nada dejaría el bucle vacío
    // y la prueba pasaría sin comprobar nada.
    expect(fabrica.llamadas.filter((l) => l.soloLectura !== undefined)).toHaveLength(3);
  });

  it('todas las llamadas usan el mismo nombre de base', async () => {
    // Abrir con un nombre y cerrar con otro dejaría la conexión viva y
    // crearía un archivo distinto en cada arranque.
    const fabrica = new FabricaFalsa(true, true);
    await abrirBaseDeDatos(fabrica);
    await cerrarBaseDeDatos(fabrica);
    const nombres = new Set(
      fabrica.llamadas.map((l) => l.bd).filter((bd): bd is string => bd !== undefined),
    );
    expect([...nombres]).toEqual([NOMBRE_BD]);
  });

  it('el nombre de la base no lleva extensión .db', async () => {
    // El plugin le agrega "SQLite.db" al nombre; pasarle "algo.db" produce
    // un archivo distinto del que abre al reiniciar.
    expect(NOMBRE_BD.endsWith('.db')).toBe(false);
  });
});
