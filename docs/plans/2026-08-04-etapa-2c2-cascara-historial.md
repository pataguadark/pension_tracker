# Etapa 2c parte 2 — Cáscara e historial

> **Para agentes:** SUB-SKILL OBLIGATORIA: usar superpowers:subagent-driven-development
> para ejecutar este plan tarea por tarea. Los pasos usan casillas (`- [ ]`).

**Objetivo:** que la app móvil muestre los pagos. Al terminar, una base de
datos con pagos se ve en el teléfono con el mismo contenido que en el
escritorio.

**Arquitectura:** tres capas. (1) El tooling de pruebas de componentes y la
cáscara: encabezado, navegación y mensajes. (2) Un estado de aplicación que
carga pagos y UTM desde los repositorios ya existentes. (3) La pantalla de
historial, que es la más densa del producto.

**Stack:** Svelte 5 (runas), vitest + jsdom, `@testing-library/svelte`.

## Restricciones globales

- **No se toca el escritorio (`src/pensiontracker/`).** Ni las plantillas ni
  las rutas ni el CSS original.
- **`mobile/src/ui/estilo.css` no se edita.** Es copia byte a byte del CSS del
  escritorio y así debe seguir: es lo que hace visible cualquier divergencia
  de diseño. Las clases que se usen deben ser las que ese archivo ya define.
- **La lógica de negocio no se reimplementa en los componentes.** Los cálculos
  vienen de `mobile/src/core/`; si un componente necesita algo que el core no
  expone, se agrega al core con sus pruebas, no al `.svelte`.
- **Ninguna prueba sale a la red ni requiere dispositivo.** La suite completa
  debe correr dentro de `unshare -rn`.
- **Comentarios, nombres y textos de interfaz en español.**
- El repositorio canónico es
  `/run/media/darkdiego/ssd_kingston480G/.darkprojects/dd.release/pension_tracker`
  (**con guion bajo**). El directorio `pensiontracker` sin guion bajo es un
  respaldo obsoleto: no se toca.

## Fuera de alcance (parte 3)

Registro, edición, eliminación y la pantalla de ajustes. Esta parte es el
**camino de lectura**; la parte 3 es el de escritura.

---

## Estructura de archivos

| Archivo | Responsabilidad | Tarea |
|---|---|---|
| `mobile/vitest.config.ts` | Sumar el plugin de Svelte y el entorno jsdom. | 1 |
| `mobile/src/ui/App.svelte` | Cáscara: encabezado, navegación, mensajes, pie. | 1 |
| `mobile/src/ui/Encabezado.svelte` | Marca y navegación entre vistas. | 1 |
| `mobile/src/ui/Mensajes.svelte` | Equivalente de los mensajes flash del escritorio. | 1 |
| `mobile/src/ui/mensajes.svelte.ts` | La cola de mensajes, como estado compartido. | 1 |
| `mobile/src/ui/estado.svelte.ts` | Carga de pagos y UTM de referencia desde los repositorios. | 2 |
| `mobile/src/ui/Historial.svelte` | La pantalla completa. | 3 |
| `mobile/src/ui/TarjetasResumen.svelte` | Las cuatro tarjetas, con el conmutador Valor/UTM. | 3 |
| `mobile/src/ui/TablaPagos.svelte` | La tabla. | 3 |
| `mobile/src/core/agrupacion.ts` | Conteo de pagos por período (badge ×N). | 3 |

---

### Tarea 1: Tooling de pruebas de componentes y cáscara

**Archivos:**
- Modificar: `mobile/vitest.config.ts`, `mobile/package.json`
- Crear: `mobile/src/ui/Encabezado.svelte`, `mobile/src/ui/Mensajes.svelte`,
  `mobile/src/ui/mensajes.svelte.ts`, `mobile/src/ui/mensajes.test.ts`,
  `mobile/src/ui/App.test.ts`
