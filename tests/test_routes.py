"""
test_routes.py
---------------
Tests de los blueprints vía el test client de Flask: CRUD de pagos,
CSRF activo, exportación CSV y verificación de que los endpoints
mutadores rechazan GET.
"""

import io
import sqlite3
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


def test_historial_con_fila_utm_factor_infinito_no_revienta(client):
    """
    Regresión: v1.0.0 no validaba finitud al guardar (limpiar_factor
    aceptaba 'inf'/'1e400' y calcular_cuota_pactada solo comprobaba
    <= 0), así que un utm_factor infinito quedó persistido en bases de
    datos reales. Antes de esta rama esa fila renderizaba "$inf"; con
    los guards nuevos de finitud, /historial y /historial/<anio>
    reventaban con un ValueError sin capturar en vez de degradar la
    fila. Un dato ya guardado, no importa cuán corrupto, no debe poder
    tumbar la vista principal de un usuario real.
    """
    db_manager.insertar_pago(
        fecha="2025-01-15", mes_pago=1, anio_pago=2025,
        utm_valor=67294, cuota_pactada=201882.0,
        monto_pagado=200000, desbalance=-1882.0,
        utm_factor=float("inf"),
    )
    db_manager.insertar_pago(
        fecha="2025-02-15", mes_pago=2, anio_pago=2025,
        utm_valor=67429, cuota_pactada=202287.0,
        monto_pagado=202287, desbalance=0.0,
        utm_factor=3.0,
    )

    resp = client.get("/historial")
    assert resp.status_code == 200
    # La fila sana sigue intacta pese a la corrupta.
    assert "202.287".encode() in resp.data

    resp_anio = client.get("/historial/2025")
    assert resp_anio.status_code == 200
    assert "202.287".encode() in resp_anio.data


def test_historial_con_utm_vigente_infinita_no_revienta(client):
    """
    Regresión: utm_service.obtener_utm_anio() hacía float(item["valor"])
    sobre la respuesta de mindicador.cl sin comprobar finitud, así que un
    valor extremo (o ya corrupto en una BD real) podía quedar persistido
    como infinito en utm_historial. v1.0.2 respondía 200 en ese estado;
    con el guard de finitud que calcular_desbalance_acumulado_utm agregó
    para el valor UTM vigente, /historial y /historial/<anio> reventaban
    con un ValueError sin capturar. Un utm_valor_actual no finito debe
    tratarse como "sin UTM de referencia" (estado ya soportado), no tumbar
    la vista.
    """
    hoy = datetime.today()
    db_manager.guardar_utm(hoy.year, hoy.month, float("inf"))
    _registrar_pago(client)

    resp = client.get("/historial")
    assert resp.status_code == 200
    assert "No se pudo calcular el valor UTM".encode() in resp.data

    resp_anio = client.get(f"/historial/{hoy.year}")
    assert resp_anio.status_code == 200


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


def test_editar_pago_con_producto_que_desborda_no_revienta(client):
    """
    Regresión (punto 2 de la revisión): routes/pagos.py llamaba a
    calcular_cuota_pactada en el manejador de edición SIN try/except, a
    diferencia del de registro. Un factor de 309 dígitos pasa
    limpiar_factor (son dígitos ASCII válidos), pero al multiplicarlo por
    utm_valor el producto desborda a infinito y calcular_cuota_pactada
    lanza ValueError. v1.0.2 respondía 302 tanto en /registro como en
    /editar; con el guard de finitud nuevo, /registro sigue respondiendo
    302 (lo captura), pero /editar reventaba con 500. Debe comportarse
    igual que /registro: capturar y mostrar el error.
    """
    _registrar_pago(client)

    resp = client.get("/editar/1")
    assert resp.status_code == 200
    token = extraer_csrf_token(resp.get_data(as_text=True))

    resp = client.post("/editar/1", data={
        "csrf_token": token,
        "utm_factor": "1" * 309,
        "utm_valor": "70.000",
        "monto_pagado": "220.000",
        "mes_pago": "8",
        "anio_pago": "2026",
        "fecha": "2026-08-01",
    })
    assert resp.status_code == 302

    resp = client.get(resp.headers["Location"])
    assert resp.status_code == 200
    assert "Error al procesar el pago".encode() in resp.data

    # El pago original no debe haberse alterado por el intento fallido.
    pago = db_manager.obtener_pago_por_id(1)
    assert pago["monto_pagado"] != 220000


