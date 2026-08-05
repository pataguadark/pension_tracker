import { describe, expect, it } from 'vitest';

import { EjecutorNode } from '../data/ejecutor-node';
import { inicializarBd } from '../data/esquema';
import { RepositorioPagos, RepositorioUtm } from '../data/repositorio';
import { ServicioUtm } from '../utm/servicio-utm';
import { EstadoApp } from './estado.svelte';

/**
 * Cliente HTTP que cuenta sus llamadas y, si alguien lo usa, devuelve un
 * valor DISTINTO del que hay guardado.
 *
 * Que devuelva algo en vez de fallar es deliberado: un cliente que lanza
 * dejaría pasar una implementación que sale a la red y se recupera del
 * error, que es exactamente la que no queremos. Con este, salir a la red
 * cambia el resultado y la prueba lo nota.
 */
class HttpQueCuenta {
  llamadas = 0;
  async obtenerJson(): Promise<unknown> {
    this.llamadas++;
    return { serie: [{ fecha: '2025-06-01T04:00:00.000Z', valor: 99_999 }] };
  }
}

async function montar() {
  const ejecutor = new EjecutorNode(':memory:');
  await inicializarBd(ejecutor);
  const pagos = new RepositorioPagos(ejecutor);
  const repoUtm = new RepositorioUtm(ejecutor);
  const http = new HttpQueCuenta();
  const estado = new EstadoApp(pagos, new ServicioUtm(http, repoUtm));
  return { estado, pagos, repoUtm, http };
}

const pagoDe = (anio: number, mes: number, pagado: number) => ({
  fecha: `${anio}-${String(mes).padStart(2, '0')}-05`,
  mesPago: mes,
  anioPago: anio,
  utmValor: 60_000,
  cuotaPactada: 180_000,
  montoPagado: pagado,
  desbalance: pagado - 180_000,
  utmFactor: 3,
});

