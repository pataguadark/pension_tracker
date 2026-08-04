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
