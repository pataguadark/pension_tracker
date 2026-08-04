# Etapa 2b — Cliente UTM del móvil

> **Para agentes:** SUB-SKILL REQUERIDA: usar superpowers:subagent-driven-development
> (recomendado) o superpowers:executing-plans para implementar tarea por tarea.
> Los pasos usan casillas (`- [ ]`) para seguimiento.

**Goal:** Portar a TypeScript la obtención del valor de la UTM desde
mindicador.cl, con caché en la base local y degradación cuando no hay red, de
modo que el móvil calcule las mismas cuotas que el escritorio.

**Architecture:** El servicio no habla con Capacitor ni con `fetch` directamente:
habla con una interfaz `ClienteHttp` de un solo método, igual que la capa de
datos habla con `EjecutorSql`. En producción la implementa `fetch` —que Capacitor
parchea para que vaya por la capa nativa y evite CORS—; en las pruebas la
implementan respuestas preparadas, sin tocar la red.

**Tech Stack:** TypeScript, vitest, `fetch` de Node 22, Python 3.12 + pytest para
las fixtures compartidas.

## Global Constraints

- Cero datos personales: valores sintéticos. Los valores UTM son un índice
  económico público, no un dato personal.
- Nombres, comentarios y docstrings en **español**; `camelCase` en TypeScript
  conservando los nombres en español.
- **Ninguna prueba puede tocar la red.** Todo lo que salga a internet va detrás
  de `ClienteHttp` y en los tests se reemplaza por respuestas preparadas. Una
  suite que dependa de mindicador.cl sería lenta, intermitente y fallaría sin
  conexión.
- `mobile/src/core/` sigue sin importar nada de `data/` ni de `utm/`.
- Verde en `uv run pytest -q`, `npm test --prefix mobile` y
  `npm run typecheck --prefix mobile`.

---

## Contexto

La app calcula `cuota_pactada = utm_factor × utm_valor`, así que sin el valor de
la UTM del mes no puede calcular nada. El escritorio resuelve esto en
`src/pensiontracker/services/utm_service.py`, y el móvil necesita lo mismo:
consultar mindicador.cl, cachear en la base local, y seguir funcionando cuando
no hay señal.

Hay **dos trampas** que este port debe esquivar, ambas verificadas.

### Trampa 1: las fechas de mindicador.cl y el huso horario

Una respuesta real de `GET https://mindicador.cl/api/utm/2025` trae:

```json
{
  "version": "...", "autor": "...", "codigo": "utm",
  "nombre": "...", "unidad_medida": "...",
  "serie": [
    { "fecha": "2025-12-01T03:00:00.000Z", "valor": 69542 },
    { "fecha": "2025-06-01T04:00:00.000Z", "valor": 68785 }
  ]
}
```

Cada fecha es la medianoche chilena expresada en UTC, y el desfase cambia con el
horario de verano (`03:00` en verano, `04:00` en invierno).

El escritorio extrae el año y el mes **cortando el string**
(`fecha[0:4]` y `fecha[5:7]`), así que el huso no lo afecta. Si el TypeScript
usara `new Date(fecha).getMonth()`, el resultado dependería del huso del
teléfono. Medido:

| Huso del dispositivo | `new Date("2025-12-01T03:00:00.000Z").getMonth()+1` |
|---|---|
| America/Santiago | 12 ✓ |
| UTC | 12 ✓ |
| Asia/Tokyo | 12 ✓ |
| **America/New_York** | **11 ✗** |

Un chileno viviendo en el extranjero, o un teléfono con el huso mal configurado,
asignaría la UTM de diciembre a noviembre — y con ella, la cuota equivocada.
**El TypeScript debe cortar el string, nunca construir un `Date`.**

### Trampa 2: valores no finitos

Ya conocida de etapas anteriores, y el escritorio ya la maneja: un `valor` que la
API devuelva fuera del rango de un double decodifica a infinito y **no debe
persistirse**. Rige el mismo principio de siempre: validar duro al escribir,
tolerar al leer.

### Sobre `fetch` y CORS

La documentación de Capacitor indica que habilitar el plugin `CapacitorHttp`
parchea `fetch` y `XMLHttpRequest` para que usen las bibliotecas HTTP nativas,
**evitando por completo las restricciones de CORS del WebView**, y lo señala como
el enfoque recomendado en producción. Por eso el cliente de producción usa
`fetch` plano: no hace falta llamar a `CapacitorHttp.get` explícitamente, y así
el mismo código corre en Node durante las pruebas.

La configuración que habilita ese plugin se agrega en la Etapa 2c, junto con el
resto del andamiaje de Capacitor. **Anótalo como pendiente ahí**: sin esa
configuración, el `fetch` del WebView chocaría con CORS.

---

## Estructura de archivos

```
mobile/src/utm/
├── cliente-http.ts       # la interfaz, el error tipado y el cliente sobre fetch
├── serie.ts              # parseo de la respuesta de mindicador.cl
├── servicio-utm.ts       # la lógica: red, caché, degradación
└── *.test.ts

shared/fixtures/
└── serie-utm.json        # casos de parseo verificados en ambos lenguajes
```

---

## Task 1: Cliente HTTP

**Files:**
- Create: `mobile/src/utm/cliente-http.ts`, `mobile/src/utm/cliente-http.test.ts`

**Interfaces:**
- Produces:
  - `class ErrorDeRed extends Error` con `motivo: 'timeout' | 'conexion' | 'http' | 'respuesta_invalida'`
  - `interface ClienteHttp { obtenerJson(url: string): Promise<unknown> }`
  - `class ClienteHttpFetch implements ClienteHttp` con constructor
    `(timeoutMs?: number, fetchImpl?: typeof fetch)`
  - `const TIMEOUT_MS = 10000`, `const CABECERAS`

El escritorio usa `TIMEOUT = 10` segundos y las cabeceras
`User-Agent: pension-tracker/1.0 (personal)` y `Accept: application/json`
(`utm_service.py:38-43`). Se replican.

`fetchImpl` inyectable existe para las pruebas: permiten ejercitar el timeout y
los errores sin red. **No uses `vi.stubGlobal`**: inyectar es más explícito y no
deja estado global entre tests.

- [ ] **Step 1: Escribir los tests que fallan**

