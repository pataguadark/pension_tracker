"""
test_importador.py
------------------
El validador y el importador de respaldos, aislados de Flask.

Las bases de prueba se construyen acá mismo con valores sintéticos: nunca
se lee un archivo real de nadie.
"""

import sqlite3
from pathlib import Path

import pytest

from pensiontracker.services import importador


def _crear_respaldo(ruta: Path, *, con_utm_factor: bool = True) -> None:
    """Crea un .db con el esquema de la aplicación y un pago sintético."""
    conn = sqlite3.connect(ruta)
    columna_factor = ",\n            utm_factor    REAL" if con_utm_factor else ""
    conn.executescript(f"""
        CREATE TABLE pagos (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            fecha         TEXT    NOT NULL,
            mes_pago      INTEGER NOT NULL,
            anio_pago     INTEGER NOT NULL,
            utm_valor     REAL    NOT NULL,
            cuota_pactada REAL    NOT NULL,
            monto_pagado  REAL    NOT NULL,
            desbalance    REAL    NOT NULL{columna_factor}
        );
        CREATE TABLE utm_historial (
            id             INTEGER PRIMARY KEY AUTOINCREMENT,
            anio           INTEGER NOT NULL,
            mes            INTEGER NOT NULL,
            utm_valor      REAL    NOT NULL,
            fecha_registro TEXT    NOT NULL,
            UNIQUE(anio, mes)
        );
        CREATE TABLE configuracion (
            clave TEXT PRIMARY KEY,
            valor TEXT NOT NULL
        );
    """)
    if con_utm_factor:
        conn.execute(
            "INSERT INTO pagos (id, fecha, mes_pago, anio_pago, utm_valor,"
            " cuota_pactada, monto_pagado, desbalance, utm_factor)"
            " VALUES (1, '2026-07-15', 7, 2026, 70000, 210000, 200000, -10000, 3.0)"
        )
    else:
        conn.execute(
            "INSERT INTO pagos (id, fecha, mes_pago, anio_pago, utm_valor,"
            " cuota_pactada, monto_pagado, desbalance)"
            " VALUES (1, '2026-07-15', 7, 2026, 70000, 210000, 200000, -10000)"
        )
    conn.commit()
    conn.close()


def test_acepta_un_respaldo_del_esquema_actual(tmp_path):
    ruta = tmp_path / "respaldo.db"
    _crear_respaldo(ruta)

    informe = importador.validar(ruta)

    assert informe.tiene_utm_factor is True


def test_acepta_un_respaldo_legacy_sin_utm_factor(tmp_path):
    """
    El escritorio y el móvil migran esa base al arrancar, así que rechazarla
    como importación sería incoherente: es un archivo que la app abre feliz
    como base propia.
    """
    ruta = tmp_path / "legacy.db"
    _crear_respaldo(ruta, con_utm_factor=False)

    informe = importador.validar(ruta)

    assert informe.tiene_utm_factor is False


def test_rechaza_un_archivo_que_no_es_sqlite(tmp_path):
    ruta = tmp_path / "cualquier_cosa.db"
    ruta.write_bytes(b"esto no es una base de datos")

    with pytest.raises(importador.RespaldoInvalido, match="No parece un respaldo"):
        importador.validar(ruta)


def test_rechaza_una_base_de_otra_aplicacion(tmp_path):
    ruta = tmp_path / "ajena.db"
    conn = sqlite3.connect(ruta)
    conn.execute("CREATE TABLE clientes (id INTEGER PRIMARY KEY, nombre TEXT)")
    conn.commit()
    conn.close()

    with pytest.raises(importador.RespaldoInvalido, match="no de esta aplicación"):
        importador.validar(ruta)


def test_rechaza_una_tabla_con_columnas_distintas(tmp_path):
    """
    Una base con las tres tablas pero con `pagos` de otra forma. Es el caso
    que la comparación de estructura existe para atrapar: sin ella, el
    importador leería columnas que no están.
    """
    ruta = tmp_path / "parecida.db"
    conn = sqlite3.connect(ruta)
    conn.executescript("""
        CREATE TABLE pagos (id INTEGER PRIMARY KEY, monto TEXT);
        CREATE TABLE utm_historial (
            id             INTEGER PRIMARY KEY AUTOINCREMENT,
            anio           INTEGER NOT NULL,
            mes            INTEGER NOT NULL,
            utm_valor      REAL    NOT NULL,
            fecha_registro TEXT    NOT NULL,
            UNIQUE(anio, mes)
        );
        CREATE TABLE configuracion (clave TEXT PRIMARY KEY, valor TEXT NOT NULL);
    """)
    conn.commit()
    conn.close()

    with pytest.raises(importador.RespaldoInvalido, match="no de esta aplicación"):
        importador.validar(ruta)


def test_rechaza_una_base_con_una_tabla_de_mas(tmp_path):
    """
    Las tres tablas esperadas están, correctas, pero hay una cuarta ajena.
    Sin esta comprobación el validador adoptaría cualquier archivo que
    además de la estructura propia traiga contenido de otra aplicación.
    """
    ruta = tmp_path / "con_extra.db"
    _crear_respaldo(ruta)
    conn = sqlite3.connect(ruta)
    conn.execute("CREATE TABLE notas (id INTEGER PRIMARY KEY, texto TEXT)")
    conn.commit()
    conn.close()

    with pytest.raises(importador.RespaldoInvalido, match="no de esta aplicación"):
        importador.validar(ruta)


def test_rechaza_una_base_danada(tmp_path):
    """
    Un archivo con cabecera de SQLite pero con las páginas rotas: sqlite lo
    abre y falla al leerlo. Es lo que `integrity_check` está para detectar.
    """
    ruta = tmp_path / "danada.db"
    _crear_respaldo(ruta)
    contenido = bytearray(ruta.read_bytes())
    # Se conservan los primeros 16 bytes (la cadena "SQLite format 3\0")
    # y se destroza el resto: la cabecera sigue siendo válida, el cuerpo no.
    for i in range(16, len(contenido)):
        contenido[i] = 0
    ruta.write_bytes(bytes(contenido))

    with pytest.raises(importador.RespaldoInvalido):
        importador.validar(ruta)