def test_registro_con_producto_que_desborda_no_revienta(client):
    """Mismo escenario que el test anterior, pero para /registro: fija el
    comportamiento existente (302 + mensaje) para que una futura
    regresión en el manejador de registro también quede detectada."""
    resp = client.get("/registro")
    token = extraer_csrf_token(resp.get_data(as_text=True))

    resp = client.post("/registro", data={
        "csrf_token": token,
        "utm_factor": "1" * 309,
        "utm_valor": "70.000",
        "monto_pagado": "220.000",
        "mes_pago": "8",
        "anio_pago": "2026",
        "fecha": "2026-08-01",
    })
    assert resp.status_code == 302

    resp = client.get(resp.headers["Location"])
    assert resp.status_code == 200
    assert "Error al procesar el pago".encode() in resp.data


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


def test_historial_muestra_el_factor_con_coma(client):
    """
    El factor UTM se muestra con coma decimal, igual que en registro y
    edición y que en la app móvil.

    Antes el historial imprimía el float crudo de Python vía Jinja
    ("3.0561", con punto) mientras el resto de la aplicación usaba
    fmt_factor ("3,0561"). La coma es el separador decimal chileno: el
    historial era el que estaba mal, y la diferencia se veía además entre
    el escritorio y el teléfono para la MISMA base de datos.
    """
    _registrar_pago(client)
    html = client.get("/historial").get_data(as_text=True)

    assert "3,0561" in html
    assert "3.0561" not in html


def test_historial_no_muestra_decimales_de_mas_en_el_factor(client):
    """Un factor entero se muestra como '3', no como '3.0' ni '3,0'."""
    _registrar_pago(client, utm_factor="3", monto_pagado="209.667")
    html = client.get("/historial").get_data(as_text=True)

    assert ">3<" in html.replace(" ", "").replace("\n", "")
    assert "3.0" not in html


def _respaldo_en_memoria(tmp_path):
    """Un .db mínimo y válido, devuelto como bytes para subirlo."""
    ruta = tmp_path / "para_subir.db"
    conn = sqlite3.connect(ruta)
    conn.executescript("""
        CREATE TABLE pagos (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            fecha         TEXT    NOT NULL,
            mes_pago      INTEGER NOT NULL,
            anio_pago     INTEGER NOT NULL,
            utm_valor     REAL    NOT NULL,
            cuota_pactada REAL    NOT NULL,
            monto_pagado  REAL    NOT NULL,
            desbalance    REAL    NOT NULL,
            utm_factor    REAL
        );
        CREATE TABLE utm_historial (
            id             INTEGER PRIMARY KEY AUTOINCREMENT,
            anio           INTEGER NOT NULL,
            mes            INTEGER NOT NULL,
            utm_valor      REAL    NOT NULL,
            fecha_registro TEXT    NOT NULL,
            UNIQUE(anio, mes)
        );
        CREATE TABLE configuracion (clave TEXT PRIMARY KEY, valor TEXT NOT NULL);
        INSERT INTO pagos (id, fecha, mes_pago, anio_pago, utm_valor,
                           cuota_pactada, monto_pagado, desbalance, utm_factor)
        VALUES (1, '2026-05-10', 5, 2026, 68000, 204000, 300000, 96000, 3.0);
    """)
    conn.commit()
    conn.close()
    return ruta.read_bytes()


