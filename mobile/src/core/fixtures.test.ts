/**
 * Ejecuta contra la implementación TypeScript los mismos casos que
 * tests/test_fixtures_doradas.py ejecuta contra la de Python.
 *
 * Ver shared/fixtures/README.md.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  calcularCuotaPactada,
  calcularDesbalanceAcumuladoUtm,
  calcularDesbalanceMensual,
  calcularDesbalanceUtmMensual,
  obtenerHistorialDesbalances,
  resumirEstadoCuenta,
} from './calculos';
import { fmtFactor, formatearPesos, limpiarEntero, limpiarFactor } from './formatters';
import type { Pago } from './tipos';

const AQUI = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(AQUI, '../../../shared/fixtures');

interface Caso {
  nombre: string;
  entrada: unknown;
  esperado: unknown;
}

export function cargar(archivo: string): Record<string, Caso[]> {
  return JSON.parse(readFileSync(resolve(FIXTURES, archivo), 'utf-8'));
}

export function esperaError(esperado: unknown): boolean {
  return (
    typeof esperado === 'object' &&
    esperado !== null &&
    (esperado as { error?: boolean }).error === true
  );
}

/**
 * Devuelve los casos de un bloque del fixture, comprobando explícitamente que
 * no esté vacío.
 *
 * Antes se accedía con `formatters.clave!`, la aserción non-null de
 * TypeScript. Ese `!` no protege nada en tiempo de ejecución: es solo una
 * promesa al compilador. Si la clave se escribe mal, `formatters.clave` es
 * `undefined` y el `!` no lo detecta. En esta versión de vitest eso hace que
 * `it.each` reviente con un TypeError críptico y tire abajo todo el archivo
 * (falla ruidosa, no un "pase" silencioso) — pero ese comportamiento es un
 * detalle de implementación de vitest, no algo garantizado. Esta función deja
 * la comprobación explícita, en el punto donde se cargan los casos, con un
 * mensaje claro, y sirve también para los archivos de fixture que se agreguen
 * después.
 */
export function obtenerCasos(bloque: Record<string, Caso[]>, clave: string): Caso[] {
  const lista = bloque[clave];
  if (!Array.isArray(lista) || lista.length === 0) {
    throw new Error(
      `El bloque de fixtures "${clave}" no existe o está vacío. ` +
        'Revisa que la clave esté bien escrita y que tenga al menos un caso; ' +
        'de lo contrario esta suite dejaría de cubrir esos casos sin que nadie lo note.'
    );
  }
  return lista;
}

const formatters = cargar('formatters.json');

// Claves que formatters.json debe tener, cada una con al menos un caso. Si
// alguien renombra una clave (o la vacía), este test se pone rojo con un
// mensaje explícito en vez de que la suite se quede sin cobertura en silencio.
const CLAVES_ESPERADAS_FORMATTERS = ['limpiarFactor', 'limpiarEntero', 'fmtFactor', 'formatearPesos'] as const;

describe('formatters.json trae las claves esperadas', () => {
  it.each(CLAVES_ESPERADAS_FORMATTERS)('el bloque "%s" existe y tiene al menos un caso', (clave) => {
    expect(Array.isArray(formatters[clave])).toBe(true);
    expect((formatters[clave] ?? []).length).toBeGreaterThan(0);
  });
});

describe('limpiarFactor contra fixtures', () => {
  it.each(obtenerCasos(formatters, 'limpiarFactor'))('$nombre', ({ entrada, esperado }) => {
    if (esperaError(esperado)) {
      expect(() => limpiarFactor(entrada as string)).toThrow();
    } else {
      expect(limpiarFactor(entrada as string)).toBeCloseTo(esperado as number, 10);
    }
  });
});

describe('limpiarEntero contra fixtures', () => {
  it.each(obtenerCasos(formatters, 'limpiarEntero'))('$nombre', ({ entrada, esperado }) => {
    if (esperaError(esperado)) {
      expect(() => limpiarEntero(entrada as string)).toThrow();
    } else {
      expect(limpiarEntero(entrada as string)).toBe(esperado);
    }
  });
});

describe('fmtFactor contra fixtures', () => {
  it.each(obtenerCasos(formatters, 'fmtFactor'))('$nombre', ({ entrada, esperado }) => {
    expect(fmtFactor(entrada as number | null)).toBe(esperado);
  });
});

