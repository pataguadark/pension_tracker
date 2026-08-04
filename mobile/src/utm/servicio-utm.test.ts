import { beforeEach, describe, expect, it } from 'vitest';
import { EjecutorNode } from '../data/ejecutor-node';
import { inicializarBd } from '../data/esquema';
import { RepositorioUtm } from '../data/repositorio';
import { ErrorDeRed, type ClienteHttp } from './cliente-http';
import { ServicioUtm } from './servicio-utm';

/** Cliente que responde según la URL pedida, sin tocar la red. */
function clienteQueResponde(porUrl: Record<string, unknown>): ClienteHttp {
  return {
    obtenerJson: async (url: string) => {
      for (const [fragmento, cuerpo] of Object.entries(porUrl)) {
        if (url.includes(fragmento)) {
          if (cuerpo instanceof Error) throw cuerpo;
          return cuerpo;
        }
      }
      throw new ErrorDeRed(`sin respuesta preparada para ${url}`, 'http');
    },
  };
}

/**
 * Delega en un cliente real, pero cuenta cuántas veces se invocó
 * obtenerJson. Sirve para fijar que un mes inválido no genera ninguna
 * petición de red -en un teléfono eso son datos móviles y batería
 * gastados en una consulta que no puede tener respuesta-, en vez de solo
 * comprobar `fuente`/`utm`: un mes inválido sin la validación explícita
 * también termina en `fuente: 'no_disponible'` porque la consulta puntual
 * falla por falta de respuesta preparada, así que esas aserciones no
 * distinguen si hubo o no una petición de red de por medio.
 */
function clienteQueCuenta(real: ClienteHttp): ClienteHttp & { llamadas: number } {
  return {
    llamadas: 0,
    async obtenerJson(url: string) {
      this.llamadas += 1;
      return real.obtenerJson(url);
    },
  };
}

const SERIE_2025 = {
  serie: [
    { fecha: '2025-02-01T03:00:00.000Z', valor: 67429 },
    { fecha: '2025-01-01T03:00:00.000Z', valor: 67294 },
  ],
};

let ejecutor: EjecutorNode;
let repo: RepositorioUtm;

beforeEach(async () => {
  ejecutor = new EjecutorNode(':memory:');
  await inicializarBd(ejecutor);
  repo = new RepositorioUtm(ejecutor);
});

describe('ServicioUtm.obtenerUtm', () => {
  it('devuelve el valor de la serie anual cuando el mes está publicado', async () => {
    const s = new ServicioUtm(clienteQueResponde({ '/utm/2025': SERIE_2025 }), repo);
    const r = await s.obtenerUtm(2025, 1);
    expect(r).toMatchObject({ utm: 67294, mes: 1, anio: 2025, fuente: 'mindicador' });
    expect(r.error).toBeNull();
  });

  it('cae a la consulta puntual si el mes no está en la serie anual', async () => {
    const s = new ServicioUtm(
      clienteQueResponde({
        '/utm/2025': { serie: [] },
        '/utm/01-03-2025': { serie: [{ fecha: '2025-03-01T03:00:00.000Z', valor: 68034 }] },
      }),
      repo,
    );
    const r = await s.obtenerUtm(2025, 3);
    expect(r).toMatchObject({ utm: 68034, fuente: 'mindicador' });
  });

  it('sin red, usa la última UTM guardada y lo avisa', async () => {
    await repo.guardarUtm(2024, 12, 66500, '2024-12-01 00:00:00');
    const caido = { obtenerJson: async () => { throw new ErrorDeRed('sin red', 'conexion'); } };
    const r = await new ServicioUtm(caido, repo).obtenerUtm(2025, 1);
    expect(r).toMatchObject({ utm: 66500, fuente: 'base_de_datos' });
    expect(r.error).toBeTruthy();
  });

  it('sin red y sin nada guardado, informa que no hay valor disponible', async () => {
    const caido = { obtenerJson: async () => { throw new ErrorDeRed('sin red', 'conexion'); } };
    const r = await new ServicioUtm(caido, repo).obtenerUtm(2025, 1);
    expect(r).toMatchObject({ utm: null, fuente: 'no_disponible' });
    expect(r.error).toBeTruthy();
  });

  it('con el mes publicado pero sin red no consulta la base', async () => {
    await repo.guardarUtm(2024, 12, 66500, '2024-12-01 00:00:00');
    const s = new ServicioUtm(clienteQueResponde({ '/utm/2025': SERIE_2025 }), repo);
    expect((await s.obtenerUtm(2025, 2)).utm).toBe(67429);
  });

  it.each([0, 13, -1])('rechaza el mes inválido %i', async (mes) => {
    const s = new ServicioUtm(clienteQueResponde({ '/utm/2025': SERIE_2025 }), repo);
    const r = await s.obtenerUtm(2025, mes);
    expect(r.fuente).toBe('no_disponible');
    expect(r.utm).toBeNull();
  });

  it.each([0, 13, -1, 1.5])(
    'con el mes inválido %s no hace ninguna petición de red',
    async (mes) => {
      const contado = clienteQueCuenta(clienteQueResponde({ '/utm/2025': SERIE_2025 }));
      const s = new ServicioUtm(contado, repo);
      await s.obtenerUtm(2025, mes);
      expect(contado.llamadas).toBe(0);
    },
  );

  it('el mes publicado pero ausente en ambas consultas no queda como mindicador', async () => {
    const s = new ServicioUtm(
      clienteQueResponde({ '/utm/2025': { serie: [] }, '/utm/01-07-2025': { serie: [] } }),
      repo,
    );
    const r = await s.obtenerUtm(2025, 7);
    expect(r.fuente).not.toBe('mindicador');
    expect(r.utm).toBeNull();
  });
});

