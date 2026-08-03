"""
test_routes.py
---------------
Tests de los blueprints vía el test client de Flask: CRUD de pagos,
CSRF activo, exportación CSV y verificación de que los endpoints
mutadores rechazan GET.
"""

from datetime import datetime
from unittest.mock import Mock

import pytest

from pensiontracker import create_app
from pensiontracker.database import db_manager
from pensiontracker.services import utm_service
from tests.conftest import extraer_csrf_token


def _registrar_pago(client, **overrides):
    """Registra un pago vía POST /registro y retorna la respuesta (siguiendo el redirect)."""
    resp = client.get("/registro")
    token = extraer_csrf_token(resp.get_data(as_text=True))

    datos = {
        "csrf_token": token,
        "utm_factor": "3,0561",
        "utm_valor": "69.889",
        "monto_pagado": "213.588",
        "mes_pago": "7",
        "anio_pago": "2026",
        "fecha": "2026-07-15",
    }
    datos.update(overrides)
    return client.post("/registro", data=datos, follow_redirects=True)


def test_registro_sin_csrf_token_falla(client):
    resp = client.post("/registro", data={
        "utm_factor": "3,0561",
        "utm_valor": "69.889",
        "monto_pagado": "213.588",
        "mes_pago": "7",
        "anio_pago": "2026",
    })
    assert resp.status_code == 400


def test_registro_valido_crea_pago_y_aparece_en_historial(client):
    resp = _registrar_pago(client)
    assert resp.status_code == 200
    assert b"213.588" in resp.data


def test_registro_con_punto_decimal_en_factor_no_decuplica_la_cuota(client):
    """
    Extremo a extremo (cableado completo POST /registro → BD): el bug
    original convertía '3.5' en 35 al descartar el punto como separador
    decimal, decuplicando cuota_pactada. Postea con punto y verifica que
    la cuota guardada corresponde a factor 3,5, no a 35.
    """
    resp = _registrar_pago(client, utm_factor="3.5", utm_valor="69.889")
    assert resp.status_code == 200

    pago = db_manager.obtener_pago_por_id(1)
    assert pago is not None
    assert pago["utm_factor"] == pytest.approx(3.5)
    assert pago["cuota_pactada"] == pytest.approx(3.5 * 69889, abs=0.01)
    # Guarda contra la regresión: no debe haberse colado el valor decuplicado.
    assert pago["cuota_pactada"] != pytest.approx(35 * 69889, abs=0.01)


def test_historial_vacio_muestra_estado_vacio(client):
    resp = client.get("/historial")
    assert resp.status_code == 200
    assert "Sin pagos registrados".encode() in resp.data


def test_editar_pago_actualiza_valores(client):
    _registrar_pago(client)

    resp = client.get("/editar/1")
    assert resp.status_code == 200
    token = extraer_csrf_token(resp.get_data(as_text=True))

    resp = client.post("/editar/1", data={
        "csrf_token": token,
        "utm_factor": "3,0561",
        "utm_valor": "70.000",
        "monto_pagado": "220.000",
        "mes_pago": "8",
        "anio_pago": "2026",
        "fecha": "2026-08-01",
    }, follow_redirects=True)

    assert resp.status_code == 200
    assert b"220.000" in resp.data


def test_editar_pago_inexistente_redirige_a_historial(client):
    resp = client.get("/editar/999", follow_redirects=True)
    assert resp.status_code == 200
    assert "No se encontr".encode() in resp.data


def test_eliminar_pago(client):
    _registrar_pago(client)

    resp = client.get("/historial")
    token = extraer_csrf_token(resp.get_data(as_text=True))

    resp = client.post("/eliminar/1", data={"csrf_token": token}, follow_redirects=True)
    assert resp.status_code == 200
    assert "Sin pagos registrados".encode() in resp.data


def test_exportar_csv_con_pagos(client):
    _registrar_pago(client)

    resp = client.get("/exportar")
    assert resp.status_code == 200
    assert resp.mimetype == "text/csv"
    assert b"213587.77" in resp.data


def test_exportar_csv_sin_pagos_redirige(client):
    resp = client.get("/exportar", follow_redirects=True)
    assert resp.status_code == 200
    assert "No hay pagos registrados".encode() in resp.data


def test_get_eliminar_devuelve_405(client):
    resp = client.get("/eliminar/1")
    assert resp.status_code == 405


def test_get_utm_refrescar_devuelve_405(client):
    resp = client.get("/utm/refrescar")
    assert resp.status_code == 405


def test_get_respaldar_devuelve_405(client):
    resp = client.get("/respaldar")
    assert resp.status_code == 405


def test_registro_get_banner_rojo_sin_utm_guardada(client):
    resp = client.get("/registro")
    assert b"utm-error" in resp.data
    assert "UTM no disponible".encode() in resp.data


def test_registro_get_banner_verde_cuando_utm_mes_actual_en_bd(client):
    hoy = datetime.today()
    db_manager.guardar_utm(hoy.year, hoy.month, 71649)

    resp = client.get("/registro")

    assert b"utm-ok" in resp.data
    assert "verificada".encode() in resp.data


def test_registro_get_banner_amarillo_cuando_utm_es_de_otro_mes(client):
    anio_pasado = datetime.today().year - 1
    db_manager.guardar_utm(anio_pasado, 1, 50000)

    resp = client.get("/registro")

    assert b"utm-warn" in resp.data
    assert "no es del mes actual".encode() in resp.data