`mobile/src/utm/cliente-http.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { ClienteHttpFetch, ErrorDeRed } from './cliente-http';

/** fetch falso que responde lo que se le indique. */
function fetchQueResponde(cuerpo: unknown, status = 200, tipo = 'application/json'): typeof fetch {
  return (async () =>
    new Response(typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo), {
      status,
      headers: { 'content-type': tipo },
    })) as unknown as typeof fetch;
}

describe('ClienteHttpFetch', () => {
  it('devuelve el JSON cuando la respuesta es correcta', async () => {
    const cliente = new ClienteHttpFetch(1000, fetchQueResponde({ serie: [{ valor: 69542 }] }));
    expect(await cliente.obtenerJson('https://ejemplo.cl/api')).toEqual({
      serie: [{ valor: 69542 }],
    });
  });

  it('envía las cabeceras que el escritorio usa', async () => {
    let vistas: Record<string, string> = {};
    const espia = (async (_url: string, init?: RequestInit) => {
      vistas = init?.headers as Record<string, string>;
      return new Response('{}', { headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;
    await new ClienteHttpFetch(1000, espia).obtenerJson('https://ejemplo.cl/api');
    expect(vistas['Accept']).toBe('application/json');
    expect(vistas['User-Agent']).toContain('pension-tracker');
  });

  it('lanza ErrorDeRed con motivo http cuando el estado no es exitoso', async () => {
    const cliente = new ClienteHttpFetch(1000, fetchQueResponde({}, 503));
    await expect(cliente.obtenerJson('https://ejemplo.cl/api')).rejects.toMatchObject({
      motivo: 'http',
    });
  });

  it('el mensaje del error http incluye el código', async () => {
    const cliente = new ClienteHttpFetch(1000, fetchQueResponde({}, 503));
    await expect(cliente.obtenerJson('https://ejemplo.cl/api')).rejects.toThrow(/503/);
  });

  it('lanza ErrorDeRed con motivo respuesta_invalida si el cuerpo no es JSON', async () => {
    const cliente = new ClienteHttpFetch(1000, fetchQueResponde('<html>error</html>', 200, 'text/html'));
    await expect(cliente.obtenerJson('https://ejemplo.cl/api')).rejects.toMatchObject({
      motivo: 'respuesta_invalida',
    });
  });

  it('lanza ErrorDeRed con motivo timeout si la respuesta tarda demasiado', async () => {
    const lento = ((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(Object.assign(new Error('abortado'), { name: 'AbortError' }));
        });
      })) as unknown as typeof fetch;
    const cliente = new ClienteHttpFetch(20, lento);
    await expect(cliente.obtenerJson('https://ejemplo.cl/api')).rejects.toMatchObject({
      motivo: 'timeout',
    });
  });

  it('lanza ErrorDeRed con motivo conexion si fetch falla', async () => {
    const caido = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    await expect(
      new ClienteHttpFetch(1000, caido).obtenerJson('https://ejemplo.cl/api'),
    ).rejects.toMatchObject({ motivo: 'conexion' });
  });

  it('ErrorDeRed es instancia de Error y conserva su nombre', async () => {
    const cliente = new ClienteHttpFetch(1000, fetchQueResponde({}, 500));
    await expect(cliente.obtenerJson('https://ejemplo.cl/api')).rejects.toBeInstanceOf(ErrorDeRed);
  });

  it('no deja el temporizador vivo tras una respuesta correcta', async () => {
    // Si el timeout no se cancela, vitest se queda esperando al cerrar.
    const cliente = new ClienteHttpFetch(60_000, fetchQueResponde({ ok: true }));
    await cliente.obtenerJson('https://ejemplo.cl/api');
    expect(true).toBe(true);
  });
});
```

- [ ] **Step 2: Ver fallar los tests**

Ejecutar: `npm test --prefix mobile`
Esperado: FAIL, no existe `./cliente-http`.

- [ ] **Step 3: Implementar**

`mobile/src/utm/cliente-http.ts`:

```typescript
/**
 * La frontera entre el servicio de UTM y la red.
 *
 * El servicio no conoce Capacitor ni fetch: habla con esta interfaz, igual
 * que el repositorio habla con EjecutorSql. En las pruebas se reemplaza por
 * respuestas preparadas, así ninguna suite depende de que mindicador.cl
 * esté disponible.
 *
 * En producción se usa `fetch` plano y no `CapacitorHttp.get`: habilitando
 * el plugin CapacitorHttp, Capacitor parchea fetch para que use las
 * bibliotecas HTTP nativas, evitando las restricciones de CORS del WebView.
 * Esa configuración se agrega junto con el andamiaje de Capacitor.
 */

export type MotivoDeError = 'timeout' | 'conexion' | 'http' | 'respuesta_invalida';

/** Falla al obtener datos de la red. Equivale al ScraperError del escritorio. */
export class ErrorDeRed extends Error {
  constructor(mensaje: string, readonly motivo: MotivoDeError) {
    super(mensaje);
    this.name = 'ErrorDeRed';
  }
}

export interface ClienteHttp {
  /** GET que devuelve el JSON, o lanza ErrorDeRed con el motivo. */
  obtenerJson(url: string): Promise<unknown>;
}

/** Igual que el escritorio (utm_service.py:43). */
export const TIMEOUT_MS = 10_000;

/** Igual que el escritorio (utm_service.py:38-41). */
export const CABECERAS: Record<string, string> = {
  'User-Agent': 'pension-tracker/1.0 (personal)',
  Accept: 'application/json',
};

export class ClienteHttpFetch implements ClienteHttp {
  constructor(
    private readonly timeoutMs: number = TIMEOUT_MS,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async obtenerJson(url: string): Promise<unknown> {
    const controlador = new AbortController();
    const temporizador = setTimeout(() => controlador.abort(), this.timeoutMs);

    let respuesta: Response;
    try {
      respuesta = await this.fetchImpl(url, {
        headers: CABECERAS,
        signal: controlador.signal,
      });
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') {
        throw new ErrorDeRed(
          `mindicador.cl tardó más de ${this.timeoutMs / 1000}s en responder (${url}).`,
          'timeout',
        );
      }
      throw new ErrorDeRed(
        'No se pudo conectar a mindicador.cl. Verifica tu conexión a internet.',
        'conexion',
      );
    } finally {
      // Sin esto el temporizador queda vivo y demora el cierre del proceso.
      clearTimeout(temporizador);
    }

    if (!respuesta.ok) {
      throw new ErrorDeRed(
        `mindicador.cl devolvió un error HTTP: ${respuesta.status} para ${url}`,
        'http',
      );
    }

    try {
      return await respuesta.json();
    } catch {
      throw new ErrorDeRed(
        `mindicador.cl devolvió una respuesta no válida (${url}).`,
        'respuesta_invalida',
      );
    }
  }
}
```

