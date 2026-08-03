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
from pensiontracker.services.calculation_service import formatear_pesos

FIXTURES = Path(__file__).resolve().parent.parent / "shared" / "fixtures"


def cargar(nombre: str) -> dict:
    return json.loads((FIXTURES / nombre).read_text(encoding="utf-8"))


def casos(nombre_archivo: str, clave: str) -> list:
    """Retorna los casos como tuplas (nombre, entrada, esperado) para parametrizar."""
    datos = cargar(nombre_archivo)
    return [(c["nombre"], c["entrada"], c["esperado"]) for c in datos[clave]]


def espera_error(esperado) -> bool:
    return isinstance(esperado, dict) and esperado.get("error") is True


@pytest.mark.parametrize("nombre,entrada,esperado", casos("formatters.json", "limpiarFactor"))
def test_limpiar_factor_contra_fixtures(nombre, entrada, esperado):
    if espera_error(esperado):
        with pytest.raises(ValueError):
            limpiar_factor(entrada)
    else:
        assert limpiar_factor(entrada) == pytest.approx(esperado)


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