describe('obtenerUtmMesConCache', () => {
  it('no consulta la red si el mes ya está cacheado', async () => {
    await repo.guardarUtm(2025, 1, 67294, '2025-01-01 00:00:00');
    const contado = clienteQueCuenta(clienteQueResponde({ '/utm/2025': SERIE_2025 }));
    const r = await new ServicioUtm(contado, repo).obtenerUtmMesConCache(2025, 1);
    expect(r).toMatchObject({ utm: 67294, fuente: 'base_de_datos' });
    expect(contado.llamadas).toBe(0);
  });

  it('trae el año completo y cachea todos los meses recibidos', async () => {
    const contado = clienteQueCuenta(clienteQueResponde({ '/utm/2025': SERIE_2025 }));
    const s = new ServicioUtm(contado, repo);
    const r = await s.obtenerUtmMesConCache(2025, 1);
    expect(r).toMatchObject({ utm: 67294, fuente: 'mindicador' });
    // El mes 2 venía en la misma respuesta y quedó cacheado.
    expect((await repo.obtenerUtmGuardada(2025, 2))!.utmValor).toBe(67429);
    expect(contado.llamadas).toBe(1);
  });

  it('un segundo mes del mismo año no gasta otra petición', async () => {
    const contado = clienteQueCuenta(clienteQueResponde({ '/utm/2025': SERIE_2025 }));
    const s = new ServicioUtm(contado, repo);
    await s.obtenerUtmMesConCache(2025, 1);
    await s.obtenerUtmMesConCache(2025, 2);
    expect(contado.llamadas).toBe(1);
  });

  it('si el mes no está publicado lo informa sin inventar valor', async () => {
    const s = new ServicioUtm(clienteQueResponde({ '/utm/2025': SERIE_2025 }), repo);
    const r = await s.obtenerUtmMesConCache(2025, 11);
    expect(r).toMatchObject({ utm: null, fuente: 'no_disponible' });
    expect(r.error).toBeTruthy();
  });

  it('sin red informa el fallo sin lanzar', async () => {
    const caido = { obtenerJson: async () => { throw new ErrorDeRed('sin red', 'conexion'); } };
    const r = await new ServicioUtm(caido, repo).obtenerUtmMesConCache(2025, 1);
    expect(r).toMatchObject({ utm: null, fuente: 'no_disponible' });
  });
});

