# Etapa 1 — Core TypeScript + fixtures doradas

> **Para agentes:** SUB-SKILL REQUERIDA: usar superpowers:subagent-driven-development
> (recomendado) o superpowers:executing-plans para implementar tarea por tarea.
> Los pasos usan casillas (`- [ ]`) para seguimiento.

**Goal:** Portar la aritmética del tracker a TypeScript y montar un mecanismo de
fixtures doradas que verifique en paralelo la implementación Python y la
TypeScript, para que no puedan divergir en silencio.

**Architecture:** Se crea `mobile/` con npm + TypeScript + vitest, conteniendo un
core de **funciones puras** (reciben los pagos como argumento, no consultan base
de datos). Los casos de prueba viven en `shared/fixtures/*.json`, y dos suites
—`pytest` y `vitest`— leen los mismos archivos y comparan contra los mismos
resultados esperados.

**Tech Stack:** Python 3.12 + pytest (existente), Node 22 + TypeScript + vitest
(nuevo), JSON para las fixtures.

## Global Constraints

- Cero datos personales en fixtures y tests: valores sintéticos y redondos.
- Nombres, docstrings y comentarios en **español**. En TypeScript se usa
  `camelCase` conservando los nombres en español: `calcularCuotaPactada`.
- Las fixtures verifican **números y estados**, nunca cadenas de descripción
  (ver "Qué NO cubren las fixtures").
- `uv run pytest` y `npm test --prefix mobile` deben quedar ambos en verde.
- Ninguna petición de red fuera de mindicador.cl. En esta etapa no hay red.
- El core TypeScript no importa nada de SQLite, DOM ni Capacitor.

---

## Contexto y riesgo central

Tras esta etapa habrá **dos implementaciones de la misma aritmética** sobre
pensiones de alimentos. Si divergen, un usuario ve un saldo distinto en cada
dispositivo y no sabe cuál creer. Las fixtures doradas son el mecanismo que
convierte esa divergencia en un CI rojo en vez de en un reclamo.

La Etapa 0 ya mostró lo que pasa cuando la aritmética no está cubierta: un bug de
parseo decuplicaba la cuota y sobrevivió a 91 tests.

### El riesgo específico de este port: Python y JavaScript no redondean igual

`round()` de Python usa **redondeo bancario** (empates al par más cercano) y
`Math.round` de JavaScript usa **medio hacia arriba**:

| Expresión | Python | JavaScript |
|---|---|---|
| `round(2.5)` | `2` | `3` |
| `round(0.5)` | `0` | `1` |
| `round(1.5)` | `2` | `2` |

Toda la lógica del tracker redondea a 2 decimales (`round(x, 2)`), así que
cualquier cuota o desbalance que caiga exactamente en un empate diferiría en un
peso entre plataformas. Esta divergencia **ya existe hoy** dentro de la app de
escritorio: el preview en `app.js` usa `Math.round` y el servidor usa `"{:,.0f}"`,
que redondea al par.

Por eso el core TypeScript usará una función `redondear()` que replica el
comportamiento de Python, y las fixtures incluirán casos de empate a propósito.

**La trampa dentro de la trampa.** El atajo obvio —multiplicar por `10^decimales`
y comparar el resto contra 0.5— **no funciona**, porque la propia multiplicación
introduce error: `2.675 * 100` da exactamente `267.5` en JavaScript, aunque el
valor binario de 2.675 sea 2.67499999… y Python devuelva 2.67. El atajo fabrica
un empate inexistente y entrega 2.68. La implementación de la Task 2 detecta el
empate mirando la expansión decimal, y está verificada contra Python sobre 7.018
casos, incluidos empates diádicos y productos factor × UTM.

### Qué NO cubren las fixtures

Las cadenas de descripción (`"Pagó $5.898 de menos este mes."`) quedan **fuera**.
Son presentación, dependen del idioma y del formateo local, y hacerlas coincidir
carácter a carácter entre dos lenguajes produce tests frágiles que se rompen por
un espacio. Las fixtures verifican `diferencia` y `estado`; la descripción se
prueba por separado en cada lenguaje.

---

## Estructura de archivos

```
pension_tracker/
├── shared/fixtures/
│   ├── cuota-pactada.json
│   ├── desbalance-mensual.json
│   ├── desbalance-utm.json
│   ├── historial-corrido.json
│   └── formatters.json
├── tests/
│   └── test_fixtures_doradas.py     # pytest lee shared/fixtures/
└── mobile/
    ├── package.json
    ├── tsconfig.json
    ├── vitest.config.ts
    └── src/core/
        ├── redondeo.ts
        ├── formatters.ts
        ├── calculos.ts
        └── tipos.ts
```

---

## Task 1: Corregir el formato de moneda en las descripciones

**Files:**
- Modify: `src/pensiontracker/services/calculation_service.py:67,73,177,186`
- Modify: `tests/test_calculations.py` (agregar tests)

**Interfaces:**
- Consumes: `formatear_pesos(monto)` de `calculation_service.py:339`, que ya
  existe y produce formato chileno.
- Produces: `calcular_desbalance_mensual` y `calcular_desbalance_acumulado`
  siguen con la misma firma; solo cambia el texto de `descripcion`.

**Por qué:** `calcular_desbalance_mensual` construye su descripción con
`f"${diferencia:,.0f}"`, que usa la coma como separador de miles: produce
`"Pagó $5,898 de menos este mes."`. Un lector chileno interpreta `$5,898` como
cinco pesos con 898. Ese texto **llega al usuario** como mensaje flash en
`routes/pagos.py:157`. El resto de la app usa `formatear_pesos()`, que da
`$5.898`. Se corrige antes de portar para no replicar la inconsistencia.

- [ ] **Step 1: Escribir los tests que fallan**

Agregar al final de `tests/test_calculations.py`:

```python
def test_descripcion_mensual_usa_formato_chileno():
    """El separador de miles debe ser punto: '$5.898', no '$5,898'."""
    info = calculation_service.calcular_desbalance_mensual(200000, 205898)
    assert "$5.898" in info["descripcion"]
    assert "5,898" not in info["descripcion"]


def test_descripcion_mensual_excedente_usa_formato_chileno():
    info = calculation_service.calcular_desbalance_mensual(210000, 204102)
    assert "$5.898" in info["descripcion"]
    assert "5,898" not in info["descripcion"]
```

Verificar que `tests/test_calculations.py` ya importa `calculation_service`; si
importa funciones sueltas, ajustar las llamadas al estilo del archivo.

- [ ] **Step 2: Ver fallar los tests**

Ejecutar: `uv run pytest tests/test_calculations.py -k formato_chileno -v`
Esperado: FAIL, porque la descripción actual contiene `$5,898`.

- [ ] **Step 3: Implementar**

En `src/pensiontracker/services/calculation_service.py`, dentro de
`calcular_desbalance_mensual`, reemplazar las dos líneas de descripción:

```python
        descripcion = f"Pagó {formatear_pesos(diferencia)} de más este mes."
```
```python
        descripcion = f"Pagó {formatear_pesos(abs(diferencia))} de menos este mes."
```

Y dentro de `calcular_desbalance_acumulado`:

```python
        descripcion = (
            f"En total se han pagado {formatear_pesos(total)} de más "
            f"a lo largo de {cantidad} pago(s)."
        )
```
```python
        descripcion = (
            f"Existe una deuda acumulada de {formatear_pesos(abs(total))} "
            f"a lo largo de {cantidad} pago(s)."
        )
```

`formatear_pesos` está definida más abajo en el mismo módulo (línea 339). Python
resuelve el nombre en tiempo de llamada, así que no hace falta moverla.

- [ ] **Step 4: Ver pasar los tests**

Ejecutar: `uv run pytest -q`
Esperado: todo verde. Si algún test existente afirmaba el formato viejo, es un
test que codificaba el bug: actualízalo y deja constancia en el reporte.

- [ ] **Step 5: Commit**

```bash
git add src/pensiontracker/services/calculation_service.py tests/test_calculations.py
git commit -m "Fix: las descripciones de desbalance usaban separador de miles estadounidense

calcular_desbalance_mensual y calcular_desbalance_acumulado construían su
texto con f'\${x:,.0f}', que produce '\$5,898'. Ese texto llega al usuario
como mensaje flash, y en Chile se lee como cinco pesos con 898. Ahora usan
formatear_pesos(), como el resto de la app."
```

---

## Task 2: Andamiaje de `mobile/` y port de los formatters

**Files:**
- Create: `mobile/package.json`, `mobile/tsconfig.json`, `mobile/vitest.config.ts`
- Create: `mobile/.gitignore`
- Create: `mobile/src/core/redondeo.ts`, `mobile/src/core/formatters.ts`
- Create: `mobile/src/core/redondeo.test.ts`, `mobile/src/core/formatters.test.ts`
- Modify: `.gitignore` (raíz) para excluir `mobile/node_modules/`

