/**
 * Tests de calculos.ts que no son casos de fixtures doradas (no comparan
 * aritmética contra Python): cubren un detalle de manejo de errores
 * específico de esta implementación TypeScript.
 *
 * Ver shared/fixtures/README.md para los casos que sí se comparan entre
 * ambos lenguajes.
 */

import { describe, expect, it } from 'vitest';

import { calcularDesbalanceAcumuladoUtm, factorDePagoTolerante } from './calculos';
import type { Pago } from './tipos';

const pagoValido: Pago = {
  fecha: '2025-01-15',
  mesPago: 1,
  anioPago: 2025,
  utmValor: 67294,
  cuotaPactada: 201882,
  montoPagado: 200000,
  desbalance: -1882,
  utmFactor: 3,
};

describe('desbalanceUtmMensualTolerante (ejercitado vía calcularDesbalanceAcumuladoUtm)', () => {
  it('no traga errores que no sean de validación de finitud', () => {
    /**
     * Punto 5 (tercer hueco barato) de la revisión: el wrapper tolerante
     * (desbalanceUtmMensualTolerante) usaba un `catch` desnudo que se
     * traga CUALQUIER error lanzado al calcular una fila, no solo el de
     * "valor no finito" que es el único que debe degradarse a "sin dato
     * UTM". El lado Python es más estricto: `except ValueError` no
     * atrapa otras excepciones (p. ej. AttributeError si el pago es
     * `None`), así que un bug ahí se ve (revienta), no se esconde.
     *
     * Acá se simula el mismo tipo de bug con una fila que no es un
     * objeto de pago válido en absoluto (`null`, colado por un error de
     * programación en el llamador, no un valor no finito persistido):
     * acceder a `pago.utmFactor` lanza un TypeError. Antes de esta rama,
     * ese TypeError quedaba silenciosamente convertido en "sin dato UTM"
     * para esa fila, igual que un utm_factor infinito legítimo — dos
     * situaciones muy distintas tratadas igual. Con el catch acotado a
     * ErrorDatoNoFinito, el TypeError se propaga.
     */
    const pagos = [pagoValido, null as unknown as Pago];

    expect(() => calcularDesbalanceAcumuladoUtm(70000, pagos)).toThrow();
  });

  it('sigue degradando (no lanza) una fila con utmFactor no finito', () => {
    // Contraparte del test anterior: el caso que SÍ debe seguir
    // tragándose, para no angostar de más el catch. Ya cubierto también
    // por shared/fixtures/desbalance-utm.json (bloque "acumulado"), acá
    // se deja explícito junto al test de arriba para que el contraste
    // sea evidente en un solo archivo.
    const pagoCorrupto: Pago = { ...pagoValido, mesPago: 2, utmFactor: Infinity };

    const resultado = calcularDesbalanceAcumuladoUtm(70000, [pagoValido, pagoCorrupto]);

    expect(resultado.estado).toBe('DEUDA');
  });
});

describe('factorDePagoTolerante', () => {
  /**
   * La columna "Factor UTM" del historial pinta una fila a la vez. Si
   * usara factorDePago() directo, una sola fila con utm_factor no finito
   * —dato que la propia calculos.ts documenta como posible en bases
   * guardadas por versiones antiguas— lanzaría durante el render y
   * dejaría la pantalla completa en blanco: el usuario perdería el
   * historial entero por un registro malo. El escritorio no tiene ese
   * problema porque Jinja imprime `inf` sin quejarse.
   */
  it('devuelve el factor guardado cuando el pago lo trae', () => {
    expect(factorDePagoTolerante(pagoValido)).toBe(3);
  });

  it('deriva el factor de cuota / valor UTM cuando no viene guardado', () => {
    const sinFactor: Pago = { ...pagoValido, utmFactor: null, cuotaPactada: 134588 };
    expect(factorDePagoTolerante(sinFactor)).toBeCloseTo(2, 10);
  });

  it('devuelve null —y no lanza— con un factor no finito', () => {
    const corrupto: Pago = { ...pagoValido, utmFactor: Infinity };
    expect(factorDePagoTolerante(corrupto)).toBeNull();
  });

  it('devuelve null —y no lanza— con un valor UTM no finito', () => {
    const corrupto: Pago = { ...pagoValido, utmFactor: null, utmValor: NaN };
    expect(factorDePagoTolerante(corrupto)).toBeNull();
  });

  it('no traga errores que no sean de validación de finitud', () => {
    // Mismo criterio que desbalanceUtmMensualTolerante: un `catch` desnudo
    // convertiría un bug de programación (una fila `null`) en un inocente
    // "sin factor".
    expect(() => factorDePagoTolerante(null as unknown as Pago)).toThrow();
  });
});
