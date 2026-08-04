/**
 * La frontera entre el servicio de UTM y la red.
 *
 * El servicio no conoce Capacitor ni fetch: habla con esta interfaz, igual
 * que el repositorio habla con EjecutorSql. En las pruebas se reemplaza por
 * respuestas preparadas, así ninguna suite depende de que mindicador.cl
 * esté disponible.
 *
 * En producción se usa `fetch` plano y no `CapacitorHttp.get`: habilitando
 * el plugin CapacitorHttp, Capacitor parchea fetch para que use las
 * bibliotecas HTTP nativas, evitando las restricciones de CORS del WebView.
 * Esa configuración se agrega junto con el andamiaje de Capacitor.
 */

export type MotivoDeError = 'timeout' | 'conexion' | 'http' | 'respuesta_invalida';

/** Falla al obtener datos de la red. Equivale al ScraperError del escritorio. */
export class ErrorDeRed extends Error {
  constructor(mensaje: string, readonly motivo: MotivoDeError) {
    super(mensaje);
    this.name = 'ErrorDeRed';
  }
}

export interface ClienteHttp {
  /** GET que devuelve el JSON, o lanza ErrorDeRed con el motivo. */
  obtenerJson(url: string): Promise<unknown>;
}

/** Igual que el escritorio (utm_service.py:43). */
export const TIMEOUT_MS = 10_000;

/** Igual que el escritorio (utm_service.py:38-41). */
export const CABECERAS: Record<string, string> = {
  'User-Agent': 'pension-tracker/1.0 (personal)',
  Accept: 'application/json',
};

export class ClienteHttpFetch implements ClienteHttp {
  constructor(
    private readonly timeoutMs: number = TIMEOUT_MS,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async obtenerJson(url: string): Promise<unknown> {
    const controlador = new AbortController();
    const temporizador = setTimeout(() => controlador.abort(), this.timeoutMs);

    let respuesta: Response;
    try {
      respuesta = await this.fetchImpl(url, {
        headers: CABECERAS,
        signal: controlador.signal,
      });
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') {
        throw new ErrorDeRed(
          `mindicador.cl tardó más de ${this.timeoutMs / 1000}s en responder (${url}).`,
          'timeout',
        );
      }
      throw new ErrorDeRed(
        'No se pudo conectar a mindicador.cl. Verifica tu conexión a internet.',
        'conexion',
      );
    } finally {
      // Sin esto el temporizador queda vivo y demora el cierre del proceso.
      clearTimeout(temporizador);
    }

    if (!respuesta.ok) {
      throw new ErrorDeRed(
        `mindicador.cl devolvió un error HTTP: ${respuesta.status} para ${url}`,
        'http',
      );
    }

    try {
      return await respuesta.json();
    } catch {
      throw new ErrorDeRed(
        `mindicador.cl devolvió una respuesta no válida (${url}).`,
        'respuesta_invalida',
      );
    }
  }
}
