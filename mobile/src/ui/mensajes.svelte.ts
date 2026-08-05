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
