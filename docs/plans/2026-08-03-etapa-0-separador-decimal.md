# Etapa 0 — Separador decimal del factor UTM

> **Para agentes:** SUB-SKILL REQUERIDA: usar superpowers:subagent-driven-development
> (recomendado) o superpowers:executing-plans para implementar tarea por tarea.
> Los pasos usan casillas (`- [ ]`) para seguimiento.

**Goal:** Que el factor UTM acepte punto y coma como separador decimal, en el
backend y en la interfaz, para que escribir `3.5` deje de convertirse en `35`.

**Architecture:** Se corrige `limpiar_factor()` en `formatters.py` con una regla
única — el último separador presente es el decimal, los anteriores son de miles —
y se alinea el formateador del cliente en `app.js` para que deje de borrar los
puntos. Se crea la suite de tests de `formatters.py`, hoy inexistente.

**Tech Stack:** Python 3.12, pytest, JavaScript sin framework.

## Global Constraints

- Cero datos personales en tests y fixtures: valores sintéticos y redondos.
- Todo endpoint que escribe usa POST y va protegido con CSRF (no aplica a esta
  etapa, pero rige el repositorio).
- Nombres y comentarios en español, siguiendo el estilo del código existente.
- La suite completa (`uv run pytest`) debe quedar en verde antes de cada commit.

---

## Contexto: por qué esta etapa existe

`limpiar_factor()` promete en su docstring aceptar punto como separador decimal:

```
Ej: '3,0561' → 3.0561 | '3.0561' → 3.0561 | '3' → 3.0
```

Pero su implementación (`formatters.py:33`) hace
`.replace(".", "").replace(",", ".")`, que borra el punto antes de interpretarlo:

| Entrada | Resultado actual | Correcto |
|---|---|---|
| `'3,0561'` | `3.0561` | `3.0561` |
| `'3.0561'` | **`30561.0`** | `3.0561` |
| `'3.5'` | **`35.0`** | `3.5` |

El formateador del cliente (`app.js:15`) hace `replace(/[^0-9,]/g, '')`, que borra
el punto mientras el usuario escribe: teclear `3.5` deja el campo en `35`. Y
`routes/pagos.py:44` solo valida `> 0`, que `35.0` cumple.

Consecuencia: una cuota pactada diez veces mayor, que marca todos los pagos como
deuda. En la app Android que viene esto se vuelve el camino más probable, porque
los teclados decimales de celular suelen ofrecer punto y no coma.

`formatters.py` no tiene ninguna prueba hoy. Esa es la razón de que el bug haya
sobrevivido a 91 tests.

---

## Regla de normalización

**El último separador presente (punto o coma) es el decimal. Cualquier separador
anterior es de miles y se descarta.**

| Entrada | Salida | Por qué |
|---|---|---|
| `'3,0561'` | `3.0561` | única coma → decimal |
| `'3.0561'` | `3.0561` | único punto → decimal |
| `'3'` | `3.0` | sin separador |
| `'1.234,56'` | `1234.56` | coma es la última → decimal; punto es de miles |
| `'1,234.56'` | `1234.56` | punto es el último → decimal; coma es de miles |
| `'3,'` | `3.0` | separador final sin decimales |
| `'.5'` | `0.5` | sin parte entera |

Un factor UTM es un número pequeño (unidades de UTM). Que `'1.234'` se
interprete como `1.234` y no como `1234` es deliberado: un factor de 1234 UTM no
existe en la realidad, uno de 1,234 sí.

---

## Task 1: Corregir `limpiar_factor` con su suite de tests

**Files:**
- Create: `tests/test_formatters.py`
- Modify: `src/pensiontracker/formatters.py:25-34`

**Interfaces:**
- Consumes: nada.
- Produces: `limpiar_factor(valor: str) -> float` con la regla de normalización
  de arriba. `routes/pagos.py:43` y `routes/utm.py` ya la consumen y no cambian.

- [ ] **Step 1: Escribir los tests que fallan**

Crear `tests/test_formatters.py`:

```python
"""
test_formatters.py
------------------
Cobertura de formatters.py, con foco en el separador decimal del factor
UTM: en los teclados de celular el punto suele ser lo único disponible,
así que aceptarlo no es una comodidad sino un requisito.
"""

import pytest

from pensiontracker.formatters import fmt_factor, limpiar_entero, limpiar_factor


# ----------------------------------------------------------------
# limpiar_factor
# ----------------------------------------------------------------

@pytest.mark.parametrize("entrada,esperado", [
    ("3,0561", 3.0561),
    ("3.0561", 3.0561),
    ("3,5",    3.5),
    ("3.5",    3.5),
    ("3",      3.0),
    ("0,5",    0.5),
    (".5",     0.5),
    ("3,",     3.0),
    ("  3,5 ", 3.5),
])
def test_limpiar_factor_acepta_punto_y_coma(entrada, esperado):
    assert limpiar_factor(entrada) == pytest.approx(esperado)


@pytest.mark.parametrize("entrada,esperado", [
    ("1.234,56", 1234.56),
    ("1,234.56", 1234.56),
])
def test_limpiar_factor_ultimo_separador_es_el_decimal(entrada, esperado):
    """Con ambos separadores presentes, el último manda y el otro es de miles."""
    assert limpiar_factor(entrada) == pytest.approx(esperado)


@pytest.mark.parametrize("entrada", ["", "   ", "abc", "3,,5x"])
def test_limpiar_factor_rechaza_entradas_invalidas(entrada):
    with pytest.raises(ValueError):
        limpiar_factor(entrada)


# ----------------------------------------------------------------
# limpiar_entero
# ----------------------------------------------------------------

@pytest.mark.parametrize("entrada,esperado", [
    ("69.889",  69889),
    ("213.588", 213588),
    ("1000",    1000),
    (" 200.000 ", 200000),
])
def test_limpiar_entero_quita_separador_de_miles(entrada, esperado):
    assert limpiar_entero(entrada) == esperado


@pytest.mark.parametrize("entrada", ["", "1,5", "abc"])
def test_limpiar_entero_rechaza_entradas_invalidas(entrada):
    with pytest.raises(ValueError):
        limpiar_entero(entrada)


# ----------------------------------------------------------------
# fmt_factor
# ----------------------------------------------------------------

@pytest.mark.parametrize("entrada,esperado", [
    (3.0561, "3,0561"),
    (3.0,    "3"),
    (3.5,    "3,5"),
    (None,   ""),
])
def test_fmt_factor_usa_coma_y_no_deja_ceros_de_mas(entrada, esperado):
    assert fmt_factor(entrada) == esperado


@pytest.mark.parametrize("texto", ["3,0561", "3.0561", "3,5", "3"])
def test_factor_sobrevive_ida_y_vuelta(texto):
    """fmt_factor(limpiar_factor(x)) debe poder volver a leerse igual."""
    valor = limpiar_factor(texto)
    assert limpiar_factor(fmt_factor(valor)) == pytest.approx(valor)
```

- [ ] **Step 2: Ver fallar los tests**

Ejecutar: `uv run pytest tests/test_formatters.py -v`

Esperado: fallan al menos `test_limpiar_factor_acepta_punto_y_coma[3.0561-...]`,
`[3.5-3.5]` y `[.5-0.5]`, con valores `30561.0`, `35.0` y un `ValueError`
respectivamente. También falla `test_limpiar_factor_ultimo_separador_es_el_decimal`.
Los tests de `limpiar_entero` y `fmt_factor` deberían pasar ya (documentan el
comportamiento actual, que es correcto).

Si algún test de `limpiar_factor` pasa antes del arreglo, revisar que el test
esté midiendo lo que dice.

- [ ] **Step 3: Implementar el arreglo**

Reemplazar `limpiar_factor` en `src/pensiontracker/formatters.py`:

```python
def limpiar_factor(valor: str) -> float:
    """
    Convierte texto de factor UTM a float.

    Acepta punto o coma como separador decimal: en los teclados decimales
    de celular el punto suele ser lo único disponible, así que rechazarlo
    convertiría '3.5' en 35 y decuplicaría la cuota pactada.

    Regla: el último separador presente es el decimal; los anteriores son
    separadores de miles y se descartan.

    Ej: '3,0561' → 3.0561 | '3.0561' → 3.0561 | '1.234,56' → 1234.56
    """
    if not valor:
        raise ValueError("Valor vacío")

    limpio = valor.strip()
    if not limpio:
        raise ValueError("Valor vacío")

    corte = max(limpio.rfind("."), limpio.rfind(","))
    if corte == -1:
        entero, decimales = limpio, ""
    else:
        entero, decimales = limpio[:corte], limpio[corte + 1:]

    entero = entero.replace(".", "").replace(",", "")
    normalizado = f"{entero}.{decimales}" if decimales else entero

    try:
        return float(normalizado)
    except ValueError:
        raise ValueError(f"Factor UTM inválido: {valor!r}")
```

- [ ] **Step 4: Ver pasar los tests**

Ejecutar: `uv run pytest tests/test_formatters.py -v`
Esperado: todos PASS.

Ejecutar: `uv run pytest -q`
Esperado: la suite completa en verde, sin advertencias nuevas. Antes de esta
tarea eran 91 tests; ahora deben ser 91 + los nuevos.

- [ ] **Step 5: Commit**

```bash
git add tests/test_formatters.py src/pensiontracker/formatters.py
git commit -m "Fix: el factor UTM aceptaba solo coma como separador decimal

limpiar_factor() prometía en su docstring aceptar punto, pero lo borraba
antes de interpretarlo: '3.5' devolvía 35.0 y la cuota pactada salía diez
veces mayor, marcando todos los pagos como deuda.

Nueva regla: el último separador presente es el decimal, los anteriores
son de miles. Se agrega tests/test_formatters.py, que no existía — por eso
el bug sobrevivió a 91 tests."
```

---

## Task 2: Que la interfaz deje de borrar el punto

**Files:**
- Modify: `src/pensiontracker/static/app.js:14-25`

**Interfaces:**
- Consumes: `limpiar_factor` corregido en Task 1 (el backend ya tolera ambos
  separadores, así que este cambio no puede romper el envío).
- Produces: `formatearFactor(input)` normaliza a coma para mostrar, aceptando
  que el usuario teclee punto.

- [ ] **Step 1: Reemplazar `formatearFactor`**

En `src/pensiontracker/static/app.js`, reemplazar la función completa:

```javascript
function formatearFactor(input) {
    // Se acepta punto además de coma: en los teclados decimales de celular
    // el punto suele ser lo único disponible. Se normaliza a coma, que es
    // el separador decimal chileno y lo que el usuario espera ver.
    let val = input.value.replace(/[^0-9.,]/g, '').replace(/\./g, ',');

    const partes = val.split(',');
    if (partes.length > 2) {
        // Varios separadores: el último manda, los anteriores eran de miles.
        val = partes.slice(0, -1).join('') + ',' + partes[partes.length - 1];
    }

    const [entero, decimales] = val.split(',');
    if (decimales !== undefined && decimales.length > 4) {
        val = entero + ',' + decimales.slice(0, 4);
    }

    input.value = val;
    calcularPreview();
}
```

- [ ] **Step 2: Verificar a mano en el navegador**

No hay runner de JavaScript en el proyecto todavía — llega en la Etapa 1 junto
con `vitest`, y ahí esta función se cubre con tests automáticos. Mientras tanto,
verificación manual explícita.

Levantar la app contra una BD temporal, para no tocar datos reales:

```bash
XDG_DATA_HOME=/tmp/pt-verif PT_PORT=8140 uv run pensiontracker --browser
```

Abrir `http://127.0.0.1:8140/registro` y comprobar en el campo **Factor UTM
pactado**:

| Se teclea | El campo debe mostrar | La cuota pactada debe |
|---|---|---|
| `3.5` | `3,5` | usar factor 3,5 |
| `3,5` | `3,5` | usar factor 3,5 |
| `3.0561` | `3,0561` | usar factor 3,0561 |
| `3.05619` | `3,0561` | truncar a 4 decimales |
| `3a.5b` | `3,5` | ignorar letras |

Detener el servidor y limpiar: `rm -rf /tmp/pt-verif`

- [ ] **Step 3: Confirmar que el envío sigue funcionando**

