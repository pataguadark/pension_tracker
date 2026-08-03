"""
test_fixtures_doradas.py
------------------------
Ejecuta contra la implementación Python los mismos casos que
mobile/src/core/fixtures.test.ts ejecuta contra la de TypeScript.

Si las dos implementaciones de la aritmética divergen, una de las dos
suites se pone roja. Ese es el único mecanismo que impide que el
escritorio y el móvil muestren saldos distintos.
"""

import json
from pathlib import Path

import pytest

from pensiontracker.formatters import fmt_factor, limpiar_entero, limpiar_factor
from pensiontracker.services.calculation_service import (
    calcular_cuota_pactada,
    calcular_desbalance_acumulado_utm,
    calcular_desbalance_mensual,
    calcular_desbalance_utm_mensual,
    formatear_pesos,
    obtener_historial_desbalances,
    resumir_estado_cuenta,
)

FIXTURES = Path(__file__).resolve().parent.parent / "shared" / "fixtures"


def cargar(nombre: str) -> dict:
    return json.loads((FIXTURES / nombre).read_text(encoding="utf-8"))


def casos(nombre_archivo: str, clave: str) -> list:
    """Retorna los casos como tuplas (nombre, entrada, esperado) para parametrizar.

    Comprobación explícita de no-vacío: si `clave` no existe en el archivo o su
    lista de casos quedó vacía (p. ej. por una clave mal escrita al agregar un
    fixture nuevo), `pytest.mark.parametrize` con una lista vacía NO hace
    fallar el test correspondiente: pytest lo marca "skipped" y la suite queda
    en verde sin haber verificado nada. Es exactamente el modo de falla
    silenciosa que este mecanismo de paridad existe para evitar, así que se
    valida aquí mismo, en el punto donde se cargan los casos, y se lanza un
    error de colección con mensaje claro en vez de dejar pasar un "skip" mudo.
    """
    datos = cargar(nombre_archivo)
    bloque = datos.get(clave)
    if not bloque:
        raise ValueError(
            f'El bloque de fixtures "{clave}" no existe o está vacío en '
            f"{nombre_archivo}. Revisa que la clave esté bien escrita y que "
            "tenga al menos un caso; de lo contrario esta suite dejaría de "
            "cubrir esos casos sin que nadie lo note."
        )
    return [(c["nombre"], c["entrada"], c["esperado"]) for c in bloque]


def espera_error(esperado) -> bool:
    return isinstance(esperado, dict) and esperado.get("error") is True


# El lado TypeScript compara con toBeCloseTo(esperado, 10), cuya tolerancia
# es absoluta: |actual - esperado| < 0.5 * 10**-10 = 5e-11. pytest.approx, si
# no se le fija nada, usa una tolerancia RELATIVA por defecto (rel=1e-6), mucho
# mas laxa. Con esa laxitud, una divergencia entre las dos implementaciones de
# entre 1e-4 y 1e-6 haria fallar vitest pero pasaria inadvertida aqui: el
# mecanismo de paridad detectaria mejor en una direccion que en la otra, lo
# cual es peor que no tener el mecanismo (da falsa confianza).
#
# Fijamos abs=5e-11 (y ningun rel) para igualar exactamente la sensibilidad
# de toBeCloseTo(esperado, 10). No aflojar este valor: hacerlo rompe la
# simetria entre ambas suites y reabre el punto ciego descrito arriba.
TOLERANCIA_ABSOLUTA_PARIDAD_TS = 5e-11


@pytest.mark.parametrize("nombre,entrada,esperado", casos("formatters.json", "limpiarFactor"))
def test_limpiar_factor_contra_fixtures(nombre, entrada, esperado):
    if espera_error(esperado):
        with pytest.raises(ValueError):
            limpiar_factor(entrada)
    else:
        assert limpiar_factor(entrada) == pytest.approx(
            esperado, abs=TOLERANCIA_ABSOLUTA_PARIDAD_TS
        )


@pytest.mark.parametrize("nombre,entrada,esperado", casos("formatters.json", "limpiarEntero"))
def test_limpiar_entero_contra_fixtures(nombre, entrada, esperado):
    if espera_error(esperado):
        with pytest.raises(ValueError):
            limpiar_entero(entrada)
    else:
        assert limpiar_entero(entrada) == esperado


@pytest.mark.parametrize("nombre,entrada,esperado", casos("formatters.json", "fmtFactor"))
def test_fmt_factor_contra_fixtures(nombre, entrada, esperado):
    assert fmt_factor(entrada) == esperado