**Interfaces:**
- Consumes: la regla de separador decimal de la Etapa 0, ya implementada en
  `src/pensiontracker/formatters.py`.
- Produces:
  - `redondear(valor: number, decimales: number): number` — redondeo al par,
    equivalente a `round()` de Python.
  - `limpiarEntero(valor: string): number`
  - `limpiarFactor(valor: string): number`
  - `fmtFactor(n: number | null): string`
  - `formatearPesos(monto: number): string`

- [ ] **Step 1: Crear el andamiaje**

`mobile/package.json`:

```json
{
  "name": "pensiontracker-mobile",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

`mobile/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["vitest/globals"]
  },
  "include": ["src"]
}
```

`mobile/vitest.config.ts`:

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['src/**/*.test.ts'],
  },
});
```

`mobile/.gitignore`:

```
node_modules/
dist/
```

Agregar al `.gitignore` de la raíz del repositorio, al final:

```
# Dependencias de la app móvil
mobile/node_modules/
```

Instalar: `npm install --prefix mobile`

- [ ] **Step 2: Escribir los tests que fallan**

`mobile/src/core/redondeo.test.ts`:

```typescript
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
```

`mobile/src/core/formatters.test.ts`:

```typescript
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
});
```

- [ ] **Step 3: Ver fallar los tests**

Ejecutar: `npm test --prefix mobile`
Esperado: FAIL, no existen `./redondeo` ni `./formatters`.

- [ ] **Step 4: Implementar**

`mobile/src/core/redondeo.ts`:

```typescript
/**
 * Redondeo equivalente al de Python: los empates van al par más cercano
 * (redondeo bancario), no hacia arriba como Math.round.
 *
 * Sin esto, cualquier cuota o desbalance que caiga exactamente en un
 * empate diferiría en un peso entre el escritorio y el móvil.
 */
export function redondear(valor: number, decimales: number): number {
  if (!Number.isFinite(valor)) {
    throw new Error(`No se puede redondear un valor no finito: ${valor}`);
  }

  // Se mira la expansión decimal del double para distinguir un empate
  // real de uno inventado por el error de escalar.
  //
  // NO sirve multiplicar por 10^decimales y comparar el resto contra 0.5:
  // `2.675 * 100` da exactamente `267.5` en JavaScript, aunque 2.675 en
  // binario valga 2.67499999... y Python redondee a 2.67. Ese atajo
  // fabrica un empate inexistente y devuelve 2.68.
  const exacto = valor.toFixed(Math.min(decimales + 25, 100));
  const punto = exacto.indexOf('.');
  const cola = punto === -1 ? '' : exacto.slice(punto + 1 + decimales);

  if (/^50*$/.test(cola)) {
    // Empate exacto: al par, como Python.
    const escala = 10 ** decimales;
    const abajo = Math.floor(valor * escala);
    return (abajo % 2 === 0 ? abajo : abajo + 1) / escala;
  }

  // Sin empate, toFixed opera sobre el valor binario exacto y coincide
  // con Python.
  return Number(valor.toFixed(decimales));
}
```

`mobile/src/core/formatters.ts`:

```typescript
/**
 * Parsing y formateo de números en formato chileno: miles con punto,
 * decimales con coma.
 *
 * Port de src/pensiontracker/formatters.py. Debe mantenerse en paridad
 * con esa implementación; las fixtures doradas verifican ambas.
 */

/**
 * Convierte texto de factor UTM a número.
 *
 * Acepta punto o coma como separador decimal: en los teclados decimales
 * de celular el punto suele ser lo único disponible.
 *
 * Regla: el último separador presente es el decimal; los anteriores son
 * separadores de miles y se descartan. Un separador final suelto se
 * ignora, porque no delimita ninguna parte decimal.
 */
export function limpiarFactor(valor: string): number {
  if (!valor) {
    throw new Error('Valor vacío');
  }

  let limpio = valor.trim();
  while (limpio.length > 0 && (limpio.endsWith('.') || limpio.endsWith(','))) {
    limpio = limpio.slice(0, -1);
  }
  if (limpio.length === 0) {
    throw new Error('Valor vacío');
  }

  const corte = Math.max(limpio.lastIndexOf('.'), limpio.lastIndexOf(','));
  let entero: string;
  let decimales: string;
  if (corte === -1) {
    entero = limpio;
    decimales = '';
  } else {
    entero = limpio.slice(0, corte);
    decimales = limpio.slice(corte + 1);
  }

  entero = entero.replaceAll('.', '').replaceAll(',', '');
  const normalizado = decimales ? `${entero}.${decimales}` : entero;

  // Number() acepta cadena vacía como 0 y tolera espacios; se exige que
  // la cadena sea exactamente un número decimal.
  if (!/^-?\d*\.?\d+$/.test(normalizado)) {
    throw new Error(`Factor UTM inválido: ${JSON.stringify(valor)}`);
  }

  const resultado = Number(normalizado);
  if (!Number.isFinite(resultado)) {
    throw new Error(`Factor UTM inválido: ${JSON.stringify(valor)}`);
  }
  return resultado;
}

/**
 * Convierte texto formateado en Chile (miles con puntos) a entero.
 * Rechaza comas: en este campo no se permiten decimales.
 */
export function limpiarEntero(valor: string): number {
  if (!valor) {
    throw new Error('Valor vacío');
  }
  const limpio = valor.trim();
  if (limpio.includes(',')) {
    throw new Error('No se permiten decimales en este campo');
  }
  const sinPuntos = limpio.replaceAll('.', '');
  if (!/^-?\d+$/.test(sinPuntos)) {
    throw new Error(`Entero inválido: ${JSON.stringify(valor)}`);
  }
  return Number(sinPuntos);
}

/** Formatea un factor UTM para mostrar: 3.0561 → '3,0561', sin ceros de más. */
export function fmtFactor(n: number | null | undefined): string {
  if (n === null || n === undefined) {
    return '';
  }
  const s = n.toFixed(4).replace('.', ',');
  return s.includes(',') ? s.replace(/0+$/, '').replace(/,$/, '') : s;
}

/** Formatea un monto como moneda chilena: 68923.5 → '$68.924'. */
export function formatearPesos(monto: number): string {
  const entero = redondearAEntero(monto);
  const signo = entero < 0 ? '-' : '';
  const digitos = Math.abs(entero).toString();
  const conPuntos = digitos.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `$${signo}${conPuntos}`;
}

function redondearAEntero(monto: number): number {
  // Igual que "{:,.0f}" de Python: empates al par.
  const abajo = Math.floor(monto);
  const resto = Number((monto - abajo).toPrecision(15));
  if (resto > 0.5) return abajo + 1;
  if (resto < 0.5) return abajo;
  return abajo % 2 === 0 ? abajo : abajo + 1;
}
```

- [ ] **Step 5: Ver pasar los tests**

Ejecutar: `npm test --prefix mobile`
Esperado: todos PASS.

Ejecutar: `uv run pytest -q`
Esperado: sigue en verde (esta tarea no toca Python).

- [ ] **Step 6: Commit**

```bash
git add mobile/ .gitignore
git commit -m "Etapa 1: andamiaje de mobile/ con TypeScript y vitest, port de formatters

Incluye redondear(), que replica el redondeo bancario de Python: Math.round
va medio hacia arriba y produciría un peso de diferencia entre escritorio y
móvil en cada empate."
```

---

## Task 3: Mecanismo de fixtures doradas

**Files:**
- Create: `shared/fixtures/formatters.json`
- Create: `shared/fixtures/README.md`
- Create: `tests/test_fixtures_doradas.py`
- Create: `mobile/src/core/fixtures.test.ts`

**Interfaces:**
- Consumes: `limpiarFactor`/`limpiarEntero`/`fmtFactor` de Task 2, y sus
  equivalentes `limpiar_factor`/`limpiar_entero`/`fmt_factor` en
  `src/pensiontracker/formatters.py`.
- Produces: el formato de fixture que usarán las Tasks 4, 5 y 6, y las dos
  suites que lo consumen.

**Formato de fixture.** Cada archivo es un objeto con `descripcion` y `casos`.
Cada caso tiene `nombre`, `entrada` y `esperado`. Un caso que debe fallar usa
`"esperado": {"error": true}`.

- [ ] **Step 1: Crear la fixture**

`shared/fixtures/formatters.json`:

```json
{
  "descripcion": "Parsing y formateo de números en formato chileno. Verificado en paralelo por pytest y vitest.",
  "limpiarFactor": [
    { "nombre": "coma decimal", "entrada": "3,0561", "esperado": 3.0561 },
    { "nombre": "punto decimal", "entrada": "3.0561", "esperado": 3.0561 },
    { "nombre": "entero sin separador", "entrada": "3", "esperado": 3 },
    { "nombre": "un separador con tres digitos es decimal", "entrada": "1.234", "esperado": 1.234 },
    { "nombre": "miles con punto y decimal con coma", "entrada": "1.234,56", "esperado": 1234.56 },
    { "nombre": "miles con coma y decimal con punto", "entrada": "1,234.56", "esperado": 1234.56 },
    { "nombre": "separador final suelto", "entrada": "3,5.", "esperado": 3.5 },
    { "nombre": "separador final suelto invertido", "entrada": "3.5,", "esperado": 3.5 },
    { "nombre": "sin parte entera", "entrada": ".5", "esperado": 0.5 },
    { "nombre": "cadena vacia", "entrada": "", "esperado": { "error": true } },
    { "nombre": "solo espacios", "entrada": "   ", "esperado": { "error": true } },
    { "nombre": "texto", "entrada": "abc", "esperado": { "error": true } },
    { "nombre": "no finito nan", "entrada": "nan", "esperado": { "error": true } },
    { "nombre": "no finito inf", "entrada": "inf", "esperado": { "error": true } },
    { "nombre": "notacion cientifica", "entrada": "1e10", "esperado": { "error": true } },
    { "nombre": "notacion cientifica con decimal", "entrada": "3.5e2", "esperado": { "error": true } },
    { "nombre": "signo mas explicito", "entrada": "+3,5", "esperado": { "error": true } },
    { "nombre": "negativo se parsea, lo rechaza la validacion de la ruta", "entrada": "-3,5", "esperado": -3.5 }
  ],
  "limpiarEntero": [
    { "nombre": "miles con punto", "entrada": "69.889", "esperado": 69889 },
    { "nombre": "sin separador", "entrada": "1000", "esperado": 1000 },
    { "nombre": "con espacios", "entrada": " 200.000 ", "esperado": 200000 },
    { "nombre": "rechaza coma decimal", "entrada": "1,5", "esperado": { "error": true } },
    { "nombre": "cadena vacia", "entrada": "", "esperado": { "error": true } }
  ],
  "fmtFactor": [
    { "nombre": "cuatro decimales", "entrada": 3.0561, "esperado": "3,0561" },
    { "nombre": "entero sin ceros de mas", "entrada": 3, "esperado": "3" },
    { "nombre": "un decimal", "entrada": 3.5, "esperado": "3,5" },
    { "nombre": "nulo", "entrada": null, "esperado": "" }
  ],
  "formatearPesos": [
    { "nombre": "redondea hacia arriba", "entrada": 68923.5, "esperado": "$68.924" },
    { "nombre": "miles con punto", "entrada": 5898, "esperado": "$5.898" },
    { "nombre": "cero", "entrada": 0, "esperado": "$0" },
    { "nombre": "negativo con miles", "entrada": -5898, "esperado": "$-5.898" },
    { "nombre": "negativo que redondea a cero conserva el signo", "entrada": -0.25, "esperado": "$-0" },
    { "nombre": "negativo en el limite del empate", "entrada": -0.5, "esperado": "$-0" },
    { "nombre": "negativo justo pasado el empate", "entrada": -0.51, "esperado": "$-1" }
  ]
}
```

`shared/fixtures/README.md`:

```markdown
# Fixtures doradas

Casos de prueba compartidos entre las dos implementaciones de la aritmética
del tracker: la de Python (`src/pensiontracker/`) y la de TypeScript
(`mobile/src/core/`).

`tests/test_fixtures_doradas.py` los ejecuta con pytest y
`mobile/src/core/fixtures.test.ts` con vitest. Ambas suites leen **estos
mismos archivos**, así que si una implementación se desvía de la otra, una
de las dos se pone roja.

## Reglas

- Todos los valores son **sintéticos**. Nunca datos reales de nadie.
- Las fixtures verifican **números y estados**, nunca cadenas de
  descripción: esas son presentación y hacerlas coincidir carácter a
  carácter entre dos lenguajes produce tests frágiles.
- Un caso que debe lanzar error se marca con `"esperado": {"error": true}`.
- Al agregar un caso, agrégalo aquí: las dos suites lo recogen solas.
```

- [ ] **Step 2: Escribir las dos suites y verlas fallar**

`tests/test_fixtures_doradas.py`:

```python
"""
test_fixtures_doradas.py
------------------------
Ejecuta contra la implementación Python los mismos casos que
mobile/src/core/fixtures.test.ts ejecuta contra la de TypeScript.

Si las dos implementaciones de la aritmética divergen, una de las dos
suites se pone roja. Ese es el único mecanismo que impide que el
escritorio y el móvil muestren saldos distintos.
"""

import json
from pathlib import Path

import pytest

from pensiontracker.formatters import fmt_factor, limpiar_entero, limpiar_factor
from pensiontracker.services.calculation_service import formatear_pesos

FIXTURES = Path(__file__).resolve().parent.parent / "shared" / "fixtures"


def cargar(nombre: str) -> dict:
    return json.loads((FIXTURES / nombre).read_text(encoding="utf-8"))


def casos(nombre_archivo: str, clave: str) -> list:
    """Retorna los casos como tuplas (nombre, entrada, esperado) para parametrizar."""
    datos = cargar(nombre_archivo)
    return [(c["nombre"], c["entrada"], c["esperado"]) for c in datos[clave]]


def espera_error(esperado) -> bool:
    return isinstance(esperado, dict) and esperado.get("error") is True


@pytest.mark.parametrize("nombre,entrada,esperado", casos("formatters.json", "limpiarFactor"))
def test_limpiar_factor_contra_fixtures(nombre, entrada, esperado):
    if espera_error(esperado):
        with pytest.raises(ValueError):
            limpiar_factor(entrada)
    else:
        assert limpiar_factor(entrada) == pytest.approx(esperado)


@pytest.mark.parametrize("nombre,entrada,esperado", casos("formatters.json", "limpiarEntero"))
def test_limpiar_entero_contra_fixtures(nombre, entrada, esperado):
    if espera_error(esperado):
        with pytest.raises(ValueError):
            limpiar_entero(entrada)
    else:
        assert limpiar_entero(entrada) == esperado


@pytest.mark.parametrize("nombre,entrada,esperado", casos("formatters.json", "fmtFactor"))
def test_fmt_factor_contra_fixtures(nombre, entrada, esperado):
    assert fmt_factor(entrada) == esperado


@pytest.mark.parametrize("nombre,entrada,esperado", casos("formatters.json", "formatearPesos"))
def test_formatear_pesos_contra_fixtures(nombre, entrada, esperado):
    assert formatear_pesos(entrada) == esperado
```

`mobile/src/core/fixtures.test.ts`:

```typescript
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
```

Ejecutar ambas y ver el estado inicial:

```bash
uv run pytest tests/test_fixtures_doradas.py -v
npm test --prefix mobile
```

Nota: como las implementaciones ya existen de la Etapa 0 y la Task 2, estos
tests **deberían pasar de entrada**. Eso es esperado: aquí el artefacto nuevo es
el mecanismo, no el comportamiento. Para comprobar que el mecanismo de verdad
detecta divergencias, haz el paso siguiente.

- [ ] **Step 3: Comprobar que el mecanismo detecta una divergencia real**

Introduce a propósito una divergencia temporal en el TypeScript: en
`mobile/src/core/formatters.ts`, dentro de `limpiarFactor`, cambia el descarte de
separadores finales por un `while (false)`.

Ejecutar: `npm test --prefix mobile`
Esperado: **FALLA** el caso `separador final suelto`, mientras pytest sigue en
verde. Eso demuestra que la fixture compartida detecta la divergencia.

**Revierte la divergencia** y vuelve a ejecutar ambas suites: las dos en verde.

Deja constancia en tu reporte de la salida de la falla provocada. Este paso es la
única evidencia de que el mecanismo sirve; sin él, las fixtures son decorativas.

- [ ] **Step 4: Commit**

```bash
git add shared/ tests/test_fixtures_doradas.py mobile/src/core/fixtures.test.ts
git commit -m "Etapa 1: mecanismo de fixtures doradas compartidas entre pytest y vitest

Los mismos casos JSON se ejecutan contra la implementación Python y la
TypeScript. Verificado provocando una divergencia deliberada: vitest se pone
rojo mientras pytest sigue verde."
```

---

## Task 4: Cuota pactada y desbalance mensual en TypeScript

**Files:**
- Create: `mobile/src/core/tipos.ts`, `mobile/src/core/calculos.ts`
- Create: `mobile/src/core/calculos.test.ts`
- Create: `shared/fixtures/cuota-pactada.json`, `shared/fixtures/desbalance-mensual.json`
- Modify: `tests/test_fixtures_doradas.py`, `mobile/src/core/fixtures.test.ts`

