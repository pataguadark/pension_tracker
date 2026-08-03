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
    calcular_desbalance_mensual,
    formatear_pesos,
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
