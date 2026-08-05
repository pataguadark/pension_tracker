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
