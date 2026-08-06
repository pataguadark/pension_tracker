/**
 * Punto de entrada en el teléfono: abre la base real, cablea la app y la
 * monta.
 *
 * **Es el único archivo que importa `@capacitor-community/sqlite`**, y el
 * único que toca el DOM. Todo lo demás del arranque vive en `arranque.ts`,
 * que recibe la fábrica de conexiones por parámetro: así las pruebas
 * ejercitan el cableado sin cargar el plugin (que fuera del teléfono no
 * tiene implementación nativa) ni montar la app como efecto secundario de
 * un import.
 *
 * El fallo de apertura NO se silencia: se muestra en pantalla con el
 * mensaje real y se registra en la consola. Es lo contrario de tragárselo —
 * un `catch` vacío acá dejaría al usuario frente a un historial vacío que
 * parece decir que sus pagos se perdieron.
 */

import { CapacitorSQLite, SQLiteConnection } from '@capacitor-community/sqlite';
import { mount } from 'svelte';

import { arrancarApp, crearEstadoApp } from './arranque';
import App from './ui/App.svelte';
import './ui/estilo.css';

const destino = document.getElementById('app')!;

async function arrancar(): Promise<void> {
  let cableada;
  try {
    cableada = await crearEstadoApp(new SQLiteConnection(CapacitorSQLite));
  } catch (e) {
    const detalle = e instanceof Error ? e.message : String(e);
    console.error('No se pudo abrir la base de datos:', e);
    mount(App, { target: destino, props: { errorArranque: detalle } });
    return;
  }

  // Se monta ANTES de cargar: `cargar()` publica su propio error en
  // `estado.error`, que App ya sabe mostrar, y así la cáscara aparece de
  // inmediato en vez de esperar a la base y a la red.
  mount(App, { target: destino, props: { estado: cableada.estado } });
  await arrancarApp(cableada.estado, cableada.servicioUtm);
}

void arrancar();
