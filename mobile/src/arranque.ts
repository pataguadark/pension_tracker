/**
 * Cableado de la app contra una base ya abierta.
 *
 * **Por qué no vive en main.ts.** `main.ts` es el único archivo que importa
 * `@capacitor-community/sqlite` y el único que monta sobre el DOM: importarlo
 * desde una prueba montaría la app entera como efecto secundario. Acá queda
 * todo lo que sí se puede ejercitar —qué repositorios se construyen, sobre
 * qué base, y en qué orden se hace cada cosa al arrancar—, recibiendo la
 * fábrica de conexiones por parámetro en vez de importarla.
 *
 * Esa separación es también la respuesta a "aísla el import del plugin":
 * el aislamiento es por archivo, no por un try/catch. Nada acá se traga un
 * fallo — si la base no se puede abrir, `crearEstadoApp` lanza y main.ts lo
 * muestra en pantalla.
 */

import { abrirBaseDeDatos, type FabricaDeConexiones } from './data/conexion';
import {
  RepositorioConfiguracion, RepositorioPagos, RepositorioUtm,
} from './data/repositorio';
import { EstadoApp } from './ui/estado.svelte';
import { ClienteHttpFetch, type ClienteHttp } from './utm/cliente-http';
import { ServicioUtm } from './utm/servicio-utm';

export interface AppCableada {
  estado: EstadoApp;
  /**
   * Se devuelve además del estado porque el refresco de UTM del arranque es
   * del servicio, no del estado: `EstadoApp` no expone el suyo.
   */
  servicioUtm: ServicioUtm;
}

/**
 * Abre la base y construye el EstadoApp sobre ella.
 *
 * No carga nada ni toca la red: eso es `arrancarApp`. Si la apertura falla,
 * el error se propaga tal cual — devolver un estado a medias dejaría al
 * usuario frente a un historial vacío indistinguible de "no hay pagos".
 */
export async function crearEstadoApp(
  fabrica: FabricaDeConexiones,
  http: ClienteHttp = new ClienteHttpFetch(),
): Promise<AppCableada> {
  const ejecutor = await abrirBaseDeDatos(fabrica);

  const repoPagos = new RepositorioPagos(ejecutor);
  const repoUtm = new RepositorioUtm(ejecutor);
  const config = new RepositorioConfiguracion(ejecutor);
  const servicioUtm = new ServicioUtm(http, repoUtm);

  return {
    estado: new EstadoApp(repoPagos, servicioUtm, repoUtm, config),
    servicioUtm,
  };
}

/**
 * Lo que hace la app al abrirse, una vez montada.
 *
 * El escritorio refresca la UTM del mes en curso al crear la aplicación,
 * justo después de inicializar la base (`__init__.py:50-52`), y recién
 * después sirve cualquier página. Acá el orden se invierte a propósito:
 *
 *   1. `cargar()` primero, que es una lectura local y rápida: la pantalla
 *      deja de mostrar un historial vacío cuanto antes.
 *   2. `refrescarUtmSiFalta` después, que puede tardar hasta el timeout del
 *      cliente HTTP (10s). Hacerlo antes dejaría "Sin pagos registrados" en
 *      pantalla todo ese rato, que es justo el mensaje que no queremos
 *      mostrar sin motivo.
 *   3. `cargar()` otra vez, porque el paso 2 pudo guardar la UTM del mes en
 *      curso y la referencia se deriva de ella. Es otra lectura local.
 *
 * `refrescarUtmSiFalta` nunca lanza (un teléfono sin señal es lo normal),
 * así que arrancar sin red llega igual hasta el final y sin error.
 */
export async function arrancarApp(estado: EstadoApp, servicioUtm: ServicioUtm): Promise<void> {
  await estado.cargar();

  const hoy = new Date();
  await servicioUtm.refrescarUtmSiFalta(hoy.getFullYear(), hoy.getMonth() + 1);

  await estado.cargar();
}