- Modificar: `mobile/src/ui/App.svelte`
- Leer antes de empezar: `src/pensiontracker/templates/base.html` (la cáscara
  del escritorio, que es lo que se replica) y `mobile/src/ui/estilo.css`
  (buscar `.site-header`, `.brand`, `.main-nav`, `.nav-link`, `.flash`,
  `.site-footer` para usar las clases que ya existen).

**Interfaces:**
- Produce: `type Vista = 'historial' | 'registro'`;
  `mensajes.agregar(texto, tipo)` y `mensajes.lista` desde
  `mensajes.svelte.ts`; `App.svelte` acepta la propiedad `vistaInicial`.

**Contexto.** El escritorio navega con URLs y muestra avisos con los mensajes
flash de Flask. En una SPA dentro de un WebView no hay servidor que redirija,
así que la vista es estado y los mensajes son una cola en memoria. La cáscara
debe verse igual: mismo encabezado, mismo pie con los enlaces de donación,
mismas clases CSS.

**Por qué el tooling va en esta tarea y no aparte:** sin entorno DOM no se
puede probar ningún componente, y una cáscara sin pruebas es exactamente el
tipo de andamiaje que después nadie verifica.

- [ ] **Paso 1: Instalar las dependencias de prueba**

```bash
npm install --prefix mobile --save-dev jsdom @testing-library/svelte @testing-library/jest-dom @testing-library/user-event
```

- [ ] **Paso 2: Habilitar el plugin de Svelte en las pruebas**

`mobile/vitest.config.ts` debe compilar los `.svelte` y resolver el punto de
entrada de navegador. **Conserva el `include` que ya tiene**, agregando el
patrón de los componentes:

```typescript
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [svelte()],
  // Svelte publica un punto de entrada distinto para navegador y para
  // servidor. Sin esta condición, vitest toma el de servidor y los
  // componentes no reaccionan a los eventos en las pruebas.
  resolve: { conditions: ['browser'] },
  test: {
    globals: true,
    // El entorno NO se pone en jsdom globalmente: las pruebas de datos usan
    // node:sqlite y no necesitan un DOM. Cada prueba de componente declara
    // `// @vitest-environment jsdom` en su primera línea.
    include: [
      'src/**/*.test.ts',
      'capacitor.config.test.ts',
      'configuracion-build.test.ts',
    ],
  },
});
```

- [ ] **Paso 3: Escribir la prueba de la cola de mensajes**

`mobile/src/ui/mensajes.test.ts`:

```typescript
import { beforeEach, describe, expect, it } from 'vitest';

import { mensajes } from './mensajes.svelte';

describe('cola de mensajes', () => {
  beforeEach(() => mensajes.limpiar());

  it('empieza vacía', () => {
    expect(mensajes.lista).toEqual([]);
  });

  it('conserva el orden en que llegan', () => {
    mensajes.agregar('primero', 'exito');
    mensajes.agregar('segundo', 'error');
    expect(mensajes.lista.map((m) => m.texto)).toEqual(['primero', 'segundo']);
  });

  it('descarta uno por su id sin tocar los demás', () => {
    mensajes.agregar('a', 'exito');
    mensajes.agregar('b', 'error');
    const primero = mensajes.lista[0]!;
    mensajes.descartar(primero.id);
    expect(mensajes.lista.map((m) => m.texto)).toEqual(['b']);
  });

  it('da ids distintos a mensajes de texto idéntico', () => {
    // Si el id se derivara del texto, descartar uno borraría el otro.
    mensajes.agregar('mismo', 'exito');
    mensajes.agregar('mismo', 'exito');
    const [a, b] = mensajes.lista;
    expect(a!.id).not.toBe(b!.id);
  });
});
```

- [ ] **Paso 4: Correr y verificar que falla**

```bash
npm test --prefix mobile -- mensajes
```

Esperado: FAIL, por no existir `./mensajes.svelte`.

- [ ] **Paso 5: Escribir la cola de mensajes**

`mobile/src/ui/mensajes.svelte.ts` (la extensión `.svelte.ts` es lo que
habilita las runas fuera de un componente):

```typescript
/**
 * Equivalente de los mensajes flash de Flask.
 *
 * En el escritorio el servidor los guarda en la sesión y la siguiente
 * plantilla los muestra. Acá no hay redirección: la cola vive en memoria y
 * los componentes reaccionan a ella.
 */

