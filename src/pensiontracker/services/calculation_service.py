"""
calculation_service.py
----------------------
Responsabilidad: TODA la lógica de cálculo del tracker.

Fórmulas centrales:
  cuota_pactada  = utm_factor × utm_valor
  desbalance_mes = monto_pagado - cuota_pactada
  desbalance_acumulado = suma de todos los desbalances anteriores + desbalance_mes

Convenciones de signo para desbalance:
  > 0  →  Pagó de MÁS  (crédito a favor del deudor)
  = 0  →  Pago EXACTO
  < 0  →  Pagó de MENOS (deuda pendiente)

Desbalance "Valor UTM" (estilo cartola de Tribunales de Familia): en vez
de sumar diferencias en pesos a la tasa histórica de cada mes, cada
diferencia se convierte a UNIDADES UTM (a la tasa de ESE mes) y se suman
en UTM; el total se expresa en pesos a la UTM vigente HOY.
"""

from pensiontracker.database import db_manager


# -------------------------------------------------------------------
# Configuración del contrato
# -------------------------------------------------------------------

def calcular_cuota_pactada(utm_factor: float, utm_valor: float) -> float:
    """
    Calcula el monto en pesos que corresponde pagar este mes.

    Parámetros:
        utm_factor (float): Cuántas UTMs vale la pensión (ej: 3.5)
        utm_valor  (float): Valor actual de la UTM en pesos (ej: 68923.0)

    Retorna:
        float: Monto en pesos (ej: 241130.5)
    """
    if utm_factor <= 0:
        raise ValueError("El factor UTM debe ser un número positivo.")
    if utm_valor <= 0:
        raise ValueError("El valor de la UTM debe ser un número positivo.")
    return round(utm_factor * utm_valor, 2)


# -------------------------------------------------------------------
# Cálculo de desbalance mensual
# -------------------------------------------------------------------

def calcular_desbalance_mensual(monto_pagado: float,
                                cuota_pactada: float) -> dict:
    """
    Calcula el desbalance de un pago individual.

    Retorna un dict con:
        {
            "diferencia":  float,  # monto_pagado - cuota_pactada
            "estado":      str,    # "EXCEDENTE" | "EXACTO" | "DEUDA"
            "descripcion": str,    # Texto legible para la UI
        }
    """
    diferencia = round(monto_pagado - cuota_pactada, 2)

    if diferencia > 0:
        estado = "EXCEDENTE"
        descripcion = f"Pagó ${diferencia:,.0f} de más este mes."
    elif diferencia == 0:
        estado = "EXACTO"
        descripcion = "Pago exacto. Sin diferencia."
    else:
        estado = "DEUDA"
        descripcion = f"Pagó ${abs(diferencia):,.0f} de menos este mes."

    return {
        "diferencia":  diferencia,
        "estado":      estado,
        "descripcion": descripcion,
    }


# -------------------------------------------------------------------
# Desbalance "Valor UTM" (estilo cartola)
# -------------------------------------------------------------------

def _factor_de_pago(pago: dict) -> float | None:
    """Factor UTM de un pago: el guardado, o derivado de cuota_pactada/utm_valor."""
    if pago.get("utm_factor"):
        return pago["utm_factor"]
    if pago.get("utm_valor") and pago["utm_valor"] > 0:
        return pago["cuota_pactada"] / pago["utm_valor"]
    return None


def calcular_desbalance_utm_mensual(pago: dict) -> float | None:
    """
    Diferencia de un pago en UNIDADES UTM, calculada a la tasa de ESE
    mes (monto_pagado convertido a UTM, menos el factor pactado).
    Mismo signo que calcular_desbalance_mensual() para ese pago (dividir
    por utm_valor > 0 no cambia el signo). None si faltan datos.
    """
    factor = _factor_de_pago(pago)
    if factor is None or not pago.get("utm_valor"):
        return None
    return (pago["monto_pagado"] / pago["utm_valor"]) - factor


def calcular_desbalance_acumulado_utm(utm_valor_actual: float | None,
                                      pagos: list | None = None) -> dict:
    """
    Suma las diferencias mensuales en UTM (cada una a su propia tasa) y
    expresa el total en pesos a utm_valor_actual — así calculan la deuda
    los Tribunales de Familia.

    Si utm_valor_actual es None (no hay UTM de referencia disponible),
    "desbalance_ajustado" queda en None: no se puede expresar en pesos
    sin una tasa de referencia.
    """
    if pagos is None:
        pagos = db_manager.obtener_todos_los_pagos()

    total_utm = 0.0
    for pago in pagos:
        diff_utm = calcular_desbalance_utm_mensual(pago)
        if diff_utm is not None:
            total_utm += diff_utm

    # El ajuste en pesos se calcula sobre el total SIN redondear, para
    # que coincida centavo a centavo con la última fila de
    # obtener_historial_desbalances() (que acumula sin redondear entre
    # meses). total_utm ya redondeado solo se expone para mostrar/depurar.
    desbalance_ajustado = round(total_utm * utm_valor_actual, 2) if utm_valor_actual else None

    estado = ("EXCEDENTE" if total_utm > 0
              else "DEUDA" if total_utm < 0
              else "EXACTO")

    return {
        "desbalance_acumulado_utm": round(total_utm, 4),
        "desbalance_ajustado":      desbalance_ajustado,
        "estado":                   estado,
    }


