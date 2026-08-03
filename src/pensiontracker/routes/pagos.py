"""
routes/pagos.py
----------------
Blueprint: registro, historial y edición de pagos.

Rutas:
  GET  /                  → Redirige a /registro
  GET  /registro          → Formulario de nuevo pago (pre-carga última UTM y factor usados)
  POST /registro          → Procesa y guarda el pago
  GET  /historial         → Lista de pagos + desbalance acumulado
  GET  /historial/<anio>  → Filtrado por año
  GET  /editar/<id>       → Formulario de edición de un pago existente
  POST /editar/<id>       → Guarda los cambios del pago editado
  POST /eliminar/<id>     → Elimina un pago por ID
"""

from datetime import date

from flask import Blueprint, flash, redirect, render_template, request, url_for

from pensiontracker import formatters
from pensiontracker.database import db_manager
from pensiontracker.services import calculation_service, utm_service

pagos_bp = Blueprint("pagos", __name__)


# -------------------------------------------------------------------
# Helpers de validación de formulario
# -------------------------------------------------------------------

def _validar_formulario_pago(form) -> tuple[dict, list]:
    """
    Valida y parsea los campos comunes del formulario de pago
    (registro y edición comparten exactamente esta validación).

    Retorna (valores, errores): valores trae None en los campos inválidos.
    """
    errores = []
    valores = {}

    try:
        valores["utm_factor"] = formatters.limpiar_factor(form.get("utm_factor", ""))
        if valores["utm_factor"] <= 0:
            raise ValueError
    except ValueError:
        errores.append("El factor UTM debe ser un número positivo (ej: 3,0561).")
        valores["utm_factor"] = None

    try:
        valores["utm_valor"] = formatters.limpiar_entero(form.get("utm_valor", ""))
        if valores["utm_valor"] <= 0:
            raise ValueError
    except ValueError:
        errores.append("El valor UTM debe ser un número entero positivo (ej: 69.889).")
        valores["utm_valor"] = None

    try:
        valores["monto_pagado"] = formatters.limpiar_entero(form.get("monto_pagado", ""))
        if valores["monto_pagado"] < 0:
            raise ValueError
    except ValueError:
        errores.append("El monto pagado debe ser un número entero positivo.")
        valores["monto_pagado"] = None

    try:
        valores["mes_pago"] = int(form.get("mes_pago", 0))
        if not 1 <= valores["mes_pago"] <= 12:
            raise ValueError
    except ValueError:
        errores.append("El mes debe ser un número entre 1 y 12.")
        valores["mes_pago"] = None

    try:
        valores["anio_pago"] = int(form.get("anio_pago", 0))
        if valores["anio_pago"] < 2000:
            raise ValueError
    except ValueError:
        errores.append("El año debe ser un número válido (ej: 2024).")
        valores["anio_pago"] = None

    return valores, errores


# -------------------------------------------------------------------
# Rutas
# -------------------------------------------------------------------

@pagos_bp.route("/")
def index():
    return redirect(url_for("pagos.registro"))


# ---------- REGISTRO DE PAGO ----------

@pagos_bp.route("/registro", methods=["GET"])
def registro():
    """
    Muestra el formulario de registro.
    Pre-carga la UTM y el Factor UTM con los últimos valores guardados en la BD.
    """
    hoy = date.today()

    ref = utm_service.obtener_utm_referencia()
    utm_valor = ref["utm_valor"]
    if utm_valor is None:
        utm_fuente = None
    elif ref["es_actual"]:
        utm_fuente = "base_de_datos_actual"
    else:
        utm_fuente = "base_de_datos"

    factor_predeterminado = db_manager.obtener_configuracion(
        db_manager.CLAVE_FACTOR_UTM_PREDETERMINADO
    )
    if factor_predeterminado is not None:
        ultimo_factor = float(factor_predeterminado)
    else:
        ultimo_factor = db_manager.obtener_ultimo_factor_utm()

    def _fmt_entero(n):
        return f"{int(n):,}".replace(",", ".") if n is not None else ""

    return render_template(
        "registro_pago.html",
        utm_valor_fmt=_fmt_entero(utm_valor),
        utm_fuente=utm_fuente,
        utm_error=None,
        mes_actual=hoy.month,
        anio_actual=hoy.year,
        fecha_hoy=hoy.strftime("%Y-%m-%d"),
        ultimo_factor_fmt=formatters.fmt_factor(ultimo_factor),
    )


@pagos_bp.route("/registro", methods=["POST"])
def registro_post():
    """Recibe el formulario, valida los datos, calcula y guarda el pago."""
    valores, errores = _validar_formulario_pago(request.form)
    fecha = request.form.get("fecha") or date.today().strftime("%Y-%m-%d")

    if errores:
        for e in errores:
            flash(e, "error")
        return redirect(url_for("pagos.registro"))

    try:
        resultado = calculation_service.procesar_pago(
            utm_factor=valores["utm_factor"],
            utm_valor=valores["utm_valor"],
            monto_pagado=valores["monto_pagado"],
            mes_pago=valores["mes_pago"],
            anio_pago=valores["anio_pago"],
            fecha=fecha,
        )
        flash(
            f"✅ Pago registrado correctamente. {resultado['descripcion_mes']}",
            "success"
        )
        return redirect(url_for("pagos.historial"))

    except Exception as e:
        flash(f"Error al procesar el pago: {str(e)}", "error")
        return redirect(url_for("pagos.registro"))


# ---------- HISTORIAL ----------