describe('refrescarUtmSiFalta', () => {
  it('guarda la UTM del mes si no estaba', async () => {
    const s = new ServicioUtm(clienteQueResponde({ '/utm/2025': SERIE_2025 }), repo);
    await s.refrescarUtmSiFalta(2025, 1);
    expect((await repo.obtenerUtmGuardada(2025, 1))!.utmValor).toBe(67294);
  });

  it('no consulta la red si el mes ya estaba guardado', async () => {
    await repo.guardarUtm(2025, 1, 67294, '2025-01-01 00:00:00');
    const contado = clienteQueCuenta(clienteQueResponde({ '/utm/2025': SERIE_2025 }));
    await new ServicioUtm(contado, repo).refrescarUtmSiFalta(2025, 1);
    expect(contado.llamadas).toBe(0);
  });

  it('no lanza cuando no hay red: no puede impedir que la app abra', async () => {
    const caido = { obtenerJson: async () => { throw new ErrorDeRed('sin red', 'conexion'); } };
    await expect(new ServicioUtm(caido, repo).refrescarUtmSiFalta(2025, 1)).resolves.toBeUndefined();
  });

  it('no guarda un valor que vino de la base y no de mindicador', async () => {
    await repo.guardarUtm(2024, 12, 66500, '2024-12-01 00:00:00');
    const caido = { obtenerJson: async () => { throw new ErrorDeRed('sin red', 'conexion'); } };
    await new ServicioUtm(caido, repo).refrescarUtmSiFalta(2025, 1);
    expect(await repo.obtenerUtmGuardada(2025, 1)).toBeNull();
  });
});

describe('obtenerUtmReferencia', () => {
  it('prioriza la UTM del mes indicado', async () => {
    await repo.guardarUtm(2024, 12, 66500, '2024-12-01 00:00:00');
    await repo.guardarUtm(2025, 1, 67294, '2025-01-01 00:00:00');
    const s = new ServicioUtm(clienteQueResponde({}), repo);
    expect(await s.obtenerUtmReferencia(2025, 1)).toEqual({ utmValor: 67294, esActual: true });
  });

  it('cae a la última guardada y lo marca', async () => {
    await repo.guardarUtm(2024, 12, 66500, '2024-12-01 00:00:00');
    const s = new ServicioUtm(clienteQueResponde({}), repo);
    expect(await s.obtenerUtmReferencia(2025, 1)).toEqual({ utmValor: 66500, esActual: false });
  });

  it('sin nada guardado devuelve nulo', async () => {
    const s = new ServicioUtm(clienteQueResponde({}), repo);
    expect(await s.obtenerUtmReferencia(2025, 1)).toEqual({ utmValor: null, esActual: false });
  });

  // Los dos siguientes reflejan test_obtener_utm_referencia_trata_valor_actual_
  // infinito_como_ausente y test_obtener_utm_referencia_trata_ultima_infinita_
  // como_ausente de test_utm_service.py: obtenerUltimaUtmGuardada es un LIMIT 1
  // sin filtrar (repositorio.ts, igual que db_manager.py:335-353), así que una
  // fila corrupta que además es la más reciente no tiene a dónde "caer": el
  // escritorio no encadena hacia una fila válida más antigua, se rinde con
  // null. Por eso estos dos casos no combinan una fila corrupta con una fila
  // válida más antigua en la misma prueba -esa combinación pediría una
  // semántica de "saltar filas corruptas" que el escritorio no implementa.

  it('ignora un valor no finito guardado para el mes indicado', async () => {
    await ejecutor.correr(
      'INSERT INTO utm_historial (anio, mes, utm_valor, fecha_registro) VALUES (?,?,?,?)',
      [2025, 1, Infinity, '2025-01-01 00:00:00'],
    );
    const s = new ServicioUtm(clienteQueResponde({}), repo);
    // Tolerar al leer: la fila corrupta se trata como si no existiera.
    expect(await s.obtenerUtmReferencia(2025, 1)).toEqual({ utmValor: null, esActual: false });
  });

  it('ignora un valor no finito guardado como última UTM', async () => {
    await ejecutor.correr(
      'INSERT INTO utm_historial (anio, mes, utm_valor, fecha_registro) VALUES (?,?,?,?)',
      [2024, 12, Infinity, '2024-12-01 00:00:00'],
    );
    const s = new ServicioUtm(clienteQueResponde({}), repo);
    // Tolerar al leer: la fila corrupta se trata como si no existiera.
    expect(await s.obtenerUtmReferencia(2025, 1)).toEqual({ utmValor: null, esActual: false });
  });
});