describe('formatearPesos contra fixtures', () => {
  it.each(obtenerCasos(formatters, 'formatearPesos'))('$nombre', ({ entrada, esperado }) => {
    expect(formatearPesos(entrada as number)).toBe(esperado);
  });
});

const cuotaPactada = cargar('cuota-pactada.json');
const desbalanceMensual = cargar('desbalance-mensual.json');

/**
 * Convierte las convenciones "NaN"/"Infinity"/"-Infinity" que usan las
 * fixtures JSON (JSON no tiene literales para estos valores) al number no
 * finito correspondiente. Los demás valores se retornan sin cambios. Ver
 * shared/fixtures/README.md.
 */
function convertirNoFinito(valor: unknown): number {
  if (valor === 'NaN') return NaN;
  if (valor === 'Infinity') return Infinity;
  if (valor === '-Infinity') return -Infinity;
  return valor as number;
}

describe('calcularCuotaPactada contra fixtures', () => {
  it.each(obtenerCasos(cuotaPactada, 'casos'))('$nombre', ({ entrada, esperado }) => {
    const { utmFactor, utmValor } = entrada as { utmFactor: number; utmValor: number };
    const factor = convertirNoFinito(utmFactor);
    const valor = convertirNoFinito(utmValor);
    if (esperaError(esperado)) {
      expect(() => calcularCuotaPactada(factor, valor)).toThrow();
    } else {
      expect(calcularCuotaPactada(factor, valor)).toBeCloseTo(esperado as number, 10);
    }
  });
});

describe('calcularDesbalanceMensual contra fixtures', () => {
  it.each(obtenerCasos(desbalanceMensual, 'casos'))('$nombre', ({ entrada, esperado }) => {
    const { montoPagado, cuotaPactada: cuota } = entrada as {
      montoPagado: number;
      cuotaPactada: number;
    };
    const monto = convertirNoFinito(montoPagado);
    const pactada = convertirNoFinito(cuota);
    if (esperaError(esperado)) {
      expect(() => calcularDesbalanceMensual(monto, pactada)).toThrow();
    } else {
      const obtenido = calcularDesbalanceMensual(monto, pactada);
      const esp = esperado as { diferencia: number; estado: string };
      expect(obtenido.diferencia).toBeCloseTo(esp.diferencia, 10);
      expect(obtenido.estado).toBe(esp.estado);
    }
  });
});

/**
 * Aplica convertirNoFinito a utmFactor/utmValor de un pago dentro de una
 * lista. Se usa en los bloques "acumulado" e "historial", donde cada
 * pago vive dentro de un arreglo: ahí se necesita poder representar una
 * fila individual con un valor no finito persistido (una fila corrupta
 * no debe tumbar el cálculo agregado de las demás), sin tocar el resto
 * de los campos del pago.
 */
function convertirNoFinitosDePago(pago: Pago): Pago {
  return {
    ...pago,
    utmFactor: convertirNoFinito(pago.utmFactor) as number | null,
    utmValor: convertirNoFinito(pago.utmValor) as number,
  };
}

const desbalanceUtm = cargar('desbalance-utm.json');

// Nota: las fixtures del bloque `mensual` no traen las claves `mesPago`,
// `anioPago` ni `desbalance`, porque calcularDesbalanceUtmMensual no las usa.
// El `as unknown as Pago` es deliberado: obliga a que el test refleje
// exactamente lo que la función necesita, sin inventar campos.
describe('calcularDesbalanceUtmMensual contra fixtures', () => {
  it.each(obtenerCasos(desbalanceUtm, 'mensual'))('$nombre', ({ entrada, esperado }) => {
    const base = entrada as { utmFactor: unknown; utmValor: unknown };
    const pago = {
      ...(entrada as object),
      utmFactor: convertirNoFinito(base.utmFactor),
      utmValor: convertirNoFinito(base.utmValor),
    } as unknown as Pago;

    if (esperaError(esperado)) {
      expect(() => calcularDesbalanceUtmMensual(pago)).toThrow();
      return;
    }

    const obtenido = calcularDesbalanceUtmMensual(pago);
    if (esperado === null) {
      expect(obtenido).toBeNull();
    } else {
      expect(obtenido).toBeCloseTo(esperado as number, 10);
    }
  });
});

