import { describe, expect, it } from 'vitest';

import {
  calcularPreview, formatearMiles, formatearFactorTecleado, validarFormulario,
} from './formulario';

describe('formatearMiles', () => {
  it('agrupa de a tres con punto', () => {
    expect(formatearMiles('213588')).toBe('213.588');
  });

  it('descarta todo lo que no sea dígito', () => {
    expect(formatearMiles('$213.588 pesos')).toBe('213.588');
  });

  it('deja vacío lo que no tiene dígitos', () => {
    expect(formatearMiles('abc')).toBe('');
  });
});

describe('formatearFactorTecleado', () => {
  it('normaliza el punto a coma', () => {
    // En los teclados decimales de celular el punto suele ser lo único
    // disponible; la coma es el separador chileno.
    expect(formatearFactorTecleado('3.0561')).toBe('3,0561');
  });

  it('con varios separadores el último manda', () => {
    expect(formatearFactorTecleado('1.234,56')).toBe('1234,56');
  });

  it('ignora un separador suelto al final', () => {
    expect(formatearFactorTecleado('3,5,')).toBe('3,5');
  });

  it('corta a cuatro decimales', () => {
    expect(formatearFactorTecleado('3,056199')).toBe('3,0561');
  });

  it('descarta letras y símbolos', () => {
    expect(formatearFactorTecleado('3a,0b5')).toBe('3,05');
  });
});

describe('calcularPreview', () => {
  it('sin factor ni UTM válidos deja todo en guion', () => {
    const p = calcularPreview({ factor: '', utmValor: '', montoPagado: '' });
    expect(p.cuota).toBe('—');
    expect(p.pagado).toBe('—');
    expect(p.diferencia).toBe('—');
    expect(p.estado).toBeNull();
  });

  it('calcula la cuota aunque el monto pagado sea cero', () => {
    const p = calcularPreview({ factor: '3', utmValor: '60.000', montoPagado: '' });
    expect(p.cuota).toBe('$180.000');
    expect(p.pagado).toBe('—');
  });

  it('con pago de más informa excedente', () => {
    const p = calcularPreview({ factor: '3', utmValor: '60.000', montoPagado: '200.000' });
    expect(p.diferencia).toBe('+$20.000');
    expect(p.estado).toBe('EXCEDENTE');
  });

  it('con pago de menos informa deuda', () => {
    const p = calcularPreview({ factor: '3', utmValor: '60.000', montoPagado: '100.000' });
    expect(p.diferencia).toBe('-$80.000');
    expect(p.estado).toBe('DEUDA');
  });

  it('con pago justo informa exacto', () => {
    const p = calcularPreview({ factor: '3', utmValor: '60.000', montoPagado: '180.000' });
    expect(p.diferencia).toBe('+$0');
    expect(p.estado).toBe('EXACTO');
  });

  it('acepta el factor con punto igual que con coma', () => {
    const conComa = calcularPreview({ factor: '3,5', utmValor: '60.000', montoPagado: '' });
    const conPunto = calcularPreview({ factor: '3.5', utmValor: '60.000', montoPagado: '' });
    expect(conPunto.cuota).toBe(conComa.cuota);
  });

  // Añadido más allá del brief: a diferencia del test de validarFormulario
  // con 400 nueves (que ya es rechazado por el propio limpiarFactor, porque
  // Number('9'.repeat(400)) es Infinity), este caso usa un factor y una UTM
  // que SÍ parsean a números finitos por separado, pero cuyo producto
  // desborda. Es la situación real que calcularCuotaPactada() está para
  // atajar, y que sin este try/catch tumbaría el preview mientras el
  // usuario teclea.
  it('con factor y UTM finitos cuyo producto desborda, no revienta', () => {
    const p = calcularPreview({
      factor: `1${'0'.repeat(300)}`,
      utmValor: `1${'0'.repeat(10)}`,
      montoPagado: '',
    });
    expect(p.cuota).toBe('—');
    expect(p.estado).toBeNull();
  });
});

describe('validarFormulario', () => {
  const validos = {
    factor: '3,0561', utmValor: '69.889', montoPagado: '213.588',
    mesPago: '7', anioPago: '2026', fecha: '2026-07-15',
  };

  it('acepta un formulario correcto', () => {
    const r = validarFormulario(validos);
    expect(r.errores).toEqual([]);
    expect(r.valores?.utmFactor).toBe(3.0561);
    expect(r.valores?.utmValor).toBe(69_889);
    expect(r.valores?.montoPagado).toBe(213_588);
  });

  it('acepta monto pagado cero: un mes sin pago es un dato válido', () => {
    expect(validarFormulario({ ...validos, montoPagado: '0' }).errores).toEqual([]);
  });

  it('rechaza un factor no positivo con el mensaje del escritorio', () => {
    const r = validarFormulario({ ...validos, factor: '0' });
    expect(r.errores).toContain(
      'El factor UTM debe ser un número positivo (ej: 3,0561).',
    );
  });

  it('rechaza una UTM no positiva con el mensaje del escritorio', () => {
    const r = validarFormulario({ ...validos, utmValor: '0' });
    expect(r.errores).toContain(
      'El valor UTM debe ser un número entero positivo (ej: 69.889).',
    );
  });

  it('rechaza un mes fuera de rango', () => {
    expect(validarFormulario({ ...validos, mesPago: '13' }).errores).toContain(
      'El mes debe ser un número entre 1 y 12.',
    );
    expect(validarFormulario({ ...validos, mesPago: '0' }).errores).toContain(
      'El mes debe ser un número entre 1 y 12.',
    );
  });

  it('rechaza un año anterior a 2000', () => {
    expect(validarFormulario({ ...validos, anioPago: '1999' }).errores).toContain(
      'El año debe ser un número válido (ej: 2024).',
    );
  });

  it('junta todos los errores en vez de parar en el primero', () => {
    // El escritorio muestra todos los problemas de una vez; parar en el
    // primero obligaría a corregir de a uno.
    const r = validarFormulario({
      ...validos, factor: 'x', utmValor: 'x', mesPago: '99', anioPago: '10',
    });
    expect(r.errores.length).toBe(4);
    expect(r.valores).toBeNull();
  });

  it('rechaza un factor que desborda la cuota a infinito', () => {
    // limpiarFactor acepta dígitos ASCII, así que un factor enorme pasa el
    // parseo pero hace que factor × UTM desborde. El escritorio lo rechaza
    // en calcular_cuota_pactada; acá debe rechazarse antes de guardar.
    const r = validarFormulario({ ...validos, factor: '9'.repeat(400) });
    expect(r.errores.length).toBeGreaterThan(0);
    expect(r.valores).toBeNull();
  });

  // Añadido más allá del brief: el caso anterior en realidad ya lo atrapa
  // limpiarFactor por su cuenta (Number('9'.repeat(400)) da Infinity, y
  // limpiarFactor lanza ante resultados no finitos), así que no ejercita el
  // guardarraíl de calcularCuotaPactada del que habla su propio comentario.
  // Este caso usa un factor y una UTM que parsean a números finitos por
  // separado, para forzar el desborde en la multiplicación y confirmar que
  // ESE camino también se rechaza.
  it('rechaza un factor y una UTM finitos cuyo producto desborda', () => {
    const r = validarFormulario({
      ...validos,
      factor: `1${'0'.repeat(300)}`,
      utmValor: `1${'0'.repeat(10)}`,
    });
    expect(r.errores.length).toBeGreaterThan(0);
    expect(r.valores).toBeNull();
  });
});