def test_create_app_en_testing_no_llama_a_mindicador(monkeypatch, tmp_path):
    """
    Contrato de aislamiento: create_app() solo dispara el refresco de
    UTM al arrancar (D2) cuando NO está en modo TESTING. Si este guard
    se rompe, toda la suite empezaría a hacer peticiones de red reales.
    """
    monkeypatch.setattr(
        utm_service.requests, "get",
        Mock(side_effect=AssertionError(
            "create_app() no debe llamar a mindicador.cl en modo TESTING"
        )),
    )

    create_app({
        "TESTING": True,
        "WTF_CSRF_ENABLED": True,
        "DB_PATH": tmp_path / "test.db",
    })


def test_guardar_factor_predeterminado_cambia_prellenado_de_registro(client):
    _registrar_pago(client)  # deja un pago con factor 3,0561 como "último usado"

    resp = client.get("/registro")
    token = extraer_csrf_token(resp.get_data(as_text=True))

    resp = client.post(
        "/utm/factor-predeterminado",
        json={"utm_factor": "4,25"},
        headers={"X-CSRFToken": token},
    )
    assert resp.status_code == 200
    assert resp.get_json()["ok"] is True

    resp = client.get("/registro")
    assert b'value="4,25"' in resp.data


def test_guardar_factor_predeterminado_sin_csrf_falla(client):
    resp = client.post("/utm/factor-predeterminado", json={"utm_factor": "4,25"})
    assert resp.status_code == 400


def test_guardar_factor_predeterminado_valor_invalido_devuelve_error(client):
    resp = client.get("/registro")
    token = extraer_csrf_token(resp.get_data(as_text=True))

    resp = client.post(
        "/utm/factor-predeterminado",
        json={"utm_factor": "no-es-un-numero"},
        headers={"X-CSRFToken": token},
    )
    assert resp.status_code == 400
    assert resp.get_json()["ok"] is False


def test_get_utm_factor_predeterminado_devuelve_405(client):
    resp = client.get("/utm/factor-predeterminado")
    assert resp.status_code == 405


def test_utm_historico_devuelve_json_y_cachea(client, monkeypatch):
    resp = client.get("/registro")
    token = extraer_csrf_token(resp.get_data(as_text=True))

    serie = [{"fecha": "2024-03-01T04:00:00.000Z", "valor": 65400}]
    monkeypatch.setattr(
        utm_service.requests, "get",
        Mock(return_value=Mock(
            raise_for_status=Mock(),
            json=Mock(return_value={"codigo": "utm", "serie": serie}),
        )),
    )

    resp = client.post(
        "/utm/historico",
        json={"anio": 2024, "mes": 3},
        headers={"X-CSRFToken": token},
    )

    assert resp.status_code == 200
    data = resp.get_json()
    assert data["ok"] is True
    assert data["utm_fmt"] == "65.400"
    assert db_manager.obtener_utm_guardada(2024, 3)["utm_valor"] == 65400.0


def test_utm_historico_sin_csrf_falla(client):
    resp = client.post("/utm/historico", json={"anio": 2024, "mes": 3})
    assert resp.status_code == 400


def test_get_utm_historico_devuelve_405(client):
    resp = client.get("/utm/historico")
    assert resp.status_code == 405


def test_utm_historico_mes_invalido_devuelve_400(client):
    resp = client.get("/registro")
    token = extraer_csrf_token(resp.get_data(as_text=True))

    resp = client.post(
        "/utm/historico",
        json={"anio": 2024, "mes": 13},
        headers={"X-CSRFToken": token},
    )
    assert resp.status_code == 400


def test_historial_incluye_valor_utm_cuando_hay_referencia(client):
    _registrar_pago(client)  # procesar_pago() ya guarda una UTM para ese mes/año

    resp = client.get("/historial")

    assert b'id="btnToggleDesbalance"' in resp.data
    assert "Tribunales de Familia".encode() in resp.data


def test_historial_muestra_aviso_sin_utm_de_referencia(client, monkeypatch):
    _registrar_pago(client)
    monkeypatch.setattr(
        utm_service, "obtener_utm_referencia",
        lambda: {"utm_valor": None, "es_actual": False},
    )

    resp = client.get("/historial")

    assert b'id="btnToggleDesbalance"' not in resp.data
    assert "No se pudo calcular el valor UTM".encode() in resp.data


def test_historial_anio_incluye_valor_utm_filtrado_por_anio(client):
    _registrar_pago(client)

    resp = client.get("/historial/2026")

    assert "Tribunales de Familia".encode() in resp.data


def test_respaldar_con_csrf_descarga_bd_valida(client, tmp_path):
    _registrar_pago(client)

    resp = client.get("/historial")
    token = extraer_csrf_token(resp.get_data(as_text=True))

    resp = client.post("/respaldar", data={"csrf_token": token})
    assert resp.status_code == 200
    assert resp.mimetype == "application/x-sqlite3"

    backup_path = tmp_path / "backup.db"
    backup_path.write_bytes(resp.data)

    import sqlite3
    conn = sqlite3.connect(backup_path)
    assert conn.execute("SELECT COUNT(*) FROM pagos").fetchone() == (1,)
    conn.close()
