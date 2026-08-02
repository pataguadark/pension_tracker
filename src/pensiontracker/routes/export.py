"""
routes/export.py
-----------------
Blueprint: exportación y respaldo de los pagos.

Rutas:
  GET  /exportar          → Descarga CSV con todos los pagos
  POST /respaldar         → Descarga una copia binaria completa de la BD
                             (API .backup de sqlite3; POST + CSRF)
"""

import csv
import io
import os
import sqlite3
import tempfile
from datetime import date

from flask import Blueprint, flash, redirect, send_file, url_for

from pensiontracker.database import db_manager

export_bp = Blueprint("export", __name__)


@export_bp.route("/exportar")
def exportar_csv():
    """
    Genera y descarga un archivo CSV con todos los pagos registrados.

    Formato pensado para abrirse directamente en Excel (Chile):
      - Separador ';' (evita conflicto con la coma decimal chilena).
      - Codificación UTF-8 con BOM (utf-8-sig) para respetar los acentos.
    """
    pagos = db_manager.obtener_todos_los_pagos()

    if not pagos:
        flash("No hay pagos registrados para exportar.", "warning")
        return redirect(url_for("pagos.historial"))

    encabezados = ["ID", "Fecha Registro", "Año", "Mes",
                   "Factor UTM", "Valor UTM ($)", "Cuota Pactada ($)",
                   "Monto Pagado ($)", "Desbalance ($)", "Estado"]

    texto = io.StringIO()
    writer = csv.writer(texto, delimiter=";")
    writer.writerow(encabezados)
    for pago in pagos:
        desbalance = pago["desbalance"]
        estado = "EXCEDENTE" if desbalance > 0 else ("EXACTO" if desbalance == 0 else "DEUDA")
        writer.writerow([
            pago["id"], pago["fecha"], pago["anio_pago"], pago["mes_pago"],
            pago["utm_factor"], pago["utm_valor"], pago["cuota_pactada"],
            pago["monto_pagado"], desbalance, estado,
        ])

    output = io.BytesIO(texto.getvalue().encode("utf-8-sig"))
    output.seek(0)

    nombre_archivo = f"pension_tracker_{date.today().strftime('%Y%m%d')}.csv"

    return send_file(
        output,
        mimetype="text/csv",
        as_attachment=True,
        download_name=nombre_archivo,
    )


@export_bp.route("/respaldar", methods=["POST"])
def respaldar_datos():
    """
    Genera una copia binaria completa de la BD (vía la API .backup de
    sqlite3, que produce una copia consistente aunque haya escrituras
    concurrentes) y la descarga para que el usuario la guarde donde quiera.
    """
    fd, tmp_path = tempfile.mkstemp(suffix=".db")
    os.close(fd)

    origen = db_manager.get_connection()
    destino = sqlite3.connect(tmp_path)
    try:
        origen.backup(destino)
    finally:
        destino.close()
        origen.close()

    nombre_archivo = f"pension_tracker_backup_{date.today().strftime('%Y%m%d')}.db"

    respuesta = send_file(
        tmp_path,
        mimetype="application/x-sqlite3",
        as_attachment=True,
        download_name=nombre_archivo,
    )
    respuesta.call_on_close(lambda: os.remove(tmp_path))
    return respuesta
