// @vitest-environment jsdom
/**
 * Pruebas del formulario de pago compartido por registro y edición.
 *
 * El formateo, el preview y la validación NO se reprueban acá en detalle:
 * eso ya está cubierto por formulario.test.ts contra ./formulario.ts. Lo que
 * se prueba es que el componente conecta esa lógica al DOM: que los seis
 * campos existen con los atributos correctos, que escriben en `campos` con
 * el formato correcto, que el preview se refresca solo, y que el envío
 * respeta la validación.
 *
 * Los errores de validación se prueban contra la cola de `mensajes`
 * (mensajes.svelte.ts), no contra un `.form-error` propio: el escritorio no
 * tiene marcado de error por campo, solo el flash de sesión, y ese mismo
 * mecanismo ya está portado ahí (ver mensajes.test.ts).
 */
import { fireEvent, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import {
  beforeEach, describe, expect, it,
} from 'vitest';

import type { CamposFormulario, ValoresFormulario } from './formulario';
import FormularioPago from './FormularioPago.svelte';
import { mensajes } from './mensajes.svelte';

/** Campos vacíos, como arranca un registro sin precarga. */
function camposVacios(): CamposFormulario {
  return {
    factor: '', utmValor: '', montoPagado: '', mesPago: '1', anioPago: '2025', fecha: '',
  };
}

/** Campos con datos válidos: factor 3, UTM 60.000, pagado 200.000 -> EXCEDENTE de 20.000. */
function camposValidos(): CamposFormulario {
  return {
    factor: '3', utmValor: '60.000', montoPagado: '200.000', mesPago: '5', anioPago: '2025', fecha: '2025-05-10',
  };
}

function form(container: HTMLElement): HTMLFormElement {
  return container.querySelector('form')!;
}

function campo(nombre: RegExp): HTMLInputElement {
  return screen.getByLabelText(nombre) as HTMLInputElement;
}

function valoresPreview(container: HTMLElement): (string | null)[] {
  return [...container.querySelectorAll('.preview-value')].map((e) => e.textContent);
}

beforeEach(() => mensajes.limpiar());

describe('FormularioPago — los seis campos', () => {
  it('existen y son accesibles por su etiqueta', () => {
    render(FormularioPago, { campos: camposVacios(), alEnviar: () => {} });
    expect(campo(/Factor UTM pactado/)).toBeInTheDocument();
    expect(campo(/^Valor UTM/)).toBeInTheDocument();
    expect(screen.getByLabelText('Mes del pago')).toBeInTheDocument();
    expect(screen.getByLabelText('Año del pago')).toBeInTheDocument();
    expect(campo(/Monto efectivamente pagado/)).toBeInTheDocument();
    expect(screen.getByLabelText('Fecha de registro')).toBeInTheDocument();
  });

  it('el factor pide teclado decimal y los montos piden teclado numérico', () => {
    render(FormularioPago, { campos: camposVacios(), alEnviar: () => {} });
    expect(campo(/Factor UTM pactado/)).toHaveAttribute('inputmode', 'decimal');
    expect(campo(/^Valor UTM/)).toHaveAttribute('inputmode', 'numeric');
    expect(campo(/Monto efectivamente pagado/)).toHaveAttribute('inputmode', 'numeric');
  });

  it('el selector de mes trae los doce meses, con Enero en el 1 y Diciembre en el 12', () => {
    render(FormularioPago, { campos: camposVacios(), alEnviar: () => {} });
    const select = screen.getByLabelText('Mes del pago') as HTMLSelectElement;
    const opciones = [...select.options];
    expect(opciones).toHaveLength(12);
    expect(opciones[0]!.value).toBe('1');
    expect(opciones[0]!.textContent?.trim()).toBe('Enero');
    expect(opciones[11]!.value).toBe('12');
    expect(opciones[11]!.textContent?.trim()).toBe('Diciembre');
  });
});

describe('FormularioPago — formateo mientras se teclea', () => {
  it('al teclear en el monto, el valor se formatea con puntos de miles', async () => {
    render(FormularioPago, { campos: camposVacios(), alEnviar: () => {} });
    const input = campo(/Monto efectivamente pagado/);
    await fireEvent.input(input, { target: { value: '200000' } });
    expect(input.value).toBe('200.000');
  });

  it('al teclear un punto en el factor, aparece una coma', async () => {
    render(FormularioPago, { campos: camposVacios(), alEnviar: () => {} });
    const input = campo(/Factor UTM pactado/);
    await fireEvent.input(input, { target: { value: '3.05' } });
    expect(input.value).toBe('3,05');
  });
});

describe('FormularioPago — preview en vivo', () => {
  it('con factor 3, UTM 60.000 y pagado 200.000 muestra la cuota, la diferencia y EXCEDENTE', async () => {
    const { container } = render(FormularioPago, { campos: camposVacios(), alEnviar: () => {} });
    await fireEvent.input(campo(/Factor UTM pactado/), { target: { value: '3' } });
    await fireEvent.input(campo(/^Valor UTM/), { target: { value: '60000' } });
    await fireEvent.input(campo(/Monto efectivamente pagado/), { target: { value: '200000' } });
    await tick();

    expect(valoresPreview(container)).toEqual(['$180.000', '$200.000', '+$20.000']);
    expect(container.querySelector('.preview-estado')?.textContent).toContain('EXCEDENTE');
  });

  it('el preview vuelve a guiones si el factor se borra', async () => {
    const { container } = render(FormularioPago, { campos: camposValidos(), alEnviar: () => {} });
    await tick();
    expect(valoresPreview(container)).toEqual(['$180.000', '$200.000', '+$20.000']);

    await fireEvent.input(campo(/Factor UTM pactado/), { target: { value: '' } });
    await tick();

    expect(valoresPreview(container)).toEqual(['—', '—', '—']);
  });
});

describe('FormularioPago — envío', () => {
  it('con datos válidos, alEnviar recibe los valores ya parseados (números, no texto)', async () => {
    let recibido: ValoresFormulario | null = null;
    const { container } = render(FormularioPago, {
      campos: camposValidos(),
      alEnviar: (v: ValoresFormulario) => { recibido = v; },
    });

    await fireEvent.submit(form(container));

    expect(recibido).toEqual({
      utmFactor: 3, utmValor: 60_000, montoPagado: 200_000, mesPago: 5, anioPago: 2025, fecha: '2025-05-10',
    });
  });

  it('con datos inválidos, alEnviar NO se llama y los errores quedan visibles', async () => {
    let llamado = 0;
    const { container } = render(FormularioPago, {
      campos: camposVacios(),
      alEnviar: () => { llamado += 1; },
    });

    await fireEvent.submit(form(container));

    expect(llamado).toBe(0);
    expect(mensajes.lista.map((m) => m.texto)).toContain(
      'El factor UTM debe ser un número positivo (ej: 3,0561).',
    );
    expect(mensajes.lista.map((m) => m.texto)).toContain(
      'El valor UTM debe ser un número entero positivo (ej: 69.889).',
    );
  });
});
