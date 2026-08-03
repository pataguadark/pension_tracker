"""
Tests de caracterización para calculation_service.

Cubren solo las funciones puras del módulo (sin tocar la BD): red de
seguridad mínima para el refactor de las fases siguientes.
"""

from pensiontracker.services import calculation_service as calc


# -------------------------------------------------------------------
# calcular_cuota_pactada: cuota = utm_factor × utm_valor
# -------------------------------------------------------------------

def test_calcular_cuota_pactada_caso_tipico():
    assert calc.calcular_cuota_pactada(3.0561, 69889) == 213587.77


def test_calcular_cuota_pactada_factor_entero():
    assert calc.calcular_cuota_pactada(2, 100000) == 200000.0


def test_calcular_cuota_pactada_redondea_a_dos_decimales():
    resultado = calc.calcular_cuota_pactada(1.0001, 100)
    assert resultado == 100.01


def test_calcular_cuota_pactada_factor_no_positivo_lanza_error():
    import pytest
    with pytest.raises(ValueError):
        calc.calcular_cuota_pactada(0, 69889)


def test_calcular_cuota_pactada_utm_no_positiva_lanza_error():
    import pytest
    with pytest.raises(ValueError):
        calc.calcular_cuota_pactada(3.0, -1)


# -------------------------------------------------------------------
# calcular_desbalance_mensual: monto_pagado - cuota_pactada
# -------------------------------------------------------------------

def test_desbalance_mensual_excedente():
    resultado = calc.calcular_desbalance_mensual(monto_pagado=250000, cuota_pactada=213587.77)
    assert resultado["diferencia"] == 36412.23
    assert resultado["estado"] == "EXCEDENTE"


def test_desbalance_mensual_exacto():
    resultado = calc.calcular_desbalance_mensual(monto_pagado=200000, cuota_pactada=200000)
    assert resultado["diferencia"] == 0
    assert resultado["estado"] == "EXACTO"


def test_desbalance_mensual_deuda():
    resultado = calc.calcular_desbalance_mensual(monto_pagado=150000, cuota_pactada=213587.77)
    assert resultado["diferencia"] == -63587.77
    assert resultado["estado"] == "DEUDA"


# -------------------------------------------------------------------
# Acumulado: suma de varios desbalances mensuales (sin pasar por la BD)
# -------------------------------------------------------------------

def test_acumulado_manual_de_varios_meses():
    meses = [
        calc.calcular_desbalance_mensual(220000, 213587.77),  # +6412.23
        calc.calcular_desbalance_mensual(200000, 213587.77),  # -13587.77
        calc.calcular_desbalance_mensual(213587.77, 213587.77),  # 0
    ]
    acumulado = round(sum(m["diferencia"] for m in meses), 2)
    assert acumulado == -7175.54


# -------------------------------------------------------------------
# formatear_pesos
# -------------------------------------------------------------------

def test_formatear_pesos_redondea_y_usa_punto_de_miles():
    assert calc.formatear_pesos(68923.5) == "$68.924"


def test_formatear_pesos_monto_pequeno():
    assert calc.formatear_pesos(500) == "$500"


def test_formatear_pesos_monto_negativo():
    assert calc.formatear_pesos(-1234) == "$-1.234"


# -------------------------------------------------------------------
# calcular_desbalance_utm_mensual / calcular_desbalance_acumulado_utm
# -------------------------------------------------------------------

def test_calcular_desbalance_utm_mensual_caso_tipico():
    pago = {"utm_valor": 70000, "cuota_pactada": 210000, "monto_pagado": 220000, "utm_factor": 3}
    # 220000/70000 - 3 = 0.142857...
    assert calc.calcular_desbalance_utm_mensual(pago) == 220000 / 70000 - 3


def test_calcular_desbalance_utm_mensual_mismo_signo_que_desbalance_pesos():
    pago_excedente = {"utm_valor": 70000, "cuota_pactada": 210000, "monto_pagado": 220000, "utm_factor": 3}
    pago_deuda = {"utm_valor": 71000, "cuota_pactada": 213000, "monto_pagado": 200000, "utm_factor": 3}
    assert calc.calcular_desbalance_utm_mensual(pago_excedente) > 0
    assert calc.calcular_desbalance_utm_mensual(pago_deuda) < 0


def test_calcular_desbalance_utm_mensual_deriva_factor_si_falta():
    # Fila legacy sin utm_factor: se deriva de cuota_pactada/utm_valor.
    pago = {"utm_valor": 70000, "cuota_pactada": 210000, "monto_pagado": 210000, "utm_factor": None}
    assert calc.calcular_desbalance_utm_mensual(pago) == 0.0


def test_calcular_desbalance_utm_mensual_sin_datos_retorna_none():
    assert calc.calcular_desbalance_utm_mensual({"utm_valor": 0, "cuota_pactada": 0, "monto_pagado": 100}) is None


def test_desbalance_utm_mensual_tolerante_no_traga_errores_que_no_sean_valueerror():
    """
    Punto 5 (tercer hueco barato) de la revisión: _desbalance_utm_mensual_
    tolerante() solo captura ValueError (el guard de finitud), no
    cualquier excepción. Una fila que ni siquiera es un dict (p. ej. una
    fila `None` colada por un bug en el llamador, no un valor no finito
    persistido) lanza AttributeError al hacer pago.get(...), y eso debe
    propagarse, no degradarse a "sin dato UTM" en silencio.

    Simetría con TypeScript: desbalanceUtmMensualTolerante() usaba un
    `catch` desnudo que sí se tragaba esto (ver calculos.ts /
    calculos.test.ts); se lo acotó a una clase de error dedicada
    (ErrorDatoNoFinito) para igualar esta selectividad de Python.
    """
    import pytest

    pagos = [
        {"utm_valor": 70000, "cuota_pactada": 210000, "monto_pagado": 220000, "utm_factor": 3},
        None,
    ]

    with pytest.raises(AttributeError):
        calc.calcular_desbalance_acumulado_utm(70000, pagos=pagos)


