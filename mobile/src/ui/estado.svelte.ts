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
  calcularCuotaPactada,
  calcularDesbalanceAcumuladoUtm,
  calcularDesbalanceMensual,
  obtenerHistorialDesbalances,
  resumirEstadoCuenta,
  type FilaHistorial,
} from '../core/calculos';
import { limpiarFactor } from '../core/formatters';
import type { Pago } from '../core/tipos';
import type {
  RepositorioConfiguracion, RepositorioPagos, RepositorioUtm,
} from '../data/repositorio';
import type { ServicioUtm } from '../utm/servicio-utm';
import type { ValoresFormulario } from './formulario';

type Resumen = ReturnType<typeof resumirEstadoCuenta>;
type ResumenUtm = ReturnType<typeof calcularDesbalanceAcumuladoUtm>;

/**
 * Clave del factor UTM predeterminado en la tabla `configuracion`.
 *
 * Literal de db_manager.CLAVE_FACTOR_UTM_PREDETERMINADO (db_manager.py:42):
 * la misma base la comparten escritorio y teléfono, así que el texto de la
 * clave tiene que coincidir carácter a carácter.
 */
export const CLAVE_FACTOR_UTM_PREDETERMINADO = 'factor_utm_predeterminado';

/** Lo que devuelve `registrarPago`, para que la pantalla arme su mensaje. */
export interface ResultadoRegistro {
  desbalance: number;
}

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
  /**
   * Si `utmReferencia` es la del mes en curso o la de un mes anterior.
   *
   * Es el `es_actual` que `obtener_utm_referencia` devuelve junto al valor y
   * que `registro()` traduce a `base_de_datos_actual` / `base_de_datos`
   * (routes/pagos.py:105-111): el banner de registro lo necesita para
   * distinguir "verificada" de "usando UTM guardada".
   */
  utmReferenciaEsActual = $state(false);
  /**
   * Factor con el que arranca el formulario de registro: el guardado como
   * predeterminado si lo hay, y si no el del último pago. Port de la
   * precarga de `registro()` (routes/pagos.py:113-119).
   */
  factorPrecargado = $state<number | null>(null);

  /** Todos los pagos cargados, tal como vienen del repositorio. */
  private todosLosPagos: Pago[] = [];

  constructor(
    private readonly pagos: RepositorioPagos,
    private readonly utm: ServicioUtm,
    /**
     * Se recibe además del ServicioUtm porque acá hace falta ESCRIBIR en
     * `utm_historial`, no solo leer: tanto `procesar_pago` como
     * `editar_pago_post` guardan la UTM del período, y en el escritorio lo
     * hacen llamando a `db_manager.guardar_utm` directo, no pasando por
     * utm_service.
     */
    private readonly repoUtm: RepositorioUtm,
    private readonly config: RepositorioConfiguracion,
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
      this.utmReferenciaEsActual = ref.esActual;

      this.factorPrecargado = await this.calcularFactorPrecargado();

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

  /**
   * Trae la UTM del mes en curso desde mindicador.cl y, si la consigue, la
   * guarda y la deja como referencia. Port de `POST /utm/refrescar`
   * (routes/utm.py:27-52), que es lo que dispara el ↻ del banner.
   *
   * `ok` es el mismo del escritorio: solo cuenta como refresco un valor que
   * vino de mindicador.cl. `obtenerUtm` cae a la última UTM guardada cuando
   * no hay red, y esa NO se persiste ni se promueve a "actual": sería
   * declarar verificado un dato viejo.
   *
   * Nunca borra lo que ya había. Un fallo de red deja el valor anterior
   * intacto, en pantalla y en la base: perder el dato por quedarse sin señal
   * sería peor que no refrescar.
   */
  async refrescarUtm(): Promise<{ ok: boolean; utm: number | null }> {
    const hoy = new Date();
    const r = await this.utm.obtenerUtm(hoy.getFullYear(), hoy.getMonth() + 1);

    // `Number.isFinite` además de lo que pide el escritorio: un valor
    // extremo de la API entraría al cálculo de la cuota, que lo rechaza.
    // Mismo criterio defensivo que `obtenerUtmReferencia`.
    const ok = r.utm !== null && Number.isFinite(r.utm) && r.fuente === 'mindicador';
    if (!ok) {
      return { ok: false, utm: r.utm };
    }

    await this.repoUtm.guardarUtm(r.anio, r.mes, r.utm!);
    this.utmReferencia = r.utm;
    this.utmReferenciaEsActual = true;
    // Filas y resúmenes se derivan de `utmReferencia`: sin recalcular, el
    // banner mostraría la UTM nueva y la tabla seguiría con la vieja.
    // `filtrarPorAnio(this.anioFiltro)` en vez de `cargar()` porque
    // refrescar no es una navegación y no debe soltar el filtro.
    await this.filtrarPorAnio(this.anioFiltro);
    return { ok: true, utm: r.utm };
  }

  /** Un pago por su id, o null. Lo usa la pantalla de edición al abrirse. */
  async obtenerPago(id: number): Promise<Pago | null> {
    return this.pagos.obtenerPagoPorId(id);
  }

  /**
   * Registra un pago nuevo. Port de
   * `calculation_service.procesar_pago`: calcula la cuota, calcula el
   * desbalance, inserta y guarda la UTM del período en `utm_historial`.
   *
   * Recargar después equivale a la redirección a /historial del escritorio,
   * que vuelve a consultarlo todo: el filtro por año se pierde igual que
   * allá.
   */
  async registrarPago(valores: ValoresFormulario): Promise<ResultadoRegistro> {
    const cuotaPactada = calcularCuotaPactada(valores.utmFactor, valores.utmValor);
    const { diferencia } = calcularDesbalanceMensual(valores.montoPagado, cuotaPactada);

    await this.pagos.insertarPago({
      fecha: valores.fecha,
      mesPago: valores.mesPago,
      anioPago: valores.anioPago,
      utmValor: valores.utmValor,
      cuotaPactada,
      montoPagado: valores.montoPagado,
      desbalance: diferencia,
      utmFactor: valores.utmFactor,
    });

    // Paso 4 de procesar_pago: la UTM usada queda auditada y sirve de
    // respaldo cuando no hay red.
    await this.repoUtm.guardarUtm(valores.anioPago, valores.mesPago, valores.utmValor);

    await this.cargar();
    return { desbalance: diferencia };
  }

  /**
   * Reescribe un pago existente. Port de `editar_pago_post`
   * (routes/pagos.py:250-297), incluida la comprobación de existencia
   * ANTES de escribir nada y el `guardar_utm` posterior.
   *
   * Devuelve false si el id no existe, para que la pantalla avise con el
   * mismo texto que el flash del escritorio.
   */
  async actualizarPago(id: number, valores: ValoresFormulario): Promise<boolean> {
    if ((await this.pagos.obtenerPagoPorId(id)) === null) {
      return false;
    }

    const cuotaPactada = calcularCuotaPactada(valores.utmFactor, valores.utmValor);
    const { diferencia } = calcularDesbalanceMensual(valores.montoPagado, cuotaPactada);

    await this.pagos.actualizarPago(id, {
      fecha: valores.fecha,
      mesPago: valores.mesPago,
      anioPago: valores.anioPago,
      utmValor: valores.utmValor,
      cuotaPactada,
      montoPagado: valores.montoPagado,
      desbalance: diferencia,
      utmFactor: valores.utmFactor,
    });

    await this.repoUtm.guardarUtm(valores.anioPago, valores.mesPago, valores.utmValor);

    await this.cargar();
    return true;
  }

  /** Borra un pago. Devuelve false si el id no existe (`eliminar_pago`). */
  async eliminarPago(id: number): Promise<boolean> {
    const eliminado = await this.pagos.eliminarPago(id);
    await this.cargar();
    return eliminado;
  }

  /**
   * El predeterminado manda sobre el último factor usado, igual que
   * `registro()`.
   *
   * Desviación consciente: el escritorio hace `float(...)` sobre el valor
   * guardado y un texto ilegible le da un 500. Acá la carga es la que pinta
   * la pantalla entera, así que un valor corrupto se trata como si no
   * estuviera en vez de dejar la app en blanco.
   */
  private async calcularFactorPrecargado(): Promise<number | null> {
    const guardado = await this.config.obtenerConfiguracion(CLAVE_FACTOR_UTM_PREDETERMINADO);
    if (guardado !== null) {
      try {
        return limpiarFactor(guardado);
      } catch {
        // Se ignora y se cae al último factor usado.
      }
    }
    return this.repoUtm.obtenerUltimoFactorUtm();
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