# -------------------------------------------------------------------
# Desbalance acumulado histórico
# -------------------------------------------------------------------

def calcular_desbalance_acumulado() -> dict:
    """
    Suma todos los desbalances históricos registrados en la BD.

    Retorna un dict con:
        {
            "total":       float,  # Suma de todos los desbalances
            "estado":      str,    # "EXCEDENTE" | "EXACTO" | "DEUDA"
            "descripcion": str,
            "cantidad_pagos": int,
        }
    """
    pagos = db_manager.obtener_todos_los_pagos()

    if not pagos:
        return {
            "total":          0.0,
            "estado":         "EXACTO",
            "descripcion":    "No hay pagos registrados aún.",
            "cantidad_pagos": 0,
        }

    total = round(sum(p["desbalance"] for p in pagos), 2)
    cantidad = len(pagos)

    if total > 0:
        estado = "EXCEDENTE"
        descripcion = (
            f"En total se han pagado ${total:,.0f} de más "
            f"a lo largo de {cantidad} pago(s)."
        )
    elif total == 0:
        estado = "EXACTO"
        descripcion = f"Los {cantidad} pago(s) están exactamente al día."
    else:
        estado = "DEUDA"
        descripcion = (
            f"Existe una deuda acumulada de ${abs(total):,.0f} "
            f"a lo largo de {cantidad} pago(s)."
        )

    return {
        "total":          total,
        "estado":         estado,
        "descripcion":    descripcion,
        "cantidad_pagos": cantidad,
    }


# -------------------------------------------------------------------
# Función principal: procesar y registrar un pago completo
# -------------------------------------------------------------------

def procesar_pago(utm_factor: float, utm_valor: float,
                  monto_pagado: float, mes_pago: int,
                  anio_pago: int, fecha: str = None) -> dict:
    """
    Orquesta el proceso completo de registrar un pago:
      1. Calcula la cuota pactada
      2. Calcula el desbalance mensual
      3. Persiste el pago en la BD
      4. Guarda la UTM usada en el historial
      5. Retorna un resumen completo para la UI

    Parámetros:
        utm_factor   (float): UTMs pactadas por mes (ej: 3.5)
        utm_valor    (float): Valor UTM en pesos del mes
        monto_pagado (float): Cuánto pagó efectivamente
        mes_pago     (int):   Mes al que corresponde (1-12)
        anio_pago    (int):   Año al que corresponde
        fecha        (str):   Fecha de registro YYYY-MM-DD (default: hoy)

    Retorna dict completo con todos los datos calculados y el ID del registro.
    """
    from datetime import date

    if fecha is None:
        fecha = date.today().strftime("%Y-%m-%d")

    # 1. Calcular cuota
    cuota_pactada = calcular_cuota_pactada(utm_factor, utm_valor)

    # 2. Calcular desbalance mensual
    desbalance_info = calcular_desbalance_mensual(monto_pagado, cuota_pactada)
    desbalance = desbalance_info["diferencia"]

    # 3. Guardar pago en BD
    pago_id = db_manager.insertar_pago(
        fecha=fecha,
        mes_pago=mes_pago,
        anio_pago=anio_pago,
        utm_valor=utm_valor,
        cuota_pactada=cuota_pactada,
        monto_pagado=monto_pagado,
        desbalance=desbalance,
        utm_factor=utm_factor,
    )

    # 4. Guardar UTM en historial (para auditoría y fallback)
    db_manager.guardar_utm(anio_pago, mes_pago, utm_valor)

    # 5. Recalcular desbalance acumulado post-inserción
    acumulado = calcular_desbalance_acumulado()

    return {
        "pago_id":             pago_id,
        "fecha":               fecha,
        "mes_pago":            mes_pago,
        "anio_pago":           anio_pago,
        "utm_factor":          utm_factor,
        "utm_valor":           utm_valor,
        "cuota_pactada":       cuota_pactada,
        "monto_pagado":        monto_pagado,
        # Desbalance mensual
        "desbalance_mes":      desbalance,
        "estado_mes":          desbalance_info["estado"],
        "descripcion_mes":     desbalance_info["descripcion"],
        # Desbalance acumulado
        "desbalance_total":    acumulado["total"],
        "estado_total":        acumulado["estado"],
        "descripcion_total":   acumulado["descripcion"],
        "cantidad_pagos":      acumulado["cantidad_pagos"],
    }


# -------------------------------------------------------------------
# Utilidades de consulta para la UI
# -------------------------------------------------------------------

