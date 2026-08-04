/**
 * Obtención del valor de la UTM, con caché local y degradación sin red.
 *
 * Port de src/pensiontracker/services/utm_service.py. No conoce Capacitor ni
 * fetch: recibe un ClienteHttp. No conoce SQLite: recibe un RepositorioUtm.
 *
 * Las cadenas de `error` son presentación y no se verifican contra el
 * Python: hacerlas coincidir carácter a carácter entre dos lenguajes produce
 * pruebas frágiles. Lo que debe coincidir es `utm` y `fuente`.
 *
 * El servicio nunca lanza: un teléfono sin señal es lo normal, no la
 * excepción, así que hasta un fallo al leer la caché local (paso de
 * respaldo) se atrapa y se informa en `fuente`/`error`, igual que
 * obtener_utm hace con el `except Exception as db_error` de
 * utm_service.py:103-105.
 */

import type { RepositorioUtm } from '../data/repositorio';
import { ErrorDeRed, type ClienteHttp } from './cliente-http';
import { buscarMesEnSerie, extraerValoresDelAnio } from './serie';

const API_ANIO = (anio: number) => `https://mindicador.cl/api/utm/${anio}`;
const API_FECHA = (anio: number, mes: number) =>
  `https://mindicador.cl/api/utm/01-${String(mes).padStart(2, '0')}-${anio}`;

export type FuenteUtm = 'mindicador' | 'base_de_datos' | 'no_disponible';

export interface ResultadoUtm {
  utm: number | null;
  mes: number;
  anio: number;
  fuente: FuenteUtm | null;
  error: string | null;
}

export class ServicioUtm {
  constructor(
    private readonly http: ClienteHttp,
    private readonly repo: RepositorioUtm,
  ) {}

  /** Valores publicados de un año, en una sola petición. */
  async obtenerUtmAnio(anio: number): Promise<Map<number, number>> {
    return extraerValoresDelAnio(await this.http.obtenerJson(API_ANIO(anio)), anio);
  }

  /**
   * Valor de un mes: primero mindicador.cl, y si falla, la última UTM
   * guardada. Nunca lanza: informa el estado en `fuente` y `error`.
   */
  async obtenerUtm(anio: number, mes: number): Promise<ResultadoUtm> {
    const resultado: ResultadoUtm = { utm: null, mes, anio, fuente: null, error: null };

    try {
      resultado.utm = await this.consultarMindicador(anio, mes);
      resultado.fuente = 'mindicador';
      return resultado;
    } catch (e) {
      resultado.error = e instanceof Error ? e.message : String(e);
    }

    try {
      const ultima = await this.repo.obtenerUltimaUtmGuardada();
      if (ultima) {
        resultado.utm = ultima.utmValor;
        resultado.fuente = 'base_de_datos';
        resultado.error =
          `${resultado.error} | AVISO: Se está usando la última UTM registrada ` +
          `(${ultima.utmValor} de ${ultima.fechaRegistro}).`;
      } else {
        resultado.fuente = 'no_disponible';
        resultado.error = `${resultado.error} | No hay UTM guardada en la base de datos.`;
      }
    } catch (dbError) {
      resultado.fuente = 'no_disponible';
      resultado.error =
        `${resultado.error} | Error al consultar la base de datos de respaldo: ` +
        `${dbError instanceof Error ? dbError.message : String(dbError)}`;
    }
    return resultado;
  }

