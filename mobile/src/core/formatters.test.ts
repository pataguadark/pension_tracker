import { describe, expect, it } from 'vitest';
import { fmtFactor, formatearPesos, limpiarEntero, limpiarFactor } from './formatters';

describe('limpiarFactor', () => {
  it.each([
    ['3,0561', 3.0561],
    ['3.0561', 3.0561],
    ['3,5', 3.5],
    ['3.5', 3.5],
    ['3', 3],
    ['0,5', 0.5],
    ['.5', 0.5],
    ['3,', 3],
    ['  3,5 ', 3.5],
    ['1.234', 1.234],
    ['1.234,56', 1234.56],
    ['1,234.56', 1234.56],
    ['3,5.', 3.5],
    ['3.5,', 3.5],
    ['3,,5', 3.5],
  ])('convierte %s en %s', (entrada, esperado) => {
    expect(limpiarFactor(entrada)).toBeCloseTo(esperado, 10);
  });

  it.each(['', '   ', 'abc', '3,,5x', 'nan', 'NaN', 'inf', '-inf', 'Infinity'])(
    'rechaza %s',
    (entrada) => {
      expect(() => limpiarFactor(entrada)).toThrow();
    },
  );

  // Regresión: notación científica y signo '+' no son formas válidas de un
  // factor UTM. Fija el comportamiento estricto que Python debe igualar.
  it.each(['+3,5', '1e10', '3.5e2'])('rechaza notación científica y signo +: %s', (entrada) => {
    expect(() => limpiarFactor(entrada)).toThrow();
  });
});

describe('limpiarEntero', () => {
  it.each([
    ['69.889', 69889],
    ['213.588', 213588],
    ['1000', 1000],
    [' 200.000 ', 200000],
  ])('convierte %s en %s', (entrada, esperado) => {
    expect(limpiarEntero(entrada)).toBe(esperado);
  });

  it.each(['', '1,5', 'abc'])('rechaza %s', (entrada) => {
    expect(() => limpiarEntero(entrada)).toThrow();
  });
});

describe('fmtFactor', () => {
  it.each([
    [3.0561, '3,0561'],
    [3, '3'],
    [3.5, '3,5'],
    [null, ''],
  ])('formatea %s como %s', (entrada, esperado) => {
    expect(fmtFactor(entrada)).toBe(esperado);
  });
});

describe('formatearPesos', () => {
  it.each([
    [68923.5, '$68.924'],
    [5898, '$5.898'],
    [0, '$0'],
    [-5898, '$-5.898'],
  ])('formatea %s como %s', (entrada, esperado) => {
    expect(formatearPesos(entrada)).toBe(esperado);
  });

  // Regresión: montos negativos que redondean en magnitud a cero deben
  // conservar el signo, igual que Python ("$-0"). Tabla generada
  // ejecutando formatear_pesos de Python (implementación de referencia).
  it.each([
    [-0.01, '$-0'],
    [-0.25, '$-0'],
    [-0.5, '$-0'],
    [-0.51, '$-1'],
    [-5898, '$-5.898'],
    [0, '$0'],
  ])('formatea %s como %s (paridad con Python)', (entrada, esperado) => {
    expect(formatearPesos(entrada)).toBe(esperado);
  });
});