@pytest.mark.parametrize("nombre,entrada,esperado", casos("formatters.json", "formatearPesos"))
def test_formatear_pesos_contra_fixtures(nombre, entrada, esperado):
    assert formatear_pesos(entrada) == esperado


# Claves que formatters.json debe tener, cada una con al menos un caso. Si
# alguien renombra una clave (o la vacía), este test se pone rojo con un
# mensaje explícito en vez de que la suite se quede sin cobertura en silencio.
CLAVES_ESPERADAS_FORMATTERS = ("limpiarFactor", "limpiarEntero", "fmtFactor", "formatearPesos")


@pytest.mark.parametrize("clave", CLAVES_ESPERADAS_FORMATTERS)
def test_formatters_json_trae_las_claves_esperadas_con_casos(clave):
    datos = cargar("formatters.json")
    assert clave in datos, f'Falta la clave "{clave}" en shared/fixtures/formatters.json'
    assert isinstance(
        datos[clave], list
    ), f'La clave "{clave}" en formatters.json debería ser una lista de casos'
    assert len(datos[clave]) > 0, f'El bloque "{clave}" en formatters.json está vacío'


def casos_simples(nombre_archivo: str) -> list:
    """Casos de un fixture con forma simple {"casos": [...]} (sin sub-bloques
    por clave, a diferencia de formatters.json). Reutiliza casos() para
    heredar el mismo guard de "no vacío": así esta forma de fixture queda
    protegida igual que la de sub-bloques, en vez de leer datos["casos"]
    directamente y arriesgarse a un "skipped" silencioso si la clave
    desapareciera o quedara vacía.
    """
    return casos(nombre_archivo, "casos")


def _convertir_no_finito(valor):
    """Convierte las convenciones "NaN"/"Infinity"/"-Infinity" que usan las
    fixtures JSON (JSON no tiene literales para estos valores) al float no
    finito correspondiente. Los demás valores se retornan sin cambios. Ver
    shared/fixtures/README.md.
    """
    if valor == "NaN":
        return float("nan")
    if valor == "Infinity":
        return float("inf")
    if valor == "-Infinity":
        return float("-inf")
    return valor


@pytest.mark.parametrize("nombre,entrada,esperado", casos_simples("cuota-pactada.json"))
def test_cuota_pactada_contra_fixtures(nombre, entrada, esperado):
    utm_factor = _convertir_no_finito(entrada["utmFactor"])
    utm_valor = _convertir_no_finito(entrada["utmValor"])
    if espera_error(esperado):
        with pytest.raises(ValueError):
            calcular_cuota_pactada(utm_factor, utm_valor)
    else:
        obtenido = calcular_cuota_pactada(utm_factor, utm_valor)
        assert obtenido == pytest.approx(esperado, abs=TOLERANCIA_ABSOLUTA_PARIDAD_TS)


@pytest.mark.parametrize("nombre,entrada,esperado", casos_simples("desbalance-mensual.json"))
def test_desbalance_mensual_contra_fixtures(nombre, entrada, esperado):
    monto_pagado = _convertir_no_finito(entrada["montoPagado"])
    cuota_pactada = _convertir_no_finito(entrada["cuotaPactada"])
    if espera_error(esperado):
        with pytest.raises(ValueError):
            calcular_desbalance_mensual(monto_pagado, cuota_pactada)
    else:
        obtenido = calcular_desbalance_mensual(monto_pagado, cuota_pactada)
        assert obtenido["diferencia"] == pytest.approx(
            esperado["diferencia"], abs=TOLERANCIA_ABSOLUTA_PARIDAD_TS
        )
        assert obtenido["estado"] == esperado["estado"]


# Mapa de las claves camelCase que usan las fixtures a las snake_case que
# espera el Python. Solo cubre las claves de `pago` que aparecen en
# desbalance-utm.json; no es un traductor genérico.
MAPA_CLAVES = {
    "utmFactor": "utm_factor",
    "utmValor": "utm_valor",
    "cuotaPactada": "cuota_pactada",
    "montoPagado": "monto_pagado",
    "mesPago": "mes_pago",
    "anioPago": "anio_pago",
}


def a_snake(pago: dict) -> dict:
    """Traduce las claves camelCase de las fixtures a las snake_case del Python."""
    return {MAPA_CLAVES.get(k, k): v for k, v in pago.items()}