describe('calcularDesbalanceAcumuladoUtm contra fixtures', () => {
  it.each(obtenerCasos(desbalanceUtm, 'acumulado'))('$nombre', ({ entrada, esperado }) => {
    const { utmValorActual, pagos: pagosCrudos } = entrada as {
      utmValorActual: unknown;
      pagos: Pago[];
    };
    const valorActual = convertirNoFinito(utmValorActual) as number | null;
    const pagos = pagosCrudos.map(convertirNoFinitosDePago);

    if (esperaError(esperado)) {
      expect(() => calcularDesbalanceAcumuladoUtm(valorActual, pagos)).toThrow();
      return;
    }

    const obtenido = calcularDesbalanceAcumuladoUtm(valorActual, pagos);
    const esp = esperado as {
      desbalanceAcumuladoUtm: number;
      desbalanceAjustado: number | null;
      estado: string;
    };

    expect(obtenido.desbalanceAcumuladoUtm).toBeCloseTo(esp.desbalanceAcumuladoUtm, 10);
    expect(obtenido.estado).toBe(esp.estado);

    if (esp.desbalanceAjustado === null) {
      expect(obtenido.desbalanceAjustado).toBeNull();
    } else {
      expect(obtenido.desbalanceAjustado).toBeCloseTo(esp.desbalanceAjustado, 10);
    }
  });
});

const historialCorrido = cargar('historial-corrido.json');

interface FilaEsperada {
  mesPago: number;
  desbalanceCorrido: number;
  estadoCorrido: string;
  desbalanceUtmMesPesos: number | null;
  desbalanceUtmCorridoPesos: number | null;
  estadoUtmMes: string | null;
  estadoUtmCorrido: string | null;
}

describe('obtenerHistorialDesbalances contra fixtures', () => {
  it.each(obtenerCasos(historialCorrido, 'historial'))('$nombre', ({ entrada, esperado }) => {
    const { utmValorActual, pagos: pagosCrudos } = entrada as {
      utmValorActual: number | null;
      pagos: Pago[];
    };
    const pagos = pagosCrudos.map(convertirNoFinitosDePago);
    const obtenido = obtenerHistorialDesbalances(pagos, utmValorActual);
    const filas = esperado as unknown as FilaEsperada[];

    expect(obtenido).toHaveLength(filas.length);

    filas.forEach((esp, i) => {
      const fila = obtenido[i]!;
      // El orden importa: se espera del más reciente al más antiguo.
      expect(fila.mesPago).toBe(esp.mesPago);
      expect(fila.desbalanceCorrido).toBeCloseTo(esp.desbalanceCorrido, 10);
      expect(fila.estadoCorrido).toBe(esp.estadoCorrido);
      expect(fila.estadoUtmMes).toBe(esp.estadoUtmMes);
      expect(fila.estadoUtmCorrido).toBe(esp.estadoUtmCorrido);

      if (esp.desbalanceUtmMesPesos === null) {
        expect(fila.desbalanceUtmMesPesos).toBeNull();
        expect(fila.desbalanceUtmCorridoPesos).toBeNull();
      } else {
        expect(fila.desbalanceUtmMesPesos).toBeCloseTo(esp.desbalanceUtmMesPesos, 10);
        expect(fila.desbalanceUtmCorridoPesos).toBeCloseTo(
          esp.desbalanceUtmCorridoPesos as number, 10);
      }
    });
  });
});

describe('resumirEstadoCuenta contra fixtures', () => {
  it.each(obtenerCasos(historialCorrido, 'resumen'))('$nombre', ({ entrada, esperado }) => {
    const { pagos } = entrada as { pagos: Pago[] };
    const obtenido = resumirEstadoCuenta(pagos);
    const esp = esperado as {
      cantidadPagos: number;
      totalPagado: number;
      totalPactado: number;
      desbalanceAcumulado: number;
      estado: string;
    };

    expect(obtenido.cantidadPagos).toBe(esp.cantidadPagos);
    expect(obtenido.totalPagado).toBeCloseTo(esp.totalPagado, 10);
    expect(obtenido.totalPactado).toBeCloseTo(esp.totalPactado, 10);
    expect(obtenido.desbalanceAcumulado).toBeCloseTo(esp.desbalanceAcumulado, 10);
    expect(obtenido.estado).toBe(esp.estado);
  });
});