**Interfaces:**
- Consumes: `redondear` de `./redondeo` (Task 2); el helper `cargar`/`esperaError`
  exportado por `fixtures.test.ts` (Task 3).
- Produces:
  - `type Pago` en `tipos.ts`
  - `calcularCuotaPactada(utmFactor: number, utmValor: number): number`
  - `calcularDesbalanceMensual(montoPagado: number, cuotaPactada: number): { diferencia: number; estado: Estado }`
  - `type Estado = 'EXCEDENTE' | 'EXACTO' | 'DEUDA'`

- [ ] **Step 1: Crear las fixtures**

`shared/fixtures/cuota-pactada.json`:

```json
{
  "descripcion": "cuota_pactada = utm_factor x utm_valor, redondeada a 2 decimales.",
  "casos": [
    { "nombre": "factor entero", "entrada": { "utmFactor": 3, "utmValor": 70000 }, "esperado": 210000 },
    { "nombre": "factor con decimales", "entrada": { "utmFactor": 3.0561, "utmValor": 69889 }, "esperado": 213587.77 },
    { "nombre": "factor con medio punto", "entrada": { "utmFactor": 3.5, "utmValor": 70000 }, "esperado": 245000 },
    { "nombre": "empate al par hacia abajo", "entrada": { "utmFactor": 1.005, "utmValor": 1000 }, "esperado": 1005 },
    { "nombre": "factor pequeno", "entrada": { "utmFactor": 0.5, "utmValor": 68923 }, "esperado": 34461.5 },
    { "nombre": "factor cero", "entrada": { "utmFactor": 0, "utmValor": 70000 }, "esperado": { "error": true } },
    { "nombre": "factor negativo", "entrada": { "utmFactor": -3, "utmValor": 70000 }, "esperado": { "error": true } },
    { "nombre": "utm cero", "entrada": { "utmFactor": 3, "utmValor": 0 }, "esperado": { "error": true } },
    { "nombre": "utm negativa", "entrada": { "utmFactor": 3, "utmValor": -70000 }, "esperado": { "error": true } }
  ]
}
```

**Antes de dar por buenos estos valores**, verifícalos contra la implementación
Python que es la referencia:

```bash
uv run python -c "
from pensiontracker.services.calculation_service import calcular_cuota_pactada as c
for f, u in [(3,70000),(3.0561,69889),(3.5,70000),(1.005,1000),(0.5,68923)]:
    print(f, u, '->', c(f, u))
"
```

Si algún valor no coincide con el JSON, **corrige el JSON**, no la
implementación: Python es la referencia en esta etapa. Deja constancia en el
reporte de cualquier valor que hayas ajustado.

`shared/fixtures/desbalance-mensual.json`:

```json
{
  "descripcion": "diferencia = monto_pagado - cuota_pactada, redondeada a 2 decimales. Signo: >0 EXCEDENTE, =0 EXACTO, <0 DEUDA.",
  "casos": [
    { "nombre": "pago exacto", "entrada": { "montoPagado": 210000, "cuotaPactada": 210000 }, "esperado": { "diferencia": 0, "estado": "EXACTO" } },
    { "nombre": "pago en exceso", "entrada": { "montoPagado": 215000, "cuotaPactada": 210000 }, "esperado": { "diferencia": 5000, "estado": "EXCEDENTE" } },
    { "nombre": "pago deficiente", "entrada": { "montoPagado": 200000, "cuotaPactada": 210000 }, "esperado": { "diferencia": -10000, "estado": "DEUDA" } },
    { "nombre": "diferencia con decimales", "entrada": { "montoPagado": 213588, "cuotaPactada": 213588.75 }, "esperado": { "diferencia": -0.75, "estado": "DEUDA" } },
    { "nombre": "sin pago", "entrada": { "montoPagado": 0, "cuotaPactada": 210000 }, "esperado": { "diferencia": -210000, "estado": "DEUDA" } }
  ]
}
```

- [ ] **Step 2: Escribir los tests que fallan**

Agregar a `mobile/src/core/fixtures.test.ts`, tras los bloques existentes:

```typescript
import { calcularCuotaPactada, calcularDesbalanceMensual } from './calculos';

const cuotaPactada = cargar('cuota-pactada.json') as unknown as { casos: Caso[] };
const desbalanceMensual = cargar('desbalance-mensual.json') as unknown as { casos: Caso[] };

describe('calcularCuotaPactada contra fixtures', () => {
  it.each(cuotaPactada.casos)('$nombre', ({ entrada, esperado }) => {
    const { utmFactor, utmValor } = entrada as { utmFactor: number; utmValor: number };
    if (esperaError(esperado)) {
      expect(() => calcularCuotaPactada(utmFactor, utmValor)).toThrow();
    } else {
      expect(calcularCuotaPactada(utmFactor, utmValor)).toBeCloseTo(esperado as number, 6);
    }
  });
});

describe('calcularDesbalanceMensual contra fixtures', () => {
  it.each(desbalanceMensual.casos)('$nombre', ({ entrada, esperado }) => {
    const { montoPagado, cuotaPactada: cuota } = entrada as {
      montoPagado: number;
      cuotaPactada: number;
    };
    const obtenido = calcularDesbalanceMensual(montoPagado, cuota);
    const esp = esperado as { diferencia: number; estado: string };
    expect(obtenido.diferencia).toBeCloseTo(esp.diferencia, 6);
    expect(obtenido.estado).toBe(esp.estado);
  });
});
```

Agregar a `tests/test_fixtures_doradas.py`:

```python
from pensiontracker.services.calculation_service import (
    calcular_cuota_pactada,
    calcular_desbalance_mensual,
)


def casos_simples(nombre_archivo: str) -> list:
    datos = cargar(nombre_archivo)
    return [(c["nombre"], c["entrada"], c["esperado"]) for c in datos["casos"]]


@pytest.mark.parametrize("nombre,entrada,esperado", casos_simples("cuota-pactada.json"))
def test_cuota_pactada_contra_fixtures(nombre, entrada, esperado):
    if espera_error(esperado):
        with pytest.raises(ValueError):
            calcular_cuota_pactada(entrada["utmFactor"], entrada["utmValor"])
    else:
        obtenido = calcular_cuota_pactada(entrada["utmFactor"], entrada["utmValor"])
        assert obtenido == pytest.approx(esperado)


@pytest.mark.parametrize("nombre,entrada,esperado", casos_simples("desbalance-mensual.json"))
def test_desbalance_mensual_contra_fixtures(nombre, entrada, esperado):
    obtenido = calcular_desbalance_mensual(entrada["montoPagado"], entrada["cuotaPactada"])
    assert obtenido["diferencia"] == pytest.approx(esperado["diferencia"])
    assert obtenido["estado"] == esperado["estado"]
```

Ejecutar: `npm test --prefix mobile`
Esperado: FAIL, no existe `./calculos`.

Ejecutar: `uv run pytest tests/test_fixtures_doradas.py -v`
Esperado: los tests nuevos de Python deberían pasar (la implementación ya
existe); si alguno falla, el valor del JSON está mal y hay que corregirlo.

- [ ] **Step 3: Implementar**

`mobile/src/core/tipos.ts`:

```typescript
/** Estados posibles de un desbalance, en pesos o en UTM. */
export type Estado = 'EXCEDENTE' | 'EXACTO' | 'DEUDA';

/**
 * Un pago tal como se persiste. Refleja las columnas de la tabla `pagos`
 * del escritorio, para que el archivo .db sea intercambiable entre
 * plataformas.
 */
export interface Pago {
  id?: number;
  fecha: string;
  mesPago: number;
  anioPago: number;
  utmValor: number;
  cuotaPactada: number;
  montoPagado: number;
  desbalance: number;
  utmFactor?: number | null;
}
```

`mobile/src/core/calculos.ts`:

```typescript
/**
 * Toda la lógica de cálculo del tracker.
 *
 * Port de src/pensiontracker/services/calculation_service.py, con una
 * diferencia deliberada: acá las funciones son puras. En Python varias
 * consultan la base de datos por dentro, lo que obliga a montar una BD
 * para probarlas. Acá reciben los pagos como argumento.
 *
 * Las cadenas de descripción no se portan: son presentación y se arman
 * en la capa de interfaz.
 */

import { redondear } from './redondeo';
import type { Estado } from './tipos';

/** Determina el estado según el signo de un desbalance. */
export function estadoDe(valor: number): Estado {
  if (valor > 0) return 'EXCEDENTE';
  if (valor < 0) return 'DEUDA';
  return 'EXACTO';
}

/** Monto en pesos que corresponde pagar: factor UTM x valor de la UTM. */
export function calcularCuotaPactada(utmFactor: number, utmValor: number): number {
  if (!(utmFactor > 0)) {
    throw new Error('El factor UTM debe ser un número positivo.');
  }
  if (!(utmValor > 0)) {
    throw new Error('El valor de la UTM debe ser un número positivo.');
  }
  return redondear(utmFactor * utmValor, 2);
}

/** Desbalance de un pago individual: lo pagado menos lo pactado. */
export function calcularDesbalanceMensual(
  montoPagado: number,
  cuotaPactada: number,
): { diferencia: number; estado: Estado } {
  const diferencia = redondear(montoPagado - cuotaPactada, 2);
  return { diferencia, estado: estadoDe(diferencia) };
}
```