- [ ] **Step 4: Ver pasar los tests**

Ejecutar: `npm test --prefix mobile` y `npm run typecheck --prefix mobile`.

Comprobar además que **la suite no toca la red**: desconecta la red o ejecuta con
`--reporter=verbose` y confirma que ningún test tarda cerca de los 10 segundos
del timeout real. Si alguno lo hiciera, está usando `fetch` de verdad.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/utm/
git commit -m "Etapa 2b: cliente HTTP con timeout y errores tipados

El servicio de UTM hablará con una interfaz de un método en vez de con
fetch, igual que el repositorio habla con EjecutorSql, para que las
pruebas no dependan de que mindicador.cl esté disponible."
```

---

## Task 2: Parseo de la serie, con fixtures compartidas

**Files:**
- Create: `mobile/src/utm/serie.ts`, `shared/fixtures/serie-utm.json`
- Modify: `mobile/src/core/fixtures.test.ts`, `tests/test_fixtures_doradas.py`

**Interfaces:**
- Produces:
  - `interface ItemSerie { fecha?: unknown; valor?: unknown }`
  - `extraerValoresDelAnio(respuesta: unknown, anio: number): Map<number, number>`
  - `buscarMesEnSerie(serie: unknown, anio: number, mes: number): number | null`

Estas dos funciones son **puras**: reciben el JSON ya decodificado y devuelven
números. Por eso pueden verificarse con fixtures doradas contra el Python, igual
que la aritmética. El parseo de la respuesta de un tercero es justamente donde dos
implementaciones se desvían sin que nadie lo note.

**Recuerda la trampa del huso horario:** corta el string, no construyas un
`Date`. Un caso de fixture lo fija.

- [ ] **Step 1: Crear la fixture**

`shared/fixtures/serie-utm.json`:

```json
{
  "descripcion": "Parseo de la respuesta de mindicador.cl. Las fechas son la medianoche chilena expresada en UTC, con desfase variable por horario de verano; deben leerse cortando el string y nunca construyendo un Date, porque el mes resultante dependería del huso del dispositivo.",
  "extraerValoresDelAnio": [
    {
      "nombre": "serie normal de tres meses",
      "entrada": {
        "anio": 2025,
        "respuesta": { "serie": [
          { "fecha": "2025-03-01T03:00:00.000Z", "valor": 68034 },
          { "fecha": "2025-02-01T03:00:00.000Z", "valor": 67429 },
          { "fecha": "2025-01-01T03:00:00.000Z", "valor": 67294 }
        ] }
      },
      "esperado": { "1": 67294, "2": 67429, "3": 68034 }
    },
    {
      "nombre": "diciembre con desfase de verano no se corre a noviembre",
      "entrada": {
        "anio": 2025,
        "respuesta": { "serie": [{ "fecha": "2025-12-01T03:00:00.000Z", "valor": 69542 }] }
      },
      "esperado": { "12": 69542 }
    },
    {
      "nombre": "junio con desfase de invierno",
      "entrada": {
        "anio": 2025,
        "respuesta": { "serie": [{ "fecha": "2025-06-01T04:00:00.000Z", "valor": 68785 }] }
      },
      "esperado": { "6": 68785 }
    },
    {
      "nombre": "descarta los meses de otro anio",
      "entrada": {
        "anio": 2025,
        "respuesta": { "serie": [
          { "fecha": "2025-01-01T03:00:00.000Z", "valor": 67294 },
          { "fecha": "2024-12-01T03:00:00.000Z", "valor": 66500 }
        ] }
      },
      "esperado": { "1": 67294 }
    },
    {
      "nombre": "descarta valores nulos",
      "entrada": {
        "anio": 2025,
        "respuesta": { "serie": [
          { "fecha": "2025-01-01T03:00:00.000Z", "valor": 67294 },
          { "fecha": "2025-02-01T03:00:00.000Z", "valor": null }
        ] }
      },
      "esperado": { "1": 67294 }
    },
    {
      "nombre": "descarta fechas malformadas",
      "entrada": {
        "anio": 2025,
        "respuesta": { "serie": [
          { "fecha": "2025-01-01T03:00:00.000Z", "valor": 67294 },
          { "fecha": "no-es-fecha", "valor": 99999 },
          { "fecha": "", "valor": 88888 }
        ] }
      },
      "esperado": { "1": 67294 }
    },
    {
      "nombre": "sin clave serie devuelve vacio",
      "entrada": { "anio": 2025, "respuesta": { "version": "1.7.0" } },
      "esperado": {}
    },
    {
      "nombre": "serie vacia devuelve vacio",
      "entrada": { "anio": 2025, "respuesta": { "serie": [] } },
      "esperado": {}
    }
  ],
  "buscarMesEnSerie": [
    {
      "nombre": "encuentra el mes pedido",
      "entrada": { "anio": 2025, "mes": 2, "serie": [
        { "fecha": "2025-01-01T03:00:00.000Z", "valor": 67294 },
        { "fecha": "2025-02-01T03:00:00.000Z", "valor": 67429 }
      ] },
      "esperado": 67429
    },
    {
      "nombre": "devuelve nulo si el mes no esta",
      "entrada": { "anio": 2025, "mes": 7, "serie": [
        { "fecha": "2025-01-01T03:00:00.000Z", "valor": 67294 }
      ] },
      "esperado": null
    },
    {
      "nombre": "devuelve nulo con serie vacia",
      "entrada": { "anio": 2025, "mes": 1, "serie": [] },
      "esperado": null
    }
  ]
}
```

**Antes de darla por buena, verifica cada valor contra el Python**, que es la
referencia:

```bash
uv run python -c "
import json
from pensiontracker.services import utm_service as u
casos = json.load(open('shared/fixtures/serie-utm.json'))
for c in casos['extraerValoresDelAnio']:
    e = c['entrada']
    print(c['nombre'], '->', {str(k): v for k, v in
        u._extraer_valores_del_anio(e['respuesta'], e['anio']).items()})
