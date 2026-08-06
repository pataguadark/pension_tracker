// @vitest-environment jsdom
/**
 * Pruebas del banner de UTM (port de registro_pago.html:13-42 más el
 * `refrescarUtm` de static/app.js:92-133).
 *
 * Igual que Registro.test.ts, el estado es el REAL sobre una base SQLite en
 * memoria: lo que se quiere detectar es una divergencia entre lo que el
 * teléfono muestra/escribe y lo que el escritorio mostraría/escribiría con
 * la MISMA base.
 *
 * El mes y el año se toman de `new Date()` en cada corrida, no de una fecha
 * fija: el banner rotula "UTM mes/año" con el mes en curso, así que una
 * fecha fija dejaría la prueba en verde hoy y en rojo el mes siguiente.
 */
import { render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { EjecutorNode } from '../data/ejecutor-node';
import { inicializarBd } from '../data/esquema';
import {
  RepositorioConfiguracion, RepositorioPagos, RepositorioUtm,
} from '../data/repositorio';
import { ServicioUtm } from '../utm/servicio-utm';
import BannerUtm from './BannerUtm.svelte';
import { EstadoApp } from './estado.svelte';

const HOY = new Date();
const ANIO = HOY.getFullYear();
const MES = HOY.getMonth() + 1;

/** Cliente que falla: el caso "sin red" y el respaldo desde la base. */
class HttpSinRed {
  llamadas = 0;
  async obtenerJson(): Promise<unknown> {
    this.llamadas++;
    throw new Error('sin red');
  }
}

/** Cliente que publica `valor` para el mes en curso, contando llamadas. */
class HttpConValor {
  llamadas = 0;
  constructor(private readonly valor: number) {}
  async obtenerJson(): Promise<unknown> {
    this.llamadas++;
    return {
      serie: [
        { fecha: `${ANIO}-${String(MES).padStart(2, '0')}-01T04:00:00.000Z`, valor: this.valor },
      ],
    };
  }
}

interface Opciones {
  /** UTM guardada para el mes EN CURSO (caso `utm-ok`). */
  utmDelMesActual?: number;
  /** UTM guardada para un mes viejo (caso `utm-warn`). */
  utmVieja?: number;
  /** Cliente HTTP; por defecto uno sin red. */
  http?: HttpSinRed | HttpConValor;
}

async function montarEstado(opciones: Opciones = {}) {
  const ejecutor = new EjecutorNode(':memory:');
  await inicializarBd(ejecutor);
  const pagos = new RepositorioPagos(ejecutor);
  const repoUtm = new RepositorioUtm(ejecutor);
  const config = new RepositorioConfiguracion(ejecutor);

  if (opciones.utmDelMesActual !== undefined) {
    await repoUtm.guardarUtm(ANIO, MES, opciones.utmDelMesActual);
  }
  if (opciones.utmVieja !== undefined) {
    // Año anterior: nunca coincide con el mes en curso, corra cuando corra.
    await repoUtm.guardarUtm(ANIO - 1, 6, opciones.utmVieja);
  }

  const http = opciones.http ?? new HttpSinRed();
  const estado = new EstadoApp(pagos, new ServicioUtm(http, repoUtm), repoUtm, config);
  await estado.cargar();
  return { estado, repoUtm, http };
}

const banner = (c: HTMLElement) => c.querySelector('.utm-banner')!;
const valor = (c: HTMLElement) => c.querySelector('.utm-valor')!;
const fuente = (c: HTMLElement) => c.querySelector('.utm-source')!;
const boton = () => screen.getByRole('button', { name: 'Actualizar UTM' });

describe('BannerUtm — los tres estados visuales', () => {
  it('con la UTM del mes en curso: utm-ok y "verificada"', async () => {
    const { estado } = await montarEstado({ utmDelMesActual: 69_889 });
    const { container } = render(BannerUtm, { estado });

    expect(banner(container)).toHaveClass('utm-ok');
    expect(banner(container)).not.toHaveClass('utm-warn');
    expect(banner(container)).not.toHaveClass('utm-error');
    expect(fuente(container).textContent).toBe(`● UTM ${MES}/${ANIO} verificada`);
    expect(valor(container).textContent).toBe('$ 69.889');
    expect(valor(container)).not.toHaveClass('utm-nd');
  });

  it('con una UTM guardada de otro mes: utm-warn y el aviso', async () => {
    const { estado } = await montarEstado({ utmVieja: 65_000 });
    const { container } = render(BannerUtm, { estado });

    expect(banner(container)).toHaveClass('utm-warn');
    expect(banner(container)).not.toHaveClass('utm-ok');
    expect(fuente(container).textContent).toBe('● Usando UTM guardada (no es del mes actual)');
    expect(fuente(container)).toHaveClass('utm-source-warn');
    // El valor SÍ se muestra: es viejo, no inexistente.
    expect(valor(container).textContent).toBe('$ 65.000');
  });

  it('sin ninguna UTM guardada: utm-error y "No disponible"', async () => {
    const { estado } = await montarEstado();
    const { container } = render(BannerUtm, { estado });

    expect(banner(container)).toHaveClass('utm-error');
    expect(banner(container)).not.toHaveClass('utm-ok');
    expect(banner(container)).not.toHaveClass('utm-warn');
    expect(fuente(container).textContent).toBe('● UTM no disponible');
    expect(fuente(container)).toHaveClass('utm-source-error');
    expect(valor(container).textContent).toBe('No disponible');
    expect(valor(container)).toHaveClass('utm-nd');
  });

  it('rotula el mes y el año en curso', async () => {
    const { estado } = await montarEstado({ utmDelMesActual: 69_889 });
    const { container } = render(BannerUtm, { estado });
    expect(container.querySelector('.utm-label')!.textContent).toBe(`UTM ${MES}/${ANIO}`);
  });
});

describe('BannerUtm — el botón de refrescar', () => {
  it('consulta el servicio de UTM al pulsarlo', async () => {
    const user = userEvent.setup();
    const http = new HttpConValor(70_123);
    const { estado } = await montarEstado({ utmVieja: 65_000, http });
    render(BannerUtm, { estado });

    const antes = http.llamadas;
    await user.click(boton());
    await waitFor(() => expect(http.llamadas).toBeGreaterThan(antes));
  });

  it('un refresco exitoso actualiza el valor mostrado y la fuente', async () => {
    const user = userEvent.setup();
    const { estado } = await montarEstado({ utmVieja: 65_000, http: new HttpConValor(70_123) });
    const { container } = render(BannerUtm, { estado });

    expect(valor(container).textContent).toBe('$ 65.000');
    await user.click(boton());

    await waitFor(() => expect(valor(container).textContent).toBe('$ 70.123'));
    expect(banner(container)).toHaveClass('utm-ok');
    expect(banner(container)).not.toHaveClass('utm-warn');
    expect(fuente(container).textContent).toBe('● Fuente: mindicador.cl');
    expect(fuente(container)).not.toHaveClass('utm-source-warn');
  });

  it('un refresco exitoso guarda la UTM en la base, como /utm/refrescar', async () => {
    // routes/utm.py:41-42: solo persiste cuando el valor vino de
    // mindicador.cl. Sin esto el valor se vería en pantalla y se perdería al
    // cerrar la app.
    const user = userEvent.setup();
    const { estado, repoUtm } = await montarEstado({
      utmVieja: 65_000, http: new HttpConValor(70_123),
    });
    render(BannerUtm, { estado });

    await user.click(boton());
    await waitFor(async () => {
      expect(await repoUtm.obtenerUtmGuardada(ANIO, MES)).toMatchObject({ utmValor: 70_123 });
    });
  });

  it('un refresco fallido NO borra el valor que ya había', async () => {
    // Perder el dato por un fallo de red sería peor que no refrescar: el
    // escritorio tampoco toca `utmValor` en la rama de error
    // (static/app.js:120-128).
    const user = userEvent.setup();
    const { estado } = await montarEstado({ utmVieja: 65_000, http: new HttpSinRed() });
    const { container } = render(BannerUtm, { estado });

    await user.click(boton());

    await waitFor(() => expect(banner(container)).toHaveClass('utm-error'));
    expect(valor(container).textContent).toBe('$ 65.000');
    expect(valor(container)).not.toHaveClass('utm-nd');
    expect(fuente(container).textContent).toBe('● No se pudo obtener la UTM');
    expect(fuente(container)).toHaveClass('utm-source-error');
  });

  it('un refresco fallido tampoco pisa la UTM guardada en la base', async () => {
    const user = userEvent.setup();
    const { estado, repoUtm } = await montarEstado({
      utmVieja: 65_000, http: new HttpSinRed(),
    });
    render(BannerUtm, { estado });

    await user.click(boton());
    await waitFor(() => expect(screen.getByText('● No se pudo obtener la UTM')).toBeInTheDocument());
    expect(await repoUtm.obtenerUtmGuardada(ANIO, MES)).toBeNull();
  });

  it('avisa el valor nuevo a quien lo hospeda, para el campo del formulario', async () => {
    // static/app.js:113-115 también escribe el input `utm_valor` y recalcula
    // el preview: refrescar y que el formulario siguiera con el valor viejo
    // registraría el pago con una UTM distinta de la que se ve arriba.
    const user = userEvent.setup();
    const { estado } = await montarEstado({ utmVieja: 65_000, http: new HttpConValor(70_123) });
    const avisados: number[] = [];
    render(BannerUtm, { estado, alActualizarValor: (v: number) => avisados.push(v) });

    await user.click(boton());
    await waitFor(() => expect(avisados).toEqual([70_123]));
  });

  it('un refresco fallido no avisa ningún valor', async () => {
    const user = userEvent.setup();
    const { estado } = await montarEstado({ utmVieja: 65_000, http: new HttpSinRed() });
    const avisados: number[] = [];
    const { container } = render(BannerUtm, {
      estado, alActualizarValor: (v: number) => avisados.push(v),
    });

    await user.click(boton());
    await waitFor(() => expect(banner(container)).toHaveClass('utm-error'));
    expect(avisados).toEqual([]);
  });

  it('sin base de datos abierta el botón queda deshabilitado', async () => {
    render(BannerUtm, { estado: null });
    expect(boton()).toBeDisabled();
  });
});

describe('BannerUtm — el marcado que exige el CSS', () => {
  // jsdom mide 1024px de ancho y no aplica ninguna @media, así que ninguna
  // otra prueba nota si el marcado deja de encajar con el CSS del
  // escritorio. Estas comprueban las piezas de las que dependen reglas que
  // solo existen en pantallas de teléfono.

  it('el botón lleva la clase utm-refresh, que es la que le da 44px táctiles', async () => {
    // estilo.css:1382-1385, dentro de @media (max-width: 768px): sin esa
    // clase el botón se queda en 2rem (32px) en el teléfono, por debajo del
    // mínimo táctil.
    const { estado } = await montarEstado({ utmDelMesActual: 69_889 });
    render(BannerUtm, { estado });
    expect(boton()).toHaveClass('utm-refresh');
  });

  it('el icono del botón va en su propio span, que es lo que gira al cargar', async () => {
    // estilo.css:531-533 anima `.utm-refresh.loading .utm-refresh-icon`: sin
    // el span interior no hay nada que girar y el botón se ve congelado.
    const { estado } = await montarEstado({ utmDelMesActual: 69_889 });
    render(BannerUtm, { estado });
    expect(boton().querySelector('.utm-refresh-icon')).not.toBeNull();
  });

  it('etiqueta y valor van en .utm-banner-left; fuente y botón en .utm-banner-right', async () => {
    // `.utm-banner` es flex con space-between y `.utm-banner-right` es flex
    // con gap (estilo.css:428-438, 492-496). Sin las dos mitades, los cuatro
    // elementos se reparten sueltos y el banner se descuadra.
    const { estado } = await montarEstado({ utmDelMesActual: 69_889 });
    const { container } = render(BannerUtm, { estado });

    const izq = container.querySelector('.utm-banner-left')!;
    const der = container.querySelector('.utm-banner-right')!;
    expect(izq.querySelector('.utm-label')).not.toBeNull();
    expect(izq.querySelector('.utm-valor')).not.toBeNull();
    expect(der.querySelector('.utm-source')).not.toBeNull();
    expect(der.querySelector('.utm-refresh')).not.toBeNull();
  });
});
