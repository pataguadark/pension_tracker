"""
test_utm_service.py
--------------------
Tests de utm_service: éxito, timeout, sin conexión y fallback a la BD.
mindicador.cl siempre está mockeado; ningún test hace una petición real.
"""

from datetime import datetime
from unittest.mock import Mock

import pytest
import requests

from pensiontracker.database import db_manager
from pensiontracker.services import utm_service


@pytest.fixture
def db_temporal(tmp_path, monkeypatch):
    db_path = tmp_path / "test.db"
    monkeypatch.setattr(db_manager, "DB_PATH", db_path)
    db_manager.inicializar_db()
    return db_path


def _mock_respuesta_ok(serie):
    resp = Mock()
    resp.raise_for_status = Mock()
    resp.json = Mock(return_value={"codigo": "utm", "serie": serie})
    return resp


def test_obtener_utm_exito_via_mindicador(monkeypatch):
    serie = [{"fecha": "2026-07-01T04:00:00.000Z", "valor": 69889}]
    monkeypatch.setattr(
        utm_service.requests, "get",
        Mock(return_value=_mock_respuesta_ok(serie)),
    )

    resultado = utm_service.obtener_utm(2026, 7)

    assert resultado["fuente"] == "mindicador"
    assert resultado["utm"] == 69889.0
    assert resultado["error"] is None


def test_obtener_utm_mes_no_publicado_sin_fallback(monkeypatch, db_temporal):
    """La API responde pero el mes pedido no está en la serie: sin BD, no hay fallback posible."""
    monkeypatch.setattr(
        utm_service.requests, "get",
        Mock(return_value=_mock_respuesta_ok([])),
    )

    resultado = utm_service.obtener_utm(2026, 7)

    assert resultado["fuente"] == "no_disponible"
    assert resultado["utm"] is None
    assert resultado["error"] is not None


def test_obtener_utm_timeout_con_fallback_a_bd(monkeypatch, db_temporal):
    db_manager.guardar_utm(2025, 12, 68500)

    monkeypatch.setattr(
        utm_service.requests, "get",
        Mock(side_effect=requests.exceptions.Timeout()),
    )

    resultado = utm_service.obtener_utm(2026, 7)

    assert resultado["fuente"] == "base_de_datos"
    assert resultado["utm"] == 68500
    assert "AVISO" in resultado["error"]


def test_obtener_utm_sin_conexion_y_sin_fallback_en_bd(monkeypatch, db_temporal):
    monkeypatch.setattr(
        utm_service.requests, "get",
        Mock(side_effect=requests.exceptions.ConnectionError()),
    )

    resultado = utm_service.obtener_utm(2026, 7)

    assert resultado["fuente"] == "no_disponible"
    assert resultado["utm"] is None
    assert resultado["error"] is not None
    assert "No hay UTM guardada" in resultado["error"]


def test_obtener_utm_actual_usa_mes_y_anio_de_hoy(monkeypatch):
    hoy = datetime.today()
    serie = [{"fecha": f"{hoy.year}-{hoy.month:02d}-01T04:00:00.000Z", "valor": 69889}]
    monkeypatch.setattr(
        utm_service.requests, "get",
        Mock(return_value=_mock_respuesta_ok(serie)),
    )

    resultado = utm_service.obtener_utm_actual()

    assert resultado["anio"] == hoy.year
    assert resultado["mes"] == hoy.month
    assert resultado["fuente"] == "mindicador"


def test_refrescar_utm_si_falta_guarda_cuando_no_hay_utm_del_mes(monkeypatch, db_temporal):
    hoy = datetime.today()
    serie = [{"fecha": f"{hoy.year}-{hoy.month:02d}-01T04:00:00.000Z", "valor": 71649}]
    monkeypatch.setattr(
        utm_service.requests, "get",
        Mock(return_value=_mock_respuesta_ok(serie)),
    )

    utm_service.refrescar_utm_si_falta()

    guardada = db_manager.obtener_utm_guardada(hoy.year, hoy.month)
    assert guardada is not None
    assert guardada["utm_valor"] == 71649


def test_refrescar_utm_si_falta_no_hace_nada_si_ya_existe(monkeypatch, db_temporal):
    hoy = datetime.today()
    db_manager.guardar_utm(hoy.year, hoy.month, 12345)

    monkeypatch.setattr(
        utm_service.requests, "get",
        Mock(side_effect=AssertionError("no debería llamar a la red")),
    )

    utm_service.refrescar_utm_si_falta()

    guardada = db_manager.obtener_utm_guardada(hoy.year, hoy.month)
    assert guardada["utm_valor"] == 12345