"
```

Ese ayudante `_extraer_valores_del_anio` **no existe todavía** en el Python: hoy
la lógica está incrustada dentro de `obtener_utm_anio`, que además hace la
petición de red. El Step 2 lo extrae.

- [ ] **Step 2: Extraer la función pura en el Python**

En `src/pensiontracker/services/utm_service.py`, saca el bucle que recorre la
serie de dentro de `obtener_utm_anio` a una función `_extraer_valores_del_anio(respuesta: dict, anio: int) -> dict`,
y haz que `obtener_utm_anio` la llame tras obtener el JSON. **El comportamiento no
debe cambiar**: es solo separar la parte pura de la parte con red, para poder
alimentarla con las fixtures.

Es el mismo patrón que ya se aplicó a `obtener_historial_desbalances` y a
`resumir_estado_cuenta` en etapas anteriores.

Ejecutar: `uv run pytest -q`
Esperado: verde, sin tocar ningún llamador.

- [ ] **Step 3: Escribir los tests de fixtures y verlos fallar**

Agregar a `tests/test_fixtures_doradas.py`:

```python
from pensiontracker.services.utm_service import (
    _buscar_mes_en_serie,
    _extraer_valores_del_anio,
)


@pytest.mark.parametrize("nombre,entrada,esperado",
                         casos("serie-utm.json", "extraerValoresDelAnio"))
def test_extraer_valores_del_anio_contra_fixtures(nombre, entrada, esperado):
    obtenido = _extraer_valores_del_anio(entrada["respuesta"], entrada["anio"])
    # Las claves del JSON son cadenas; las del Python, enteros.
    assert {str(k): v for k, v in obtenido.items()} == esperado


@pytest.mark.parametrize("nombre,entrada,esperado",
                         casos("serie-utm.json", "buscarMesEnSerie"))
def test_buscar_mes_en_serie_contra_fixtures(nombre, entrada, esperado):
    obtenido = _buscar_mes_en_serie(entrada["serie"], entrada["anio"], entrada["mes"])
    if esperado is None:
        assert obtenido is None
    else:
        assert obtenido == pytest.approx(esperado, abs=TOLERANCIA_ABSOLUTA_PARIDAD_TS)
```

Agregar a `mobile/src/core/fixtures.test.ts`:

```typescript
import { buscarMesEnSerie, extraerValoresDelAnio } from '../utm/serie';

const serieUtm = cargar('serie-utm.json');

describe('extraerValoresDelAnio contra fixtures', () => {
  it.each(obtenerCasos(serieUtm, 'extraerValoresDelAnio'))('$nombre', ({ entrada, esperado }) => {
    const { respuesta, anio } = entrada as { respuesta: unknown; anio: number };
    const obtenido = extraerValoresDelAnio(respuesta, anio);
    const comoObjeto = Object.fromEntries([...obtenido].map(([m, v]) => [String(m), v]));
    expect(comoObjeto).toEqual(esperado);
  });
});

describe('buscarMesEnSerie contra fixtures', () => {
  it.each(obtenerCasos(serieUtm, 'buscarMesEnSerie'))('$nombre', ({ entrada, esperado }) => {
    const { serie, anio, mes } = entrada as { serie: unknown; anio: number; mes: number };
    const obtenido = buscarMesEnSerie(serie, anio, mes);
    if (esperado === null) {
      expect(obtenido).toBeNull();
    } else {
      expect(obtenido).toBeCloseTo(esperado as number, 10);
    }
  });
});
```

Usa el ayudante `obtenerCasos` y la constante de tolerancia que el archivo ya
define; no introduzcas convenciones nuevas.

- [ ] **Step 4: Implementar el TypeScript**

`mobile/src/utm/serie.ts`:

```typescript
/**
 * Parseo de la respuesta de mindicador.cl.
 *
 * Funciones puras: reciben el JSON ya decodificado. Se verifican contra la
 * implementación Python con las fixtures de shared/fixtures/serie-utm.json.
 *
 * **El año y el mes se sacan cortando el string, nunca con un Date.** Las
 * fechas vienen como la medianoche chilena expresada en UTC
 * ("2025-12-01T03:00:00.000Z"), con desfase variable por horario de verano.
 * `new Date(...).getMonth()` devolvería el mes según el huso del dispositivo:
 * en America/New_York esa fecha da noviembre, no diciembre. Un usuario fuera
 * de Chile terminaría con la UTM del mes equivocado, y con ella una cuota
 * equivocada.
 */

/** Año y mes de una fecha ISO, leídos del texto. Null si no es interpretable. */
function anioYMesDe(fecha: unknown): { anio: number; mes: number } | null {
  if (typeof fecha !== 'string' || fecha.length < 7) return null;
  const anio = Number(fecha.slice(0, 4));
  const mes = Number(fecha.slice(5, 7));
  if (!Number.isInteger(anio) || !Number.isInteger(mes)) return null;
  if (mes < 1 || mes > 12) return null;
  return { anio, mes };
}

/** Valor numérico y finito de un item, o null si no lo es. */
function valorFinito(valor: unknown): number | null {
  if (valor === null || valor === undefined) return null;
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
}

function serieDe(respuesta: unknown): unknown[] {
  if (typeof respuesta !== 'object' || respuesta === null) return [];
  const serie = (respuesta as { serie?: unknown }).serie;
  return Array.isArray(serie) ? serie : [];
}

/**
 * Valores publicados de un año, como {mes: valor}. Solo incluye los meses
 * presentes en la serie: los futuros o no publicados no aparecen.
 *
 * Descarta valores no finitos en vez de persistirlos: validar duro al
 * escribir. Ese mes queda como si no se hubiera publicado.
 */
export function extraerValoresDelAnio(respuesta: unknown, anio: number): Map<number, number> {
  const valores = new Map<number, number>();
  for (const item of serieDe(respuesta)) {
    if (typeof item !== 'object' || item === null) continue;
    const fecha = anioYMesDe((item as { fecha?: unknown }).fecha);
    if (fecha === null || fecha.anio !== anio) continue;
    const valor = valorFinito((item as { valor?: unknown }).valor);
    if (valor !== null) valores.set(fecha.mes, valor);
  }
  return valores;
}

