/**
 * Pruebas del cableado de arranque.
 *
 * Existen porque `main.ts` no es ejecutable en las pruebas: monta sobre el
 * DOM y es el único archivo que importa `@capacitor-community/sqlite`, cuyo
 * `SQLiteConnection` necesita el puente nativo. Todo lo que sí se puede
 * comprobar —qué repositorios se construyen, sobre qué base, y en qué orden
 * se hacen las cosas— vive acá y recibe la fábrica de conexiones por
 * parámetro.
 *
 * Sin estas pruebas el cableado sería justo la clase de código que "se ve
 * bien" y no está sujetado por nada: el bug de `isTransactionActive` vivió
 * ahí un escalón antes de manifestarse.
 */

import { describe, expect, it } from 'vitest';

import { arrancarApp, crearEstadoApp } from './arranque';
import { EjecutorNode } from './data/ejecutor-node';
import type { FabricaDeConexiones } from './data/conexion';
import { NOMBRE_BD } from './data/conexion';
import type { ConexionPluginSqlite } from './data/plugin-sqlite';

/**
 * Fábrica de conexiones que devuelve una base SQLite de verdad (node:sqlite)
 * detrás de la misma forma que expone `SQLiteConnection` del plugin.
 *
 * Deliberadamente NO es un doble que devuelve objetos vacíos: así el
 * `inicializarBd` que hace `abrirBaseDeDatos` corre de verdad y las tablas
 * quedan creadas, que es lo que el resto de la prueba necesita comprobar.
 */
class FabricaFalsa implements FabricaDeConexiones {
  readonly llamadas: string[] = [];
  abierta = 0;
  private readonly ejecutor = new EjecutorNode(':memory:');

  constructor(private readonly existePrevia = false) {}

  private conexion(): ConexionPluginSqlite & { open(): Promise<void>; close(): Promise<void> } {
    const ej = this.ejecutor;
    const contar = () => { this.abierta += 1; };
    return {
      open: async () => { contar(); },
      close: async () => {},
      execute: async (statements: string) => { await ej.ejecutar(statements); return {}; },
      run: async (statement: string, values?: unknown[]) => {
        const r = await ej.correr(statement, values ?? []);
        return { changes: { changes: r.cambios, lastId: r.ultimoId ?? -1 } };
      },
      query: async <T>(statement: string, values?: unknown[]) => (
        { values: await ej.consultar<T>(statement, values ?? []) }
      ),
      beginTransaction: async () => { await ej.ejecutar('BEGIN'); return {}; },
      commitTransaction: async () => { await ej.ejecutar('COMMIT'); return {}; },
      rollbackTransaction: async () => { await ej.ejecutar('ROLLBACK'); return {}; },
      isTransactionActive: async () => ({ result: false }),
    };
  }

  async checkConnectionsConsistency(): Promise<{ result?: boolean }> {
    this.llamadas.push('checkConnectionsConsistency');
    return { result: true };
  }

  async isConnection(database: string): Promise<{ result?: boolean }> {
    this.llamadas.push(`isConnection:${database}`);
    return { result: this.existePrevia };
  }

  async retrieveConnection(database: string) {
    this.llamadas.push(`retrieveConnection:${database}`);
    return this.conexion();
  }

  async createConnection(database: string) {
    this.llamadas.push(`createConnection:${database}`);
    return this.conexion();
  }

  async closeConnection(database: string): Promise<void> {
    this.llamadas.push(`closeConnection:${database}`);
  }
}

/** Cliente HTTP que cuenta y publica un valor para el año que le pidan. */
class HttpQueCuenta {
  llamadas = 0;
  constructor(private readonly valor: number | null = null) {}
  async obtenerJson(url: string): Promise<unknown> {
    this.llamadas++;
    if (this.valor === null) throw new Error('sin red');
    const anio = Number(url.slice(-4));
    const hoy = new Date();
    return {
      serie: [{
        fecha: `${anio}-${String(hoy.getMonth() + 1).padStart(2, '0')}-01T04:00:00.000Z`,
        valor: this.valor,
      }],
    };
  }
}

