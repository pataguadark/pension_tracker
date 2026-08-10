/**
 * (El archivo no se llama vite.config.test.ts porque vitest excluye por
 * defecto todo lo que matchee `vite.config.*`, y el archivo desaparecía de
 * la corrida sin avisar.)
 *
 * Fija las tres decisiones de `vite.config.ts` y `public/` de las que depende
 * que la app se vea bien en el teléfono.
 *
 * Ninguna de las tres rompe una prueba si se pierde: son configuración
 * correcta sin nada que la sostenga, que es la forma exacta que tenía el bug
 * de `isTransactionActive` un escalón antes de manifestarse.
 */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import config from './vite.config';

const aqui = (relativa: string) => fileURLToPath(new URL(relativa, import.meta.url));

describe('vite.config', () => {
  it('emite rutas relativas', () => {
    // El WebView de Android sirve desde file://. Con `base: '/'` los assets
    // apuntan a la raíz del sistema de archivos y la app arranca en blanco.
    expect(config.base).toBe('./');
  });

  it('deja los assets en la raíz de dist, hermanos de fonts/', () => {
    // `estilo.css` es copia byte a byte del CSS del escritorio, donde
    // style.css y fonts/ son hermanos, así que sus `url('fonts/...')` son
    // relativos a ese nivel. Con el 'assets' por defecto de Vite el CSS
    // quedaba un nivel más abajo y las cuatro fuentes daban 404 en silencio.
    expect(config.build?.assetsDir).toBe('');
  });
});

describe('meta viewport', () => {
  it('no declara viewport-fit=cover', () => {
    // Con `viewport-fit=cover` el WebView se colapsa a ~86px de alto en
    // cuanto sale el teclado, y el campo que se está tecleando queda tapado.
    //
    // El culpable es el plugin SystemBars de Capacitor
    // (node_modules/@capacitor/android/.../plugin/SystemBars.java:200-208):
    // cuando el WebView del sistema es >= 140 Y la meta viewport dice
    // `viewport-fit=cover`, le mete al padre del WebView un padding inferior
    // igual al alto del teclado. Ese padding existe para Android 15+, donde
    // la ventana ya no se achica sola porque el modo edge-to-edge es
    // obligatorio; pero la rama NO está protegida por versión de Android, y
    // en un teléfono viejo (API < 35) la ventana SÍ se achica por su cuenta.
    // Resultado: el alto del teclado se descuenta dos veces.
    //
    // Sin `cover` se toma la otra rama, que sí pregunta por la versión de
    // Android antes de tocar el padding, y cada plataforma queda con un solo
    // descuento. No se pierde nada: el CSS no usa `env(safe-area-inset-*)`
    // en ninguna parte, que es lo único para lo que sirve `cover`.
    const html = readFileSync(aqui('./index.html'), 'utf8');
    const meta = /<meta\s+name="viewport"\s+content="([^"]*)"/.exec(html);

    expect(meta, 'index.html sin <meta name="viewport">').not.toBeNull();
    expect(meta![1]).not.toContain('viewport-fit');
  });
});

describe('fuentes', () => {
  it('cada fuente que pide el CSS existe en public/', () => {
    const css = readFileSync(aqui('./src/ui/estilo.css'), 'utf8');
    const pedidas = [...css.matchAll(/url\('fonts\/([^']+)'\)/g)].map((m) => m[1]!);

    // Si el CSS dejara de declarar fuentes, el bucle quedaría vacío y la
    // prueba pasaría sin comprobar nada.
    expect(pedidas.length).toBe(4);

    for (const fuente of pedidas) {
      expect(existsSync(aqui(`./public/fonts/${fuente}`)), `falta ${fuente}`).toBe(true);
    }
  });
});