@pytest.mark.parametrize("nombre,entrada,esperado", casos("desbalance-utm.json", "mensual"))
def test_desbalance_utm_mensual_contra_fixtures(nombre, entrada, esperado):
    pago = a_snake(entrada)
    pago["utm_factor"] = _convertir_no_finito(pago.get("utm_factor"))
    pago["utm_valor"] = _convertir_no_finito(pago.get("utm_valor"))

    if espera_error(esperado):
        with pytest.raises(ValueError):
            calcular_desbalance_utm_mensual(pago)
        return

    obtenido = calcular_desbalance_utm_mensual(pago)
    if esperado is None:
        assert obtenido is None
    else:
        assert obtenido == pytest.approx(esperado, abs=TOLERANCIA_ABSOLUTA_PARIDAD_TS)


@pytest.mark.parametrize("nombre,entrada,esperado", casos("desbalance-utm.json", "acumulado"))
def test_desbalance_acumulado_utm_contra_fixtures(nombre, entrada, esperado):
    pagos = [a_snake(p) for p in entrada["pagos"]]
    utm_valor_actual = _convertir_no_finito(entrada["utmValorActual"])

    if espera_error(esperado):
        with pytest.raises(ValueError):
            calcular_desbalance_acumulado_utm(utm_valor_actual, pagos)
        return

    obtenido = calcular_desbalance_acumulado_utm(utm_valor_actual, pagos)

    assert obtenido["desbalance_acumulado_utm"] == pytest.approx(
        esperado["desbalanceAcumuladoUtm"], abs=TOLERANCIA_ABSOLUTA_PARIDAD_TS
    )
    assert obtenido["estado"] == esperado["estado"]

    if esperado["desbalanceAjustado"] is None:
        assert obtenido["desbalance_ajustado"] is None
    else:
        assert obtenido["desbalance_ajustado"] == pytest.approx(
            esperado["desbalanceAjustado"], abs=TOLERANCIA_ABSOLUTA_PARIDAD_TS
        )


# Claves de cada fila del historial corrido, en snake_case (Python) mapeadas
# a camelCase (fixture JSON). Reutiliza la misma transformación snake→camel
# en vez de mantener un segundo mapa manual como MAPA_CLAVES.
CLAVES_FILA = (
    "desbalance_corrido",
    "estado_corrido",
    "desbalance_utm_mes_pesos",
    "desbalance_utm_corrido_pesos",
    "estado_utm_mes",
    "estado_utm_corrido",
)


@pytest.mark.parametrize("nombre,entrada,esperado", casos("historial-corrido.json", "historial"))
def test_historial_corrido_contra_fixtures(nombre, entrada, esperado):
    pagos = [a_snake(p) for p in entrada["pagos"]]
    obtenido = obtener_historial_desbalances(entrada["utmValorActual"], pagos)

    assert len(obtenido) == len(esperado)

    for fila, esp in zip(obtenido, esperado):
        # El orden importa: la fixture espera del más reciente al más antiguo.
        assert fila["mes_pago"] == esp["mesPago"]
        for clave_py in CLAVES_FILA:
            clave_json = "".join(
                parte if i == 0 else parte.capitalize()
                for i, parte in enumerate(clave_py.split("_"))
            )
            valor, valor_esp = fila[clave_py], esp[clave_json]
            if valor_esp is None:
                assert valor is None, f"{nombre}: {clave_py} debería ser None"
            elif isinstance(valor_esp, str):
                assert valor == valor_esp, f"{nombre}: {clave_py}"
            else:
                assert valor == pytest.approx(
                    valor_esp, abs=TOLERANCIA_ABSOLUTA_PARIDAD_TS
                ), f"{nombre}: {clave_py}"


@pytest.mark.parametrize("nombre,entrada,esperado", casos("historial-corrido.json", "resumen"))
def test_resumen_estado_cuenta_contra_fixtures(nombre, entrada, esperado):
    """El resumen del Python vive en obtener_estado_cuenta(), que llama a
    resumir_estado_cuenta() tras leer de la BD. Se invoca acá directamente
    la función pura de producción (mismo patrón que hace resumirEstadoCuenta
    del lado TypeScript), en vez de reimplementar la aritmética en el test."""
    pagos = [a_snake(p) for p in entrada["pagos"]]

    obtenido = resumir_estado_cuenta(pagos)

    assert obtenido["cantidad_pagos"] == esperado["cantidadPagos"]
    assert obtenido["total_pagado"] == pytest.approx(
        esperado["totalPagado"], abs=TOLERANCIA_ABSOLUTA_PARIDAD_TS
    )
    assert obtenido["total_pactado"] == pytest.approx(
        esperado["totalPactado"], abs=TOLERANCIA_ABSOLUTA_PARIDAD_TS
    )
    assert obtenido["desbalance_acumulado"] == pytest.approx(
        esperado["desbalanceAcumulado"], abs=TOLERANCIA_ABSOLUTA_PARIDAD_TS
    )
    assert obtenido["estado"] == esperado["estado"]
