"""
test_db_manager.py
-------------------
Tests directos sobre db_manager: esquema, migración implícita de
utm_factor y operaciones CRUD, todo contra una BD SQLite temporal.
"""

import sqlite3

import pytest

from pensiontracker.database import db_manager


@pytest.fixture
def db(tmp_path, monkeypatch):
    db_path = tmp_path / "test.db"
    monkeypatch.setattr(db_manager, "DB_PATH", db_path)
    db_manager.inicializar_db()
    return db_path


def test_inicializar_db_crea_tablas(db):
    conn = sqlite3.connect(db)
    tablas = {row[0] for row in conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table'"
    )}
    conn.close()
    assert {"pagos", "utm_historial", "configuracion"}.issubset(tablas)


def test_inicializar_db_es_idempotente(db):
    # Llamar de nuevo no debe fallar ni duplicar la columna migrada.
    db_manager.inicializar_db()
    conn = sqlite3.connect(db)
    columnas = [row[1] for row in conn.execute("PRAGMA table_info(pagos)")]
    conn.close()
    assert columnas.count("utm_factor") == 1


def test_migracion_implicita_agrega_utm_factor(tmp_path, monkeypatch):
    """
    Simula una BD de una versión anterior (sin la columna utm_factor) y
    verifica que inicializar_db() la agrega sin perder los datos existentes.
    """
    db_path = tmp_path / "legacy.db"
    conn = sqlite3.connect(db_path)
    conn.execute("""
        CREATE TABLE pagos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            fecha TEXT NOT NULL,
            mes_pago INTEGER NOT NULL,
            anio_pago INTEGER NOT NULL,
            utm_valor REAL NOT NULL,
            cuota_pactada REAL NOT NULL,
            monto_pagado REAL NOT NULL,
            desbalance REAL NOT NULL
        )
    """)
    conn.execute(
        "INSERT INTO pagos (fecha, mes_pago, anio_pago, utm_valor, "
        "cuota_pactada, monto_pagado, desbalance) "
        "VALUES ('2024-01-01', 1, 2024, 68000, 200000, 200000, 0)"
    )
    conn.commit()
    conn.close()

    monkeypatch.setattr(db_manager, "DB_PATH", db_path)
    db_manager.inicializar_db()

    conn = sqlite3.connect(db_path)
    columnas = [row[1] for row in conn.execute("PRAGMA table_info(pagos)")]
    fila = conn.execute("SELECT fecha, utm_factor FROM pagos").fetchone()
    conn.close()

    assert "utm_factor" in columnas
    assert fila == ("2024-01-01", None)


def test_insertar_y_obtener_pago(db):
    pago_id = db_manager.insertar_pago(
        fecha="2026-07-15", mes_pago=7, anio_pago=2026,
        utm_valor=69889, cuota_pactada=213587.77,
        monto_pagado=213588, desbalance=0.23, utm_factor=3.0561,
    )
    pago = db_manager.obtener_pago_por_id(pago_id)
    assert pago["fecha"] == "2026-07-15"
    assert pago["utm_factor"] == 3.0561


def test_obtener_pago_por_id_inexistente_retorna_none(db):
    assert db_manager.obtener_pago_por_id(999) is None


def test_actualizar_pago(db):
    pago_id = db_manager.insertar_pago(
        fecha="2026-07-15", mes_pago=7, anio_pago=2026,
        utm_valor=69889, cuota_pactada=213587.77,
        monto_pagado=213588, desbalance=0.23, utm_factor=3.0561,
    )
    actualizado = db_manager.actualizar_pago(
        pago_id=pago_id, fecha="2026-08-01", mes_pago=8, anio_pago=2026,
        utm_valor=70000, cuota_pactada=214000, monto_pagado=220000,
        desbalance=6000, utm_factor=3.0561,
    )
    assert actualizado is True
    pago = db_manager.obtener_pago_por_id(pago_id)
    assert pago["monto_pagado"] == 220000


def test_actualizar_pago_inexistente_retorna_false(db):
    actualizado = db_manager.actualizar_pago(
        pago_id=999, fecha="2026-08-01", mes_pago=8, anio_pago=2026,
        utm_valor=70000, cuota_pactada=214000, monto_pagado=220000,
        desbalance=6000,
    )
    assert actualizado is False


def test_eliminar_pago(db):
    pago_id = db_manager.insertar_pago(
        fecha="2026-07-15", mes_pago=7, anio_pago=2026,
        utm_valor=69889, cuota_pactada=213587.77,
        monto_pagado=213588, desbalance=0.23,
    )
    assert db_manager.eliminar_pago(pago_id) is True
    assert db_manager.obtener_pago_por_id(pago_id) is None
    assert db_manager.eliminar_pago(pago_id) is False


def test_guardar_y_obtener_utm(db):
    db_manager.guardar_utm(2026, 7, 69889)
    guardado = db_manager.obtener_utm_guardada(2026, 7)
    assert guardado["utm_valor"] == 69889

    ultima = db_manager.obtener_ultima_utm_guardada()
    assert ultima["utm_valor"] == 69889


def test_guardar_utm_reemplaza_valor_existente(db):
    db_manager.guardar_utm(2026, 7, 69889)
    db_manager.guardar_utm(2026, 7, 70000)
    assert db_manager.obtener_utm_guardada(2026, 7)["utm_valor"] == 70000


def test_obtener_configuracion_inexistente_retorna_none(db):
    assert db_manager.obtener_configuracion("no_existe") is None


def test_guardar_y_obtener_configuracion(db):
    db_manager.guardar_configuracion("factor_utm_predeterminado", "3.0561")
    assert db_manager.obtener_configuracion("factor_utm_predeterminado") == "3.0561"


def test_guardar_configuracion_actualiza_valor_existente(db):
    db_manager.guardar_configuracion("factor_utm_predeterminado", "3.0561")
    db_manager.guardar_configuracion("factor_utm_predeterminado", "3.5")
    assert db_manager.obtener_configuracion("factor_utm_predeterminado") == "3.5"


def test_guardar_utm_bulk_inserta_varios_meses_en_una_transaccion(db):
    db_manager.guardar_utm_bulk(2024, {1: 65000, 2: 65200, 3: 65400})

    assert db_manager.obtener_utm_guardada(2024, 1)["utm_valor"] == 65000
    assert db_manager.obtener_utm_guardada(2024, 2)["utm_valor"] == 65200
    assert db_manager.obtener_utm_guardada(2024, 3)["utm_valor"] == 65400


def test_guardar_utm_bulk_con_diccionario_vacio_no_hace_nada(db):
    db_manager.guardar_utm_bulk(2024, {})
    assert db_manager.obtener_ultima_utm_guardada() is None