def test_calcular_desbalance_acumulado_utm_caso_tipico():
    pagos = [
        {"utm_valor": 70000, "cuota_pactada": 210000, "monto_pagado": 220000, "utm_factor": 3},
        {"utm_valor": 71000, "cuota_pactada": 213000, "monto_pagado": 200000, "utm_factor": 3},
    ]

    resultado = calc.calcular_desbalance_acumulado_utm(72000, pagos=pagos)

    assert resultado["desbalance_acumulado_utm"] == -0.0402
    assert resultado["desbalance_ajustado"] == -2897.38
    assert resultado["estado"] == "DEUDA"


def test_calcular_desbalance_acumulado_utm_sin_pagos():
    resultado = calc.calcular_desbalance_acumulado_utm(72000, pagos=[])
    assert resultado["desbalance_acumulado_utm"] == 0
    assert resultado["desbalance_ajustado"] == 0
    assert resultado["estado"] == "EXACTO"


def test_calcular_desbalance_acumulado_utm_sin_utm_actual_retorna_ajustado_none():
    pagos = [{"utm_valor": 70000, "cuota_pactada": 210000, "monto_pagado": 220000, "utm_factor": 3}]
    resultado = calc.calcular_desbalance_acumulado_utm(None, pagos=pagos)
    assert resultado["desbalance_ajustado"] is None
    assert resultado["desbalance_acumulado_utm"] != 0


# -------------------------------------------------------------------
# obtener_historial_desbalances: campos UTM por fila (Feature 3)
# -------------------------------------------------------------------

def test_obtener_historial_desbalances_sin_utm_actual_deja_campos_utm_en_none(monkeypatch):
    pagos = [
        {"id": 1, "anio_pago": 2026, "mes_pago": 1, "utm_valor": 70000,
         "cuota_pactada": 210000, "monto_pagado": 220000, "utm_factor": 3, "desbalance": 10000},
    ]
    monkeypatch.setattr(calc.db_manager, "obtener_todos_los_pagos", lambda: pagos)

    historial = calc.obtener_historial_desbalances()

    assert historial[0]["desbalance_utm_mes_pesos"] is None
    assert historial[0]["desbalance_utm_corrido_pesos"] is None


def test_obtener_historial_desbalances_con_utm_actual_calcula_campos_utm(monkeypatch):
    pagos = [
        {"id": 1, "anio_pago": 2026, "mes_pago": 1, "utm_valor": 70000,
         "cuota_pactada": 210000, "monto_pagado": 220000, "utm_factor": 3, "desbalance": 10000},
        {"id": 2, "anio_pago": 2026, "mes_pago": 2, "utm_valor": 71000,
         "cuota_pactada": 213000, "monto_pagado": 200000, "utm_factor": 3, "desbalance": -13000},
    ]
    monkeypatch.setattr(calc.db_manager, "obtener_todos_los_pagos", lambda: pagos)

    historial = calc.obtener_historial_desbalances(utm_valor_actual=72000)

    # Vuelve del más reciente al más antiguo: el pago de febrero es historial[0].
    mes_febrero = historial[0]
    mes_enero = historial[1]

    assert mes_febrero["desbalance_utm_mes_pesos"] is not None
    assert (mes_febrero["desbalance_utm_mes_pesos"] < 0) == (mes_febrero["desbalance"] < 0)
    assert (mes_enero["desbalance_utm_mes_pesos"] > 0) == (mes_enero["desbalance"] > 0)


# -------------------------------------------------------------------
# Formato de descripción: debe usar separador de miles chileno (punto)
# -------------------------------------------------------------------

def test_descripcion_mensual_usa_formato_chileno():
    """El separador de miles debe ser punto: '$5.898', no '$5,898'."""
    info = calc.calcular_desbalance_mensual(200000, 205898)
    assert "$5.898" in info["descripcion"]
    assert "5,898" not in info["descripcion"]


def test_descripcion_mensual_excedente_usa_formato_chileno():
    info = calc.calcular_desbalance_mensual(210000, 204102)
    assert "$5.898" in info["descripcion"]
    assert "5,898" not in info["descripcion"]


def test_descripcion_acumulado_excedente_usa_formato_chileno(monkeypatch):
    """calcular_desbalance_acumulado (rama EXCEDENTE) debe usar punto de miles."""
    pagos = [{"desbalance": 15898}]
    monkeypatch.setattr(calc.db_manager, "obtener_todos_los_pagos", lambda: pagos)

    resultado = calc.calcular_desbalance_acumulado()

    assert resultado["estado"] == "EXCEDENTE"
    assert "$15.898" in resultado["descripcion"]
    assert "15,898" not in resultado["descripcion"]


def test_descripcion_acumulado_deuda_usa_formato_chileno(monkeypatch):
    """calcular_desbalance_acumulado (rama DEUDA) debe usar punto de miles."""
    pagos = [{"desbalance": -15898}]
    monkeypatch.setattr(calc.db_manager, "obtener_todos_los_pagos", lambda: pagos)

    resultado = calc.calcular_desbalance_acumulado()

    assert resultado["estado"] == "DEUDA"
    assert "$15.898" in resultado["descripcion"]
    assert "15,898" not in resultado["descripcion"]