/** Valor de un mes concreto dentro de una serie, o null si no está. */
export function buscarMesEnSerie(serie: unknown, anio: number, mes: number): number | null {
  const items = Array.isArray(serie) ? serie : [];
  for (const item of items) {
    if (typeof item !== 'object' || item === null) continue;
    const fecha = anioYMesDe((item as { fecha?: unknown }).fecha);
    if (fecha === null || fecha.anio !== anio || fecha.mes !== mes) continue;
    const valor = valorFinito((item as { valor?: unknown }).valor);
    if (valor !== null) return valor;
  }
  return null;
}
```

- [ ] **Step 5: Ver pasar los tests y comprobar el huso**

Ejecutar: `npm test --prefix mobile`, `uv run pytest -q` y
`npm run typecheck --prefix mobile`.

Y **la comprobación que da sentido a la trampa 1**: corre la suite de TypeScript
bajo un huso distinto al chileno y confirma que sigue verde.

```bash
TZ=America/New_York npm test --prefix mobile
TZ=Asia/Tokyo npm test --prefix mobile
```

Si alguna falla, alguna función está construyendo un `Date`. Pega ambas salidas
en tu reporte.

- [ ] **Step 6: Commit**

```bash
git add mobile/src/utm/ shared/fixtures/serie-utm.json tests/test_fixtures_doradas.py mobile/src/core/fixtures.test.ts src/pensiontracker/services/utm_service.py
git commit -m "Etapa 2b: parseo de la serie de mindicador.cl, con fixtures compartidas

El año y el mes se leen cortando el string y no con un Date: las fechas son
la medianoche chilena en UTC, y getMonth() devolvería el mes según el huso
del dispositivo. En America/New_York, diciembre se leería como noviembre.

Se extrae la parte pura del Python a _extraer_valores_del_anio para poder
alimentarla con las mismas fixtures."
```

---

## Task 3: Obtener la UTM, con degradación

**Files:**
- Create: `mobile/src/utm/servicio-utm.ts`, `mobile/src/utm/servicio-utm.test.ts`

**Interfaces:**
- Consumes: `ClienteHttp` (Task 1), `extraerValoresDelAnio`/`buscarMesEnSerie`
  (Task 2), `RepositorioUtm` (Etapa 2a).
- Produces:
  - `type FuenteUtm = 'mindicador' | 'base_de_datos' | 'no_disponible'`
  - `interface ResultadoUtm { utm: number | null; mes: number; anio: number; fuente: FuenteUtm | null; error: string | null }`
  - `class ServicioUtm` con constructor `(http: ClienteHttp, repo: RepositorioUtm)`
  - `obtenerUtm(anio: number, mes: number): Promise<ResultadoUtm>`

**La estrategia del escritorio, que se replica** (`utm_service.py:50-107` y
`253-282`):

1. Pedir el año completo (`/api/utm/<aaaa>`) y buscar el mes en la serie.
2. Si no aparece, pedir la fecha puntual (`/api/utm/01-<mm>-<aaaa>`).
3. Si la red falla, caer a la última UTM guardada en la base, marcando la fuente
   como `base_de_datos` y dejando un aviso en `error`.
4. Si tampoco hay nada guardado, `fuente = 'no_disponible'`.

**Las cadenas de `error` no se verifican contra el Python.** Son presentación y
hacerlas coincidir carácter a carácter entre dos lenguajes produce pruebas
frágiles — es la misma decisión que se tomó con las descripciones de desbalance
en la Etapa 1. Lo que sí se verifica es `utm` y `fuente`.

**El mes se valida:** el escritorio rechaza meses fuera de 1..12
(`utm_service.py:263`). Replícalo.

- [ ] **Step 1: Escribir los tests que fallan**

`mobile/src/utm/servicio-utm.test.ts`:

```typescript
import { beforeEach, describe, expect, it } from 'vitest';
import { EjecutorNode } from '../data/ejecutor-node';
import { inicializarBd } from '../data/esquema';
import { RepositorioUtm } from '../data/repositorio';
import { ErrorDeRed, type ClienteHttp } from './cliente-http';
import { ServicioUtm } from './servicio-utm';

/** Cliente que responde según la URL pedida, sin tocar la red. */
function clienteQueResponde(porUrl: Record<string, unknown>): ClienteHttp {
  return {
    obtenerJson: async (url: string) => {
      for (const [fragmento, cuerpo] of Object.entries(porUrl)) {
        if (url.includes(fragmento)) {
          if (cuerpo instanceof Error) throw cuerpo;
          return cuerpo;
        }
      }
      throw new ErrorDeRed(`sin respuesta preparada para ${url}`, 'http');
    },
  };
}

const SERIE_2025 = {
  serie: [
    { fecha: '2025-02-01T03:00:00.000Z', valor: 67429 },
    { fecha: '2025-01-01T03:00:00.000Z', valor: 67294 },
  ],
};

let ejecutor: EjecutorNode;
let repo: RepositorioUtm;

beforeEach(async () => {
  ejecutor = new EjecutorNode(':memory:');
  await inicializarBd(ejecutor);
  repo = new RepositorioUtm(ejecutor);
});

