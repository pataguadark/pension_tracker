/**
 * Afirma, en tiempo de compilación, que los tipos reales de
 * @capacitor-community/sqlite satisfacen las interfaces que declaramos a
 * mano en `plugin-sqlite.ts` y `conexion.ts`.
 *
 * **Por qué existe.** Esas interfaces se escribieron antes de instalar el
 * plugin, y salieron mal: `isTransactionActive` se declaró devolviendo un
 * booleano cuando el plugin devuelve `{ result?: boolean }`. Como ningún
 * archivo de producción importa todavía las clases reales, el compilador no
 * tenía forma de notarlo, y el doble de las pruebas devolvía obedientemente
 * el booleano inventado: 24 pruebas verdes sobre una guarda que contra el
 * plugin real nunca podía dispararse.
 *
 * Este archivo cierra ese hueco. No se importa desde ningún lado —no aporta
 * valores ni entra al bundle—; su único efecto es que `tsc --noEmit` falle
 * si las declaraciones vuelven a divergir de los `.d.ts` del plugin.
 *
 * Las importaciones son `import type` a propósito: nada del plugin debe
 * cargarse en Node, donde no tiene implementación nativa.
 */

import type { SQLiteConnection, SQLiteDBConnection } from '@capacitor-community/sqlite';

import type { FabricaDeConexiones } from './conexion';
import type { ConexionPluginSqlite } from './plugin-sqlite';

/** Una conexión real del plugin debe servir donde el adaptador espera la suya. */
type ConexionRealEsCompatible = SQLiteDBConnection extends ConexionPluginSqlite ? true : never;

/** El objeto real que fabrica conexiones debe servir donde `abrirBaseDeDatos` espera el suyo. */
type FabricaRealEsCompatible = SQLiteConnection extends FabricaDeConexiones ? true : never;

// Si alguna de las dos deja de ser compatible, el tipo se vuelve `never` y
// esta asignación no compila. El mensaje de error apunta acá.
export const compatibilidadVerificada: [ConexionRealEsCompatible, FabricaRealEsCompatible] = [
  true,
  true,
];