Nota sobre `!(utmFactor > 0)`: escrito así en vez de `utmFactor <= 0` porque
`NaN <= 0` es `false` y dejaría pasar un `NaN`. Esta es la misma clase de defecto
que la revisión de la Etapa 0 encontró en el guard de Python.

- [ ] **Step 4: Ver pasar los tests**

Ejecutar: `npm test --prefix mobile`
Esperado: todos PASS.

Ejecutar: `uv run pytest -q`
Esperado: verde.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/core/ shared/fixtures/ tests/test_fixtures_doradas.py
git commit -m "Etapa 1: cuota pactada y desbalance mensual en TypeScript, con fixtures"
```

---

## Task 5: Desbalance en UTM

**Files:**
- Modify: `mobile/src/core/calculos.ts`
- Create: `shared/fixtures/desbalance-utm.json`
- Modify: `tests/test_fixtures_doradas.py`, `mobile/src/core/fixtures.test.ts`

**Interfaces:**
- Consumes: `Pago`, `Estado`, `redondear`, `estadoDe` de las tareas anteriores.
- Produces:
  - `factorDePago(pago: Pago): number | null`
  - `calcularDesbalanceUtmMensual(pago: Pago): number | null`
  - `calcularDesbalanceAcumuladoUtm(utmValorActual: number | null, pagos: Pago[]): { desbalanceAcumuladoUtm: number; desbalanceAjustado: number | null; estado: Estado }`

**Qué es esto.** En vez de sumar diferencias en pesos a la tasa histórica de cada
mes, cada diferencia se convierte a **unidades UTM** a la tasa de ese mes, se
suman en UTM, y el total se expresa en pesos a la UTM vigente hoy. Así calculan
la deuda los Tribunales de Familia.

**Detalle de precisión que hay que respetar.** El Python calcula
`desbalance_ajustado` sobre el total **sin redondear**, y solo redondea al final;
`desbalance_acumulado_utm` se redondea a 4 decimales pero es solo para mostrar.
Si se redondea antes de multiplicar, el resultado deja de coincidir centavo a
centavo con la última fila del historial corrido de la Task 6. Replicar ese
orden exacto.

- [ ] **Step 1: Crear la fixture**

Los valores esperados de abajo **ya fueron generados ejecutando la
implementación Python**, que es la referencia. Úsalos textualmente. Si al correr
los tests alguno no coincide, repórtalo en vez de ajustarlo: significaría que
alguien cambió el comportamiento del Python.

Ojo con las claves: el JSON usa `camelCase` y el Python usa `snake_case`. La
suite de pytest traduce con la función `a_snake` del Step 2.

`shared/fixtures/desbalance-utm.json`:

```json
{
  "descripcion": "Diferencias convertidas a unidades UTM a la tasa de cada mes, sumadas en UTM y expresadas en pesos a la UTM vigente. Así calculan la deuda los Tribunales de Familia.",
  "mensual": [
    {
      "nombre": "pago exacto no genera diferencia",
      "entrada": { "utmFactor": 3.0, "utmValor": 70000, "cuotaPactada": 210000.0, "montoPagado": 210000 },
      "esperado": 0.0
    },
    {
      "nombre": "exceso en un mes",
      "entrada": { "utmFactor": 3.0, "utmValor": 70000, "cuotaPactada": 210000.0, "montoPagado": 215000 },
      "esperado": 0.07142857142857162
    },
    {
      "nombre": "deficit en un mes",
      "entrada": { "utmFactor": 3.0, "utmValor": 67294, "cuotaPactada": 201882.0, "montoPagado": 200000 },
      "esperado": -0.027966832109846518
    },
    {
      "nombre": "sin utmFactor se deriva de cuota y utm",
      "entrada": { "utmFactor": null, "utmValor": 70000, "cuotaPactada": 210000.0, "montoPagado": 215000 },
      "esperado": 0.07142857142857162
    },
    {
      "nombre": "sin utmValor no se puede calcular",
      "entrada": { "utmFactor": 3.0, "utmValor": 0, "cuotaPactada": 210000.0, "montoPagado": 215000 },
      "esperado": null
    }
  ],
  "acumulado": [
    {
      "nombre": "sin pagos",
      "entrada": { "utmValorActual": 70000, "pagos": [] },
      "esperado": { "desbalanceAcumuladoUtm": 0.0, "desbalanceAjustado": 0.0, "estado": "EXACTO" }
    },
    {
      "nombre": "un solo pago deficiente",
      "entrada": {
        "utmValorActual": 70000,
        "pagos": [
          { "mesPago": 1, "anioPago": 2025, "utmFactor": 3.0, "utmValor": 67294, "cuotaPactada": 201882.0, "montoPagado": 200000, "desbalance": -1882.0 }
        ]
      },
      "esperado": { "desbalanceAcumuladoUtm": -0.028, "desbalanceAjustado": -1957.68, "estado": "DEUDA" }
    },
    {
      "nombre": "tres pagos con UTM distinta mezclando exceso y deficit",
      "entrada": {
        "utmValorActual": 70000,
        "pagos": [
          { "mesPago": 1, "anioPago": 2025, "utmFactor": 3.0, "utmValor": 67294, "cuotaPactada": 201882.0, "montoPagado": 200000, "desbalance": -1882.0 },
          { "mesPago": 2, "anioPago": 2025, "utmFactor": 3.0, "utmValor": 67429, "cuotaPactada": 202287.0, "montoPagado": 202287, "desbalance": 0.0 },
          { "mesPago": 3, "anioPago": 2025, "utmFactor": 3.0, "utmValor": 68034, "cuotaPactada": 204102.0, "montoPagado": 210000, "desbalance": 5898.0 }
        ]
      },
      "esperado": { "desbalanceAcumuladoUtm": 0.0587, "desbalanceAjustado": 4110.76, "estado": "EXCEDENTE" }
    },
    {
      "nombre": "sin UTM de referencia el ajuste en pesos queda nulo",
      "entrada": {
        "utmValorActual": null,
        "pagos": [
          { "mesPago": 1, "anioPago": 2025, "utmFactor": 3.0, "utmValor": 67294, "cuotaPactada": 201882.0, "montoPagado": 200000, "desbalance": -1882.0 },
          { "mesPago": 2, "anioPago": 2025, "utmFactor": 3.0, "utmValor": 67429, "cuotaPactada": 202287.0, "montoPagado": 202287, "desbalance": 0.0 },
          { "mesPago": 3, "anioPago": 2025, "utmFactor": 3.0, "utmValor": 68034, "cuotaPactada": 204102.0, "montoPagado": 210000, "desbalance": 5898.0 }
        ]
      },
      "esperado": { "desbalanceAcumuladoUtm": 0.0587, "desbalanceAjustado": null, "estado": "EXCEDENTE" }
    }
  ]
}
```

- [ ] **Step 2: Escribir los tests y verlos fallar**

Agregar a `tests/test_fixtures_doradas.py`:

```python
from pensiontracker.services.calculation_service import (
    calcular_desbalance_acumulado_utm,
    calcular_desbalance_utm_mensual,
)

MAPA_CLAVES = {
    "utmFactor": "utm_factor",
    "utmValor": "utm_valor",
    "cuotaPactada": "cuota_pactada",
    "montoPagado": "monto_pagado",
    "mesPago": "mes_pago",
    "anioPago": "anio_pago",
}


def a_snake(pago: dict) -> dict:
    """Traduce las claves camelCase de las fixtures a las snake_case del Python."""
    return {MAPA_CLAVES.get(k, k): v for k, v in pago.items()}


@pytest.mark.parametrize("nombre,entrada,esperado", casos("desbalance-utm.json", "mensual"))
def test_desbalance_utm_mensual_contra_fixtures(nombre, entrada, esperado):
    obtenido = calcular_desbalance_utm_mensual(a_snake(entrada))
    if esperado is None:
        assert obtenido is None
    else:
        assert obtenido == pytest.approx(esperado)