describe('ServicioUtm.obtenerUtm', () => {
  it('devuelve el valor de la serie anual cuando el mes está publicado', async () => {
    const s = new ServicioUtm(clienteQueResponde({ '/utm/2025': SERIE_2025 }), repo);
    const r = await s.obtenerUtm(2025, 1);
    expect(r).toMatchObject({ utm: 67294, mes: 1, anio: 2025, fuente: 'mindicador' });
    expect(r.error).toBeNull();
  });

  it('cae a la consulta puntual si el mes no está en la serie anual', async () => {
    const s = new ServicioUtm(
      clienteQueResponde({
        '/utm/2025': { serie: [] },
        '/utm/01-03-2025': { serie: [{ fecha: '2025-03-01T03:00:00.000Z', valor: 68034 }] },
      }),
      repo,
    );
    const r = await s.obtenerUtm(2025, 3);
    expect(r).toMatchObject({ utm: 68034, fuente: 'mindicador' });
  });

  it('sin red, usa la última UTM guardada y lo avisa', async () => {
    await repo.guardarUtm(2024, 12, 66500, '2024-12-01 00:00:00');
    const caido = { obtenerJson: async () => { throw new ErrorDeRed('sin red', 'conexion'); } };
    const r = await new ServicioUtm(caido, repo).obtenerUtm(2025, 1);
    expect(r).toMatchObject({ utm: 66500, fuente: 'base_de_datos' });
    expect(r.error).toBeTruthy();
  });

  it('sin red y sin nada guardado, informa que no hay valor disponible', async () => {
    const caido = { obtenerJson: async () => { throw new ErrorDeRed('sin red', 'conexion'); } };
    const r = await new ServicioUtm(caido, repo).obtenerUtm(2025, 1);
    expect(r).toMatchObject({ utm: null, fuente: 'no_disponible' });
    expect(r.error).toBeTruthy();
  });

  it('con el mes publicado pero sin red no consulta la base', async () => {
    await repo.guardarUtm(2024, 12, 66500, '2024-12-01 00:00:00');
    const s = new ServicioUtm(clienteQueResponde({ '/utm/2025': SERIE_2025 }), repo);
    expect((await s.obtenerUtm(2025, 2)).utm).toBe(67429);
  });

  it.each([0, 13, -1])('rechaza el mes inválido %i', async (mes) => {
    const s = new ServicioUtm(clienteQueResponde({ '/utm/2025': SERIE_2025 }), repo);
    const r = await s.obtenerUtm(2025, mes);
    expect(r.fuente).toBe('no_disponible');
    expect(r.utm).toBeNull();
  });

  it('el mes publicado pero ausente en ambas consultas no queda como mindicador', async () => {
    const s = new ServicioUtm(
      clienteQueResponde({ '/utm/2025': { serie: [] }, '/utm/01-07-2025': { serie: [] } }),
      repo,
    );
    const r = await s.obtenerUtm(2025, 7);
    expect(r.fuente).not.toBe('mindicador');
    expect(r.utm).toBeNull();
  });
});
```

- [ ] **Step 2: Ver fallar los tests**

Ejecutar: `npm test --prefix mobile`
Esperado: FAIL, no existe `./servicio-utm`.

- [ ] **Step 3: Implementar**

Antes de escribir, **lee `obtener_utm` y `_consultar_mindicador` del escritorio**
(`utm_service.py:50-107` y `253-282`) y replica su orden de intentos y sus
condiciones exactas. Si encuentras alguna diferencia entre lo que hace y lo que
este brief describe, **el escritorio manda**: síguelo y anótalo en tu reporte.

`mobile/src/utm/servicio-utm.ts`:

```typescript
/**
 * Obtención del valor de la UTM, con caché local y degradación sin red.
 *
 * Port de src/pensiontracker/services/utm_service.py. No conoce Capacitor ni
 * fetch: recibe un ClienteHttp. No conoce SQLite: recibe un RepositorioUtm.
 *
 * Las cadenas de `error` son presentación y no se verifican contra el
 * Python: hacerlas coincidir carácter a carácter entre dos lenguajes produce
 * pruebas frágiles. Lo que debe coincidir es `utm` y `fuente`.
 */

import type { RepositorioUtm } from '../data/repositorio';
import { ErrorDeRed, type ClienteHttp } from './cliente-http';
import { buscarMesEnSerie, extraerValoresDelAnio } from './serie';

const API_ANIO = (anio: number) => `https://mindicador.cl/api/utm/${anio}`;
const API_FECHA = (anio: number, mes: number) =>
  `https://mindicador.cl/api/utm/01-${String(mes).padStart(2, '0')}-${anio}`;

export type FuenteUtm = 'mindicador' | 'base_de_datos' | 'no_disponible';

export interface ResultadoUtm {
  utm: number | null;
  mes: number;
  anio: number;
  fuente: FuenteUtm | null;
  error: string | null;
}

export class ServicioUtm {
  constructor(
    private readonly http: ClienteHttp,
    private readonly repo: RepositorioUtm,
  ) {}

  /** Valores publicados de un año, en una sola petición. */
  async obtenerUtmAnio(anio: number): Promise<Map<number, number>> {
    return extraerValoresDelAnio(await this.http.obtenerJson(API_ANIO(anio)), anio);
  }

  /**
   * Valor de un mes: primero mindicador.cl, y si falla, la última UTM
   * guardada. Nunca lanza: informa el estado en `fuente` y `error`.
   */
  async obtenerUtm(anio: number, mes: number): Promise<ResultadoUtm> {
    const resultado: ResultadoUtm = { utm: null, mes, anio, fuente: null, error: null };

    try {
      resultado.utm = await this.consultarMindicador(anio, mes);
      resultado.fuente = 'mindicador';
      return resultado;
    } catch (e) {
      resultado.error = e instanceof Error ? e.message : String(e);
    }

    const ultima = await this.repo.obtenerUltimaUtmGuardada();
    if (ultima) {
      resultado.utm = ultima.utmValor;
      resultado.fuente = 'base_de_datos';
      resultado.error =
        `${resultado.error} | AVISO: Se está usando la última UTM registrada ` +
        `(${ultima.utmValor} de ${ultima.fechaRegistro}).`;
    } else {
      resultado.fuente = 'no_disponible';
      resultado.error = `${resultado.error} | No hay UTM guardada en la base de datos.`;
    }
    return resultado;
  }

  /**
   * Estrategia del escritorio: serie anual primero, fecha puntual después.
   * Lanza ErrorDeRed si ninguna de las dos tiene el mes.
   */
  private async consultarMindicador(anio: number, mes: number): Promise<number> {
    if (!Number.isInteger(mes) || mes < 1 || mes > 12) {
      throw new ErrorDeRed(
        `Número de mes inválido: ${mes}. Debe ser entre 1 y 12.`,
        'respuesta_invalida',
      );
    }

    const serieAnio = await this.obtenerUtmAnio(anio);
    const delAnio = serieAnio.get(mes);
    if (delAnio !== undefined) return delAnio;

    const puntual = await this.http.obtenerJson(API_FECHA(anio, mes));
    const valor = buscarMesEnSerie(
      (puntual as { serie?: unknown } | null)?.serie,
      anio,
      mes,
    );
    if (valor !== null) return valor;

    throw new ErrorDeRed(
      `mindicador.cl no tiene UTM publicada para ${String(mes).padStart(2, '0')}/${anio}. ` +
        `Es posible que el mes aún no esté disponible.`,
      'respuesta_invalida',
    );
  }
}
```

- [ ] **Step 4: Ver pasar los tests**

Ejecutar: `npm test --prefix mobile`, `uv run pytest -q` y
`npm run typecheck --prefix mobile`.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/utm/
git commit -m "Etapa 2b: servicio de UTM con degradación sin red"
```

---

## Task 4: Caché por año, refresco al arrancar y UTM de referencia

**Files:**
- Modify: `mobile/src/utm/servicio-utm.ts`, `mobile/src/utm/servicio-utm.test.ts`

**Interfaces:**
- Produces, en `ServicioUtm`:
  - `obtenerUtmMesConCache(anio: number, mes: number): Promise<ResultadoUtm>`
  - `refrescarUtmSiFalta(anio: number, mes: number): Promise<void>`
  - `obtenerUtmReferencia(anio: number, mes: number): Promise<{ utmValor: number | null; esActual: boolean }>`

