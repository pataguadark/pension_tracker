// @vitest-environment jsdom
/**
 * Pruebas de la pantalla de registro.
 *
 * Mismo criterio que Historial.test.ts: el estado que recibe el componente
 * es el REAL (EstadoApp sobre una base SQLite en memoria), no un doble. Lo
 * que se quiere detectar es una divergencia entre lo que el teléfono
 * escribe y lo que el escritorio escribiría en la MISMA base, y un doble a
 * medida podría estar de acuerdo con el componente y equivocado respecto de
 * la base.
 *
 * Los seis campos, el formateo al teclear y el preview NO se reprueban acá:
 * son de FormularioPago y ya están cubiertos en FormularioPago.test.ts. Acá
 * se prueba lo propio de la pantalla: la precarga (routes/pagos.py:96-133)
 * y el guardado con su mensaje y su vuelta al historial
 * (routes/pagos.py:136-164).
 */
import { fireEvent, render, screen } from '@testing-library/svelte';
import { beforeEach, describe, expect, it } from 'vitest';

import { EjecutorNode } from '../data/ejecutor-node';
import { inicializarBd } from '../data/esquema';
import {
  RepositorioConfiguracion, RepositorioPagos, RepositorioUtm,
} from '../data/repositorio';
import { ServicioUtm } from '../utm/servicio-utm';
import { CLAVE_FACTOR_UTM_PREDETERMINADO, EstadoApp } from './estado.svelte';
import { mensajes } from './mensajes.svelte';
import Registro from './Registro.svelte';

/** Cliente HTTP que falla: ninguna prueba puede depender de la red. */
class HttpSinRed {
  async obtenerJson(): Promise<unknown> {
    throw new Error('sin red');
  }
}

interface OpcionesMontaje {
  /** Se guarda en `configuracion` como factor predeterminado. */
  factorPredeterminado?: string;
  /** Se guarda en `utm_historial`, que es de donde sale la UTM de referencia. */
  utmGuardada?: number;
  /** Factor del último pago, para el caso sin predeterminado. */
  factorUltimoPago?: number;
}

async function montarEstado(opciones: OpcionesMontaje = {}) {
  const ejecutor = new EjecutorNode(':memory:');
  await inicializarBd(ejecutor);
  const repoPagos = new RepositorioPagos(ejecutor);
  const repoUtm = new RepositorioUtm(ejecutor);
  const config = new RepositorioConfiguracion(ejecutor);

  if (opciones.utmGuardada !== undefined) {
    await repoUtm.guardarUtm(2025, 6, opciones.utmGuardada);
  }
  if (opciones.factorPredeterminado !== undefined) {
    await config.guardarConfiguracion(
      CLAVE_FACTOR_UTM_PREDETERMINADO, opciones.factorPredeterminado,
    );
  }
  if (opciones.factorUltimoPago !== undefined) {
    await repoPagos.insertarPago({
      fecha: '2025-06-05',
      mesPago: 6,
      anioPago: 2025,
      utmValor: 60_000,
      cuotaPactada: 180_000,
      montoPagado: 180_000,
      desbalance: 0,
      utmFactor: opciones.factorUltimoPago,
    });
  }

  const estado = new EstadoApp(
    repoPagos, new ServicioUtm(new HttpSinRed(), repoUtm), repoUtm, config,
  );
  await estado.cargar();
  return { estado, repoPagos, repoUtm };
}

const campo = (nombre: RegExp | string) => screen.getByLabelText(nombre) as HTMLInputElement;
/**
 * Deja correr las promesas pendientes. El envío del formulario dispara una
 * cadena de `await` contra SQLite; sin esto las aserciones corren antes de
 * que la escritura haya terminado y la prueba pasa (o falla) por azar.
 */
const dejarCorrer = () => new Promise((r) => { setTimeout(r, 0); });
const textos = () => mensajes.lista.map((m) => m.texto);

beforeEach(() => mensajes.limpiar());