describe('crearEstadoApp', () => {
  it('abre la base con el nombre acordado y deja un EstadoApp usable', async () => {
    const fabrica = new FabricaFalsa();
    const { estado } = await crearEstadoApp(fabrica, new HttpQueCuenta());

    expect(fabrica.llamadas).toContain(`createConnection:${NOMBRE_BD}`);
    expect(fabrica.abierta).toBe(1);

    // Si los cuatro repositorios no estuvieran cableados sobre la MISMA base
    // abierta, esto reventaría o no encontraría el pago.
    await estado.registrarPago({
      utmFactor: 3, utmValor: 60_000, montoPagado: 200_000,
      mesPago: 3, anioPago: 2025, fecha: '2025-03-05',
    });
    expect(estado.filas).toHaveLength(1);
    expect(estado.resumen.totalPagado).toBe(200_000);
    expect(estado.error).toBeNull();
  });

  it('comprueba la consistencia ANTES de decidir cómo obtener la conexión', async () => {
    // Cuando Android recrea el WebView, el diccionario de JS puede afirmar
    // que la conexión existe mientras el lado nativo ya la perdió
    // (conexion.ts:40-44). Si el orden se invirtiera, recuperar esa conexión
    // fantasma fallaría con "Connection ... does not exist".
    const fabrica = new FabricaFalsa(true);
    await crearEstadoApp(fabrica, new HttpQueCuenta());

    expect(fabrica.llamadas[0]).toBe('checkConnectionsConsistency');
    expect(fabrica.llamadas[1]).toBe(`isConnection:${NOMBRE_BD}`);
    expect(fabrica.llamadas[2]).toBe(`retrieveConnection:${NOMBRE_BD}`);
  });

  it('no sale a la red al construir el estado', async () => {
    // Construir no es cargar: la red se toca después, y sin bloquear.
    const http = new HttpQueCuenta(70_000);
    await crearEstadoApp(new FabricaFalsa(), http);
    expect(http.llamadas).toBe(0);
  });

  it('deja pasar el fallo de apertura en vez de tragárselo', async () => {
    // Un try/catch que devolviera un EstadoApp a medias dejaría al usuario
    // frente a un historial vacío que parece "no hay pagos".
    const fabrica = new FabricaFalsa();
    fabrica.createConnection = async () => { throw new Error('sin permisos'); };

    await expect(crearEstadoApp(fabrica, new HttpQueCuenta())).rejects.toThrow('sin permisos');
  });
});

describe('arrancarApp', () => {
  it('carga los pagos y solo después refresca la UTM contra la red', async () => {
    // El orden importa: `cargar()` es una lectura local y rápida, así que va
    // primero y la pantalla deja de mentir enseguida. `refrescarUtmSiFalta`
    // puede tardar hasta 10s (el timeout del cliente): hacerlo antes dejaría
    // "Sin pagos registrados" en pantalla todo ese rato.
    const orden: string[] = [];
    const http = new HttpQueCuenta(70_000);
    const { estado, servicioUtm } = await crearEstadoApp(new FabricaFalsa(), http);
    const cargarReal = estado.cargar.bind(estado);
    estado.cargar = async () => { orden.push('cargar'); await cargarReal(); };
    const refrescarReal = servicioUtm.refrescarUtmSiFalta.bind(servicioUtm);
    servicioUtm.refrescarUtmSiFalta = async (a: number, m: number) => {
      orden.push('refrescarUtmSiFalta');
      await refrescarReal(a, m);
    };

    await arrancarApp(estado, servicioUtm);

    expect(orden[0]).toBe('cargar');
    expect(orden).toContain('refrescarUtmSiFalta');
  });

  it('deja la UTM recién bajada como referencia visible', async () => {
    // El escritorio refresca al arrancar (__init__.py:50-52) y recién
    // después sirve cualquier página. Si acá se refrescara sin volver a
    // derivar el estado, el valor quedaría en la base y la pantalla seguiría
    // mostrando el viejo hasta el siguiente arranque.
    const { estado, servicioUtm } = await crearEstadoApp(
      new FabricaFalsa(), new HttpQueCuenta(70_000),
    );

    await arrancarApp(estado, servicioUtm);

    expect(estado.utmReferencia).toBe(70_000);
    expect(estado.utmReferenciaEsActual).toBe(true);
  });

  it('sin red arranca igual y sin error', async () => {
    // Un teléfono sin señal es lo normal, no la excepción.
    const { estado, servicioUtm } = await crearEstadoApp(
      new FabricaFalsa(), new HttpQueCuenta(null),
    );

    await expect(arrancarApp(estado, servicioUtm)).resolves.toBeUndefined();
    expect(estado.error).toBeNull();
  });
});
