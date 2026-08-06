# Etapa 2c parte 3 — Registro, edición y cableado

> **Para agentes:** SUB-SKILL OBLIGATORIA: usar superpowers:subagent-driven-development
> para ejecutar este plan tarea por tarea. Los pasos usan casillas (`- [ ]`).

**Objetivo:** que la app móvil deje registrar, editar y eliminar pagos sobre la
base real del teléfono. Al terminar, la app es usable de punta a punta.

**Arquitectura:** cuatro capas. (1) La lógica de formulario, pura y sin DOM.
(2) El componente de formulario que comparten registro y edición. (3) Las dos
pantallas. (4) El banner de UTM y el arranque contra la base real de Capacitor.

**Stack:** Svelte 5 (runas), vitest + jsdom, `@testing-library/svelte`.

## Nota sobre cómo está escrito este plan

Las etapas anteriores dejaron una lección cara: **el código que transcribí
literalmente en los planes introdujo tres bugs críticos** (un botón de menú
omitido que dejaba la navegación invisible en el teléfono, una interfaz que no
coincidía con el plugin real y volvía muerta una guarda, y un método que salía
a la red donde el escritorio solo lee la base). En los tres casos la
transcripción parecía fiel y no lo era.

Por eso este plan **da los casos de prueba exactos y los valores exactos, pero
para el marcado remite a la plantilla del escritorio**. Léela; no la
reconstruyas de memoria ni desde este documento.

## Restricciones globales

- **`src/pensiontracker/` (el escritorio) no se toca.**
- **`mobile/src/ui/estilo.css` no se edita.** Es copia byte a byte del CSS del
  escritorio. Usa solo clases que ya existan ahí; grepéalas antes.
- **Mira el CSS antes de dar por buena una pantalla.** Hay reglas dentro de
  `@media (max-width: 768px)` que ocultan elementos y exigen un mecanismo
  (el `.nav-toggle` del encabezado, los `data-label` de la tabla). jsdom usa
  1024px de ancho, así que **ninguna prueba las ve**.
- **La lógica de negocio no se reimplementa en los componentes.** Viene de
  `mobile/src/core/`.
- **Ninguna prueba sale a la red.** La suite debe correr en `unshare -rn`.
- **Comentarios, nombres y textos de interfaz en español.**
- El repositorio canónico es
  `/run/media/darkdiego/ssd_kingston480G/.darkprojects/dd.release/pension_tracker`
  (**con guion bajo**).

## Fuera de alcance (etapa 3 del proyecto)

Exportar, respaldar e importar. La pantalla de ajustes que los alojará también.

---

## Estructura de archivos

| Archivo | Responsabilidad | Tarea |
|---|---|---|
| `mobile/src/ui/formulario.ts` | Formateo de campos, preview y validación. Puro. | 1 |
| `mobile/src/ui/FormularioPago.svelte` | Los seis campos y la tarjeta de preview. | 2 |
| `mobile/src/ui/Registro.svelte` | Pantalla de registro. | 3 |
| `mobile/src/ui/Edicion.svelte` | Pantalla de edición, con eliminar. | 3 |
| `mobile/src/ui/BannerUtm.svelte` | El banner de UTM del registro. | 4 |
| `mobile/src/main.ts` | Arranque contra la base real. | 4 |

---

### Tarea 1: Lógica de formulario

**Archivos:**
- Crear: `mobile/src/ui/formulario.ts`, `mobile/src/ui/formulario.test.ts`
- Leer antes de empezar: `src/pensiontracker/static/app.js` líneas 1-90
  (`formatearMiles`, `formatearFactor`, `fmtPesos`, `calcularPreview`) y
  `src/pensiontracker/routes/pagos.py` (`_validar_formulario_pago`).

**Interfaces:**
- Consume: `limpiarFactor`, `limpiarEntero`, `formatearPesos` de
  `core/formatters`; `calcularCuotaPactada`, `estadoDe` de `core/calculos`.
- Produce: `formatearMiles(texto)`, `formatearFactorTecleado(texto)`,
  `calcularPreview({factor, utmValor, montoPagado})`,
  `validarFormulario(campos)`.