def test_importar_sin_csrf_token_falla(client, tmp_path):
    resp = client.post("/importar", data={
        "respaldo": (io.BytesIO(_respaldo_en_memoria(tmp_path)), "respaldo.db"),
    }, content_type="multipart/form-data")
    assert resp.status_code == 400


def test_importar_reemplaza_el_historial(client, tmp_path):
    _registrar_pago(client)

    resp = client.get("/historial")
    token = extraer_csrf_token(resp.get_data(as_text=True))

    resp = client.post("/importar", data={
        "csrf_token": token,
        "respaldo": (io.BytesIO(_respaldo_en_memoria(tmp_path)), "respaldo.db"),
    }, content_type="multipart/form-data", follow_redirects=True)

    assert resp.status_code == 200
    # El pago del respaldo está y el que se había registrado ya no.
    assert b"300.000" in resp.data
    assert b"213.588" not in resp.data


def test_importar_archivo_demasiado_grande_avisa_y_no_borra_nada(client):
    _registrar_pago(client)

    # Werkzeug corta por Content-Length antes de leer el cuerpo, así que no
    # hace falta un .db válido ni token CSRF: la ruta nunca llega a mirarlos.
    cuerpo = io.BytesIO(b"0" * (26 * 1024 * 1024))

    resp = client.post("/importar", data={
        "respaldo": (cuerpo, "respaldo.db"),
    }, content_type="multipart/form-data", follow_redirects=True)

    assert resp.status_code == 200
    assert "El archivo supera el máximo de 25 MB.".encode("utf-8") in resp.data
    # El pago original debe seguir visible después del rechazo.
    assert b"213.588" in resp.data


def test_importar_un_archivo_invalido_avisa_y_no_borra_nada(client, tmp_path):
    _registrar_pago(client)

    resp = client.get("/historial")
    token = extraer_csrf_token(resp.get_data(as_text=True))

    resp = client.post("/importar", data={
        "csrf_token": token,
        "respaldo": (io.BytesIO(b"no soy una base"), "trucho.db"),
    }, content_type="multipart/form-data", follow_redirects=True)

    assert "No parece un respaldo".encode() in resp.data
    assert b"213.588" in resp.data


def test_importar_con_fallo_de_disco_avisa_y_no_da_500(client, tmp_path, monkeypatch):
    """
    Si archivo.save() o la copia previa fallan por E/S (disco lleno,
    permisos), el usuario debe ver un mensaje, no un 500 crudo justo cuando
    intenta restaurar su registro.
    """
    from pensiontracker.services import importador

    _registrar_pago(client)

    resp = client.get("/historial")
    token = extraer_csrf_token(resp.get_data(as_text=True))

    def falla_por_disco_lleno(ruta):
        raise OSError("disco lleno sintético")

    monkeypatch.setattr(importador, "importar", falla_por_disco_lleno)

    resp = client.post("/importar", data={
        "csrf_token": token,
        "respaldo": (io.BytesIO(_respaldo_en_memoria(tmp_path)), "respaldo.db"),
    }, content_type="multipart/form-data", follow_redirects=True)

    assert resp.status_code == 200
    assert "No se pudo escribir el respaldo en el disco".encode() in resp.data
    assert "Tus datos no se tocaron".encode() in resp.data
    # El mensaje no delata detalles del sistema.
    assert b"disco lleno sint" not in resp.data
    # El pago original sigue ahí.
    assert b"213.588" in resp.data


def test_importar_sin_archivo_avisa(client):
    # Hace falta un pago: `.historial-actions` -y con él el csrf_token- vive
    # dentro del `{% if %}` de "hay pagos", así que con la base vacía el
    # historial no trae token que extraer.
    _registrar_pago(client)

    resp = client.get("/historial")
    token = extraer_csrf_token(resp.get_data(as_text=True))

    resp = client.post("/importar", data={"csrf_token": token},
                       content_type="multipart/form-data",
                       follow_redirects=True)

    assert "Elige un archivo".encode() in resp.data


def test_importar_rechaza_get(client):
    assert client.get("/importar").status_code == 405
