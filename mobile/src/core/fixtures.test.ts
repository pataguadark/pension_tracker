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

import { fmtFactor, formatearPesos, limpiarEntero, limpiarFactor } from './formatters';

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

const formatters = cargar('formatters.json');

describe('limpiarFactor contra fixtures', () => {
  it.each(formatters.limpiarFactor!)('$nombre', ({ entrada, esperado }) => {
    if (esperaError(esperado)) {
      expect(() => limpiarFactor(entrada as string)).toThrow();
    } else {
      expect(limpiarFactor(entrada as string)).toBeCloseTo(esperado as number, 10);
    }
  });
});

describe('limpiarEntero contra fixtures', () => {
  it.each(formatters.limpiarEntero!)('$nombre', ({ entrada, esperado }) => {
    if (esperaError(esperado)) {
      expect(() => limpiarEntero(entrada as string)).toThrow();
    } else {
      expect(limpiarEntero(entrada as string)).toBe(esperado);
    }
  });
});

describe('fmtFactor contra fixtures', () => {
  it.each(formatters.fmtFactor!)('$nombre', ({ entrada, esperado }) => {
    expect(fmtFactor(entrada as number | null)).toBe(esperado);
  });
});

describe('formatearPesos contra fixtures', () => {
  it.each(formatters.formatearPesos!)('$nombre', ({ entrada, esperado }) => {
    expect(formatearPesos(entrada as number)).toBe(esperado);
  });
});