def test_refrescar_utm_si_falta_ignora_error_de_red(monkeypatch, db_temporal):
    monkeypatch.setattr(
        utm_service.requests, "get",
        Mock(side_effect=requests.exceptions.ConnectionError()),
    )

    utm_service.refrescar_utm_si_falta()  # no debe lanzar

    hoy = datetime.today()
    assert db_manager.obtener_utm_guardada(hoy.year, hoy.month) is None


def test_obtener_utm_referencia_usa_mes_actual_si_esta_guardado(db_temporal):
    hoy = datetime.today()
    db_manager.guardar_utm(hoy.year, hoy.month, 71649)

    ref = utm_service.obtener_utm_referencia()

    assert ref == {"utm_valor": 71649, "es_actual": True}


def test_obtener_utm_referencia_cae_a_ultima_guardada(db_temporal):
    anio_pasado = datetime.today().year - 1
    db_manager.guardar_utm(anio_pasado, 1, 50000)

    ref = utm_service.obtener_utm_referencia()

    assert ref == {"utm_valor": 50000, "es_actual": False}


def test_obtener_utm_referencia_retorna_none_sin_datos(db_temporal):
    ref = utm_service.obtener_utm_referencia()

    assert ref == {"utm_valor": None, "es_actual": False}


def test_obtener_utm_referencia_trata_valor_actual_infinito_como_ausente(db_temporal):
    """
    Regresión (punto 1 de la revisión): una fila de utm_historial con un
    valor infinito (persistida por una versión anterior sin el guard de
    finitud) no debe propagarse como utm_valor_actual: eso es lo que
    hacía reventar /historial con un ValueError sin capturar, cuando la
    v1.0.2 publicada respondía 200 en ese mismo estado. Al leer, se trata
    como si no hubiera UTM guardada para el mes: "sin UTM de referencia".

    Nota de simetría: calcular_desbalance_acumulado_utm() sigue lanzando
    ValueError si se le pasa un utm_valor_actual no finito DIRECTAMENTE
    (ver desbalance-utm.json, bloque "acumulado", casos "no finito ...
    debe lanzar error") — ese es el contrato correcto para una llamada
    directa. Lo que cambia acá es que obtener_utm_referencia() nunca deja
    que un valor corrupto ya persistido llegue a ese punto.
    """
    hoy = datetime.today()
    db_manager.guardar_utm(hoy.year, hoy.month, float("inf"))

    ref = utm_service.obtener_utm_referencia()

    assert ref == {"utm_valor": None, "es_actual": False}


def test_obtener_utm_referencia_trata_ultima_infinita_como_ausente(db_temporal):
    """Mismo caso que el anterior, pero cuando la fila infinita es la que
    cae por el camino de "última guardada" (mes actual sin dato propio)."""
    anio_pasado = datetime.today().year - 1
    db_manager.guardar_utm(anio_pasado, 1, float("inf"))

    ref = utm_service.obtener_utm_referencia()

    assert ref == {"utm_valor": None, "es_actual": False}


# -------------------------------------------------------------------
# obtener_utm_anio / obtener_utm_mes_con_cache (completar meses pasados)
# -------------------------------------------------------------------

def test_obtener_utm_anio_extrae_todos_los_meses(monkeypatch):
    serie = [
        {"fecha": "2024-01-01T04:00:00.000Z", "valor": 65000},
        {"fecha": "2024-02-01T04:00:00.000Z", "valor": 65200},
        {"fecha": "2024-03-01T04:00:00.000Z", "valor": 65400},
    ]
    monkeypatch.setattr(
        utm_service.requests, "get",
        Mock(return_value=_mock_respuesta_ok(serie)),
    )

    valores = utm_service.obtener_utm_anio(2024)

    assert valores == {1: 65000.0, 2: 65200.0, 3: 65400.0}


def test_obtener_utm_anio_ignora_entradas_sin_valor(monkeypatch):
    serie = [
        {"fecha": "2024-01-01T04:00:00.000Z", "valor": 65000},
        {"fecha": "2024-02-01T04:00:00.000Z", "valor": None},
    ]
    monkeypatch.setattr(
        utm_service.requests, "get",
        Mock(return_value=_mock_respuesta_ok(serie)),
    )

    valores = utm_service.obtener_utm_anio(2024)

    assert valores == {1: 65000.0}


