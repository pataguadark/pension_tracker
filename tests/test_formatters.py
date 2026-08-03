"""
test_formatters.py
------------------
Cobertura de formatters.py, con foco en el separador decimal del factor
UTM: en los teclados de celular el punto suele ser lo único disponible,
así que aceptarlo no es una comodidad sino un requisito.
"""

import pytest

from pensiontracker.formatters import fmt_factor, limpiar_entero, limpiar_factor


# ----------------------------------------------------------------
# limpiar_factor
# ----------------------------------------------------------------

@pytest.mark.parametrize("entrada,esperado", [
    ("3,0561", 3.0561),
    ("3.0561", 3.0561),
    ("3,5",    3.5),
    ("3.5",    3.5),
    ("3",      3.0),
    ("0,5",    0.5),
    (".5",     0.5),
    ("3,",     3.0),
    ("  3,5 ", 3.5),
])
def test_limpiar_factor_acepta_punto_y_coma(entrada, esperado):
    assert limpiar_factor(entrada) == pytest.approx(esperado)


@pytest.mark.parametrize("entrada,esperado", [
    ("1.234,56", 1234.56),
    ("1,234.56", 1234.56),
])
def test_limpiar_factor_ultimo_separador_es_el_decimal(entrada, esperado):
    """Con ambos separadores presentes, el último manda y el otro es de miles."""
    assert limpiar_factor(entrada) == pytest.approx(esperado)


@pytest.mark.parametrize("entrada", ["", "   ", "abc", "3,,5x"])
def test_limpiar_factor_rechaza_entradas_invalidas(entrada):
    with pytest.raises(ValueError):
        limpiar_factor(entrada)


# ----------------------------------------------------------------
# limpiar_entero
# ----------------------------------------------------------------

@pytest.mark.parametrize("entrada,esperado", [
    ("69.889",  69889),
    ("213.588", 213588),
    ("1000",    1000),
    (" 200.000 ", 200000),
])
def test_limpiar_entero_quita_separador_de_miles(entrada, esperado):
    assert limpiar_entero(entrada) == esperado


@pytest.mark.parametrize("entrada", ["", "1,5", "abc"])
def test_limpiar_entero_rechaza_entradas_invalidas(entrada):
    with pytest.raises(ValueError):
        limpiar_entero(entrada)


# ----------------------------------------------------------------
# fmt_factor
# ----------------------------------------------------------------

@pytest.mark.parametrize("entrada,esperado", [
    (3.0561, "3,0561"),
    (3.0,    "3"),
    (3.5,    "3,5"),
    (None,   ""),
])
def test_fmt_factor_usa_coma_y_no_deja_ceros_de_mas(entrada, esperado):
    assert fmt_factor(entrada) == esperado


@pytest.mark.parametrize("texto", ["3,0561", "3.0561", "3,5", "3"])
def test_factor_sobrevive_ida_y_vuelta(texto):
    """fmt_factor(limpiar_factor(x)) debe poder volver a leerse igual."""
    valor = limpiar_factor(texto)
    assert limpiar_factor(fmt_factor(valor)) == pytest.approx(valor)
