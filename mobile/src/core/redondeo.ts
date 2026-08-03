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