**Las tres reciben el año y el mes "de hoy" por parámetro**, en vez de leer el
reloj por dentro como hace el escritorio. Es el mismo criterio que se aplicó a la
fecha en `guardarUtm`: probar algo que consulta el reloj obliga a congelarlo.
Quien llame decidirá qué es "hoy".

**Lo que hace cada una** (`utm_service.py:119-134`, `137-162`, `202-246`):

- `obtenerUtmMesConCache`: si el mes ya está en la base, **no hace ninguna
  petición**. Si no, trae el año completo en una sola petición y **cachea todo lo
  recibido**, no solo el mes pedido — así completar varios meses del mismo año
  cuesta una sola petición.
- `refrescarUtmSiFalta`: si la UTM del mes indicado no está guardada, la busca y
  la persiste. **Nunca lanza**: se llama al arrancar y no puede impedir que la app
  abra. Solo guarda si la fuente fue `mindicador`.
- `obtenerUtmReferencia`: prioriza la del mes indicado; si no está, cae a la
  última guardada y lo marca con `esActual: false`. **Tolera valores no finitos
  al leer**: una fila con `inf` guardada por una versión anterior se trata como si
  no existiera, en vez de propagarla al cálculo. El escritorio hace exactamente
  esto y hay un test suyo que lo cubre.

- [ ] **Step 1: Escribir los tests que fallan**

Agregar a `mobile/src/utm/servicio-utm.test.ts`:

```typescript
/** Cliente que además cuenta cuántas peticiones recibió. */
function clienteQueCuenta(porUrl: Record<string, unknown>) {
  const llamadas: string[] = [];
  const cliente: ClienteHttp = {
    obtenerJson: async (url: string) => {
      llamadas.push(url);
      for (const [fragmento, cuerpo] of Object.entries(porUrl)) {
        if (url.includes(fragmento)) return cuerpo;
      }
      throw new ErrorDeRed(`sin respuesta preparada para ${url}`, 'http');
    },
  };
  return { cliente, llamadas };
}

describe('obtenerUtmMesConCache', () => {
  it('no consulta la red si el mes ya está cacheado', async () => {
    await repo.guardarUtm(2025, 1, 67294, '2025-01-01 00:00:00');
    const { cliente, llamadas } = clienteQueCuenta({ '/utm/2025': SERIE_2025 });
    const r = await new ServicioUtm(cliente, repo).obtenerUtmMesConCache(2025, 1);
    expect(r).toMatchObject({ utm: 67294, fuente: 'base_de_datos' });
    expect(llamadas).toHaveLength(0);
  });

  it('trae el año completo y cachea todos los meses recibidos', async () => {
    const { cliente, llamadas } = clienteQueCuenta({ '/utm/2025': SERIE_2025 });
    const s = new ServicioUtm(cliente, repo);
    const r = await s.obtenerUtmMesConCache(2025, 1);
    expect(r).toMatchObject({ utm: 67294, fuente: 'mindicador' });
    // El mes 2 venía en la misma respuesta y quedó cacheado.
    expect((await repo.obtenerUtmGuardada(2025, 2))!.utmValor).toBe(67429);
    expect(llamadas).toHaveLength(1);
  });

  it('un segundo mes del mismo año no gasta otra petición', async () => {
    const { cliente, llamadas } = clienteQueCuenta({ '/utm/2025': SERIE_2025 });
    const s = new ServicioUtm(cliente, repo);
    await s.obtenerUtmMesConCache(2025, 1);
    await s.obtenerUtmMesConCache(2025, 2);
    expect(llamadas).toHaveLength(1);
  });

  it('si el mes no está publicado lo informa sin inventar valor', async () => {
    const { cliente } = clienteQueCuenta({ '/utm/2025': SERIE_2025 });
    const r = await new ServicioUtm(cliente, repo).obtenerUtmMesConCache(2025, 11);
    expect(r).toMatchObject({ utm: null, fuente: 'no_disponible' });
    expect(r.error).toBeTruthy();
  });

  it('sin red informa el fallo sin lanzar', async () => {
    const caido = { obtenerJson: async () => { throw new ErrorDeRed('sin red', 'conexion'); } };
    const r = await new ServicioUtm(caido, repo).obtenerUtmMesConCache(2025, 1);
    expect(r).toMatchObject({ utm: null, fuente: 'no_disponible' });
  });
});

describe('refrescarUtmSiFalta', () => {
  it('guarda la UTM del mes si no estaba', async () => {
    const { cliente } = clienteQueCuenta({ '/utm/2025': SERIE_2025 });
    await new ServicioUtm(cliente, repo).refrescarUtmSiFalta(2025, 1);
    expect((await repo.obtenerUtmGuardada(2025, 1))!.utmValor).toBe(67294);
  });

  it('no consulta la red si el mes ya estaba guardado', async () => {
    await repo.guardarUtm(2025, 1, 67294, '2025-01-01 00:00:00');
    const { cliente, llamadas } = clienteQueCuenta({ '/utm/2025': SERIE_2025 });
    await new ServicioUtm(cliente, repo).refrescarUtmSiFalta(2025, 1);
    expect(llamadas).toHaveLength(0);
  });

  it('no lanza cuando no hay red: no puede impedir que la app abra', async () => {
    const caido = { obtenerJson: async () => { throw new ErrorDeRed('sin red', 'conexion'); } };
    await expect(new ServicioUtm(caido, repo).refrescarUtmSiFalta(2025, 1)).resolves.toBeUndefined();
  });

  it('no guarda un valor que vino de la base y no de mindicador', async () => {
    await repo.guardarUtm(2024, 12, 66500, '2024-12-01 00:00:00');
    const caido = { obtenerJson: async () => { throw new ErrorDeRed('sin red', 'conexion'); } };
    await new ServicioUtm(caido, repo).refrescarUtmSiFalta(2025, 1);
    expect(await repo.obtenerUtmGuardada(2025, 1)).toBeNull();
  });
});

describe('obtenerUtmReferencia', () => {
  it('prioriza la UTM del mes indicado', async () => {
    await repo.guardarUtm(2024, 12, 66500, '2024-12-01 00:00:00');
    await repo.guardarUtm(2025, 1, 67294, '2025-01-01 00:00:00');
    const s = new ServicioUtm(clienteQueResponde({}), repo);
    expect(await s.obtenerUtmReferencia(2025, 1)).toEqual({ utmValor: 67294, esActual: true });
  });

  it('cae a la última guardada y lo marca', async () => {
    await repo.guardarUtm(2024, 12, 66500, '2024-12-01 00:00:00');
    const s = new ServicioUtm(clienteQueResponde({}), repo);
    expect(await s.obtenerUtmReferencia(2025, 1)).toEqual({ utmValor: 66500, esActual: false });
  });

  it('sin nada guardado devuelve nulo', async () => {
    const s = new ServicioUtm(clienteQueResponde({}), repo);
    expect(await s.obtenerUtmReferencia(2025, 1)).toEqual({ utmValor: null, esActual: false });
  });

  it('ignora un valor no finito guardado por una versión anterior', async () => {
    await ejecutor.correr(
      'INSERT INTO utm_historial (anio, mes, utm_valor, fecha_registro) VALUES (?,?,?,?)',
      [2025, 1, Infinity, '2025-01-01 00:00:00'],
    );
    await repo.guardarUtm(2024, 12, 66500, '2024-12-01 00:00:00');
    const s = new ServicioUtm(clienteQueResponde({}), repo);
    // Tolerar al leer: la fila corrupta se trata como si no existiera.
    expect(await s.obtenerUtmReferencia(2025, 1)).toEqual({ utmValor: 66500, esActual: false });
  });
});
```