@pytest.mark.parametrize("nombre,entrada,esperado", casos("desbalance-utm.json", "acumulado"))
def test_desbalance_acumulado_utm_contra_fixtures(nombre, entrada, esperado):
    pagos = [a_snake(p) for p in entrada["pagos"]]
    obtenido = calcular_desbalance_acumulado_utm(entrada["utmValorActual"], pagos)

    assert obtenido["desbalance_acumulado_utm"] == pytest.approx(
        esperado["desbalanceAcumuladoUtm"])
    assert obtenido["estado"] == esperado["estado"]

    if esperado["desbalanceAjustado"] is None:
        assert obtenido["desbalance_ajustado"] is None
    else:
        assert obtenido["desbalance_ajustado"] == pytest.approx(
            esperado["desbalanceAjustado"])
```

Agregar a `mobile/src/core/fixtures.test.ts`:

```typescript
import {
  calcularDesbalanceAcumuladoUtm,
  calcularDesbalanceUtmMensual,
} from './calculos';
import type { Pago } from './tipos';

const desbalanceUtm = cargar('desbalance-utm.json');

describe('calcularDesbalanceUtmMensual contra fixtures', () => {
  it.each(desbalanceUtm.mensual!)('$nombre', ({ entrada, esperado }) => {
    const obtenido = calcularDesbalanceUtmMensual(entrada as unknown as Pago);
    if (esperado === null) {
      expect(obtenido).toBeNull();
    } else {
      expect(obtenido).toBeCloseTo(esperado as number, 10);
    }
  });
});

describe('calcularDesbalanceAcumuladoUtm contra fixtures', () => {
  it.each(desbalanceUtm.acumulado!)('$nombre', ({ entrada, esperado }) => {
    const { utmValorActual, pagos } = entrada as {
      utmValorActual: number | null;
      pagos: Pago[];
    };
    const obtenido = calcularDesbalanceAcumuladoUtm(utmValorActual, pagos);
    const esp = esperado as {
      desbalanceAcumuladoUtm: number;
      desbalanceAjustado: number | null;
      estado: string;
    };

    expect(obtenido.desbalanceAcumuladoUtm).toBeCloseTo(esp.desbalanceAcumuladoUtm, 4);
    expect(obtenido.estado).toBe(esp.estado);

    if (esp.desbalanceAjustado === null) {
      expect(obtenido.desbalanceAjustado).toBeNull();
    } else {
      expect(obtenido.desbalanceAjustado).toBeCloseTo(esp.desbalanceAjustado, 2);
    }
  });
});
```

Nota: las fixtures del bloque `mensual` no traen las claves `mesPago`,
`anioPago` ni `desbalance`, porque `calcularDesbalanceUtmMensual` no las usa. El
`as unknown as Pago` es deliberado: obliga a que el test refleje exactamente lo
que la función necesita, sin inventar campos.

Ejecutar: `npm test --prefix mobile`
Esperado: FAIL, las funciones no existen en TypeScript.

Ejecutar: `uv run pytest tests/test_fixtures_doradas.py -v`
Esperado: PASS (Python es la referencia y los valores salieron de ahí).

- [ ] **Step 3: Implementar**

Agregar a `mobile/src/core/calculos.ts`:

```typescript
import type { Pago } from './tipos';

/** Factor UTM de un pago: el guardado, o derivado de cuota / valor UTM. */
export function factorDePago(pago: Pago): number | null {
  if (pago.utmFactor) {
    return pago.utmFactor;
  }
  if (pago.utmValor && pago.utmValor > 0) {
    return pago.cuotaPactada / pago.utmValor;
  }
  return null;
}

/**
 * Diferencia de un pago en unidades UTM, a la tasa de ese mes.
 * Mismo signo que el desbalance en pesos. Null si faltan datos.
 */
export function calcularDesbalanceUtmMensual(pago: Pago): number | null {
  const factor = factorDePago(pago);
  if (factor === null || !pago.utmValor) {
    return null;
  }
  return pago.montoPagado / pago.utmValor - factor;
}

/**
 * Suma las diferencias mensuales en UTM y expresa el total en pesos a
 * utmValorActual — así calculan la deuda los Tribunales de Familia.
 *
 * El ajuste en pesos se calcula sobre el total SIN redondear, para que
 * coincida centavo a centavo con la última fila del historial corrido.
 * El total en UTM se redondea a 4 decimales solo para mostrar.
 */
export function calcularDesbalanceAcumuladoUtm(
  utmValorActual: number | null,
  pagos: Pago[],
): { desbalanceAcumuladoUtm: number; desbalanceAjustado: number | null; estado: Estado } {
  let totalUtm = 0;
  for (const pago of pagos) {
    const diff = calcularDesbalanceUtmMensual(pago);
    if (diff !== null) {
      totalUtm += diff;
    }
  }

  const desbalanceAjustado = utmValorActual
    ? redondear(totalUtm * utmValorActual, 2)
    : null;

  return {
    desbalanceAcumuladoUtm: redondear(totalUtm, 4),
    desbalanceAjustado,
    estado: estadoDe(totalUtm),
  };
}
```

- [ ] **Step 4: Ver pasar los tests**

Ejecutar: `npm test --prefix mobile` y `uv run pytest -q`
Esperado: ambos verdes.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/core/calculos.ts shared/fixtures/desbalance-utm.json tests/test_fixtures_doradas.py mobile/src/core/fixtures.test.ts
git commit -m "Etapa 1: desbalance en UTM (mensual y acumulado) en TypeScript, con fixtures"
```

---

## Task 6: Historial con saldo corrido y resumen de estado de cuenta

**Files:**
- Modify: `mobile/src/core/calculos.ts`
- Create: `shared/fixtures/historial-corrido.json`
- Modify: `tests/test_fixtures_doradas.py`, `mobile/src/core/fixtures.test.ts`
- Modify: `src/pensiontracker/services/calculation_service.py:347` (ver abajo)

**Interfaces:**
- Consumes: todo lo anterior.
- Produces:
  - `obtenerHistorialDesbalances(pagos: Pago[], utmValorActual: number | null): FilaHistorial[]`
  - `resumirEstadoCuenta(pagos: Pago[]): { cantidadPagos: number; totalPagado: number; totalPactado: number; desbalanceAcumulado: number; estado: Estado }`

**Cambio necesario en Python.** `obtener_historial_desbalances` consulta la base
de datos por dentro (`calculation_service.py:361`), así que no se puede alimentar
con las fixtures. Hay que hacerla parametrizable **sin romper a sus consumidores**
(`routes/pagos.py:174` y `:200`):

```python
def obtener_historial_desbalances(utm_valor_actual: float | None = None,
                                  pagos: list | None = None) -> list:
```

y al inicio del cuerpo:

```python
    if pagos is None:
        pagos = db_manager.obtener_todos_los_pagos()
```

Es el mismo patrón que ya usa `calcular_desbalance_acumulado_utm`
(`calculation_service.py:119-120`). Los llamadores existentes no cambian.

- [ ] **Step 1: Hacer parametrizable la función Python**

Aplicar el cambio de firma descrito arriba.

Ejecutar: `uv run pytest -q`
Esperado: verde, sin tocar ningún llamador.

- [ ] **Step 2: Crear la fixture**

Los valores de abajo **ya fueron generados con la implementación Python**. Úsalos
textualmente.

Fíjate en dos cosas que la fixture fija a propósito: los pagos de entrada vienen
**desordenados** (mes 3, 1, 2) y las filas esperadas salen **del más reciente al
más antiguo** (mes 3, 2, 1). El saldo corrido acumula desde el más antiguo. El
TypeScript debe reproducir las dos cosas.

`shared/fixtures/historial-corrido.json`:

