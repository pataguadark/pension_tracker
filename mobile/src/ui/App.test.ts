// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';

import { EjecutorNode } from '../data/ejecutor-node';
import { inicializarBd } from '../data/esquema';
import {
  RepositorioConfiguracion, RepositorioPagos, RepositorioUtm,
} from '../data/repositorio';
import { ServicioUtm } from '../utm/servicio-utm';
import App from './App.svelte';
import { EstadoApp } from './estado.svelte';
import { mensajes } from './mensajes.svelte';

/** Cliente HTTP que falla: ninguna prueba puede depender de la red. */
class HttpSinRed {
  async obtenerJson(): Promise<unknown> {
    throw new Error('sin red');
  }
}

/** Base en memoria con un pago ya cargado, para probar el ✎ end-to-end. */
async function montarEstadoConUnPago() {
  const ejecutor = new EjecutorNode(':memory:');
  await inicializarBd(ejecutor);
  const repoPagos = new RepositorioPagos(ejecutor);
  const repoUtm = new RepositorioUtm(ejecutor);
  const config = new RepositorioConfiguracion(ejecutor);
  const id = await repoPagos.insertarPago({
    fecha: '2025-05-10',
    mesPago: 5,
    anioPago: 2025,
    utmValor: 60_000,
    cuotaPactada: 180_000,
    montoPagado: 200_000,
    desbalance: 20_000,
    utmFactor: 3,
  });
  const estado = new EstadoApp(
    repoPagos, new ServicioUtm(new HttpSinRed(), repoUtm), repoUtm, config,
  );
  await estado.cargar();
  return { estado, id };
}