describe('EstadoApp', () => {
  it('sin pagos deja el resumen en cero y la lista vacía', async () => {
    const { estado } = await montar();
    await estado.cargar();
    expect(estado.cargando).toBe(false);
    expect(estado.filas).toEqual([]);
    expect(estado.resumen.cantidadPagos).toBe(0);
    expect(estado.aniosDisponibles).toEqual([]);
  });

  it('carga los pagos con el saldo corrido calculado', async () => {
    const { estado, pagos } = await montar();
    await pagos.insertarPago(pagoDe(2025, 1, 100_000));
    await pagos.insertarPago(pagoDe(2025, 2, 200_000));
    await estado.cargar();

    expect(estado.resumen.cantidadPagos).toBe(2);
    // Devuelve del más reciente al más antiguo, como el escritorio.
    expect(estado.filas[0]!.mesPago).toBe(2);
    expect(estado.filas[0]!.desbalanceCorrido).toBe(-60_000);
    expect(estado.filas[1]!.desbalanceCorrido).toBe(-80_000);
  });

  it('ofrece los años de más reciente a más antiguo', async () => {
    const { estado, pagos } = await montar();
    await pagos.insertarPago(pagoDe(2024, 5, 100_000));
    await pagos.insertarPago(pagoDe(2026, 1, 100_000));
    await pagos.insertarPago(pagoDe(2025, 3, 100_000));
    await estado.cargar();
    expect(estado.aniosDisponibles).toEqual([2026, 2025, 2024]);
  });

  it('al filtrar por año conserva TODOS los años en el selector', async () => {
    // Si los años salieran de los pagos filtrados, elegir 2025 dejaría solo
    // 2025 y el usuario no podría volver a los otros años.
    const { estado, pagos } = await montar();
    await pagos.insertarPago(pagoDe(2024, 5, 100_000));
    await pagos.insertarPago(pagoDe(2025, 3, 100_000));
    await estado.cargar();

    await estado.filtrarPorAnio(2025);
    expect(estado.filas).toHaveLength(1);
    expect(estado.filas[0]!.anioPago).toBe(2025);
    expect(estado.aniosDisponibles).toEqual([2025, 2024]);
    expect(estado.anioFiltro).toBe(2025);
  });

  it('vuelve a todos los pagos al quitar el filtro', async () => {
    const { estado, pagos } = await montar();
    await pagos.insertarPago(pagoDe(2024, 5, 100_000));
    await pagos.insertarPago(pagoDe(2025, 3, 100_000));
    await estado.cargar();
    await estado.filtrarPorAnio(2025);
    await estado.filtrarPorAnio(null);
    expect(estado.filas).toHaveLength(2);
    expect(estado.anioFiltro).toBeNull();
  });

  it('el resumen del año filtrado cuenta solo ese año', async () => {
    const { estado, pagos } = await montar();
    await pagos.insertarPago(pagoDe(2024, 5, 100_000));
    await pagos.insertarPago(pagoDe(2025, 3, 150_000));
    await estado.cargar();
    await estado.filtrarPorAnio(2025);
    expect(estado.resumen.cantidadPagos).toBe(1);
    expect(estado.resumen.totalPagado).toBe(150_000);
  });

  it('sin UTM de referencia el resumen en UTM queda en null y no rompe', async () => {
    // Camino de degradación: sin red y sin UTM guardada. El historial debe
    // mostrarse igual, solo sin la columna ajustada.
    const { estado, pagos } = await montar();
    await pagos.insertarPago(pagoDe(2025, 1, 100_000));
    await estado.cargar();
    expect(estado.utmReferencia).toBeNull();
    expect(estado.resumenUtm).toBeNull();
    expect(estado.filas[0]!.desbalanceUtmMesPesos).toBeNull();
    expect(estado.error).toBeNull();
  });

  it('no sale a la red al cargar el historial', async () => {
    // El escritorio, en /historial, usa obtener_utm_referencia(), que lee
    // SOLO la base. Si acá se usara obtenerUtm(), el teléfono pediría un
    // valor en vivo cada vez que se abre la pantalla y —cuando el mes actual
    // no está guardado— mostraría una UTM distinta de la que ve el
    // escritorio con la MISMA base de datos.
    const { estado, pagos, repoUtm, http } = await montar();
    await repoUtm.guardarUtm(2025, 6, 66_000);
    await pagos.insertarPago(pagoDe(2025, 1, 100_000));
    await estado.cargar();

    expect(http.llamadas).toBe(0);
    // Y usa lo guardado, no lo que devolvería la red (99.999).
    expect(estado.utmReferencia).toBe(66_000);
  });

  it('con UTM guardada calcula el desbalance ajustado', async () => {
    const { estado, pagos, repoUtm } = await montar();
    await repoUtm.guardarUtm(2025, 6, 66_000);
    await pagos.insertarPago(pagoDe(2025, 1, 100_000));
    await estado.cargar();
    expect(estado.utmReferencia).toBe(66_000);
    expect(estado.resumenUtm).not.toBeNull();
    expect(estado.filas[0]!.desbalanceUtmMesPesos).not.toBeNull();
  });

  it('deja cargando en false aunque la carga falle, y expone el error', async () => {
    // Si `cargando` se quedara en true ante un fallo, la pantalla se quedaría
    // en el spinner para siempre sin decir qué pasó.
    //
    // Desviación del brief: en vez de acceder al ServicioUtm del `estado`
    // sano con un cast (`estado as never as { utm: ServicioUtm }`), se
    // construye uno propio con el mismo repoUtm de `montar()`. Verifica
    // exactamente lo mismo (cargando en false, error con "base corrupta")
    // sin exigir que EstadoApp exponga `utm` como campo público solo para
    // que la prueba lo lea.
    const { repoUtm } = await montar();
    const roto = new RepositorioPagos({
      ejecutar: async () => {},
      correr: async () => ({ cambios: 0, ultimoId: null }),
      consultar: async () => { throw new Error('base corrupta'); },
    });
    const estadoRoto = new EstadoApp(roto, new ServicioUtm(new HttpQueCuenta(), repoUtm));
    await estadoRoto.cargar();
    expect(estadoRoto.cargando).toBe(false);
    expect(estadoRoto.error).toContain('base corrupta');
  });
});
