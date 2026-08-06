// @vitest-environment jsdom
/**
 * Pruebas de la pantalla de edición.
 *
 * Mismo criterio que Registro.test.ts e Historial.test.ts: EstadoApp real
 * sobre SQLite en memoria, nada de dobles.
 *
 * Lo propio de esta pantalla es la precarga con el factor derivado
 * (routes/pagos.py:226-247), el recálculo al guardar
 * (routes/pagos.py:250-297) y el botón de cancelar, que en el escritorio va
 * dentro de `.edit-actions` junto al de enviar (editar_pago.html:130-137).
 */
import { fireEvent, render, screen } from '@testing-library/svelte';
import { beforeEach, describe, expect, it } from 'vitest';

import type { Pago } from '../core/tipos';
import { EjecutorNode } from '../data/ejecutor-node';
import { inicializarBd } from '../data/esquema';
import {
  RepositorioConfiguracion, RepositorioPagos, RepositorioUtm,
} from '../data/repositorio';
import { ServicioUtm } from '../utm/servicio-utm';
import Edicion from './Edicion.svelte';
import { EstadoApp } from './estado.svelte';
import { mensajes } from './mensajes.svelte';

/** Cliente HTTP que falla: ninguna prueba puede depender de la red. */
class HttpSinRed {
  async obtenerJson(): Promise<unknown> {
    throw new Error('sin red');
  }
}

/** Un pago editable con valores razonables; cada caso sobrescribe lo suyo. */
function pagoDe(extra: Partial<Omit<Pago, 'id'>> = {}): Omit<Pago, 'id'> {
  return {
    fecha: '2025-05-10',
    mesPago: 5,
    anioPago: 2025,
    utmValor: 60_000,
    cuotaPactada: 180_000,
    montoPagado: 200_000,
    desbalance: 20_000,
    utmFactor: 3,
    ...extra,
  };
}

async function montarEstado(pago: Omit<Pago, 'id'> | null = pagoDe()) {
  const ejecutor = new EjecutorNode(':memory:');
  await inicializarBd(ejecutor);
  const repoPagos = new RepositorioPagos(ejecutor);
  const repoUtm = new RepositorioUtm(ejecutor);
  const config = new RepositorioConfiguracion(ejecutor);
  const id = pago === null ? 0 : await repoPagos.insertarPago(pago);
  const estado = new EstadoApp(
    repoPagos, new ServicioUtm(new HttpSinRed(), repoUtm), repoUtm, config,
  );
  await estado.cargar();
  return {
    estado, id, repoPagos, repoUtm,
  };
}

const campo = (nombre: RegExp | string) => screen.getByLabelText(nombre) as HTMLInputElement;
/** Deja correr las promesas pendientes contra SQLite antes de aseverar. */
const dejarCorrer = () => new Promise((r) => { setTimeout(r, 0); });
const textos = () => mensajes.lista.map((m) => m.texto);

beforeEach(() => mensajes.limpiar());