```json
{
  "descripcion": "Historial enriquecido con el saldo acumulado corrido mes a mes, en pesos históricos y en UTM convertida a pesos de hoy. La entrada viene desordenada a propósito; la salida va del más reciente al más antiguo.",
  "historial": [
    {
      "nombre": "sin pagos",
      "entrada": { "utmValorActual": 70000, "pagos": [] },
      "esperado": []
    },
    {
      "nombre": "un solo pago deficiente",
      "entrada": {
        "utmValorActual": 70000,
        "pagos": [
          { "mesPago": 1, "anioPago": 2025, "utmFactor": 3.0, "utmValor": 67294, "cuotaPactada": 201882.0, "montoPagado": 200000, "desbalance": -1882.0 }
        ]
      },
      "esperado": [
        { "mesPago": 1, "desbalanceCorrido": -1882.0, "estadoCorrido": "DEUDA", "desbalanceUtmMesPesos": -1957.68, "desbalanceUtmCorridoPesos": -1957.68, "estadoUtmMes": "DEUDA", "estadoUtmCorrido": "DEUDA" }
      ]
    },
    {
      "nombre": "tres pagos desordenados se ordenan y acumulan",
      "entrada": {
        "utmValorActual": 70000,
        "pagos": [
          { "mesPago": 3, "anioPago": 2025, "utmFactor": 3.0, "utmValor": 68034, "cuotaPactada": 204102.0, "montoPagado": 210000, "desbalance": 5898.0 },
          { "mesPago": 1, "anioPago": 2025, "utmFactor": 3.0, "utmValor": 67294, "cuotaPactada": 201882.0, "montoPagado": 200000, "desbalance": -1882.0 },
          { "mesPago": 2, "anioPago": 2025, "utmFactor": 3.0, "utmValor": 67429, "cuotaPactada": 202287.0, "montoPagado": 202287, "desbalance": 0.0 }
        ]
      },
      "esperado": [
        { "mesPago": 3, "desbalanceCorrido": 4016.0, "estadoCorrido": "EXCEDENTE", "desbalanceUtmMesPesos": 6068.44, "desbalanceUtmCorridoPesos": 4110.76, "estadoUtmMes": "EXCEDENTE", "estadoUtmCorrido": "EXCEDENTE" },
        { "mesPago": 2, "desbalanceCorrido": -1882.0, "estadoCorrido": "DEUDA", "desbalanceUtmMesPesos": 0.0, "desbalanceUtmCorridoPesos": -1957.68, "estadoUtmMes": "EXACTO", "estadoUtmCorrido": "DEUDA" },
        { "mesPago": 1, "desbalanceCorrido": -1882.0, "estadoCorrido": "DEUDA", "desbalanceUtmMesPesos": -1957.68, "desbalanceUtmCorridoPesos": -1957.68, "estadoUtmMes": "DEUDA", "estadoUtmCorrido": "DEUDA" }
      ]
    },
    {
      "nombre": "sin UTM de referencia los campos en pesos quedan nulos",
      "entrada": {
        "utmValorActual": null,
        "pagos": [
          { "mesPago": 3, "anioPago": 2025, "utmFactor": 3.0, "utmValor": 68034, "cuotaPactada": 204102.0, "montoPagado": 210000, "desbalance": 5898.0 },
          { "mesPago": 1, "anioPago": 2025, "utmFactor": 3.0, "utmValor": 67294, "cuotaPactada": 201882.0, "montoPagado": 200000, "desbalance": -1882.0 },
          { "mesPago": 2, "anioPago": 2025, "utmFactor": 3.0, "utmValor": 67429, "cuotaPactada": 202287.0, "montoPagado": 202287, "desbalance": 0.0 }
        ]
      },
      "esperado": [
        { "mesPago": 3, "desbalanceCorrido": 4016.0, "estadoCorrido": "EXCEDENTE", "desbalanceUtmMesPesos": null, "desbalanceUtmCorridoPesos": null, "estadoUtmMes": null, "estadoUtmCorrido": null },
        { "mesPago": 2, "desbalanceCorrido": -1882.0, "estadoCorrido": "DEUDA", "desbalanceUtmMesPesos": null, "desbalanceUtmCorridoPesos": null, "estadoUtmMes": null, "estadoUtmCorrido": null },
        { "mesPago": 1, "desbalanceCorrido": -1882.0, "estadoCorrido": "DEUDA", "desbalanceUtmMesPesos": null, "desbalanceUtmCorridoPesos": null, "estadoUtmMes": null, "estadoUtmCorrido": null }
      ]
    }
  ],
  "resumen": [
    {
      "nombre": "sin pagos",
      "entrada": { "pagos": [] },
      "esperado": { "cantidadPagos": 0, "totalPagado": 0, "totalPactado": 0, "desbalanceAcumulado": 0, "estado": "EXACTO" }
    },
    {
      "nombre": "tres pagos con excedente neto",
      "entrada": {
        "pagos": [
          { "mesPago": 3, "anioPago": 2025, "utmFactor": 3.0, "utmValor": 68034, "cuotaPactada": 204102.0, "montoPagado": 210000, "desbalance": 5898.0 },
          { "mesPago": 1, "anioPago": 2025, "utmFactor": 3.0, "utmValor": 67294, "cuotaPactada": 201882.0, "montoPagado": 200000, "desbalance": -1882.0 },
          { "mesPago": 2, "anioPago": 2025, "utmFactor": 3.0, "utmValor": 67429, "cuotaPactada": 202287.0, "montoPagado": 202287, "desbalance": 0.0 }
        ]
      },
      "esperado": { "cantidadPagos": 3, "totalPagado": 612287, "totalPactado": 608271.0, "desbalanceAcumulado": 4016.0, "estado": "EXCEDENTE" }
    }
  ]
}
```

- [ ] **Step 3: Escribir los tests y verlos fallar**

Agregar a `tests/test_fixtures_doradas.py`:

```python
from pensiontracker.services.calculation_service import obtener_historial_desbalances

CLAVES_FILA = (
    "desbalance_corrido",
    "estado_corrido",
    "desbalance_utm_mes_pesos",
    "desbalance_utm_corrido_pesos",
    "estado_utm_mes",
    "estado_utm_corrido",
)


@pytest.mark.parametrize("nombre,entrada,esperado", casos("historial-corrido.json", "historial"))
def test_historial_corrido_contra_fixtures(nombre, entrada, esperado):
    pagos = [a_snake(p) for p in entrada["pagos"]]
    obtenido = obtener_historial_desbalances(entrada["utmValorActual"], pagos)

    assert len(obtenido) == len(esperado)

    for fila, esp in zip(obtenido, esperado):
        # El orden importa: la fixture espera del más reciente al más antiguo.
        assert fila["mes_pago"] == esp["mesPago"]
        for clave_py in CLAVES_FILA:
            clave_json = "".join(
                parte if i == 0 else parte.capitalize()
                for i, parte in enumerate(clave_py.split("_"))
            )
            valor, valor_esp = fila[clave_py], esp[clave_json]
            if valor_esp is None:
                assert valor is None, f"{nombre}: {clave_py} debería ser None"
            elif isinstance(valor_esp, str):
                assert valor == valor_esp, f"{nombre}: {clave_py}"
            else:
                assert valor == pytest.approx(valor_esp), f"{nombre}: {clave_py}"


@pytest.mark.parametrize("nombre,entrada,esperado", casos("historial-corrido.json", "resumen"))
def test_resumen_estado_cuenta_contra_fixtures(nombre, entrada, esperado):
    """El resumen del Python vive en obtener_estado_cuenta(), que consulta la BD.
    Se replica acá la aritmética que esa función aplica sobre la lista de pagos."""
    pagos = [a_snake(p) for p in entrada["pagos"]]

    if not pagos:
        obtenido = {
            "cantidadPagos": 0, "totalPagado": 0.0, "totalPactado": 0.0,
            "desbalanceAcumulado": 0.0, "estado": "EXACTO",
        }
    else:
        desbalance = round(sum(p["desbalance"] for p in pagos), 2)
        obtenido = {
            "cantidadPagos": len(pagos),
            "totalPagado": round(sum(p["monto_pagado"] for p in pagos), 2),
            "totalPactado": round(sum(p["cuota_pactada"] for p in pagos), 2),
            "desbalanceAcumulado": desbalance,
            "estado": ("EXCEDENTE" if desbalance > 0
                       else "DEUDA" if desbalance < 0 else "EXACTO"),
        }

    assert obtenido["cantidadPagos"] == esperado["cantidadPagos"]
    assert obtenido["totalPagado"] == pytest.approx(esperado["totalPagado"])
    assert obtenido["totalPactado"] == pytest.approx(esperado["totalPactado"])
    assert obtenido["desbalanceAcumulado"] == pytest.approx(esperado["desbalanceAcumulado"])
    assert obtenido["estado"] == esperado["estado"]
```

Agregar a `mobile/src/core/fixtures.test.ts`:

```typescript
import { obtenerHistorialDesbalances, resumirEstadoCuenta } from './calculos';

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
  it.each(historialCorrido.historial!)('$nombre', ({ entrada, esperado }) => {
    const { utmValorActual, pagos } = entrada as {
      utmValorActual: number | null;
      pagos: Pago[];
    };
    const obtenido = obtenerHistorialDesbalances(pagos, utmValorActual);
    const filas = esperado as unknown as FilaEsperada[];

    expect(obtenido).toHaveLength(filas.length);

    filas.forEach((esp, i) => {
      const fila = obtenido[i]!;
      // El orden importa: se espera del más reciente al más antiguo.
      expect(fila.mesPago).toBe(esp.mesPago);
      expect(fila.desbalanceCorrido).toBeCloseTo(esp.desbalanceCorrido, 2);
      expect(fila.estadoCorrido).toBe(esp.estadoCorrido);
      expect(fila.estadoUtmMes).toBe(esp.estadoUtmMes);
      expect(fila.estadoUtmCorrido).toBe(esp.estadoUtmCorrido);

      if (esp.desbalanceUtmMesPesos === null) {
        expect(fila.desbalanceUtmMesPesos).toBeNull();
        expect(fila.desbalanceUtmCorridoPesos).toBeNull();
      } else {
        expect(fila.desbalanceUtmMesPesos).toBeCloseTo(esp.desbalanceUtmMesPesos, 2);
        expect(fila.desbalanceUtmCorridoPesos).toBeCloseTo(
          esp.desbalanceUtmCorridoPesos as number, 2);
      }
    });
  });
});

describe('resumirEstadoCuenta contra fixtures', () => {
  it.each(historialCorrido.resumen!)('$nombre', ({ entrada, esperado }) => {
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
    expect(obtenido.totalPagado).toBeCloseTo(esp.totalPagado, 2);
    expect(obtenido.totalPactado).toBeCloseTo(esp.totalPactado, 2);
    expect(obtenido.desbalanceAcumulado).toBeCloseTo(esp.desbalanceAcumulado, 2);
    expect(obtenido.estado).toBe(esp.estado);
  });
});
```

Ejecutar: `npm test --prefix mobile`
Esperado: FAIL, `obtenerHistorialDesbalances` y `resumirEstadoCuenta` no existen.

Ejecutar: `uv run pytest tests/test_fixtures_doradas.py -v`
Esperado: PASS, la implementación Python ya existe y de ahí salieron los valores.

- [ ] **Step 4: Implementar**

Agregar a `mobile/src/core/calculos.ts`:

```typescript
export interface FilaHistorial extends Pago {
  desbalanceCorrido: number;
  estadoCorrido: Estado;
  desbalanceUtmMesPesos: number | null;
  desbalanceUtmCorridoPesos: number | null;
  estadoUtmMes: Estado | null;
  estadoUtmCorrido: Estado | null;
}

/**
 * Enriquece los pagos con el desbalance acumulado corrido mes a mes,
 * en pesos históricos y en UTM convertida a pesos de hoy.
 *
 * Acumula del más antiguo al más reciente y retorna del más reciente al
 * más antiguo, que es el orden en que la interfaz los muestra.
 */
export function obtenerHistorialDesbalances(
  pagos: Pago[],
  utmValorActual: number | null = null,
): FilaHistorial[] {
  const ordenados = [...pagos].sort(
    (a, b) => a.anioPago - b.anioPago || a.mesPago - b.mesPago,
  );

  let acumuladoCorrido = 0;
  let acumuladoUtmCorrido = 0;
  const historial: FilaHistorial[] = [];

  for (const pago of ordenados) {
    acumuladoCorrido = redondear(acumuladoCorrido + pago.desbalance, 2);

    const diffUtm = calcularDesbalanceUtmMensual(pago);
    if (diffUtm !== null) {
      acumuladoUtmCorrido += diffUtm;
    }

    const fila: FilaHistorial = {
      ...pago,
      desbalanceCorrido: acumuladoCorrido,
      estadoCorrido: estadoDe(acumuladoCorrido),
      desbalanceUtmMesPesos: null,
      desbalanceUtmCorridoPesos: null,
      estadoUtmMes: null,
      estadoUtmCorrido: null,
    };

    if (diffUtm !== null && utmValorActual) {
      const mesPesos = redondear(diffUtm * utmValorActual, 2);
      const corridoPesos = redondear(acumuladoUtmCorrido * utmValorActual, 2);
      fila.desbalanceUtmMesPesos = mesPesos;
      fila.desbalanceUtmCorridoPesos = corridoPesos;
      fila.estadoUtmMes = estadoDe(mesPesos);
      fila.estadoUtmCorrido = estadoDe(corridoPesos);
    }

    historial.push(fila);
  }

  return historial.reverse();
}

/** Totales y desbalance acumulado del conjunto de pagos. */
export function resumirEstadoCuenta(pagos: Pago[]): {
  cantidadPagos: number;
  totalPagado: number;
  totalPactado: number;
  desbalanceAcumulado: number;
  estado: Estado;
} {
  if (pagos.length === 0) {
    return {
      cantidadPagos: 0,
      totalPagado: 0,
      totalPactado: 0,
      desbalanceAcumulado: 0,
      estado: 'EXACTO',
    };
  }

  const totalPagado = redondear(
    pagos.reduce((suma, p) => suma + p.montoPagado, 0), 2);
  const totalPactado = redondear(
    pagos.reduce((suma, p) => suma + p.cuotaPactada, 0), 2);
  const desbalanceAcumulado = redondear(
    pagos.reduce((suma, p) => suma + p.desbalance, 0), 2);

  return {
    cantidadPagos: pagos.length,
    totalPagado,
    totalPactado,
    desbalanceAcumulado,
    estado: estadoDe(desbalanceAcumulado),
  };
}
```

- [ ] **Step 5: Ver pasar los tests**

Ejecutar: `npm test --prefix mobile` y `uv run pytest -q`
Esperado: ambos verdes.

- [ ] **Step 6: Commit**

```bash
git add mobile/src/core/calculos.ts shared/fixtures/historial-corrido.json tests/test_fixtures_doradas.py mobile/src/core/fixtures.test.ts src/pensiontracker/services/calculation_service.py
git commit -m "Etapa 1: historial con saldo corrido y resumen de cuenta en TypeScript

obtener_historial_desbalances pasa a aceptar los pagos por parámetro, igual
que calcular_desbalance_acumulado_utm, para poder alimentarla con las
fixtures sin montar una base de datos. Los llamadores no cambian."
```

---

## Task 7: CI que ejecuta ambas suites

**Files:**
- Create: `.github/workflows/tests.yml`
- Modify: `.github/workflows/build.yml`

**Interfaces:**
- Consumes: los scripts `npm test --prefix mobile` y `uv run pytest`.
- Produces: verificación automática de que ninguna de las dos implementaciones
  se desvía.

- [ ] **Step 1: Crear el workflow**

`.github/workflows/tests.yml`:

```yaml
name: Tests

on:
  push:
    branches: ["**"]
  pull_request:
  workflow_dispatch: {}

jobs:
  python:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Instalar uv
        uses: astral-sh/setup-uv@v3
      - name: Instalar Python
        run: uv python install 3.12
      - name: Instalar dependencias
        run: uv sync
      - name: Tests de Python (incluye fixtures doradas)
        run: uv run pytest -q

  typescript:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
      - name: Instalar dependencias
        run: npm install --prefix mobile
      - name: Tests de TypeScript (incluye fixtures doradas)
        run: npm test --prefix mobile
```

**Sin filtros por path a propósito.** La idea inicial era separar por lenguaje,
pero las fixtures doradas son precisamente el caso donde tocar un solo lenguaje
debe disparar **ambas** suites: un cambio en `shared/fixtures/` o en el Python
puede romper el TypeScript y al revés. Filtrar por path haría invisible la
divergencia que este mecanismo existe para detectar.

- [ ] **Step 2: Verificar que el build de release sigue intacto**

`.github/workflows/build.yml` corre con tags `v*` y compila los binarios de
escritorio. No debe ejecutar la suite de TypeScript: el binario de escritorio no
incluye `mobile/`. Confirmar leyéndolo que no requiere cambios; si el paso de
tests de ahí empieza a fallar por `mobile/`, aislar con `--ignore=mobile`.

- [ ] **Step 3: Comprobar en local lo mismo que hará el CI**

```bash
uv run pytest -q
npm install --prefix mobile
npm test --prefix mobile
```

Esperado: ambos verdes.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/tests.yml
git commit -m "Etapa 1: CI que ejecuta las suites de Python y TypeScript

Sin filtros por path: un cambio en un solo lenguaje puede romper las
fixtures doradas del otro, y ese es justamente el caso que hay que ver."
```

---

## Verificación de cierre de la etapa

1. `uv run pytest` y `npm test --prefix mobile` ambos en verde.
2. Provocar una divergencia deliberada en el core TypeScript (por ejemplo,
   cambiar `redondear` por `Math.round`) hace fallar `vitest` mientras `pytest`
   sigue verde. **Revertirla después.**
3. `mobile/src/core/` no importa nada de SQLite, DOM ni Capacitor.
4. Las fixtures de `shared/fixtures/` no contienen datos reales.
5. El CI corre ambas suites en cada push.

---

## Etapas siguientes (planes aparte)

- **Etapa 2 — App Svelte + Capacitor.** Interfaz sobre `style.css`, repositorio
  SQLite y cliente UTM, consumiendo este core.
- **Etapa 3 — Importar y restaurar respaldos** en escritorio y móvil.
- **Etapa 4 — Distribución.** Firma del APK, GitHub Releases y envío a F-Droid.