@pagos_bp.route("/historial")
def historial():
    """Muestra el historial completo de pagos con desbalance acumulado."""
    estado_cuenta = calculation_service.obtener_estado_cuenta()
    ref = utm_service.obtener_utm_referencia()
    historial_detalle = calculation_service.obtener_historial_desbalances(ref["utm_valor"])
    resumen_utm = calculation_service.calcular_desbalance_acumulado_utm(
        ref["utm_valor"], pagos=estado_cuenta["pagos"]
    )

    pagos = estado_cuenta["pagos"]
    anios_disponibles = sorted(
        set(p["anio_pago"] for p in pagos),
        reverse=True
    )

    return render_template(
        "historial.html",
        pagos=historial_detalle,
        resumen=estado_cuenta["resumen"],
        resumen_utm=resumen_utm,
        anios_disponibles=anios_disponibles,
        anio_filtro=None,
    )


@pagos_bp.route("/historial/<int:anio>")
def historial_anio(anio):
    """Muestra el historial filtrado por año."""
    estado_anual = calculation_service.obtener_estado_cuenta_anual(anio)
    ref = utm_service.obtener_utm_referencia()
    resumen_utm = calculation_service.calcular_desbalance_acumulado_utm(
        ref["utm_valor"], pagos=estado_anual["pagos"]
    )

    historial_anual = calculation_service.obtener_historial_desbalances(
        ref["utm_valor"], pagos=estado_anual["pagos"]
    )

    todos = db_manager.obtener_todos_los_pagos()
    anios_disponibles = sorted(
        set(p["anio_pago"] for p in todos),
        reverse=True
    )

    return render_template(
        "historial.html",
        pagos=historial_anual,
        resumen=estado_anual["resumen"],
        resumen_utm=resumen_utm,
        anios_disponibles=anios_disponibles,
        anio_filtro=anio,
    )


# ---------- EDITAR PAGO ----------

@pagos_bp.route("/editar/<int:pago_id>", methods=["GET"])
def editar_pago(pago_id):
    """Muestra el formulario de edición pre-cargado con los datos del pago."""
    pago = db_manager.obtener_pago_por_id(pago_id)
    if not pago:
        flash(f"No se encontró el pago #{pago_id}.", "error")
        return redirect(url_for("pagos.historial"))

    if pago.get("utm_factor"):
        utm_factor_calculado = round(pago["utm_factor"], 4)
    elif pago["utm_valor"] and pago["utm_valor"] > 0:
        utm_factor_calculado = round(
            pago["cuota_pactada"] / pago["utm_valor"], 4)
    else:
        utm_factor_calculado = None

    return render_template(
        "editar_pago.html",
        pago=pago,
        utm_factor_calc=utm_factor_calculado,
        utm_factor_calc_fmt=formatters.fmt_factor(utm_factor_calculado),
    )


@pagos_bp.route("/editar/<int:pago_id>", methods=["POST"])
def editar_pago_post(pago_id):
    """Recibe el formulario de edición, recalcula y actualiza el pago."""
    pago = db_manager.obtener_pago_por_id(pago_id)
    if not pago:
        flash(f"No se encontró el pago #{pago_id}.", "error")
        return redirect(url_for("pagos.historial"))

    valores, errores = _validar_formulario_pago(request.form)
    fecha = request.form.get("fecha") or pago["fecha"]

    if errores:
        for e in errores:
            flash(e, "error")
        return redirect(url_for("pagos.editar_pago", pago_id=pago_id))

    try:
        cuota_pactada = calculation_service.calcular_cuota_pactada(
            valores["utm_factor"], valores["utm_valor"])
        desbalance = round(valores["monto_pagado"] - cuota_pactada, 2)

        db_manager.actualizar_pago(
            pago_id=pago_id,
            fecha=fecha,
            mes_pago=valores["mes_pago"],
            anio_pago=valores["anio_pago"],
            utm_valor=valores["utm_valor"],
            cuota_pactada=cuota_pactada,
            monto_pagado=valores["monto_pagado"],
            desbalance=desbalance,
            utm_factor=valores["utm_factor"],
        )

        db_manager.guardar_utm(valores["anio_pago"], valores["mes_pago"], valores["utm_valor"])

    except Exception as e:
        # Mismo patrón que registro_post(): un factor con muchos dígitos
        # pasa limpiar_factor (son dígitos ASCII válidos) pero puede hacer
        # que el producto utm_factor × utm_valor desborde a infinito, y
        # calcular_cuota_pactada lo rechaza con ValueError. Sin este
        # try/except esa excepción no se capturaba acá (a diferencia de
        # registro_post), y /editar/<id> respondía 500 en vez de 302 con
        # un mensaje de error, como hacía la versión publicada.
        flash(f"Error al procesar el pago: {str(e)}", "error")
        return redirect(url_for("pagos.editar_pago", pago_id=pago_id))

    flash(f"✅ Pago #{pago_id} actualizado correctamente.", "success")
    return redirect(url_for("pagos.historial"))


# ---------- ELIMINAR PAGO ----------

@pagos_bp.route("/eliminar/<int:pago_id>", methods=["POST"])
def eliminar_pago(pago_id):
    """Elimina un pago por ID y redirige al historial."""
    eliminado = db_manager.eliminar_pago(pago_id)
    if eliminado:
        flash(f"Pago #{pago_id} eliminado correctamente.", "success")
    else:
        flash(f"No se encontró el pago #{pago_id}.", "error")
    return redirect(url_for("pagos.historial"))