def test_obtener_utm_mes_con_cache_usa_bd_sin_llamar_a_la_red(monkeypatch, db_temporal):
    db_manager.guardar_utm(2024, 3, 65400)
    monkeypatch.setattr(
        utm_service.requests, "get",
        Mock(side_effect=AssertionError("no debería llamar a la red: ya está en caché")),
    )

    resultado = utm_service.obtener_utm_mes_con_cache(2024, 3)

    assert resultado["utm"] == 65400
    assert resultado["fuente"] == "base_de_datos"


def test_obtener_utm_mes_con_cache_trae_anio_completo_y_cachea_todos_los_meses(monkeypatch, db_temporal):
    serie = [
        {"fecha": "2024-01-01T04:00:00.000Z", "valor": 65000},
        {"fecha": "2024-02-01T04:00:00.000Z", "valor": 65200},
        {"fecha": "2024-03-01T04:00:00.000Z", "valor": 65400},
    ]
    monkeypatch.setattr(
        utm_service.requests, "get",
        Mock(return_value=_mock_respuesta_ok(serie)),
    )

    resultado = utm_service.obtener_utm_mes_con_cache(2024, 2)

    assert resultado["utm"] == 65200.0
    assert resultado["fuente"] == "mindicador"
    # Se cachearon TODOS los meses recibidos, no solo el pedido.
    assert db_manager.obtener_utm_guardada(2024, 1)["utm_valor"] == 65000.0
    assert db_manager.obtener_utm_guardada(2024, 2)["utm_valor"] == 65200.0
    assert db_manager.obtener_utm_guardada(2024, 3)["utm_valor"] == 65400.0


def test_obtener_utm_mes_con_cache_mes_no_publicado_retorna_no_disponible(monkeypatch, db_temporal):
    serie = [{"fecha": "2024-01-01T04:00:00.000Z", "valor": 65000}]
    monkeypatch.setattr(
        utm_service.requests, "get",
        Mock(return_value=_mock_respuesta_ok(serie)),
    )

    resultado = utm_service.obtener_utm_mes_con_cache(2024, 12)

    assert resultado["utm"] is None
    assert resultado["fuente"] == "no_disponible"
    # Igual se cachea lo que sí vino en la respuesta.
    assert db_manager.obtener_utm_guardada(2024, 1)["utm_valor"] == 65000.0


def test_obtener_utm_anio_descarta_valores_no_finitos(monkeypatch):
    """
    Regresión (punto 1 de la revisión, frente de escritura): mindicador.cl
    es una fuente externa; un "valor" fuera del rango representable por un
    double (p. ej. un número con cientos de dígitos) decodifica a `inf` al
    pasar por float(), y antes de este fix se persistía tal cual en
    utm_historial. Ahora ese mes se descarta (como si no hubiera sido
    publicado), en vez de guardar un valor corrupto.
    """
    serie = [
        {"fecha": "2024-01-01T04:00:00.000Z", "valor": 65000},
        {"fecha": "2024-02-01T04:00:00.000Z", "valor": float("inf")},
        {"fecha": "2024-03-01T04:00:00.000Z", "valor": float("nan")},
    ]
    monkeypatch.setattr(
        utm_service.requests, "get",
        Mock(return_value=_mock_respuesta_ok(serie)),
    )

    valores = utm_service.obtener_utm_anio(2024)

    assert valores == {1: 65000.0}


def test_obtener_utm_mes_con_cache_no_cachea_valor_infinito_de_la_api(monkeypatch, db_temporal):
    """Extremo a extremo del frente de escritura: un valor infinito que
    venga de mindicador.cl no debe terminar guardado por
    obtener_utm_mes_con_cache (usado al completar meses pasados)."""
    serie = [{"fecha": "2024-05-01T04:00:00.000Z", "valor": float("inf")}]
    monkeypatch.setattr(
        utm_service.requests, "get",
        Mock(return_value=_mock_respuesta_ok(serie)),
    )

    resultado = utm_service.obtener_utm_mes_con_cache(2024, 5)

    assert resultado["utm"] is None
    assert resultado["fuente"] == "no_disponible"
    assert db_manager.obtener_utm_guardada(2024, 5) is None


def test_obtener_utm_mes_con_cache_error_de_red_retorna_no_disponible(monkeypatch, db_temporal):
    monkeypatch.setattr(
        utm_service.requests, "get",
        Mock(side_effect=requests.exceptions.ConnectionError()),
    )

    resultado = utm_service.obtener_utm_mes_con_cache(2024, 1)

    assert resultado["utm"] is None
    assert resultado["fuente"] == "no_disponible"
    assert resultado["error"] is not None
