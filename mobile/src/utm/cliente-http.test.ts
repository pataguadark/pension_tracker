import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClienteHttpFetch, ErrorDeRed } from './cliente-http';

/** fetch falso que responde lo que se le indique. */
function fetchQueResponde(cuerpo: unknown, status = 200, tipo = 'application/json'): typeof fetch {
  return (async () =>
    new Response(typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo), {
      status,
      headers: { 'content-type': tipo },
    })) as unknown as typeof fetch;
}

describe('ClienteHttpFetch', () => {
  it('devuelve el JSON cuando la respuesta es correcta', async () => {
    const cliente = new ClienteHttpFetch(1000, fetchQueResponde({ serie: [{ valor: 69542 }] }));
    expect(await cliente.obtenerJson('https://ejemplo.cl/api')).toEqual({
      serie: [{ valor: 69542 }],
    });
  });

  it('envía las cabeceras que el escritorio usa', async () => {
    let vistas: Record<string, string> = {};
    const espia = (async (_url: string, init?: RequestInit) => {
      vistas = init?.headers as Record<string, string>;
      return new Response('{}', { headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;
    await new ClienteHttpFetch(1000, espia).obtenerJson('https://ejemplo.cl/api');
    expect(vistas['Accept']).toBe('application/json');
    expect(vistas['User-Agent']).toContain('pension-tracker');
  });

  it('lanza ErrorDeRed con motivo http cuando el estado no es exitoso', async () => {
    const cliente = new ClienteHttpFetch(1000, fetchQueResponde({}, 503));
    await expect(cliente.obtenerJson('https://ejemplo.cl/api')).rejects.toMatchObject({
      motivo: 'http',
    });
  });

  it('el mensaje del error http incluye el código', async () => {
    const cliente = new ClienteHttpFetch(1000, fetchQueResponde({}, 503));
    await expect(cliente.obtenerJson('https://ejemplo.cl/api')).rejects.toThrow(/503/);
  });

  it('lanza ErrorDeRed con motivo respuesta_invalida si el cuerpo no es JSON', async () => {
    const cliente = new ClienteHttpFetch(1000, fetchQueResponde('<html>error</html>', 200, 'text/html'));
    await expect(cliente.obtenerJson('https://ejemplo.cl/api')).rejects.toMatchObject({
      motivo: 'respuesta_invalida',
    });
  });

  it('lanza ErrorDeRed con motivo timeout si la respuesta tarda demasiado', async () => {
    const lento = ((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(Object.assign(new Error('abortado'), { name: 'AbortError' }));
        });
      })) as unknown as typeof fetch;
    const cliente = new ClienteHttpFetch(20, lento);
    await expect(cliente.obtenerJson('https://ejemplo.cl/api')).rejects.toMatchObject({
      motivo: 'timeout',
    });
  });

  it('lanza ErrorDeRed con motivo conexion si fetch falla', async () => {
    const caido = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    await expect(
      new ClienteHttpFetch(1000, caido).obtenerJson('https://ejemplo.cl/api'),
    ).rejects.toMatchObject({ motivo: 'conexion' });
  });

  it('ErrorDeRed es instancia de Error, conserva su nombre y el motivo sobrevive a un catch genérico', async () => {
    const cliente = new ClienteHttpFetch(1000, fetchQueResponde({}, 500));
    try {
      await cliente.obtenerJson('https://ejemplo.cl/api');
      throw new Error('se esperaba que obtenerJson lanzara ErrorDeRed');
    } catch (e) {
      // e llega tipado como unknown (catch genérico); hay que angostarlo.
      expect(e).toBeInstanceOf(Error);
      expect(e).toBeInstanceOf(ErrorDeRed);
      if (!(e instanceof ErrorDeRed)) throw e;
      expect(e.name).toBe('ErrorDeRed');
      expect(e.motivo).toBe('http');
    }
  });

  describe('cancelación del temporizador', () => {
    let espiaClearTimeout: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      espiaClearTimeout = vi.spyOn(globalThis, 'clearTimeout');
    });

    afterEach(() => {
      espiaClearTimeout.mockRestore();
    });

    it('cancela el temporizador tras una respuesta correcta', async () => {
      // Si el timeout no se cancela, vitest se queda esperando al cerrar
      // y cada consulta a la UTM deja un handle de 10s colgando.
      const cliente = new ClienteHttpFetch(60_000, fetchQueResponde({ ok: true }));
      await cliente.obtenerJson('https://ejemplo.cl/api');
      expect(espiaClearTimeout).toHaveBeenCalledTimes(1);
    });

    it('cancela el temporizador cuando la respuesta es un error HTTP', async () => {
      const cliente = new ClienteHttpFetch(60_000, fetchQueResponde({}, 500));
      await expect(cliente.obtenerJson('https://ejemplo.cl/api')).rejects.toBeInstanceOf(ErrorDeRed);
      expect(espiaClearTimeout).toHaveBeenCalledTimes(1);
    });

    it('cancela el temporizador cuando fetch lanza una excepción', async () => {
      const caido = (async () => {
        throw new TypeError('fetch failed');
      }) as unknown as typeof fetch;
      const cliente = new ClienteHttpFetch(60_000, caido);
      await expect(cliente.obtenerJson('https://ejemplo.cl/api')).rejects.toBeInstanceOf(ErrorDeRed);
      expect(espiaClearTimeout).toHaveBeenCalledTimes(1);
    });
  });
});