describe('App', () => {
  beforeEach(() => mensajes.limpiar());

  it('muestra la marca del producto', () => {
    render(App);
    expect(screen.getByText('Pensión')).toBeInTheDocument();
    expect(screen.getByText('TRACKER')).toBeInTheDocument();
  });

  it('arranca en el historial', () => {
    render(App);
    expect(screen.getByRole('link', { name: 'Historial' })).toHaveClass('active');
  });

  it('cambia de vista al pulsar la navegación', async () => {
    const user = userEvent.setup();
    render(App);
    await user.click(screen.getByRole('link', { name: 'Registrar Pago' }));
    expect(screen.getByRole('link', { name: 'Registrar Pago' })).toHaveClass('active');
    expect(screen.getByRole('link', { name: 'Historial' })).not.toHaveClass('active');
  });

  it('muestra los mensajes encolados', async () => {
    render(App);
    mensajes.agregar('Pago registrado', 'exito');
    expect(await screen.findByText('Pago registrado')).toBeInTheDocument();
  });

  it('deja descartar un mensaje', async () => {
    const user = userEvent.setup();
    render(App);
    mensajes.agregar('Algo salió mal', 'error');
    await user.click(await screen.findByRole('button', { name: /descartar/i }));
    expect(screen.queryByText('Algo salió mal')).not.toBeInTheDocument();
  });

  it('conserva los enlaces de donación del escritorio', () => {
    render(App);
    const mp = screen.getByRole('link', { name: /MercadoPago/i });
    expect(mp).toHaveAttribute('href', 'https://link.mercadopago.cl/pension_tracker');
    const pp = screen.getByRole('link', { name: /PayPal/i });
    expect(pp).toHaveAttribute(
      'href',
      'https://www.paypal.com/donate/?hosted_button_id=2PFWY58A55FQE',
    );
  });

  it('la vista de historial es la pantalla de historial, no un marcador', async () => {
    // Antes acá había un `<p>Historial</p>`. Si volviera, la app arrancaría
    // mostrando una palabra suelta en vez del historial y nada más en la
    // suite lo notaría: Historial.test.ts monta el componente directamente.
    const { container } = render(App);
    expect(container.querySelector('.page-historial')).toBeInTheDocument();
    expect(screen.getByText('Sin pagos registrados')).toBeInTheDocument();
  });

  it('desde el historial vacío se llega a registrar un pago', async () => {
    const user = userEvent.setup();
    render(App);
    await user.click(screen.getByRole('link', { name: '+ Registrar primer pago' }));
    expect(screen.getByRole('link', { name: 'Registrar Pago' })).toHaveClass('active');
  });

  it('la vista de registro es la pantalla de registro, no un marcador', async () => {
    // Antes acá había un `<p>Registrar Pago</p>`. Mismo riesgo que el
    // marcador del historial: si volviera, el enlace del menú seguiría
    // marcándose activo y la prueba de navegación no se enteraría.
    const user = userEvent.setup();
    const { container } = render(App);
    await user.click(screen.getByRole('link', { name: 'Registrar Pago' }));
    expect(container.querySelector('.page-registro')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Registrar Pago →' })).toBeInTheDocument();
    expect(screen.getByLabelText('Mes del pago')).toBeInTheDocument();
  });

  it('sin base de datos abierta, registrar avisa en vez de fingir que guardó', async () => {
    // main.ts todavía monta App sin EstadoApp. Si el formulario se enviara
    // en silencio, el usuario creería que su pago quedó guardado.
    const user = userEvent.setup();
    const { container } = render(App);
    await user.click(screen.getByRole('link', { name: 'Registrar Pago' }));
    await user.type(screen.getByLabelText(/Factor UTM pactado/), '3');
    await user.type(screen.getByLabelText(/^Valor UTM/), '60000');
    await user.type(screen.getByLabelText(/Monto efectivamente pagado/), '200000');
    await fireEvent.submit(container.querySelector('form')!);

    expect(mensajes.lista.map((m) => m.texto)).toContain(
      'Error al procesar el pago: la base de datos no está abierta.',
    );
    expect(screen.getByRole('link', { name: 'Registrar Pago' })).toHaveClass('active');
  });

  it('la navegación no recarga la página al elegir una vista', async () => {
    // jsdom no navega de verdad; lo que sí podemos comprobar es que el clic
    // llegó con preventDefault() aplicado. fireEvent devuelve el resultado de
    // dispatchEvent, que es false cuando el evento (cancelable, como 'click')
    // fue cancelado.
    render(App);
    const enlace = screen.getByRole('link', { name: 'Registrar Pago' });
    const noCancelado = fireEvent.click(enlace);
    expect(await noCancelado).toBe(false);
  });
});

describe('App — el ✎ del historial abre la edición de ESE pago', () => {
  // App.test.ts renderiza `App` sin `estado` en el resto de la suite, así
  // que el historial nunca tiene filas ni un ✎ que pulsar: la única otra
  // cobertura del ✎ es el callback `alEditar` de Historial.test.ts, que
  // nunca llega hasta App. Sin esta prueba, `editar()` podría mutar
  // `vista` a cualquier valor (incluso quedarse en 'historial') y las 514
  // pruebas seguirían en verde.
  beforeEach(() => mensajes.limpiar());

  it('pulsar ✎ en una fila real lleva a Edicion con el id de esa fila', async () => {
    const user = userEvent.setup();
    const { estado, id } = await montarEstadoConUnPago();
    const { container } = render(App, { estado });

    const enlace = await screen.findByRole('link', { name: `Editar pago #${id}` });
    await user.click(enlace);

    expect(screen.getByRole('link', { name: 'Historial' })).not.toHaveClass('active');
    expect(container.querySelector('.page-title')?.textContent).toContain('Editar Pago');
    expect(container.querySelector('.page-title-anio')?.textContent?.trim()).toBe(`#${id}`);
  });
});

describe('Encabezado — menú móvil', () => {
  beforeEach(() => mensajes.limpiar());

  // jsdom no aplica media queries: no podemos comprobar que la navegación se
  // vea u oculte en un teléfono. En su lugar probamos el mecanismo del que
  // depende esa visibilidad (la clase "open" en .main-nav y el botón que la
  // controla), que es lo que el CSS ya sabe interpretar.

  it('el botón para abrir el menú existe y es accesible por su etiqueta', () => {
    render(App);
    expect(screen.getByRole('button', { name: 'Abrir menú' })).toBeInTheDocument();
  });

  it('el menú empieza cerrado', () => {
    render(App);
    expect(screen.getByRole('navigation')).not.toHaveClass('open');
  });

  it('al pulsar el botón, el menú se abre y aria-expanded pasa a "true"', async () => {
    const user = userEvent.setup();
    render(App);
    const boton = screen.getByRole('button', { name: 'Abrir menú' });
    await user.click(boton);
    expect(screen.getByRole('navigation')).toHaveClass('open');
    expect(boton).toHaveAttribute('aria-expanded', 'true');
  });

  it('al pulsarlo de nuevo, el menú se cierra y aria-expanded vuelve a "false"', async () => {
    const user = userEvent.setup();
    render(App);
    const boton = screen.getByRole('button', { name: 'Abrir menú' });
    await user.click(boton);
    await user.click(boton);
    expect(screen.getByRole('navigation')).not.toHaveClass('open');
    expect(boton).toHaveAttribute('aria-expanded', 'false');
  });

  it('al elegir una vista con el menú abierto, el menú se cierra', async () => {
    const user = userEvent.setup();
    render(App);
    await user.click(screen.getByRole('button', { name: 'Abrir menú' }));
    expect(screen.getByRole('navigation')).toHaveClass('open');
    await user.click(screen.getByRole('link', { name: 'Registrar Pago' }));
    expect(screen.getByRole('navigation')).not.toHaveClass('open');
  });
});

describe('App — un fallo de carga no puede parecerse a "no hay datos"', () => {
  // El peor mensaje posible en una app de pensión de alimentos es "Sin pagos
  // registrados" cuando en realidad los pagos están y no se pudieron leer:
  // parece que se perdieron. Hasta esta etapa `estado.error` no se pintaba
  // en ninguna parte, así que un fallo de `cargar()` caía exactamente ahí.
  beforeEach(() => mensajes.limpiar());

  /**
   * EstadoApp cuya carga revienta al leer los pagos. Bajar `control.falla`
   * simula que el problema era transitorio, para probar el reintento.
   */
  async function estadoQueFallaAlCargar() {
    const ejecutor = new EjecutorNode(':memory:');
    await inicializarBd(ejecutor);
    const repoPagos = new RepositorioPagos(ejecutor);
    const repoUtm = new RepositorioUtm(ejecutor);
    const config = new RepositorioConfiguracion(ejecutor);
    const real = repoPagos.obtenerTodosLosPagos.bind(repoPagos);
    const control = { falla: true };
    repoPagos.obtenerTodosLosPagos = async () => {
      if (control.falla) throw new Error('no se pudo abrir la base');
      return real();
    };
    const estado = new EstadoApp(
      repoPagos, new ServicioUtm(new HttpSinRed(), repoUtm), repoUtm, config,
    );
    await estado.cargar();
    return { estado, control };
  }

  it('con estado.error, App lo muestra explícitamente', async () => {
    const { estado } = await estadoQueFallaAlCargar();
    expect(estado.error).not.toBeNull();
    render(App, { estado });

    expect(screen.getByRole('alert')).toHaveTextContent('no se pudo abrir la base');
  });

  it('con estado.error, App NO muestra "Sin pagos registrados"', async () => {
    const { estado } = await estadoQueFallaAlCargar();
    render(App, { estado });

    expect(screen.queryByText('Sin pagos registrados')).not.toBeInTheDocument();
  });

  it('el aviso deja claro que los datos no se perdieron', async () => {
    const { estado } = await estadoQueFallaAlCargar();
    const { container } = render(App, { estado });

    expect(container.textContent).toMatch(/no.*(perdido|perdieron)/i);
  });

  it('ofrece reintentar, y si la carga se recupera vuelve el historial', async () => {
    const user = userEvent.setup();
    const { estado, control } = await estadoQueFallaAlCargar();
    render(App, { estado });

    // La base sigue viva: el fallo era transitorio.
    control.falla = false;
    await user.click(screen.getByRole('button', { name: 'Reintentar' }));

    expect(await screen.findByText('Sin pagos registrados')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('sin error, el historial se ve como siempre', async () => {
    // Guarda contra el fallo simétrico: pintar el aviso de error cuando no
    // hay ninguno dejaría la app inutilizable para todo el mundo.
    render(App);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText('Sin pagos registrados')).toBeInTheDocument();
  });

  it('si la base no se pudo ni abrir, App lo dice en vez de quedarse en blanco', async () => {
    // Camino distinto de `estado.error`: acá no hay EstadoApp que construir
    // porque `abrirBaseDeDatos` falló. Sin esto main.ts solo podría montar
    // App sin estado, que es indistinguible de "no hay pagos".
    render(App, { errorArranque: 'no se pudo abrir la base de datos' });

    expect(screen.getByRole('alert')).toHaveTextContent('no se pudo abrir la base de datos');
    expect(screen.queryByText('Sin pagos registrados')).not.toBeInTheDocument();
  });
});
