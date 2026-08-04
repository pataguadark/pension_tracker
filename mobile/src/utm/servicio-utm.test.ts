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