**Contexto.** El escritorio hace esto en `app.js` (formateo mientras se
teclea y preview en vivo) y en `pagos.py` (validación al recibir el POST).
Acá van juntos porque en el móvil no hay servidor: el mismo código formatea,
previsualiza y valida.

**Lo que hay que respetar del escritorio, y es fácil perder:**

1. `formatearFactorTecleado` **acepta punto además de coma y normaliza a
   coma**. El comentario de `app.js` explica por qué: en los teclados
   decimales de celular el punto suele ser lo único disponible. En el
   teléfono esto no es un detalle.
2. Con varios separadores **el último manda** (los anteriores eran de miles),
   salvo que el último esté vacío, en cuyo caso se ignora. Es la misma regla
   que `limpiarFactor` del core, y ya rompió una versión publicada.
3. Máximo **4 decimales** en el factor.
4. El preview muestra `—` en todo cuando el factor o la UTM no son positivos.
5. El monto pagado se muestra `—` mientras sea 0, pero la cuota sí se calcula.
6. La validación acepta **monto pagado 0** (`>= 0`), pero exige factor y UTM
   **estrictamente positivos** y año **>= 2000**. Los mensajes de error son
   los de `pagos.py`, literales.

- [ ] **Paso 1: Escribir las pruebas que fallan**

`mobile/src/ui/formulario.test.ts`. Cada `it` cubre una obligación distinta:

```typescript
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
});
```

- [ ] **Paso 2: Correr y verificar que fallan**

```bash
npm test --prefix mobile -- formulario
```

- [ ] **Paso 3: Implementar**

`mobile/src/ui/formulario.ts`. Requisitos, además de lo que fijan las pruebas:

- `validarFormulario` devuelve `{ valores, errores }`, con `valores: null`
  cuando hay algún error, y los errores **en el mismo orden** que
  `_validar_formulario_pago`: factor, UTM, monto, mes, año.
- `valores` incluye `fecha`, usando la de hoy en formato `YYYY-MM-DD` cuando
  viene vacía (igual que `registro_post`).
- El parseo de factor y enteros se delega en `limpiarFactor` y
  `limpiarEntero` del core: **no reimplementes el parseo**.
- El formateo de pesos se delega en `formatearPesos`, y el signo antes del
  `$` en `montoConSigno` de `ui/formato.ts`, que ya existe.

- [ ] **Paso 4: Correr, verificar que pasan, y mutar**

```bash
npm test --prefix mobile -- formulario
npm run typecheck --prefix mobile
```

Mutaciones obligatorias, cada una confirmada con grep antes de concluir:
que el factor acepte `<= 0`; que el monto rechace el 0; que los errores paren
en el primero; que el punto no se normalice a coma; que el corte de decimales
sea a 5. Todas deben morir.

- [ ] **Paso 5: Commit**

```bash
git add mobile/src/ui/formulario.ts mobile/src/ui/formulario.test.ts
git commit -m "Logica de formulario: formateo, preview y validacion"
```

---

### Tarea 2: Componente de formulario compartido

**Archivos:**
- Crear: `mobile/src/ui/FormularioPago.svelte`, `mobile/src/ui/FormularioPago.test.ts`
- Leer antes de empezar: `src/pensiontracker/templates/registro_pago.html`
  (bloque `<form>`, líneas 45-171) y `editar_pago.html` (líneas 17-127).
  **Son la referencia del marcado.** Fíjate en qué difieren: los `form-hint`
  cambian de texto, y edición no lleva los botones de acción del registro.

**Interfaces:**
- Consume: todo lo de la tarea 1.
- Produce: `FormularioPago.svelte` con las propiedades `campos` (bindable),
  `accionFactor` y `accionUtm` (snippets opcionales que la tarea 4 usa para
  meter los botones del registro), y `alEnviar`.

**Contexto.** Registro y edición comparten exactamente los mismos seis campos
y la misma tarjeta de preview; el escritorio los tiene duplicados en dos
plantillas. Acá se escriben una vez.

Los seis campos son: factor UTM, valor UTM, mes, año, monto pagado y fecha.
Mes es un `<select>` con los doce nombres completos en español; año es un
`<input type="number">` con `min="2000" max="2100"`; fecha es
`<input type="date">`.

