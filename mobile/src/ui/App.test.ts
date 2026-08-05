// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';

import App from './App.svelte';
import { mensajes } from './mensajes.svelte';

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
