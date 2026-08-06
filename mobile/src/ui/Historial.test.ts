// @vitest-environment jsdom
/**
 * Pruebas de la pantalla de historial.
 *
 * El estado que se le pasa al componente es el REAL (EstadoApp) sobre una
 * base SQLite en memoria, no un doble: lo que se quiere detectar es una
 * divergencia entre lo que el teléfono muestra y lo que el escritorio
 * muestra para la MISMA base de datos, y un doble a medida podría estar de
 * acuerdo con el componente y equivocado respecto de la base.
 *
 * jsdom no aplica hojas de estilo, así que no se puede comprobar con
 * `toBeVisible()` cuál de las dos versiones del desbalance (valor / UTM)
 * se ve: el CSS las alterna con `[data-modo-desbalance] .valor-utm {
 * display: none }` y ambas están siempre en el DOM. Lo que sí se prueba es
 * el mecanismo del que depende esa visibilidad —el atributo en el
 * contenedor y la clase de estado de la tarjeta—, mismo criterio que las
 * pruebas del menú móvil en App.test.ts.
 */
import { fireEvent, render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { tick } from 'svelte';
import {
  afterEach, describe, expect, it, vi,
} from 'vitest';

import type { Pago } from '../core/tipos';
import { EjecutorNode } from '../data/ejecutor-node';
import { inicializarBd } from '../data/esquema';
import {
  RepositorioConfiguracion, RepositorioPagos, RepositorioUtm,
} from '../data/repositorio';
import { ServicioUtm } from '../utm/servicio-utm';
import { EstadoApp } from './estado.svelte';
import Historial from './Historial.svelte';
import { mensajes } from './mensajes.svelte';

/** Cliente HTTP que falla: ninguna prueba puede depender de la red. */
class HttpSinRed {
  async obtenerJson(): Promise<unknown> {
    throw new Error('sin red');
  }
}

const CUOTA = 180_000;

/** Un pago con valores razonables; se sobrescribe lo que cada caso necesite. */
function pagoDe(
  anio: number,
  mes: number,
  extra: Partial<Omit<Pago, 'id'>> = {},
): Omit<Pago, 'id'> {
  const montoPagado = extra.montoPagado ?? CUOTA;
  const cuotaPactada = extra.cuotaPactada ?? CUOTA;
  return {
    fecha: `${anio}-${String(mes).padStart(2, '0')}-05`,
    mesPago: mes,
    anioPago: anio,
    utmValor: 60_000,
    cuotaPactada,
    montoPagado,
    desbalance: montoPagado - cuotaPactada,
    utmFactor: 3,
    ...extra,
  };
}

/**
 * Base en memoria + EstadoApp ya cargado. `utmReferencia` guarda una UTM
 * en la base, que es de donde EstadoApp la lee (nunca de la red).
 */
async function montarEstado(
  pagos: Omit<Pago, 'id'>[],
  utmReferencia: number | null = null,
): Promise<EstadoApp> {
  const ejecutor = new EjecutorNode(':memory:');
  await inicializarBd(ejecutor);
  const repoPagos = new RepositorioPagos(ejecutor);
  const repoUtm = new RepositorioUtm(ejecutor);
  for (const p of pagos) {
    await repoPagos.insertarPago(p);
  }
  if (utmReferencia !== null) {
    await repoUtm.guardarUtm(2025, 6, utmReferencia);
  }
  const estado = new EstadoApp(
    repoPagos,
    new ServicioUtm(new HttpSinRed(), repoUtm),
    repoUtm,
    new RepositorioConfiguracion(ejecutor),
  );
  await estado.cargar();
  return estado;
}

/** Deja correr las promesas pendientes contra SQLite antes de aseverar. */
const dejarCorrer = () => new Promise((r) => { setTimeout(r, 0); });

/** Texto de un elemento con los espacios colapsados, como los ve el usuario. */
function texto(el: Element | null | undefined): string {
  return (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

const filasDe = (c: HTMLElement) => [...c.querySelectorAll('tbody tr')];
const celda = (fila: Element, selector: string) => texto(fila.querySelector(selector));

describe('Historial — estado vacío', () => {
  it('sin pagos muestra el estado vacío', async () => {
    const estado = await montarEstado([]);
    render(Historial, { estado });
    expect(screen.getByText('Sin pagos registrados')).toBeInTheDocument();
  });

  it('sin pagos NO muestra ninguna tarjeta de resumen', async () => {
    // El escritorio las esconde con `{% if resumen and resumen.cantidad_pagos %}`.
    // Sin esa condición el teléfono mostraría cuatro tarjetas en cero donde
    // el computador no muestra ninguna.
    const estado = await montarEstado([]);
    const { container } = render(Historial, { estado });
    expect(screen.queryByText('Pagos registrados')).not.toBeInTheDocument();
    expect(container.querySelector('.resumen-grid')).toBeNull();
  });

  it('sin pagos no hay tabla', async () => {
    const estado = await montarEstado([]);
    const { container } = render(Historial, { estado });
    expect(container.querySelector('.tabla-pagos')).toBeNull();
  });

  it('sin pagos y sin filtro, el subtítulo dice que no hay ninguno', async () => {
    const estado = await montarEstado([]);
    render(Historial, { estado });
    expect(screen.getByText('Aún no has registrado ningún pago.')).toBeInTheDocument();
  });

  it('sin pagos PARA EL AÑO FILTRADO, el subtítulo nombra ese año', async () => {
    // El escritorio distingue los dos vacíos. Con un solo texto, filtrar un
    // año sin pagos diría "aún no has registrado ningún pago" aunque haya
    // pagos en otros años.
    const estado = await montarEstado([pagoDe(2025, 1)]);
    const { container } = render(Historial, { estado });
    await estado.filtrarPorAnio(2024);
    await tick();
    expect(texto(container.querySelector('.empty-sub'))).toBe('No hay pagos para el año 2024.');
  });
});

describe('Historial — tarjetas de resumen', () => {
  it('con pagos muestra las cuatro tarjetas', async () => {
    const estado = await montarEstado([pagoDe(2025, 1), pagoDe(2025, 2)]);
    const { container } = render(Historial, { estado });
    expect(screen.getByText('Pagos registrados')).toBeInTheDocument();
    expect(screen.getByText('Total pagado')).toBeInTheDocument();
    expect(screen.getByText('Total pactado')).toBeInTheDocument();
    expect(screen.getByText('Desbalance acumulado')).toBeInTheDocument();
    expect(container.querySelectorAll('.resumen-card')).toHaveLength(4);
  });

  it('muestra la cantidad de pagos y los totales en pesos', async () => {
    const estado = await montarEstado([
      pagoDe(2025, 1, { montoPagado: 100_000 }),
      pagoDe(2025, 2, { montoPagado: 200_000 }),
    ]);
    const { container } = render(Historial, { estado });
    const tarjetas = [...container.querySelectorAll('.resumen-card')];
    expect(texto(tarjetas[0]!.querySelector('.resumen-valor'))).toBe('2');
    expect(texto(tarjetas[1]!.querySelector('.resumen-valor'))).toBe('$300.000');
    expect(texto(tarjetas[2]!.querySelector('.resumen-valor'))).toBe('$360.000');
  });

  it('el desbalance lleva el signo ANTES del peso y dice NOMINAL', async () => {
    const estado = await montarEstado([pagoDe(2025, 1, { montoPagado: 100_000 })]);
    const { container } = render(Historial, { estado });
    const card = container.querySelector('#cardDesbalance')!;
    expect(texto(card.querySelector('.resumen-valor.valor-precio'))).toBe('-$80.000');
    expect(texto(card.querySelector('.resumen-estado.valor-precio'))).toBe('DEUDA NOMINAL');
  });

  it('un excedente se muestra con + y pinta la tarjeta de excedente', async () => {
    const estado = await montarEstado([pagoDe(2025, 1, { montoPagado: 200_000 })]);
    const { container } = render(Historial, { estado });
    const card = container.querySelector('#cardDesbalance')!;
    expect(texto(card.querySelector('.resumen-valor.valor-precio'))).toBe('+$20.000');
    expect(card).toHaveClass('card-excedente');
  });
});

describe('Historial — tabla de pagos', () => {
  it('pinta una fila por pago', async () => {
    const estado = await montarEstado([pagoDe(2025, 1), pagoDe(2025, 2), pagoDe(2025, 3)]);
    const { container } = render(Historial, { estado });
    expect(filasDe(container)).toHaveLength(3);
  });

  it('numera de forma DESCENDENTE: la fila más reciente lleva el número mayor', async () => {
    // El escritorio usa `total_filas - loop.index0`, no el id de la base.
    const estado = await montarEstado([pagoDe(2025, 1), pagoDe(2025, 2), pagoDe(2025, 3)]);
    const { container } = render(Historial, { estado });
    const numeros = filasDe(container).map((f) => celda(f, '.td-id'));
    expect(numeros).toEqual(['3', '2', '1']);
  });

  it('la primera fila es el pago más reciente', async () => {
    const estado = await montarEstado([pagoDe(2024, 12), pagoDe(2025, 3)]);
    const { container } = render(Historial, { estado });
    expect(celda(filasDe(container)[0]!, '.td-periodo')).toBe('Mar 2025');
    expect(celda(filasDe(container)[1]!, '.td-periodo')).toBe('Dic 2024');
  });

  it('muestra período, fecha, UTM, cuota y pagado formateados', async () => {
    const estado = await montarEstado([
      pagoDe(2025, 8, { montoPagado: 175_500, utmValor: 67_294, cuotaPactada: 201_882 }),
    ]);
    const { container } = render(Historial, { estado });
    const fila = filasDe(container)[0]!;
    expect(celda(fila, '.td-periodo')).toBe('Ago 2025');
    expect(celda(fila, '.td-fecha')).toBe('2025-08-05');
    expect(celda(fila, '[data-label="UTM en $"]')).toBe('$67.294');
    expect(celda(fila, '[data-label="Cuota pactada"]')).toBe('$201.882');
    expect(celda(fila, '.td-pagado')).toBe('$175.500');
  });

  it('la diferencia del mes lleva signo y clase según su signo', async () => {
    const estado = await montarEstado([
      pagoDe(2025, 1, { montoPagado: 100_000 }),
      pagoDe(2025, 2, { montoPagado: 200_000 }),
    ]);
    const { container } = render(Historial, { estado });
    const [reciente, antiguo] = filasDe(container);
    const difReciente = reciente!.querySelector('[data-label="Diferencia mes"] .valor-precio')!;
    const difAntiguo = antiguo!.querySelector('[data-label="Diferencia mes"] .valor-precio')!;
    expect(texto(difReciente)).toBe('+$20.000');
    expect(difReciente).toHaveClass('td-pos');
    expect(texto(difAntiguo)).toBe('-$80.000');
    expect(difAntiguo).toHaveClass('td-neg');
  });

  it('el saldo corrido acumula de más antiguo a más reciente', async () => {
    const estado = await montarEstado([
      pagoDe(2025, 1, { montoPagado: 100_000 }),
      pagoDe(2025, 2, { montoPagado: 100_000 }),
    ]);
    const { container } = render(Historial, { estado });
    const corridos = filasDe(container).map((f) => texto(f.querySelector('.td-corrido .valor-precio')));
    // La fila de arriba (feb, la más reciente) acumula los dos meses.
    expect(corridos).toEqual(['-$160.000', '-$80.000']);
  });

  it('cada celda lleva data-label: es lo que el CSS usa para la vista de tarjetas', async () => {
    // Bajo 768px el CSS oculta el <thead> y pinta el nombre de cada campo con
    // `td[data-label]::before { content: attr(data-label) }`. Sin los
    // data-label, en el teléfono queda una columna de números sin etiqueta —y
    // jsdom, que no aplica media queries, no lo notaría de ninguna otra forma.
    const estado = await montarEstado([pagoDe(2025, 1)]);
    const { container } = render(Historial, { estado });
    const etiquetas = [...filasDe(container)[0]!.querySelectorAll('td')].map((td) =>
      td.getAttribute('data-label'),
    );
    expect(etiquetas).toEqual([
      'N°', 'Período', 'Fecha reg.', 'Factor UTM', 'UTM en $',
      'Cuota pactada', 'Pagado', 'Diferencia mes', 'Saldo corrido',
      // La celda de acciones no lleva data-label: en el escritorio tampoco,
      // porque los dos botones se explican solos.
      null,
    ]);
  });

  it('los encabezados son los mismos del escritorio y en el mismo orden', async () => {
    const estado = await montarEstado([pagoDe(2025, 1)]);
    const { container } = render(Historial, { estado });
    const th = [...container.querySelectorAll('thead th')].map((e) => texto(e));
    expect(th).toEqual([
      '#', 'Período', 'Fecha reg.', 'Factor UTM', 'UTM en $',
      'Cuota pactada', 'Pagado', 'Diferencia mes', 'Saldo corrido',
      // El escritorio cierra con un <th> vacío sobre la columna de acciones.
      '',
    ]);
  });
});

describe('Historial — badge de multipago', () => {
  it('marca con ×N el período que tiene más de un pago', async () => {
    const estado = await montarEstado([pagoDe(2025, 3), pagoDe(2025, 3)]);
    const { container } = render(Historial, { estado });
    const badges = [...container.querySelectorAll('.badge-multipago')].map((b) => texto(b));
    expect(badges).toEqual(['×2', '×2']);
  });

  it('NO marca los períodos con un solo pago', async () => {
    const estado = await montarEstado([pagoDe(2025, 1), pagoDe(2025, 2)]);
    const { container } = render(Historial, { estado });
    expect(container.querySelectorAll('.badge-multipago')).toHaveLength(0);
  });

  it('con un período repetido y otro no, solo el repetido lleva badge', async () => {
    const estado = await montarEstado([pagoDe(2025, 1), pagoDe(2025, 5), pagoDe(2025, 5)]);
    const { container } = render(Historial, { estado });
    const filas = filasDe(container);
    // Orden: mayo, mayo, enero (más reciente primero).
    expect(texto(filas[0]!.querySelector('.badge-multipago'))).toBe('×2');
    expect(texto(filas[1]!.querySelector('.badge-multipago'))).toBe('×2');
    expect(filas[2]!.querySelector('.badge-multipago')).toBeNull();
    expect(filas[0]!).toHaveClass('fila-multipago');
    expect(filas[2]!).not.toHaveClass('fila-multipago');
  });

  it('el mismo mes de años distintos NO cuenta como período repetido', async () => {
    const estado = await montarEstado([pagoDe(2024, 1), pagoDe(2025, 1)]);
    const { container } = render(Historial, { estado });
    expect(container.querySelectorAll('.badge-multipago')).toHaveLength(0);
  });

  it('el badge de una fila se lee con SU año, no con el de otra fila', async () => {
    // Enero de 2024 tiene dos pagos y enero de 2025 uno solo. Si la fila
    // consultara el conteo con un año que no es el suyo (o solo con el mes),
    // las tres filas mostrarían lo mismo: o las tres con badge o ninguna. Con
    // dos años que tienen el mismo mes pero distinta cantidad de pagos, el
    // resultado correcto y el equivocado se distinguen.
    const estado = await montarEstado([pagoDe(2024, 1), pagoDe(2024, 1), pagoDe(2025, 1)]);
    const { container } = render(Historial, { estado });
    const badges = filasDe(container).map((f) => texto(f.querySelector('.badge-multipago')));
    // Orden: enero 2025 (sin badge), enero 2024 x2 (con badge).
    expect(badges).toEqual(['', '×2', '×2']);
  });

  it('el conteo sigue al filtro por año', async () => {
    // 2024 tiene un solo marzo; 2025 tiene dos. Filtrando a 2024 no debe
    // quedar badge, y filtrando a 2025 deben quedar dos.
    const estado = await montarEstado([pagoDe(2024, 3), pagoDe(2025, 3), pagoDe(2025, 3)]);
    const { container } = render(Historial, { estado });

    await estado.filtrarPorAnio(2024);
    await tick();
    expect(container.querySelectorAll('.badge-multipago')).toHaveLength(0);

    await estado.filtrarPorAnio(2025);
    await tick();
    expect(container.querySelectorAll('.badge-multipago')).toHaveLength(2);
  });
});

describe('Historial — factor UTM', () => {
  it('usa el factor guardado cuando el pago lo trae', async () => {
    const estado = await montarEstado([
      pagoDe(2025, 1, { utmFactor: 3, cuotaPactada: 100_000, utmValor: 67_294 }),
    ]);
    const { container } = render(Historial, { estado });
    expect(celda(filasDe(container)[0]!, '.td-factor')).toBe('3');
  });

  it('deriva el factor de cuota / valor UTM cuando el pago no lo trae', async () => {
    // 100.000 / 67.294 = 1,486019... -> 1,486 con cuatro decimales.
    const estado = await montarEstado([
      pagoDe(2025, 1, { utmFactor: null, cuotaPactada: 100_000, utmValor: 67_294 }),
    ]);
    const { container } = render(Historial, { estado });
    expect(celda(filasDe(container)[0]!, '.td-factor')).toBe('1,486');
  });

  it('muestra — cuando no hay factor ni forma de derivarlo', async () => {
    const estado = await montarEstado([
      pagoDe(2025, 1, { utmFactor: null, utmValor: 0, cuotaPactada: 100_000 }),
    ]);
    const { container } = render(Historial, { estado });
    expect(celda(filasDe(container)[0]!, '.td-factor')).toBe('—');
  });

  it('una fila con factor corrupto muestra — y NO tumba el resto del historial', async () => {
    // Una base guardada por una versión antigua puede tener un utm_factor no
    // finito. Si eso lanzara durante el render, el usuario perdería de vista
    // el historial completo por un solo registro malo.
    const estado = await montarEstado([pagoDe(2025, 1), pagoDe(2025, 2)]);
    estado.filas[0]!.utmFactor = Infinity;
    const { container } = render(Historial, { estado });
    expect(filasDe(container)).toHaveLength(2);
    expect(celda(filasDe(container)[0]!, '.td-factor')).toBe('—');
    expect(celda(filasDe(container)[1]!, '.td-factor')).toBe('3');
  });
});

describe('Historial — conmutador Valor / UTM', () => {
  it('sin UTM de referencia no hay conmutador y se ve la leyenda de advertencia', async () => {
    const estado = await montarEstado([pagoDe(2025, 1, { montoPagado: 100_000 })], null);
    const { container } = render(Historial, { estado });
    expect(screen.queryByRole('button', { name: /tipo de cálculo/i })).not.toBeInTheDocument();
    const warn = container.querySelector('.resumen-legend-warn');
    expect(texto(warn)).toBe(
      'No se pudo calcular el valor UTM: no hay una UTM de referencia disponible.',
    );
  });

  it('sin UTM de referencia el modo arranca en "valor"', async () => {
    const estado = await montarEstado([pagoDe(2025, 1, { montoPagado: 100_000 })], null);
    const { container } = render(Historial, { estado });
    expect(container.querySelector('.page-historial')).toHaveAttribute(
      'data-modo-desbalance',
      'valor',
    );
  });

  it('con UTM de referencia el modo arranca en "utm" y no hay leyenda de advertencia', async () => {
    const estado = await montarEstado([pagoDe(2025, 1, { montoPagado: 100_000 })], 66_000);
    const { container } = render(Historial, { estado });
    expect(container.querySelector('.page-historial')).toHaveAttribute(
      'data-modo-desbalance',
      'utm',
    );
    expect(container.querySelector('.resumen-legend-warn')).toBeNull();
  });

  it('con UTM de referencia existe el conmutador y alterna el modo', async () => {
    const user = userEvent.setup();
    const estado = await montarEstado([pagoDe(2025, 1, { montoPagado: 100_000 })], 66_000);
    const { container } = render(Historial, { estado });
    const boton = screen.getByRole('button', { name: /tipo de cálculo/i });
    const pagina = container.querySelector('.page-historial')!;

    await user.click(boton);
    expect(pagina).toHaveAttribute('data-modo-desbalance', 'valor');
    await user.click(boton);
    expect(pagina).toHaveAttribute('data-modo-desbalance', 'utm');
  });

  it('la tarjeta expone ambos estados y arranca con el del modo UTM', async () => {
    // Pagó exactamente la cuota en pesos (EXACTO nominal), pero esa cuota no
    // corresponde al factor guardado: medido en UTM queda excedente. El
    // escritorio guarda los dos estados en data-estado-valor /
    // data-estado-utm y toggleModoDesbalance() elige cuál pintar.
    const estado = await montarEstado(
      [pagoDe(2025, 1, { utmFactor: 2, cuotaPactada: 180_000, montoPagado: 180_000 })],
      66_000,
    );
    const { container } = render(Historial, { estado });
    const card = container.querySelector('#cardDesbalance')!;
    expect(card).toHaveAttribute('data-estado-valor', 'card-exacto');
    expect(card).toHaveAttribute('data-estado-utm', 'card-excedente');
    expect(card).toHaveClass('card-excedente');
    expect(card).not.toHaveClass('card-exacto');
  });

  it('al alternar a "valor", la tarjeta pasa a la clase del estado nominal', async () => {
    const user = userEvent.setup();
    const estado = await montarEstado(
      [pagoDe(2025, 1, { utmFactor: 2, cuotaPactada: 180_000, montoPagado: 180_000 })],
      66_000,
    );
    const { container } = render(Historial, { estado });
    const card = container.querySelector('#cardDesbalance')!;

    await user.click(screen.getByRole('button', { name: /tipo de cálculo/i }));
    expect(card).toHaveClass('card-exacto');
    expect(card).not.toHaveClass('card-excedente');

    await user.click(screen.getByRole('button', { name: /tipo de cálculo/i }));
    expect(card).toHaveClass('card-excedente');
    expect(card).not.toHaveClass('card-exacto');
  });

  it('con UTM de referencia la tarjeta muestra ambas versiones del desbalance', async () => {
    const estado = await montarEstado([pagoDe(2025, 1, { montoPagado: 100_000 })], 60_000);
    const { container } = render(Historial, { estado });
    const card = container.querySelector('#cardDesbalance')!;
    expect(texto(card.querySelector('.resumen-valor.valor-precio'))).toBe('-$80.000');
    expect(texto(card.querySelector('.resumen-valor.valor-utm'))).toBe('-$80.000');
    expect(texto(card.querySelector('.resumen-estado.valor-utm'))).toBe('DEUDA AJUSTADO UTM');
  });

  it('sin UTM de referencia la tabla no muestra la columna en UTM', async () => {
    const estado = await montarEstado([pagoDe(2025, 1, { montoPagado: 100_000 })], null);
    const { container } = render(Historial, { estado });
    expect(container.querySelectorAll('.tabla-pagos .valor-utm')).toHaveLength(0);
  });

  it('con UTM de referencia la tabla muestra ambas versiones en diferencia y saldo', async () => {
    const estado = await montarEstado([pagoDe(2025, 1, { montoPagado: 100_000 })], 60_000);
    const { container } = render(Historial, { estado });
    const fila = filasDe(container)[0]!;
    expect(texto(fila.querySelector('[data-label="Diferencia mes"] .valor-utm'))).toBe('-$80.000');
    expect(texto(fila.querySelector('.td-corrido .valor-utm'))).toBe('-$80.000');
  });
});

describe('Historial — filtro por año', () => {
  it('ofrece "Todos" y un botón por año, de más reciente a más antiguo', async () => {
    const estado = await montarEstado([pagoDe(2024, 5), pagoDe(2026, 1), pagoDe(2025, 3)]);
    const { container } = render(Historial, { estado });
    const botones = [...container.querySelectorAll('.year-btn')].map((b) => texto(b));
    expect(botones).toEqual(['Todos', '2026', '2025', '2024']);
  });

  it('sin pagos no hay filtro de años', async () => {
    const estado = await montarEstado([]);
    const { container } = render(Historial, { estado });
    expect(container.querySelector('.year-filter')).toBeNull();
  });

  it('"Todos" empieza activo', async () => {
    const estado = await montarEstado([pagoDe(2025, 1)]);
    const { container } = render(Historial, { estado });
    const botones = [...container.querySelectorAll('.year-btn')];
    expect(botones[0]!).toHaveClass('active');
    expect(botones[1]!).not.toHaveClass('active');
  });

  it('al pulsar un año la tabla queda solo con los pagos de ese año', async () => {
    const user = userEvent.setup();
    const estado = await montarEstado([pagoDe(2024, 5), pagoDe(2025, 3), pagoDe(2025, 7)]);
    const { container } = render(Historial, { estado });

    await user.click(screen.getByRole('link', { name: '2025' }));
    await tick();

    const periodos = filasDe(container).map((f) => celda(f, '.td-periodo'));
    expect(periodos).toEqual(['Jul 2025', 'Mar 2025']);
  });

  it('al pulsar un año, ese botón queda activo y el título lo muestra', async () => {
    const user = userEvent.setup();
    const estado = await montarEstado([pagoDe(2024, 5), pagoDe(2025, 3)]);
    const { container } = render(Historial, { estado });

    await user.click(screen.getByRole('link', { name: '2025' }));
    await tick();

    expect(screen.getByRole('link', { name: '2025' })).toHaveClass('active');
    expect(screen.getByRole('link', { name: 'Todos' })).not.toHaveClass('active');
    expect(texto(container.querySelector('.page-title-anio'))).toBe('2025');
  });

  it('el resumen se recalcula para el año filtrado', async () => {
    const user = userEvent.setup();
    const estado = await montarEstado([
      pagoDe(2024, 5, { montoPagado: 100_000 }),
      pagoDe(2025, 3, { montoPagado: 150_000 }),
    ]);
    const { container } = render(Historial, { estado });

    await user.click(screen.getByRole('link', { name: '2025' }));
    await tick();

    const tarjetas = [...container.querySelectorAll('.resumen-card')];
    expect(texto(tarjetas[0]!.querySelector('.resumen-valor'))).toBe('1');
    expect(texto(tarjetas[1]!.querySelector('.resumen-valor'))).toBe('$150.000');
  });

  it('al volver a "Todos" reaparecen todos los años', async () => {
    const user = userEvent.setup();
    const estado = await montarEstado([pagoDe(2024, 5), pagoDe(2025, 3)]);
    const { container } = render(Historial, { estado });

    await user.click(screen.getByRole('link', { name: '2025' }));
    await tick();
    await user.click(screen.getByRole('link', { name: 'Todos' }));
    await tick();

    expect(filasDe(container)).toHaveLength(2);
    expect(container.querySelector('.page-title-anio')).toBeNull();
  });

  it('el filtro conserva TODOS los años aunque se elija uno', async () => {
    const user = userEvent.setup();
    const estado = await montarEstado([pagoDe(2024, 5), pagoDe(2025, 3)]);
    const { container } = render(Historial, { estado });

    await user.click(screen.getByRole('link', { name: '2025' }));
    await tick();

    const botones = [...container.querySelectorAll('.year-btn')].map((b) => texto(b));
    expect(botones).toEqual(['Todos', '2025', '2024']);
  });

  it('elegir un año no recarga la página', async () => {
    // Misma razón que la navegación del encabezado: en el WebView un enlace
    // sin preventDefault() se lleva la app entera por delante. fireEvent
    // devuelve false cuando el evento fue cancelado.
    const estado = await montarEstado([pagoDe(2025, 1)]);
    render(Historial, { estado });
    const noCancelado = fireEvent.click(screen.getByRole('link', { name: '2025' }));
    expect(await noCancelado).toBe(false);
  });
});

describe('Historial — acceso a registrar', () => {
  it('el estado vacío ofrece registrar el primer pago', async () => {
    const user = userEvent.setup();
    const estado = await montarEstado([]);
    let llamado = 0;
    render(Historial, { estado, alRegistrar: () => (llamado += 1) });
    await user.click(screen.getByRole('link', { name: '+ Registrar primer pago' }));
    expect(llamado).toBe(1);
  });

  it('con pagos ofrece registrar uno nuevo', async () => {
    const user = userEvent.setup();
    const estado = await montarEstado([pagoDe(2025, 1)]);
    let llamado = 0;
    render(Historial, { estado, alRegistrar: () => (llamado += 1) });
    await user.click(screen.getByRole('link', { name: '+ Nuevo pago' }));
    expect(llamado).toBe(1);
  });
});

describe('Historial — acciones de cada fila', () => {
  // El escritorio pone en cada fila un enlace de editar (✎) y un formulario
  // de eliminar (✕) con `data-confirm` (historial.html:199-206). Sin ellos la
  // pantalla de edición no tendría por dónde abrirse y el CSS de
  // `.td-acciones` —incluida la regla de 44px bajo 768px— sería letra muerta.

  afterEach(() => {
    vi.restoreAllMocks();
    mensajes.limpiar();
  });

  it('cada fila trae editar y eliminar dentro de .td-acciones', async () => {
    const estado = await montarEstado([pagoDe(2025, 1)]);
    const { container } = render(Historial, { estado });
    const acciones = filasDe(container)[0]!.querySelector('.td-acciones');
    expect(acciones).not.toBeNull();
    expect(acciones!.querySelector('.btn-editar')?.textContent?.trim()).toBe('✎');
    expect(acciones!.querySelector('.btn-eliminar')?.textContent?.trim()).toBe('✕');
  });

  it('los botones se identifican por el id del pago, como en el escritorio', async () => {
    const estado = await montarEstado([pagoDe(2025, 1)]);
    render(Historial, { estado });
    const id = estado.filas[0]!.id;
    expect(screen.getByRole('link', { name: `Editar pago #${id}` })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: `Eliminar pago #${id}` })).toBeInTheDocument();
  });

  it('pulsar editar avisa con el id del pago y no navega', async () => {
    let editado: number | null = null;
    const estado = await montarEstado([pagoDe(2025, 1)]);
    render(Historial, { estado, alEditar: (id: number) => { editado = id; } });
    const enlace = screen.getByRole('link', { name: /Editar pago/ });

    expect(await fireEvent.click(enlace)).toBe(false);

    expect(editado).toBe(estado.filas[0]!.id);
  });

  it('eliminar pide confirmación con el texto del escritorio', async () => {
    const confirmar = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const estado = await montarEstado([pagoDe(2025, 1)]);
    render(Historial, { estado });
    const id = estado.filas[0]!.id;

    await fireEvent.click(screen.getByRole('button', { name: /Eliminar pago/ }));
    await dejarCorrer();

    expect(confirmar).toHaveBeenCalledWith(
      `¿Eliminar pago #${id}? Esta acción no se puede deshacer.`,
    );
  });

  it('al cancelar la confirmación NO elimina', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const estado = await montarEstado([pagoDe(2025, 1)]);
    render(Historial, { estado });

    await fireEvent.click(screen.getByRole('button', { name: /Eliminar pago/ }));
    await dejarCorrer();

    expect(estado.filas).toHaveLength(1);
    expect(mensajes.lista).toHaveLength(0);
  });

  it('al confirmar elimina, avisa y la fila desaparece', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const estado = await montarEstado([pagoDe(2025, 1), pagoDe(2025, 2)]);
    const { container } = render(Historial, { estado });
    const id = estado.filas[0]!.id;

    await fireEvent.click(screen.getAllByRole('button', { name: /Eliminar pago/ })[0]!);
    await dejarCorrer();
    await tick();

    expect(estado.filas).toHaveLength(1);
    expect(filasDe(container)).toHaveLength(1);
    expect(mensajes.lista.map((m) => m.texto)).toEqual([
      `Pago #${id} eliminado correctamente.`,
    ]);
    expect(mensajes.lista[0]!.tipo).toBe('exito');
  });
});