describe('Registro — encabezado', () => {
  it('lleva el mismo título y subtítulo que registro_pago.html', async () => {
    const { estado } = await montarEstado();
    const { container } = render(Registro, { estado, alVolver: () => {} });
    expect(container.querySelector('.page-title')?.textContent?.trim())
      .toBe('Registrar Pago');
    expect(screen.getByText('Ingresa los datos del pago mensual de pensión.'))
      .toBeInTheDocument();
  });

  it('usa los textos de registro, no los de edición', async () => {
    // registro_pago.html: "Cuántas UTMs equivale la pensión" / "Pre-cargado
    // desde la BD" / "Lo que se transfirió este mes" / "Registrar Pago →".
    const { estado } = await montarEstado();
    render(Registro, { estado, alVolver: () => {} });
    expect(screen.getByText('Cuántas UTMs equivale la pensión')).toBeInTheDocument();
    expect(screen.getByText('Pre-cargado desde la BD')).toBeInTheDocument();
    expect(screen.getByText('Lo que se transfirió este mes')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Registrar Pago →' })).toBeInTheDocument();
  });
});

describe('Registro — precarga', () => {
  it('precarga el factor predeterminado y la UTM de referencia', async () => {
    const { estado } = await montarEstado({
      factorPredeterminado: '3,0561', utmGuardada: 69_889,
    });
    render(Registro, { estado, alVolver: () => {} });
    expect(campo(/Factor UTM pactado/).value).toBe('3,0561');
    expect(campo(/^Valor UTM/).value).toBe('69.889');
  });

  it('sin predeterminado precarga el factor del último pago', async () => {
    const { estado } = await montarEstado({ factorUltimoPago: 4.25, utmGuardada: 60_000 });
    render(Registro, { estado, alVolver: () => {} });
    expect(campo(/Factor UTM pactado/).value).toBe('4,25');
  });

  it('sin nada guardado deja el factor y la UTM vacíos, no en cero', async () => {
    // Un "0" precargado se vería como un dato real y además haría fallar la
    // validación con un mensaje confuso.
    const { estado } = await montarEstado();
    render(Registro, { estado, alVolver: () => {} });
    expect(campo(/Factor UTM pactado/).value).toBe('');
    expect(campo(/^Valor UTM/).value).toBe('');
  });

  it('arranca en el mes y el año de hoy, y la fecha de registro es hoy', async () => {
    const hoy = new Date();
    const { estado } = await montarEstado();
    render(Registro, { estado, alVolver: () => {} });
    expect((screen.getByLabelText('Mes del pago') as HTMLSelectElement).value)
      .toBe(String(hoy.getMonth() + 1));
    expect(campo('Año del pago').value).toBe(String(hoy.getFullYear()));
    const dosDigitos = (n: number) => String(n).padStart(2, '0');
    expect(campo('Fecha de registro').value).toBe(
      `${hoy.getFullYear()}-${dosDigitos(hoy.getMonth() + 1)}-${dosDigitos(hoy.getDate())}`,
    );
  });
});

describe('Registro — guardar', () => {
  it('con datos válidos guarda el pago en la base', async () => {
    const { estado, repoPagos } = await montarEstado({ utmGuardada: 60_000 });
    const { container } = render(Registro, { estado, alVolver: () => {} });

    await fireEvent.input(campo(/Factor UTM pactado/), { target: { value: '3' } });
    await fireEvent.input(campo(/Monto efectivamente pagado/), { target: { value: '200000' } });
    await fireEvent.submit(container.querySelector('form')!);
    await dejarCorrer();

    const guardados = await repoPagos.obtenerTodosLosPagos();
    expect(guardados).toHaveLength(1);
    expect(guardados[0]!.cuotaPactada).toBe(180_000);
    expect(guardados[0]!.montoPagado).toBe(200_000);
    expect(guardados[0]!.desbalance).toBe(20_000);
    expect(guardados[0]!.utmFactor).toBe(3);
  });

  it('vuelve al historial y encola el mensaje de éxito con la descripción del mes', async () => {
    // routes/pagos.py:156-160: "✅ Pago registrado correctamente." + la
    // descripción que arma calcular_desbalance_mensual.
    let vuelto = 0;
    const { estado } = await montarEstado({ utmGuardada: 60_000 });
    const { container } = render(Registro, { estado, alVolver: () => { vuelto += 1; } });

    await fireEvent.input(campo(/Factor UTM pactado/), { target: { value: '3' } });
    await fireEvent.input(campo(/Monto efectivamente pagado/), { target: { value: '200000' } });
    await fireEvent.submit(container.querySelector('form')!);
    await dejarCorrer();

    expect(vuelto).toBe(1);
    expect(textos()).toContain(
      '✅ Pago registrado correctamente. Pagó $20.000 de más este mes.',
    );
  });

  it('con datos inválidos no guarda nada ni cambia de vista', async () => {
    let vuelto = 0;
    const { estado, repoPagos } = await montarEstado();
    const { container } = render(Registro, { estado, alVolver: () => { vuelto += 1; } });

    await fireEvent.submit(container.querySelector('form')!);
    await dejarCorrer();

    expect(vuelto).toBe(0);
    expect(await repoPagos.obtenerTodosLosPagos()).toHaveLength(0);
    expect(textos()).toContain('El factor UTM debe ser un número positivo (ej: 3,0561).');
  });

  it('si el guardado falla, avisa y NO vuelve al historial', async () => {
    // Equivalente del `except Exception` de registro_post, que reencamina a
    // /registro con el error en vez de dar por bueno el pago.
    let vuelto = 0;
    const { estado } = await montarEstado({ utmGuardada: 60_000 });
    estado.registrarPago = async () => { throw new Error('base llena'); };
    const { container } = render(Registro, { estado, alVolver: () => { vuelto += 1; } });

    await fireEvent.input(campo(/Factor UTM pactado/), { target: { value: '3' } });
    await fireEvent.input(campo(/Monto efectivamente pagado/), { target: { value: '200000' } });
    await fireEvent.submit(container.querySelector('form')!);
    await dejarCorrer();

    expect(vuelto).toBe(0);
    expect(textos()).toContain('Error al procesar el pago: base llena');
  });
});