export type TipoMensaje = 'exito' | 'error' | 'aviso';

export interface Mensaje {
  id: number;
  texto: string;
  tipo: TipoMensaje;
}

let siguienteId = 0;

class ColaDeMensajes {
  lista = $state<Mensaje[]>([]);

  agregar(texto: string, tipo: TipoMensaje): void {
    // El id es un contador y no el texto ni la posición: dos mensajes
    // idénticos deben poder descartarse por separado.
    this.lista.push({ id: siguienteId++, texto, tipo });
  }

  descartar(id: number): void {
    this.lista = this.lista.filter((m) => m.id !== id);
  }

  limpiar(): void {
    this.lista = [];
  }
}

export const mensajes = new ColaDeMensajes();
```

- [ ] **Paso 6: Correr y verificar que pasa**

```bash
npm test --prefix mobile -- mensajes
```

Esperado: PASS las 4.

- [ ] **Paso 7: Escribir la prueba de la cáscara**

`mobile/src/ui/App.test.ts`. La primera línea es obligatoria:

```typescript
// @vitest-environment jsdom
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';

import App from './App.svelte';
import { mensajes } from './mensajes.svelte';

describe('App', () => {
  beforeEach(() => mensajes.limpiar());

  it('muestra la marca del producto', () => {
    render(App);
    expect(screen.getByText('Pensión')).toBeInTheDocument();
    expect(screen.getByText('TRACKER')).toBeInTheDocument();
  });

  it('arranca en el historial', () => {
    render(App);
    expect(screen.getByRole('link', { name: 'Historial' })).toHaveClass('active');
  });

  it('cambia de vista al pulsar la navegación', async () => {
    const user = userEvent.setup();
    render(App);
    await user.click(screen.getByRole('link', { name: 'Registrar Pago' }));
    expect(screen.getByRole('link', { name: 'Registrar Pago' })).toHaveClass('active');
    expect(screen.getByRole('link', { name: 'Historial' })).not.toHaveClass('active');
  });

  it('muestra los mensajes encolados', async () => {
    render(App);
    mensajes.agregar('Pago registrado', 'exito');
    expect(await screen.findByText('Pago registrado')).toBeInTheDocument();
  });

  it('deja descartar un mensaje', async () => {
    const user = userEvent.setup();
    render(App);
    mensajes.agregar('Algo salió mal', 'error');
    await user.click(await screen.findByRole('button', { name: /descartar/i }));
    expect(screen.queryByText('Algo salió mal')).not.toBeInTheDocument();
  });

  it('conserva los enlaces de donación del escritorio', () => {
    render(App);
    const mp = screen.getByRole('link', { name: /MercadoPago/i });
    expect(mp).toHaveAttribute('href', 'https://link.mercadopago.cl/pension_tracker');
    const pp = screen.getByRole('link', { name: /PayPal/i });
    expect(pp).toHaveAttribute(
      'href',
      'https://www.paypal.com/donate/?hosted_button_id=2PFWY58A55FQE',
    );
  });
});
```

Para que `toBeInTheDocument` y `toHaveClass` existan, crea
`mobile/src/ui/configuracion-pruebas.ts` con `import '@testing-library/jest-dom/vitest';`
y agrégalo como `setupFiles: ['src/ui/configuracion-pruebas.ts']` dentro de
`test` en `vitest.config.ts`.

- [ ] **Paso 8: Correr y verificar que falla**

```bash
npm test --prefix mobile -- App
```

Esperado: FAIL.

- [ ] **Paso 9: Escribir los componentes**

`mobile/src/ui/Mensajes.svelte`:

```svelte
<script lang="ts">
  import { mensajes } from './mensajes.svelte';

  const icono = { exito: '✓', error: '✕', aviso: '⚠' } as const;
  // Las clases del escritorio son flash-success / flash-error / flash-warning.
  const clase = { exito: 'success', error: 'error', aviso: 'warning' } as const;