def obtener_estado_cuenta() -> dict:
    """
    Retorna el estado de cuenta completo: todos los pagos + resumen acumulado.
    Claves del resumen alineadas con historial.html:
      cantidad_pagos, total_pagado, total_pactado, desbalance_acumulado, estado
    """
    pagos = db_manager.obtener_todos_los_pagos()

    if not pagos:
        resumen = {
            "cantidad_pagos":       0,
            "total_pagado":         0.0,
            "total_pactado":        0.0,
            "desbalance_acumulado": 0.0,
            "estado":               "EXACTO",
        }
    else:
        total_pagado = round(sum(p["monto_pagado"] for p in pagos), 2)
        total_pactado = round(sum(p["cuota_pactada"] for p in pagos), 2)
        desbalance_acumulado = round(sum(p["desbalance"] for p in pagos), 2)
        estado = ("EXCEDENTE" if desbalance_acumulado > 0
                  else "DEUDA" if desbalance_acumulado < 0
                  else "EXACTO")
        resumen = {
            "cantidad_pagos":       len(pagos),
            "total_pagado":         total_pagado,
            "total_pactado":        total_pactado,
            "desbalance_acumulado": desbalance_acumulado,
            "estado":               estado,
        }

    return {
        "pagos":   pagos,
        "resumen": resumen,
    }


def obtener_estado_cuenta_anual(anio: int) -> dict:
    """
    Retorna pagos y resumen para un año específico.
    """
    pagos = db_manager.obtener_pagos_por_anio(anio)
    resumen = db_manager.obtener_resumen_anual(anio)

    # Calcular estado del desbalance anual
    desbalance_anual = resumen.get("desbalance_acumulado") or 0.0
    if desbalance_anual > 0:
        estado = "EXCEDENTE"
    elif desbalance_anual == 0:
        estado = "EXACTO"
    else:
        estado = "DEUDA"

    resumen["estado"] = estado
    return {
        "anio":   anio,
        "pagos":  pagos,
        "resumen": resumen,
    }


def formatear_pesos(monto: float) -> str:
    """
    Formatea un número como moneda chilena.
    Ejemplo: 68923.5  →  '$68.924'
    """
    return f"${monto:,.0f}".replace(",", ".")


def obtener_historial_desbalances(utm_valor_actual: float | None = None) -> list:
    """
    Retorna lista de pagos enriquecida con el desbalance acumulado
    corrido mes a mes (útil para graficar la evolución de la deuda),
    tanto en pesos históricos ("Valor") como en UTM convertido a pesos
    de hoy ("Valor UTM", estilo cartola).

    Cada item incluye 'desbalance_corrido' = suma acumulada hasta ese mes
    (pesos históricos). Si utm_valor_actual no es None, además incluye
    'desbalance_utm_mes_pesos'/'desbalance_utm_corrido_pesos' (y sus
    estados); si es None, esos campos quedan en None (sin UTM de
    referencia no se puede expresar el ajuste en pesos).
    """
    # Obtenemos pagos del más antiguo al más reciente para acumular
    pagos = db_manager.obtener_todos_los_pagos()
    pagos_ordenados = sorted(
        pagos,
        key=lambda p: (p["anio_pago"], p["mes_pago"])
    )

    acumulado_corrido = 0.0
    acumulado_utm_corrido = 0.0
    historial = []

    for pago in pagos_ordenados:
        acumulado_corrido = round(acumulado_corrido + pago["desbalance"], 2)

        diff_utm = calcular_desbalance_utm_mensual(pago)
        if diff_utm is not None:
            acumulado_utm_corrido += diff_utm

        item = {
            **pago,
            "desbalance_corrido": acumulado_corrido,
            "estado_corrido": (
                "EXCEDENTE" if acumulado_corrido > 0
                else "EXACTO" if acumulado_corrido == 0
                else "DEUDA"
            ),
            "desbalance_utm_mes_pesos": None,
            "desbalance_utm_corrido_pesos": None,
            "estado_utm_mes": None,
            "estado_utm_corrido": None,
        }

        if diff_utm is not None and utm_valor_actual:
            mes_pesos = round(diff_utm * utm_valor_actual, 2)
            corrido_pesos = round(acumulado_utm_corrido * utm_valor_actual, 2)
            item["desbalance_utm_mes_pesos"] = mes_pesos
            item["desbalance_utm_corrido_pesos"] = corrido_pesos
            item["estado_utm_mes"] = (
                "EXCEDENTE" if mes_pesos > 0 else "EXACTO" if mes_pesos == 0 else "DEUDA"
            )
            item["estado_utm_corrido"] = (
                "EXCEDENTE" if corrido_pesos > 0 else "EXACTO" if corrido_pesos == 0 else "DEUDA"
            )

        historial.append(item)

    # Retornar del más reciente al más antiguo para la UI
    return list(reversed(historial))