Ejecutar: `uv run pytest tests/test_routes.py -q`
Esperado: PASS. `limpiarFormateoAntesDeEnviar` (`app.js:247`) deja el factor con
coma a propósito, y el backend corregido acepta ambos separadores, así que no
hay cambio que hacer ahí.

- [ ] **Step 4: Commit**

```bash
git add src/pensiontracker/static/app.js
git commit -m "Fix: el campo de factor UTM borraba el punto mientras se escribía

formatearFactor() filtraba con /[^0-9,]/g, así que teclear '3.5' dejaba el
campo en '35'. Ahora acepta punto y lo normaliza a coma para mostrar.
Cobertura automática de esta función llega en la Etapa 1 con vitest."
```

---

## Task 3: Publicar el arreglo como v1.0.2

**Files:**
- Modify: `pyproject.toml:3`
- Modify: `packaging/pensiontracker.spec:86`
- Modify: `uv.lock` (regenerado)
- Modify: `README.md` (conteo de tests)

- [ ] **Step 1: Subir la versión**

```bash
sed -i 's/^version = "1.0.1"$/version = "1.0.2"/' pyproject.toml
sed -i 's/"CFBundleShortVersionString": "1.0.1"/"CFBundleShortVersionString": "1.0.2"/' packaging/pensiontracker.spec
uv lock
```

- [ ] **Step 2: Actualizar el conteo de tests del README**

En `README.md`, la línea de la sección Tests dice `91 tests, aislados por
completo...`. Reemplazar `91` por el número que reporte `uv run pytest -q`.

- [ ] **Step 3: Verificar todo junto**

Ejecutar: `uv run pytest -q`
Esperado: todo verde.

Ejecutar: `grep -n '^version' pyproject.toml && grep -n CFBundleShortVersionString packaging/pensiontracker.spec`
Esperado: ambos en `1.0.2`.

- [ ] **Step 4: Commit y tag**

```bash
git add pyproject.toml packaging/pensiontracker.spec uv.lock README.md
git commit -m "Versión 1.0.2: arreglo del separador decimal del factor UTM"
git tag -a v1.0.2 -m "Pensión Tracker v1.0.2 — el factor UTM acepta punto y coma"
git push origin main
git push origin v1.0.2
```

- [ ] **Step 5: Verificar el release**

El tag dispara `.github/workflows/build.yml`. Confirmar que los cuatro jobs
terminan en `success` y que el release v1.0.2 queda con los tres binarios.

Descargar el AppImage publicado y comprobar el arreglo end-to-end, con
directorio de datos aislado:

```bash
curl -sL -o /tmp/PT.AppImage https://github.com/pataguadark/pension_tracker/releases/download/v1.0.2/PensionTracker-x86_64.AppImage
chmod +x /tmp/PT.AppImage
XDG_DATA_HOME=/tmp/pt-rel PT_PORT=8141 /tmp/PT.AppImage --browser
```

Abrir `http://127.0.0.1:8141/registro`, teclear `3.5` en el factor y confirmar
que el campo muestra `3,5`. Limpiar: `rm -rf /tmp/pt-rel /tmp/PT.AppImage`

---

## Verificación de cierre de la etapa

1. `uv run pytest` en verde, con `tests/test_formatters.py` incluido.
2. `limpiar_factor('3.5') == 3.5` y `limpiar_factor('3,5') == 3.5`.
3. En el binario publicado, teclear `3.5` deja el campo en `3,5`.
4. Release v1.0.2 disponible con los tres binarios.

---

## Etapas siguientes (planes aparte)

Esta etapa desbloquea el resto: recién con la aritmética correcta tiene sentido
congelarla en fixtures.

- **Etapa 1 — Core TypeScript + fixtures doradas.** Portar cálculos y formateo a
  TS, y crear `shared/fixtures/` que `pytest` y `vitest` verifiquen en paralelo.
  Aquí entra `vitest` al proyecto y `formatearFactor` recibe cobertura automática.
- **Etapa 2 — App Svelte + Capacitor.** Interfaz sobre `style.css`, repositorio
  SQLite, cliente UTM.
- **Etapa 3 — Importar y restaurar respaldos** en escritorio y móvil.
- **Etapa 4 — Distribución.** Firma del APK, GitHub Releases y envío a F-Droid.
