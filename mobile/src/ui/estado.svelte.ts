/**
 * Estado de la pantalla de historial: carga los pagos y la UTM de
 * referencia una sola vez, y deriva de ahí filas y resúmenes.
 *
 * Port de la orquestación que arma routes/pagos.py en cada petición
 * (`historial` / `historial_anio`, que combinan `obtener_estado_cuenta`,
 * `obtener_utm_referencia`, `obtener_historial_desbalances` y
 * `calcular_desbalance_acumulado_utm`). Acá se hace una vez al cargar y se
 * reutiliza: no hay petición nueva por cada interacción.
 */

import {
  calcularDesbalanceAcumuladoUtm,
  obtenerHistorialDesbalances,
  resumirEstadoCuenta,
  type FilaHistorial,
} from '../core/calculos';
import type { Pago } from '../core/tipos';
import type { RepositorioPagos } from '../data/repositorio';
import type { ServicioUtm } from '../utm/servicio-utm';

type Resumen = ReturnType<typeof resumirEstadoCuenta>;
type ResumenUtm = ReturnType<typeof calcularDesbalanceAcumuladoUtm>;

/** Años de un conjunto de pagos, de más reciente a más antiguo, sin repetir. */
function aniosDe(pagos: Pago[]): number[] {
  return [...new Set(pagos.map((p) => p.anioPago))].sort((a, b) => b - a);
}

export class EstadoApp {
  cargando = $state(false);
  error = $state<string | null>(null);
  filas = $state<FilaHistorial[]>([]);
  resumen = $state<Resumen>(resumirEstadoCuenta([]));
  resumenUtm = $state<ResumenUtm | null>(null);
  /**
   * Años de TODOS los pagos, no de los filtrados: si salieran del filtro,
   * elegir un año dejaría solo ese año en el selector y el usuario no
   * podría volver a los demás (mismo motivo que `historial_anio` en el
   * escritorio consulta `obtener_todos_los_pagos` en vez de los del año).
   */
  aniosDisponibles = $state<number[]>([]);
  anioFiltro = $state<number | null>(null);
  utmReferencia = $state<number | null>(null);

  /** Todos los pagos cargados, tal como vienen del repositorio. */
  private todosLosPagos: Pago[] = [];

  constructor(
    private readonly pagos: RepositorioPagos,
    private readonly utm: ServicioUtm,
  ) {}

  /**
   * Carga todos los pagos y la UTM de referencia, y calcula filas y
   * resúmenes para el conjunto completo (sin filtro).
   *
   * `cargando` vuelve a `false` incluso si algo lanza: de lo contrario la
   * pantalla se quedaría en el spinner para siempre sin decir qué pasó.
   */
  async cargar(): Promise<void> {
    this.cargando = true;
    this.error = null;
    try {
      this.todosLosPagos = await this.pagos.obtenerTodosLosPagos();
      this.aniosDisponibles = aniosDe(this.todosLosPagos);

      // `obtenerUtmReferencia` y NO `obtenerUtm`: el primero lee solo la base
      // local; el segundo sale a mindicador.cl y cae a la base si falla.
      // El escritorio, en /historial, usa el equivalente que no toca la red
      // (`utm_service.obtener_utm_referencia`). Salir a la red acá haría dos
      // cosas malas: pedir un valor en vivo cada vez que se abre la pantalla,
      // y —si el mes actual no está guardado— mostrar en el teléfono una UTM
      // distinta de la que ve el escritorio con la MISMA base de datos, que
      // es justo la divergencia que este port existe para evitar.
      const hoy = new Date();
      const ref = await this.utm.obtenerUtmReferencia(hoy.getFullYear(), hoy.getMonth() + 1);
      this.utmReferencia = ref.utmValor;

      this.anioFiltro = null;
      this.recalcular(this.todosLosPagos);
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    } finally {
      this.cargando = false;
    }
  }

  /**
   * Recalcula filas y resumen para un año concreto, o para todos con
   * `null`. No vuelve a pedir la UTM ni toca `aniosDisponibles`: ambos ya
   * están resueltos desde `cargar()`.
   */
  async filtrarPorAnio(anio: number | null): Promise<void> {
    this.anioFiltro = anio;
    const pagosDelFiltro =
      anio === null ? this.todosLosPagos : this.todosLosPagos.filter((p) => p.anioPago === anio);
    this.recalcular(pagosDelFiltro);
  }

  /** Deriva filas, resumen y resumen UTM de un conjunto de pagos ya elegido. */
  private recalcular(pagosDelFiltro: Pago[]): void {
    this.filas = obtenerHistorialDesbalances(pagosDelFiltro, this.utmReferencia);
    this.resumen = resumirEstadoCuenta(pagosDelFiltro);
    this.resumenUtm = this.utmReferencia
      ? calcularDesbalanceAcumuladoUtm(this.utmReferencia, pagosDelFiltro)
      : null;
  }
}