**Detalle que importa:** el escritorio pone `inputmode="decimal"` en el factor
e `inputmode="numeric"` en los montos. En un teléfono eso decide qué teclado
aparece; sin ellos el usuario escribe cifras con el teclado alfabético.

- [ ] **Paso 1: Escribir las pruebas que fallan**

`mobile/src/ui/FormularioPago.test.ts`, con `// @vitest-environment jsdom` en
la primera línea. Cubre, cada uno como un `it` propio:

1. Los seis campos existen y son accesibles por su etiqueta.
2. El campo de factor tiene `inputmode="decimal"` y los de montos
   `inputmode="numeric"`.
3. El selector de mes trae los doce meses, con "Enero" en el valor `1` y
   "Diciembre" en el `12`.
4. Al teclear en el monto, el valor se formatea con puntos de miles.
5. Al teclear un punto en el factor, aparece una coma.
6. El preview se actualiza al teclear: con factor 3, UTM 60.000 y pagado
   200.000 muestra la cuota, la diferencia y el estado EXCEDENTE.
7. El preview vuelve a guiones si el factor se borra.
8. Al enviar con datos válidos, `alEnviar` recibe los valores ya parseados
   (números, no texto).
9. Al enviar con datos inválidos, `alEnviar` **no** se llama y los errores
   quedan visibles.

- [ ] **Paso 2: Implementar hasta que pasen, y mutar**

Mutaciones obligatorias: quitar los `inputmode`; que el envío no valide; que
el preview no reaccione. Todas deben morir.

- [ ] **Paso 3: Commit**

```bash
git add mobile/src/ui/FormularioPago.svelte mobile/src/ui/FormularioPago.test.ts
git commit -m "Formulario de pago compartido por registro y edicion"
```

---

### Tarea 3: Pantallas de registro y edición

**Archivos:**
- Crear: `mobile/src/ui/Registro.svelte`, `mobile/src/ui/Edicion.svelte`,
  `mobile/src/ui/Registro.test.ts`, `mobile/src/ui/Edicion.test.ts`
- Modificar: `mobile/src/ui/App.svelte`, `mobile/src/ui/estado.svelte.ts`
- Leer antes de empezar: `src/pensiontracker/routes/pagos.py` completo.

**Interfaces:**
- Produce: en `EstadoApp`, los métodos `registrarPago(valores)`,
  `actualizarPago(id, valores)` y `eliminarPago(id)`, que escriben en el
  repositorio y recargan.

**Contexto y reglas del escritorio que hay que replicar:**

1. **Registro precarga** el último factor usado (o el guardado como
   predeterminado, que tiene prioridad) y el valor de la UTM de referencia.
   El mes y el año arrancan en los de hoy.
2. **Tras registrar, el escritorio redirige al historial** con un mensaje de
   éxito que incluye la descripción del mes. Acá: cambiar de vista y encolar
   el mensaje.
3. **Edición precarga** el factor guardado del pago; si no tiene, lo deriva
   como `cuotaPactada / utmValor` redondeado a 4.
4. **Al editar, el escritorio también guarda la UTM** del mes y año elegidos
   en `utm_historial` (ver `editar_pago_post`). No lo pierdas.
5. **Eliminar pide confirmación** (`data-confirm` en el escritorio) y vuelve
   al historial con un mensaje.
6. **Un pago inexistente** al editar o eliminar produce el mensaje
   `No se encontró el pago #<id>.` y vuelve al historial.

- [ ] **Paso 1: Pruebas de `EstadoApp` primero**

En `estado.test.ts`, agrega pruebas para los tres métodos nuevos: que
`registrarPago` inserta y deja el pago visible en `filas`; que
`actualizarPago` recalcula la cuota y el desbalance a partir del factor y la
UTM nuevos; que `actualizarPago` guarda la UTM del período en
`utm_historial`; que `eliminarPago` lo saca de `filas`; y que los tres
recargan el resumen.

- [ ] **Paso 2: Pruebas de las dos pantallas**

`Registro.test.ts` y `Edicion.test.ts`, ambas con jsdom. Cubre:

- Registro precarga el factor y la UTM que le pasen.
- Registrar con datos válidos llama al estado y cambia a historial.
- Edición precarga los datos del pago, incluido el factor derivado cuando el
  pago no lo trae guardado.