- [ ] **Step 2: Ver fallar los tests**

Ejecutar: `npm test --prefix mobile`
Esperado: FAIL, los tres métodos no existen.

- [ ] **Step 3: Implementar**

Agregar a `ServicioUtm` en `mobile/src/utm/servicio-utm.ts`:

```typescript
  /**
   * Valor de un mes priorizando la caché local. Si el mes no está, trae el
   * año completo en una sola petición y cachea todo lo recibido: completar
   * varios meses del mismo año no debe costar una petición por mes.
   */
  async obtenerUtmMesConCache(anio: number, mes: number): Promise<ResultadoUtm> {
    const resultado: ResultadoUtm = { utm: null, mes, anio, fuente: null, error: null };

    const guardado = await this.repo.obtenerUtmGuardada(anio, mes);
    if (guardado) {
      resultado.utm = guardado.utmValor;
      resultado.fuente = 'base_de_datos';
      return resultado;
    }

    let serieAnio: Map<number, number>;
    try {
      serieAnio = await this.obtenerUtmAnio(anio);
    } catch (e) {
      resultado.fuente = 'no_disponible';
      resultado.error = e instanceof Error ? e.message : String(e);
      return resultado;
    }

    if (serieAnio.size > 0) {
      await this.repo.guardarUtmBulk(anio, serieAnio);
    }

    const valor = serieAnio.get(mes);
    if (valor !== undefined) {
      resultado.utm = valor;
      resultado.fuente = 'mindicador';
    } else {
      resultado.fuente = 'no_disponible';
      resultado.error =
        `mindicador.cl no tiene UTM publicada para ${String(mes).padStart(2, '0')}/${anio}. ` +
        `Es posible que el mes aún no esté disponible.`;
    }
    return resultado;
  }

  /**
   * Si la UTM del mes indicado no está guardada, la busca y la persiste.
   *
   * Se llama al arrancar, así que **nunca lanza**: un problema de red no
   * puede impedir que la app abra. Solo persiste si el valor vino de
   * mindicador.cl, no si salió de la propia base.
   */
  async refrescarUtmSiFalta(anio: number, mes: number): Promise<void> {
    try {
      if (await this.repo.obtenerUtmGuardada(anio, mes)) return;
      const resultado = await this.obtenerUtm(anio, mes);
      if (resultado.utm !== null && resultado.fuente === 'mindicador') {
        await this.repo.guardarUtm(resultado.anio, resultado.mes, resultado.utm);
      }
    } catch {
      // Silencio deliberado: ver el docstring.
    }
  }

  /**
   * UTM a mostrar como referencia: la del mes indicado, o la última
   * guardada marcada como no actual.
   *
   * Tolerar al leer: una fila con un valor no finito —persistida por una
   * versión sin el guard de finitud, o por una respuesta extrema de la
   * API— se trata igual que si no hubiera valor, en vez de propagar el
   * `inf` al cálculo, que lo rechazaría.
   */
  async obtenerUtmReferencia(
    anio: number,
    mes: number,
  ): Promise<{ utmValor: number | null; esActual: boolean }> {
    const actual = await this.repo.obtenerUtmGuardada(anio, mes);
    if (actual && Number.isFinite(actual.utmValor)) {
      return { utmValor: actual.utmValor, esActual: true };
    }

    const ultima = await this.repo.obtenerUltimaUtmGuardada();
    if (ultima && Number.isFinite(ultima.utmValor)) {
      return { utmValor: ultima.utmValor, esActual: false };
    }

    return { utmValor: null, esActual: false };
  }
```

- [ ] **Step 4: Ver pasar los tests**

Ejecutar: `npm test --prefix mobile`, `uv run pytest -q`,
`npm run typecheck --prefix mobile`, y de nuevo bajo otro huso:
`TZ=America/New_York npm test --prefix mobile`.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/utm/
git commit -m "Etapa 2b: caché por año, refresco al arrancar y UTM de referencia"
```

---

## Verificación de cierre de la etapa

1. Las tres verificaciones en verde, y también bajo `TZ=America/New_York` y
   `TZ=Asia/Tokyo`.
2. **Ninguna prueba toca la red**: la suite completa corre sin conexión.
3. `mobile/src/utm/` no importa nada de Capacitor ni llama a `fetch` fuera de
   `cliente-http.ts`.
4. Las fixtures de `serie-utm.json` pasan en ambos lenguajes.
5. Quitar el corte de string y usar un `Date` hace fallar la suite bajo un huso
   distinto al chileno. Compruébalo y revierte.

## Etapas siguientes (planes aparte)

- **Etapa 2c — Interfaz Svelte y andamiaje de Capacitor.** Incluye los dos
  adaptadores pendientes: el de SQLite sobre `@capacitor-community/sqlite` —con
  el contrato de transacciones ya documentado en `mobile/src/data/ejecutor.ts`— y
  la configuración que habilita el plugin `CapacitorHttp` para que `fetch` vaya
  por la capa nativa. Recuerda además que la vista anual debe ocultar las
  tarjetas de resumen cuando no hay pagos, igual que hace `historial.html`.
- **Etapa 3 — Importar y restaurar respaldos** en escritorio y móvil.
- **Etapa 4 — Distribución**: firma del APK, GitHub Releases y envío a F-Droid.