describe('Edición — encabezado y textos', () => {
  it('el título lleva el número del pago, como editar_pago.html', async () => {
    const { estado, id } = await montarEstado();
    const { container } = render(Edicion, { estado, pagoId: id, alVolver: () => {} });
    await dejarCorrer();
    expect(container.querySelector('.page-title')?.textContent).toContain('Editar Pago');
    expect(container.querySelector('.page-title-anio')?.textContent?.trim()).toBe(`#${id}`);
    expect(screen.getByText(
      'Modifica los datos del registro. El desbalance se recalcula automáticamente.',
    )).toBeInTheDocument();
  });

  it('usa los textos de edición, no los de registro', async () => {
    // editar_pago.html: "Guardado en el registro" / "En pesos chilenos" /
    // "Lo que se transfirió" / "Guardar cambios →".
    const { estado, id } = await montarEstado();
    render(Edicion, { estado, pagoId: id, alVolver: () => {} });
    await dejarCorrer();
    expect(screen.getByText('Guardado en el registro')).toBeInTheDocument();
    expect(screen.getByText('En pesos chilenos')).toBeInTheDocument();
    expect(screen.getByText('Lo que se transfirió')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Guardar cambios →' })).toBeInTheDocument();
  });
});

describe('Edición — precarga', () => {
  it('precarga los seis campos con los datos del pago', async () => {
    const { estado, id } = await montarEstado();
    render(Edicion, { estado, pagoId: id, alVolver: () => {} });
    await dejarCorrer();
    expect(campo(/Factor UTM pactado/).value).toBe('3');
    expect(campo(/^Valor UTM/).value).toBe('60.000');
    expect((screen.getByLabelText('Mes del pago') as HTMLSelectElement).value).toBe('5');
    expect(campo('Año del pago').value).toBe('2025');
    expect(campo(/Monto efectivamente pagado/).value).toBe('200.000');
    expect(campo('Fecha de registro').value).toBe('2025-05-10');
  });

  it('sin factor guardado lo deriva como cuota / UTM redondeado a 4', async () => {
    // routes/pagos.py:236-238. Con otra fórmula (por ejemplo la inversa) el
    // campo mostraría un número completamente distinto.
    const { estado, id } = await montarEstado(pagoDe({
      utmFactor: null, cuotaPactada: 187_000, utmValor: 60_000,
    }));
    render(Edicion, { estado, pagoId: id, alVolver: () => {} });
    await dejarCorrer();
    // 187.000 / 60.000 = 3,116666... -> 3,1167
    expect(campo(/Factor UTM pactado/).value).toBe('3,1167');
  });

  it('sin factor y sin UTM utilizable deja el campo vacío', async () => {
    // La rama `else: utm_factor_calculado = None` de editar_pago. Dividir por
    // cero daría Infinity y el campo mostraría basura.
    const { estado, id } = await montarEstado(pagoDe({ utmFactor: null, utmValor: 0 }));
    render(Edicion, { estado, pagoId: id, alVolver: () => {} });
    await dejarCorrer();
    expect(campo(/Factor UTM pactado/).value).toBe('');
  });
});

describe('Edición — botones', () => {
  it('cancelar y enviar van dentro de .edit-actions, cancelar primero', async () => {
    // Bajo 768px el CSS pone `.edit-actions { flex-direction: column-reverse }`,
    // así que el orden del DOM decide cuál queda arriba en el teléfono:
    // primero cancelar en el marcado = enviar arriba en pantalla, igual que
    // el escritorio. jsdom no aplica media queries y solo puede vigilar el
    // marcado del que esa regla depende.
    const { estado, id } = await montarEstado();
    const { container } = render(Edicion, { estado, pagoId: id, alVolver: () => {} });
    await dejarCorrer();

    const acciones = container.querySelector('.edit-actions');
    expect(acciones).not.toBeNull();
    const hijos = [...acciones!.children];
    expect(hijos.map((e) => e.tagName)).toEqual(['A', 'BUTTON']);
    expect(hijos[0]).toHaveClass('btn-cancelar');
    expect(hijos[1]).toHaveClass('btn-submit', 'btn-submit-edit');
  });

  it('cancelar vuelve al historial sin escribir nada', async () => {
    let vuelto = 0;
    const { estado, id, repoPagos } = await montarEstado();
    render(Edicion, { estado, pagoId: id, alVolver: () => { vuelto += 1; } });
    await dejarCorrer();

    const enlace = screen.getByRole('link', { name: /Cancelar/ });
    // Cancelable y cancelado: sin preventDefault el WebView navegaría.
    expect(await fireEvent.click(enlace)).toBe(false);
    await dejarCorrer();

    expect(vuelto).toBe(1);
    expect((await repoPagos.obtenerPagoPorId(id))?.montoPagado).toBe(200_000);
    expect(textos()).toEqual([]);
  });
});

describe('Edición — guardar', () => {
  it('recalcula y actualiza el pago en la base', async () => {
    const { estado, id, repoPagos } = await montarEstado();
    const { container } = render(Edicion, { estado, pagoId: id, alVolver: () => {} });
    await dejarCorrer();

    await fireEvent.input(campo(/Factor UTM pactado/), { target: { value: '4' } });
    await fireEvent.input(campo(/^Valor UTM/), { target: { value: '70000' } });
    await fireEvent.input(campo(/Monto efectivamente pagado/), { target: { value: '250000' } });
    await fireEvent.submit(container.querySelector('form')!);
    await dejarCorrer();

    const guardado = await repoPagos.obtenerPagoPorId(id);
    expect(guardado?.cuotaPactada).toBe(280_000);
    expect(guardado?.montoPagado).toBe(250_000);
    expect(guardado?.desbalance).toBe(-30_000);
    expect(guardado?.utmFactor).toBe(4);
    expect(guardado?.utmValor).toBe(70_000);
  });

  it('vuelve al historial con el mensaje de éxito del escritorio', async () => {
    let vuelto = 0;
    const { estado, id } = await montarEstado();
    const { container } = render(Edicion, {
      estado, pagoId: id, alVolver: () => { vuelto += 1; },
    });
    await dejarCorrer();

    await fireEvent.submit(container.querySelector('form')!);
    await dejarCorrer();

    expect(vuelto).toBe(1);
    expect(textos()).toContain(`✅ Pago #${id} actualizado correctamente.`);
  });

  it('guarda la UTM del período editado, como editar_pago_post', async () => {
    const { estado, id, repoUtm } = await montarEstado();
    const { container } = render(Edicion, { estado, pagoId: id, alVolver: () => {} });
    await dejarCorrer();

    await fireEvent.input(campo(/^Valor UTM/), { target: { value: '70000' } });
    await fireEvent.submit(container.querySelector('form')!);
    await dejarCorrer();

    expect((await repoUtm.obtenerUtmGuardada(2025, 5))?.utmValor).toBe(70_000);
  });

  it('con la fecha borrada conserva la del pago, no pone la de hoy', async () => {
    // `fecha = request.form.get("fecha") or pago["fecha"]` en editar_pago_post.
    // Registro cae a hoy; edición NO: caer a hoy reescribiría en silencio la
    // fecha de registro de un pago antiguo.
    const { estado, id, repoPagos } = await montarEstado();
    const { container } = render(Edicion, { estado, pagoId: id, alVolver: () => {} });
    await dejarCorrer();

    await fireEvent.input(campo('Fecha de registro'), { target: { value: '' } });
    await fireEvent.submit(container.querySelector('form')!);
    await dejarCorrer();

    expect((await repoPagos.obtenerPagoPorId(id))?.fecha).toBe('2025-05-10');
  });

  it('con datos inválidos no toca la base ni vuelve al historial', async () => {
    let vuelto = 0;
    const { estado, id, repoPagos } = await montarEstado();
    const { container } = render(Edicion, {
      estado, pagoId: id, alVolver: () => { vuelto += 1; },
    });
    await dejarCorrer();

    await fireEvent.input(campo(/Factor UTM pactado/), { target: { value: '' } });
    await fireEvent.submit(container.querySelector('form')!);
    await dejarCorrer();

    expect(vuelto).toBe(0);
    expect((await repoPagos.obtenerPagoPorId(id))?.utmFactor).toBe(3);
    expect(textos()).toContain('El factor UTM debe ser un número positivo (ej: 3,0561).');
  });
});

describe('Edición — pago inexistente', () => {
  it('avisa con el texto del escritorio y vuelve al historial sin formulario', async () => {
    let vuelto = 0;
    const { estado } = await montarEstado();
    const { container } = render(Edicion, {
      estado, pagoId: 999, alVolver: () => { vuelto += 1; },
    });
    await dejarCorrer();

    expect(vuelto).toBe(1);
    expect(textos()).toEqual(['No se encontró el pago #999.']);
    expect(container.querySelector('form')).toBeNull();
  });
});
