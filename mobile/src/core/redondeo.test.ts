import { describe, expect, it } from 'vitest';
import { redondear } from './redondeo';

describe('redondear', () => {
  // Python usa redondeo bancario: los empates van al par más cercano.
  // Math.round de JavaScript iría hacia arriba y produciría un peso de
  // diferencia entre el escritorio y el móvil.
  it.each([
    [0.5, 0, 0],
    [1.5, 0, 2],
    [2.5, 0, 2],
    [3.5, 0, 4],
    [-0.5, 0, 0],
    [-1.5, 0, -2],
    [-2.5, 0, -2],
    [0.125, 2, 0.12],
    [0.375, 2, 0.38],
    [0.625, 2, 0.62],
    [245000.125, 2, 245000.12],
  ])('redondea el empate exacto %s al par (%s decimales)', (valor, decimales, esperado) => {
    expect(redondear(valor, decimales)).toBe(esperado);
  });

  it.each([
    // 2.675 es el caso que delata el atajo de escalar: 2.675 * 100 da
    // exactamente 267.5 en JS, pero el valor binario es 2.67499999... y
    // Python entrega 2.67. Si este test pasa a 2.68, la implementación
    // volvió al atajo.
    [2.675, 2, 2.67],
    [-2.675, 2, -2.67],
    [245000.135, 2, 245000.14],
    [1.005, 2, 1.0],
    [213587.77289999998, 2, 213587.77],
  ])('redondea %s a %s decimales como Python', (valor, decimales, esperado) => {
    expect(redondear(valor, decimales)).toBe(esperado);
  });

  it('rechaza valores no finitos', () => {
    expect(() => redondear(NaN, 2)).toThrow();
    expect(() => redondear(Infinity, 2)).toThrow();
  });

  it('no altera valores que ya tienen menos decimales', () => {
    expect(redondear(245000, 2)).toBe(245000);
    expect(redondear(3.5, 2)).toBe(3.5);
  });
});
