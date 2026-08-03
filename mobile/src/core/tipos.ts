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