  /**
   * Estrategia del escritorio: serie anual primero, fecha puntual después.
   * Lanza ErrorDeRed si ninguna de las dos tiene el mes.
   */
  private async consultarMindicador(anio: number, mes: number): Promise<number> {
    if (!Number.isInteger(mes) || mes < 1 || mes > 12) {
      throw new ErrorDeRed(
        `Número de mes inválido: ${mes}. Debe ser entre 1 y 12.`,
        'respuesta_invalida',
      );
    }

    const serieAnio = await this.obtenerUtmAnio(anio);
    const delAnio = serieAnio.get(mes);
    if (delAnio !== undefined) return delAnio;

    const puntual = await this.http.obtenerJson(API_FECHA(anio, mes));
    const valor = buscarMesEnSerie(
      (puntual as { serie?: unknown } | null)?.serie,
      anio,
      mes,
    );
    if (valor !== null) return valor;

    throw new ErrorDeRed(
      `mindicador.cl no tiene UTM publicada para ${String(mes).padStart(2, '0')}/${anio}. ` +
        `Es posible que el mes aún no esté disponible.`,
      'respuesta_invalida',
    );
  }

  /**
   * Valor de un mes priorizando la caché local. Si el mes no está, trae el
   * año completo en una sola petición y cachea todo lo recibido: completar
   * varios meses del mismo año no debe costar una petición por mes.
   */
  async obtenerUtmMesConCache(anio: number, mes: number): Promise<ResultadoUtm> {
    const resultado: ResultadoUtm = { utm: null, mes, anio, fuente: null, error: null };

    const guardado = await this.repo.obtenerUtmGuardada(anio, mes);
    if (guardado) {
      resultado.utm = guardado.utmValor;
      resultado.fuente = 'base_de_datos';
      return resultado;
    }

    let serieAnio: Map<number, number>;
    try {
      serieAnio = await this.obtenerUtmAnio(anio);
    } catch (e) {
      resultado.fuente = 'no_disponible';
      resultado.error = e instanceof Error ? e.message : String(e);
      return resultado;
    }

    if (serieAnio.size > 0) {
      await this.repo.guardarUtmBulk(anio, serieAnio);
    }

    const valor = serieAnio.get(mes);
    if (valor !== undefined) {
      resultado.utm = valor;
      resultado.fuente = 'mindicador';
    } else {
      resultado.fuente = 'no_disponible';
      resultado.error =
        `mindicador.cl no tiene UTM publicada para ${String(mes).padStart(2, '0')}/${anio}. ` +
        `Es posible que el mes aún no esté disponible.`;
    }
    return resultado;
  }

  /**
   * Si la UTM del mes indicado no está guardada, la busca y la persiste.
   *
   * Se llama al arrancar, así que **nunca lanza**: un problema de red no
   * puede impedir que la app abra. Solo persiste si el valor vino de
   * mindicador.cl, no si salió de la propia base.
   */
  async refrescarUtmSiFalta(anio: number, mes: number): Promise<void> {
    try {
      if (await this.repo.obtenerUtmGuardada(anio, mes)) return;
      const resultado = await this.obtenerUtm(anio, mes);
      if (resultado.utm !== null && resultado.fuente === 'mindicador') {
        await this.repo.guardarUtm(resultado.anio, resultado.mes, resultado.utm);
      }
    } catch {
      // Silencio deliberado: ver el docstring.
    }
  }

  /**
   * UTM a mostrar como referencia: la del mes indicado, o la última
   * guardada marcada como no actual.
   *
   * Tolerar al leer: una fila con un valor no finito —persistida por una
   * versión sin el guard de finitud, o por una respuesta extrema de la
   * API— se trata igual que si no hubiera valor, en vez de propagar el
   * `inf` al cálculo, que lo rechazaría.
   */
  async obtenerUtmReferencia(
    anio: number,
    mes: number,
  ): Promise<{ utmValor: number | null; esActual: boolean }> {
    const actual = await this.repo.obtenerUtmGuardada(anio, mes);
    if (actual && Number.isFinite(actual.utmValor)) {
      return { utmValor: actual.utmValor, esActual: true };
    }

    const ultima = await this.repo.obtenerUltimaUtmGuardada();
    if (ultima && Number.isFinite(ultima.utmValor)) {
      return { utmValor: ultima.utmValor, esActual: false };
    }

    return { utmValor: null, esActual: false };
  }
}
