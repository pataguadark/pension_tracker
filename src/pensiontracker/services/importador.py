"""
services/importador.py
----------------------
Importación de un respaldo `.db` recibido de afuera.

Un archivo que llega de fuera es contenido no confiable: se abre en modo
solo lectura, se valida, y solo entonces se copian sus filas a la base
propia. Nunca se adopta el archivo ajeno como base de la aplicación.

Diseño completo: docs/specs/2026-08-10-importador-respaldo.md
"""

import sqlite3
from dataclasses import dataclass
from pathlib import Path

# Estructura que tiene que tener el archivo recibido: por columna, su
# nombre, su tipo declarado y si admite NULL.
#
# Se comparan estructuras y no el texto del CREATE TABLE porque el
# escritorio crea `pagos` sin `utm_factor` y la agrega con ALTER: el SQL
# guardado difiere aunque las columnas sean idénticas. Es el mismo criterio
# que usa tests/test_interoperabilidad_db.py, y ahí está explicado largo.
COLUMNAS_ESPERADAS: dict[str, list[tuple[str, str, int]]] = {
    "pagos": [
        ("id", "INTEGER", 0),
        ("fecha", "TEXT", 1),
        ("mes_pago", "INTEGER", 1),
        ("anio_pago", "INTEGER", 1),
        ("utm_valor", "REAL", 1),
        ("cuota_pactada", "REAL", 1),
        ("monto_pagado", "REAL", 1),
        ("desbalance", "REAL", 1),
        ("utm_factor", "REAL", 0),
    ],
    "utm_historial": [
        ("id", "INTEGER", 0),
        ("anio", "INTEGER", 1),
        ("mes", "INTEGER", 1),
        ("utm_valor", "REAL", 1),
        ("fecha_registro", "TEXT", 1),
    ],
    "configuracion": [
        ("clave", "TEXT", 0),
        ("valor", "TEXT", 1),
    ],
}

MENSAJE_NO_SQLITE = "No parece un respaldo de Pensión Tracker."
MENSAJE_DANADA = "El archivo está dañado y no se puede leer."
MENSAJE_ESQUEMA_AJENO = "Es una base de datos, pero no de esta aplicación."


class RespaldoInvalido(Exception):
    """
    El archivo no sirve como respaldo.

    El mensaje se muestra tal cual al usuario, así que nunca incluye la ruta
    del archivo ni fragmentos de su contenido.
    """


@dataclass(frozen=True)
class InformeValidacion:
    """Lo que el validador averiguó y el importador necesita saber."""

    tiene_utm_factor: bool


def _abrir_solo_lectura(ruta: Path) -> sqlite3.Connection:
    """
    Abre el archivo con `mode=ro`: sqlite se niega a escribir aunque el
    código de más arriba se equivoque. Es la primera de las dos defensas,
    la otra es no adoptar nunca el archivo como base propia.
    """
    conn = sqlite3.connect(f"file:{ruta}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    return conn


def _estructura(conn: sqlite3.Connection, tabla: str) -> list[tuple[str, str, int]]:
    filas = conn.execute(f"PRAGMA table_info({tabla})").fetchall()
    return [(f["name"], f["type"].upper(), f["notnull"]) for f in filas]


def validar(ruta: Path) -> InformeValidacion:
    """
    Comprueba que el archivo sea un respaldo de esta aplicación.

    Levanta RespaldoInvalido con un mensaje mostrable si no lo es.
    """
    try:
        conn = _abrir_solo_lectura(ruta)
    except sqlite3.Error as exc:
        raise RespaldoInvalido(MENSAJE_NO_SQLITE) from exc

    try:
        try:
            resultado = conn.execute("PRAGMA integrity_check").fetchone()
        except sqlite3.DatabaseError as exc:
            # sqlite abre en diferido: un archivo que no es una base no
            # falla en connect(), falla en la primera consulta.
            raise RespaldoInvalido(MENSAJE_NO_SQLITE) from exc

        if resultado[0] != "ok":
            raise RespaldoInvalido(MENSAJE_DANADA)

        estructura_pagos = _estructura(conn, "pagos")
        esperada_pagos = COLUMNAS_ESPERADAS["pagos"]
        # Una base anterior a `utm_factor` tiene las mismas ocho primeras
        # columnas y ninguna más. Se acepta y se migra al importar.
        legacy = estructura_pagos == esperada_pagos[:-1]
        if not legacy and estructura_pagos != esperada_pagos:
            raise RespaldoInvalido(MENSAJE_ESQUEMA_AJENO)

        for tabla in ("utm_historial", "configuracion"):
            if _estructura(conn, tabla) != COLUMNAS_ESPERADAS[tabla]:
                raise RespaldoInvalido(MENSAJE_ESQUEMA_AJENO)

        # Tablas de más también son esquema ajeno: sin este chequeo, un
        # archivo con las tres tablas correctas más contenido de otra
        # aplicación pasaría la validación. Se excluye el prefijo
        # `sqlite_` porque sqlite crea `sqlite_sequence` por su cuenta en
        # cuanto se inserta la primera fila en una tabla AUTOINCREMENT
        # (pagos y utm_historial la tienen): toda base real de esta
        # aplicación la trae, y no es contenido ajeno sino del motor.
        filas = conn.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table'"
        ).fetchall()
        tablas = {f["name"] for f in filas if not f["name"].startswith("sqlite_")}
        if tablas != set(COLUMNAS_ESPERADAS):
            raise RespaldoInvalido(MENSAJE_ESQUEMA_AJENO)
    finally:
        conn.close()

    return InformeValidacion(tiene_utm_factor=not legacy)