- Guardar cambios actualiza y vuelve al historial.
- Eliminar pide confirmación y, al confirmar, elimina.
- Al cancelar la confirmación, **no** elimina.

- [ ] **Paso 3: Implementar, mutar y commitear**

Mutaciones obligatorias: que editar no guarde la UTM del período; que
eliminar no pida confirmación; que el factor derivado use otra fórmula. Todas
deben morir.

```bash
git add mobile/src/ui/
git commit -m "Pantallas de registro y edicion con eliminacion"
```

---

### Tarea 4: Banner de UTM y arranque contra la base real

**Archivos:**
- Crear: `mobile/src/ui/BannerUtm.svelte`, `mobile/src/ui/BannerUtm.test.ts`
- Modificar: `mobile/src/main.ts`, `mobile/src/ui/App.svelte`,
  `mobile/src/ui/Registro.svelte`
- Leer antes de empezar: `src/pensiontracker/templates/registro_pago.html`
  (banner, líneas 13-42), `src/pensiontracker/routes/utm.py`, y
  `mobile/src/data/conexion.ts`.

**Contexto.** Es la tarea que enchufa todo: hasta ahora `App.svelte` recibe
el estado que le pasen y nadie abre la base real.

**El banner** muestra la UTM del mes en curso con tres estados visuales:
`utm-ok` (del mes actual), `utm-warn` (guardada, de otro mes) y `utm-error`
(no disponible), con el texto correspondiente. Lleva un botón de refrescar
que consulta mindicador.cl a través de `ServicioUtm` y actualiza el valor.

**Del arranque, lo que importa:**

1. `main.ts` llama a `abrirBaseDeDatos` con la `SQLiteConnection` real y monta
   `App` con un `EstadoApp` sobre esos repositorios.
2. **Si la carga falla, hay que mostrarlo.** Hoy `estado.error` no se muestra
   en ninguna parte: un fallo dejaría "Sin pagos registrados" en pantalla, que
   para esta app es el peor mensaje posible — parece que se perdieron los
   datos. Debe verse un error explícito.
3. El `ClienteHttpFetch` va tal cual: `CapacitorHttp` parchea `fetch` para que
   salga por la capa nativa.

- [ ] **Paso 1: Pruebas del banner**

Con jsdom. Cubre los tres estados visuales con su clase y su texto, que el
botón de refrescar llama al servicio, que un refresco exitoso actualiza el
valor mostrado, y que un refresco fallido **no borra** el valor que ya había
—perder el dato por un fallo de red sería peor que no refrescar—.

- [ ] **Paso 2: Prueba del error de arranque**

Que `App` muestre un mensaje de error explícito cuando `estado.error` no es
nulo, y que en ese caso **no** muestre el estado vacío de "Sin pagos
registrados".

- [ ] **Paso 3: Implementar el arranque**

`main.ts` con `abrirBaseDeDatos`. Si `@capacitor-community/sqlite` no puede
importarse fuera del teléfono, aísla ese import para que las pruebas no lo
carguen — **pero no lo envuelvas en un try/catch que silencie el fallo en el
dispositivo.**

- [ ] **Paso 4: Verificación completa**

```bash
npm test --prefix mobile
npm run typecheck --prefix mobile
npm run check --prefix mobile
npm run build --prefix mobile
unshare -rn npm test --prefix mobile
uv run pytest -q
```

- [ ] **Paso 5: Commit**

```bash
git add mobile/
git commit -m "Banner de UTM y arranque contra la base del telefono"
```

---

## Deuda que esta etapa no cierra

- Las tres acciones extra del registro del escritorio (guardar el factor como
  predeterminado, y el vínculo mes↔UTM para completar meses pasados) no se
  portan acá. Son features 2 y 4 del escritorio; van cuando la app básica esté
  probada en un teléfono real.
- El conmutador Valor/UTM del historial y el banner se alternan con
  `display:none`, que jsdom no aplica. Las pruebas fijan el mecanismo, no la
  visibilidad: hay que mirarlos a ojo en un dispositivo.
- Sigue sin haber JDK ni Android SDK, así que el APK no se puede construir ni
  probar todavía (etapa 4).