</script>

{#if mensajes.lista.length > 0}
  <div class="flash-container">
    {#each mensajes.lista as mensaje (mensaje.id)}
      <div class="flash flash-{clase[mensaje.tipo]}">
        <span class="flash-icon">{icono[mensaje.tipo]}</span>
        {mensaje.texto}
        <button
          type="button"
          class="flash-cerrar"
          aria-label="Descartar mensaje"
          onclick={() => mensajes.descartar(mensaje.id)}>✕</button>
      </div>
    {/each}
  </div>
{/if}
```

`mobile/src/ui/Encabezado.svelte`:

```svelte
<script lang="ts">
  import type { Vista } from './App.svelte';

  let { vista, alCambiar }: { vista: Vista; alCambiar: (v: Vista) => void } = $props();
</script>

<header class="site-header">
  <div class="header-inner">
    <a
      href="#historial"
      class="brand"
      onclick={(e) => { e.preventDefault(); alCambiar('historial'); }}>
      <div class="brand-text">
        <span class="brand-title">Pensión</span>
        <span class="brand-sub">TRACKER</span>
      </div>
    </a>
    <nav class="main-nav">
      <a
        href="#registro"
        class="nav-link {vista === 'registro' ? 'active' : ''}"
        onclick={(e) => { e.preventDefault(); alCambiar('registro'); }}>Registrar Pago</a>
      <a
        href="#historial"
        class="nav-link {vista === 'historial' ? 'active' : ''}"
        onclick={(e) => { e.preventDefault(); alCambiar('historial'); }}>Historial</a>
    </nav>
  </div>
</header>
```

`mobile/src/ui/App.svelte`:

```svelte
<script lang="ts" module>
  export type Vista = 'historial' | 'registro';
</script>

<script lang="ts">
  import Encabezado from './Encabezado.svelte';
  import Mensajes from './Mensajes.svelte';

  let { vistaInicial = 'historial' as Vista } = $props();
  let vista = $state<Vista>(vistaInicial);
</script>

<div class="bg-grid"></div>
<div class="bg-glow"></div>

<Encabezado {vista} alCambiar={(v) => (vista = v)} />

<Mensajes />

<main class="main-content">
  {#if vista === 'historial'}
    <p>Historial</p>
  {:else}
    <p>Registrar Pago</p>
  {/if}
</main>

<footer class="site-footer">
  <p>Pensión Tracker &mdash; uso personal &mdash; datos almacenados localmente</p>
  <p class="footer-links">
    <a href="https://github.com/pataguadark/pension_tracker" target="_blank" rel="noopener noreferrer">Código fuente</a>
    <span class="footer-sep">&middot;</span>
    <a href="https://link.mercadopago.cl/pension_tracker" target="_blank" rel="noopener noreferrer">Donar (MercadoPago)</a>
    <span class="footer-sep">&middot;</span>
    <a href="https://www.paypal.com/donate/?hosted_button_id=2PFWY58A55FQE" target="_blank" rel="noopener noreferrer">Donar (PayPal)</a>
  </p>
</footer>
```

Los marcadores `<p>Historial</p>` y `<p>Registrar Pago</p>` los reemplazan la
tarea 3 y la parte 3 respectivamente.

- [ ] **Paso 10: Correr todo**

```bash
npm test --prefix mobile
npm run typecheck --prefix mobile
npm run check --prefix mobile
npm run build --prefix mobile
```

Esperado: las 332 anteriores más las nuevas, sin regresiones.

- [ ] **Paso 11: Commit**

```bash
git add mobile/
git commit -m "Cascara de la app movil con pruebas de componentes"
```

---

### Tarea 2: Estado de la aplicación

**Archivos:**
- Crear: `mobile/src/ui/estado.svelte.ts`, `mobile/src/ui/estado.test.ts`
- Leer antes de empezar: `src/pensiontracker/routes/pagos.py` (las funciones
  `historial` e `historial_anio`, que es la lógica que se replica) y
  `mobile/src/data/repositorio.ts`.

**Interfaces:**
- Consume: `RepositorioPagos`, `ServicioUtm`, `obtenerHistorialDesbalances`,
  `resumirEstadoCuenta`, `calcularDesbalanceAcumuladoUtm`.
- Produce: `class EstadoApp` con `cargar()`, `filtrarPorAnio(anio | null)`, y
  las propiedades reactivas `cargando`, `error`, `filas`, `resumen`,
  `resumenUtm`, `aniosDisponibles`, `anioFiltro`, `utmReferencia`.

**Contexto.** El escritorio arma esto en cada petición: `obtener_estado_cuenta`,
`obtener_utm_referencia`, `obtener_historial_desbalances` y
`calcular_desbalance_acumulado_utm`. Acá se hace una vez al cargar y se
reutiliza. Ojo con dos detalles del escritorio que hay que respetar:

- **Los años disponibles salen SIEMPRE de todos los pagos**, no de los del año
  filtrado. Si salieran del filtro, al elegir un año desaparecerían los demás
  y el usuario quedaría atrapado (ver `historial_anio`, que consulta
  `obtener_todos_los_pagos` justo para eso).
- **La UTM de referencia se pide una vez** y alimenta tanto el historial como
  el resumen en UTM.

- [ ] **Paso 1: Escribir las pruebas que fallan**

`mobile/src/ui/estado.test.ts`:

```typescript
import { beforeEach, describe, expect, it } from 'vitest';

import { EjecutorNode } from '../data/ejecutor-node';
import { inicializarBd } from '../data/esquema';
import { RepositorioPagos, RepositorioUtm } from '../data/repositorio';
import { ServicioUtm } from '../utm/servicio-utm';
import { EstadoApp } from './estado.svelte';

/** Cliente HTTP que nunca sale a la red: fuerza el camino de degradación. */
const httpCaido = {
  obtenerJson: async () => { throw new Error('sin red'); },
};

async function montar() {
  const ejecutor = new EjecutorNode(':memory:');
  await inicializarBd(ejecutor);
  const pagos = new RepositorioPagos(ejecutor);
  const repoUtm = new RepositorioUtm(ejecutor);
  const estado = new EstadoApp(pagos, new ServicioUtm(httpCaido, repoUtm));
  return { estado, pagos, repoUtm };
}

const pagoDe = (anio: number, mes: number, pagado: number) => ({
  fecha: `${anio}-${String(mes).padStart(2, '0')}-05`,
  mesPago: mes,
  anioPago: anio,
  utmValor: 60_000,
  cuotaPactada: 180_000,
  montoPagado: pagado,
  desbalance: pagado - 180_000,
  utmFactor: 3,
});

describe('EstadoApp', () => {
  it('sin pagos deja el resumen en cero y la lista vacía', async () => {
    const { estado } = await montar();
    await estado.cargar();
    expect(estado.cargando).toBe(false);
    expect(estado.filas).toEqual([]);
    expect(estado.resumen.cantidadPagos).toBe(0);
    expect(estado.aniosDisponibles).toEqual([]);
  });

  it('carga los pagos con el saldo corrido calculado', async () => {
    const { estado, pagos } = await montar();
    await pagos.insertarPago(pagoDe(2025, 1, 100_000));
    await pagos.insertarPago(pagoDe(2025, 2, 200_000));
    await estado.cargar();

    expect(estado.resumen.cantidadPagos).toBe(2);
    // Devuelve del más reciente al más antiguo, como el escritorio.
    expect(estado.filas[0]!.mesPago).toBe(2);
    expect(estado.filas[0]!.desbalanceCorrido).toBe(-60_000);
    expect(estado.filas[1]!.desbalanceCorrido).toBe(-80_000);
  });

  it('ofrece los años de más reciente a más antiguo', async () => {
    const { estado, pagos } = await montar();
    await pagos.insertarPago(pagoDe(2024, 5, 100_000));
    await pagos.insertarPago(pagoDe(2026, 1, 100_000));
    await pagos.insertarPago(pagoDe(2025, 3, 100_000));
    await estado.cargar();
    expect(estado.aniosDisponibles).toEqual([2026, 2025, 2024]);
  });

  it('al filtrar por año conserva TODOS los años en el selector', async () => {
    // Si los años salieran de los pagos filtrados, elegir 2025 dejaría solo
    // 2025 y el usuario no podría volver a los otros años.
    const { estado, pagos } = await montar();
    await pagos.insertarPago(pagoDe(2024, 5, 100_000));
    await pagos.insertarPago(pagoDe(2025, 3, 100_000));
    await estado.cargar();

    await estado.filtrarPorAnio(2025);
    expect(estado.filas).toHaveLength(1);
    expect(estado.filas[0]!.anioPago).toBe(2025);
    expect(estado.aniosDisponibles).toEqual([2025, 2024]);
    expect(estado.anioFiltro).toBe(2025);
  });

  it('vuelve a todos los pagos al quitar el filtro', async () => {
    const { estado, pagos } = await montar();
    await pagos.insertarPago(pagoDe(2024, 5, 100_000));
    await pagos.insertarPago(pagoDe(2025, 3, 100_000));
    await estado.cargar();
    await estado.filtrarPorAnio(2025);
    await estado.filtrarPorAnio(null);
    expect(estado.filas).toHaveLength(2);
    expect(estado.anioFiltro).toBeNull();
  });

  it('el resumen del año filtrado cuenta solo ese año', async () => {
    const { estado, pagos } = await montar();
    await pagos.insertarPago(pagoDe(2024, 5, 100_000));
    await pagos.insertarPago(pagoDe(2025, 3, 150_000));
    await estado.cargar();
    await estado.filtrarPorAnio(2025);
    expect(estado.resumen.cantidadPagos).toBe(1);
    expect(estado.resumen.totalPagado).toBe(150_000);
  });

  it('sin UTM de referencia el resumen en UTM queda en null y no rompe', async () => {
    // Camino de degradación: sin red y sin UTM guardada. El historial debe
    // mostrarse igual, solo sin la columna ajustada.
    const { estado, pagos } = await montar();
    await pagos.insertarPago(pagoDe(2025, 1, 100_000));
    await estado.cargar();
    expect(estado.utmReferencia).toBeNull();
    expect(estado.resumenUtm).toBeNull();
    expect(estado.filas[0]!.desbalanceUtmMesPesos).toBeNull();
    expect(estado.error).toBeNull();
  });

  it('con UTM guardada calcula el desbalance ajustado', async () => {
    const { estado, pagos, repoUtm } = await montar();
    await repoUtm.guardarUtm(2025, 6, 66_000);
    await pagos.insertarPago(pagoDe(2025, 1, 100_000));
    await estado.cargar();
    expect(estado.utmReferencia).toBe(66_000);
    expect(estado.resumenUtm).not.toBeNull();
    expect(estado.filas[0]!.desbalanceUtmMesPesos).not.toBeNull();
  });

  it('deja cargando en false aunque la carga falle, y expone el error', async () => {
    // Si `cargando` se quedara en true ante un fallo, la pantalla se quedaría
    // en el spinner para siempre sin decir qué pasó.
    const { estado } = await montar();
    const roto = new RepositorioPagos({
      ejecutar: async () => {},
      correr: async () => ({ cambios: 0, ultimoId: null }),
      consultar: async () => { throw new Error('base corrupta'); },
    });
    const estadoRoto = new EstadoApp(roto, (estado as never as { utm: ServicioUtm }).utm);
    await estadoRoto.cargar();
    expect(estadoRoto.cargando).toBe(false);
    expect(estadoRoto.error).toContain('base corrupta');
  });
});
```

- [ ] **Paso 2: Correr y verificar que fallan**

```bash
npm test --prefix mobile -- estado
```

Esperado: FAIL, por no existir `./estado.svelte`.

- [ ] **Paso 3: Escribir el estado**

`mobile/src/ui/estado.svelte.ts`. La firma del constructor debe ser
`(pagos: RepositorioPagos, utm: ServicioUtm)` y el campo `utm` debe ser
accesible para la última prueba. Requisitos:

- `cargar()` obtiene todos los pagos, pide la UTM de referencia una sola vez
  y calcula filas, resumen y resumen en UTM.
- `aniosDisponibles` se calcula **siempre desde todos los pagos**, nunca desde
  los filtrados, y va de mayor a menor.
- `filtrarPorAnio(anio)` recalcula filas y resumen para ese año sin volver a
  pedir la UTM ni tocar `aniosDisponibles`; con `null` vuelve a todos.
- `cargando` es `true` mientras dura la operación y `false` al terminar,
  **incluso si lanza**; el mensaje del error queda en `error`.
- Sin UTM de referencia, `resumenUtm` es `null` y las filas traen los campos
  UTM en `null` — el historial debe seguir mostrándose.

La UTM de referencia sale de `ServicioUtm.obtenerUtm(añoActual, mesActual)`,
tomando `resultado.utm` (que es `null` cuando no hay ninguna disponible).

- [ ] **Paso 4: Correr y verificar que pasan**

```bash
npm test --prefix mobile -- estado
npm run typecheck --prefix mobile
```

Esperado: PASS las 9.

- [ ] **Paso 5: Commit**

```bash
git add mobile/src/ui/
git commit -m "Estado de la aplicacion: carga de pagos y UTM de referencia"
```

---

### Tarea 3: Pantalla de historial

**Archivos:**
- Crear: `mobile/src/core/agrupacion.ts`, `mobile/src/core/agrupacion.test.ts`
- Crear: `mobile/src/ui/TarjetasResumen.svelte`, `mobile/src/ui/TablaPagos.svelte`,
  `mobile/src/ui/Historial.svelte`
- Crear: `mobile/src/ui/Historial.test.ts`
- Modificar: `mobile/src/ui/App.svelte` (reemplazar el marcador por la pantalla)
- Leer antes de empezar: `src/pensiontracker/templates/historial.html` **completo**.
  Es la referencia exacta de qué se muestra y con qué clases.

**Interfaces:**
- Consume: `EstadoApp` (tarea 2), `FilaHistorial`, `formatearPesos`, `fmtFactor`.
- Produce: `contarPorPeriodo(pagos)` en `core/agrupacion.ts`.

**Contexto y detalles que el escritorio hace y hay que replicar:**

1. **Las tarjetas de resumen se ocultan cuando no hay pagos.** En
   `historial.html` es `{% if resumen and resumen.cantidad_pagos %}`. Con cero
   pagos se muestra solo el estado vacío. Es fácil de perder y produce una
   divergencia visible: cuatro tarjetas en cero donde el escritorio no muestra
   ninguna.
2. **La numeración de la tabla es descendente**: la fila más reciente lleva el
   número más alto (`total_filas - loop.index0`), no el id de la base.
3. **El badge ×N** aparece cuando un mismo período (año+mes) tiene más de un
   pago, y muestra cuántos.
4. **El factor mostrado**: si el pago trae `utmFactor`, ese; si no, se deriva
   como `cuotaPactada / utmValor` redondeado a 4; si `utmValor` no es
   positivo, se muestra `—`.
5. **El conmutador Valor/UTM** solo aparece si hay desbalance ajustado. El
   escritorio arranca en modo UTM cuando está disponible
   (`data-modo-desbalance`), y alterna la clase de estado de la tarjeta.
6. **Sin UTM de referencia** se muestra la leyenda de advertencia
   (`resumen-legend-warn`) en vez de la explicación normal.

- [ ] **Paso 1: Escribir la prueba del conteo por período**

`mobile/src/core/agrupacion.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';

import { contarPorPeriodo } from './agrupacion';

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
});
```

- [ ] **Paso 2: Correr, verificar que falla, implementar, verificar que pasa**

```typescript
// mobile/src/core/agrupacion.ts
import type { Pago } from './tipos';

/** Clave de período: año y mes, con separador para que no se solapen. */
export function clavePeriodo(anio: number, mes: number): string {
  return `${anio}-${mes}`;
}

/** Cuántos pagos hay en cada período. Alimenta el badge ×N del historial. */
export function contarPorPeriodo(pagos: Pago[]): Map<string, number> {
  const conteo = new Map<string, number>();
  for (const p of pagos) {
    const clave = clavePeriodo(p.anioPago, p.mesPago);
    conteo.set(clave, (conteo.get(clave) ?? 0) + 1);
  }
  return conteo;
}
```

```bash
npm test --prefix mobile -- agrupacion
```

- [ ] **Paso 3: Escribir la prueba de la pantalla**

`mobile/src/ui/Historial.test.ts`, con `// @vitest-environment jsdom` en la
primera línea. Debe cubrir, cada uno como un `it` propio:

1. Con cero pagos: se ve el estado vacío ("Sin pagos registrados") y **no**
   se ve ninguna tarjeta de resumen (busca por el texto "Pagos registrados"
   y afirma que no está).
2. Con pagos: se ven las cuatro tarjetas y la tabla con una fila por pago.
3. La numeración es descendente: con tres pagos, la primera fila muestra 3.
4. El badge ×2 aparece en un período con dos pagos, y no aparece donde hay uno.
5. El factor se deriva de `cuotaPactada / utmValor` cuando el pago no trae
   `utmFactor`.
6. Se muestra `—` cuando no hay factor ni forma de derivarlo.
7. Sin UTM de referencia: no hay conmutador Valor/UTM y se ve la leyenda de
   advertencia.
8. Con UTM de referencia: el conmutador existe y al pulsarlo cambia el valor
   mostrado en la tarjeta de desbalance.
9. El filtro por año muestra "Todos" más un botón por año, y al pulsar un año
   la tabla queda solo con los pagos de ese año.

Monta el componente pasándole un `EstadoApp` ya cargado sobre `EjecutorNode`
en memoria, igual que en `estado.test.ts`. **No inventes un doble del estado:**
usar el real sobre una base en memoria es lo que hace que estas pruebas
detecten divergencias reales.

- [ ] **Paso 4: Implementar los componentes hasta que las pruebas pasen**

`TarjetasResumen.svelte`, `TablaPagos.svelte` e `Historial.svelte`, usando
exclusivamente clases que ya existan en `mobile/src/ui/estilo.css`. Reemplaza
el marcador de `App.svelte` por `<Historial />`.

- [ ] **Paso 5: Verificación completa**

```bash
npm test --prefix mobile
npm run typecheck --prefix mobile
npm run check --prefix mobile
npm run build --prefix mobile
unshare -rn npm test --prefix mobile
```

- [ ] **Paso 6: Commit**

```bash
git add mobile/
git commit -m "Pantalla de historial con tabla, resumen y filtro por anio"
```

---

## Deuda que esta etapa no cierra

- El conteo por período y la numeración descendente los hace el escritorio
  dentro de la plantilla Jinja; acá quedan en TypeScript con pruebas. Son
  presentación, no aritmética, así que no entran en las fixtures compartidas
  — pero pueden divergir sin que el CI lo note.
- `App.svelte` sigue sin abrir la base real: monta el estado que le pasen. El
  cableado con `abrirBaseDeDatos` va cuando exista la pantalla de registro,
  para no dejar una app que muestra datos y no deja crear ninguno.
