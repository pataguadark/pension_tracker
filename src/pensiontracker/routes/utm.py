"""
routes/utm.py
--------------
Blueprint: refresco de la UTM on-demand y preferencias relacionadas.

Rutas:
  POST /utm/refrescar             → Obtiene la UTM actual on-demand (mindicador.cl) → JSON
                                     (POST + CSRF: escribe en la BD, ver D6)
  POST /utm/factor-predeterminado → Guarda el factor UTM pactado como
                                     valor por defecto para /registro
  POST /utm/historico              → UTM de un mes/año específico (cachea
                                     el año completo), para completar
                                     meses pasados en /registro
"""

from flask import Blueprint, jsonify, request

from pensiontracker import formatters
from pensiontracker.database import db_manager
from pensiontracker.services import utm_service

utm_bp = Blueprint("utm", __name__)


@utm_bp.route("/utm/refrescar", methods=["POST"])
def utm_refrescar():
    """
    Obtiene el valor de la UTM del mes actual on-demand desde mindicador.cl
    y lo guarda en el historial. Devuelve JSON para actualizar la UI sin
    recargar la página.
    """
    resultado = utm_service.obtener_utm_actual()

    ok = (resultado["utm"] is not None and resultado["fuente"] == "mindicador")
    utm_fmt = None

    if resultado["utm"] is not None:
        utm_fmt = f"{int(resultado['utm']):,}".replace(",", ".")

    if ok:
        db_manager.guardar_utm(resultado["anio"], resultado["mes"], resultado["utm"])

    return jsonify({
        "ok":      ok,
        "utm":     resultado["utm"],
        "utm_fmt": utm_fmt,
        "mes":     resultado["mes"],
        "anio":    resultado["anio"],
        "fuente":  resultado["fuente"],
        "error":   resultado["error"],
    })


@utm_bp.route("/utm/factor-predeterminado", methods=["POST"])
def utm_guardar_factor_predeterminado():
    """
    Guarda el factor UTM pactado (ej: 3,0561) como valor por defecto:
    /registro lo pre-cargará en cada arranque en vez del último usado.
    """
    body = request.get_json(silent=True) or {}
    try:
        factor = formatters.limpiar_factor(str(body.get("utm_factor", "")))
        if factor <= 0:
            raise ValueError
    except ValueError:
        return jsonify({
            "ok": False,
            "error": "El factor UTM debe ser un número positivo (ej: 3,0561).",
        }), 400

    db_manager.guardar_configuracion(
        db_manager.CLAVE_FACTOR_UTM_PREDETERMINADO, str(factor)
    )

    return jsonify({"ok": True, "factor_fmt": formatters.fmt_factor(factor)})


@utm_bp.route("/utm/historico", methods=["POST"])
def utm_historico():
    """
    UTM de un mes/año específico, para completar meses pasados en
    /registro. Si ya está cacheada en la BD no hace ninguna petición de
    red; si no, trae el año completo de una vez y cachea todo.
    """
    body = request.get_json(silent=True) or {}
    try:
        anio = int(body.get("anio"))
        mes = int(body.get("mes"))
        if not 1 <= mes <= 12:
            raise ValueError
    except (TypeError, ValueError):
        return jsonify({"ok": False, "error": "Mes o año inválido."}), 400

    resultado = utm_service.obtener_utm_mes_con_cache(anio, mes)

    ok = resultado["utm"] is not None
    utm_fmt = None
    if resultado["utm"] is not None:
        utm_fmt = f"{int(resultado['utm']):,}".replace(",", ".")

    return jsonify({
        "ok":      ok,
        "utm":     resultado["utm"],
        "utm_fmt": utm_fmt,
        "mes":     resultado["mes"],
        "anio":    resultado["anio"],
        "fuente":  resultado["fuente"],
        "error":   resultado["error"],
    })
