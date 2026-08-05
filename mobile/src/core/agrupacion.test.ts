import { describe, expect, it } from 'vitest';

import { clavePeriodo, contarPorPeriodo } from './agrupacion';

const pago = (anio: number, mes: number) => ({
  fecha: '2025-01-01', mesPago: mes, anioPago: anio, utmValor: 1,
  cuotaPactada: 1, montoPagado: 1, desbalance: 0,
});

describe('contarPorPeriodo', () => {
  it('cuenta uno por período cuando no hay repetidos', () => {
    const conteo = contarPorPeriodo([pago(2025, 1), pago(2025, 2)]);
    expect(conteo.get('2025-1')).toBe(1);
    expect(conteo.get('2025-2')).toBe(1);
  });

  it('agrupa los pagos del mismo período', () => {
    const conteo = contarPorPeriodo([pago(2025, 3), pago(2025, 3), pago(2025, 3)]);
    expect(conteo.get('2025-3')).toBe(3);
  });

  it('no confunde el mismo mes de años distintos', () => {
    // Con una clave que solo usara el mes, enero de 2024 y enero de 2025
    // aparecerían como un período con dos pagos.
    const conteo = contarPorPeriodo([pago(2024, 1), pago(2025, 1)]);
    expect(conteo.get('2024-1')).toBe(1);
    expect(conteo.get('2025-1')).toBe(1);
  });

  it('no confunde períodos cuyos dígitos se solapan', () => {
    // Una clave concatenada sin separador haría que 2025 mes 11 y 202 mes 511
    // colisionaran. El caso realista es 2025-1 vs 2025-11 con una clave mal
    // formada.
    const conteo = contarPorPeriodo([pago(2025, 1), pago(2025, 11)]);
    expect(conteo.get('2025-1')).toBe(1);
    expect(conteo.get('2025-11')).toBe(1);
  });

  it('sin pagos devuelve un conteo vacío', () => {
    expect(contarPorPeriodo([]).size).toBe(0);
  });

  it('la clave que arma coincide con la que se consulta', () => {
    // clavePeriodo() es lo que el historial usa para preguntarle al conteo
    // cuántos pagos tiene la fila que está pintando. Si contarPorPeriodo
    // guardara con otra clave, el badge ×N nunca aparecería y ninguna de las
    // pruebas de arriba lo notaría: todas construyen la clave a mano.
    const conteo = contarPorPeriodo([pago(2025, 7), pago(2025, 7)]);
    expect(conteo.get(clavePeriodo(2025, 7))).toBe(2);
  });
});
