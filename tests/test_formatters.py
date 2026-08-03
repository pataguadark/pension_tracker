"""
test_formatters.py
------------------
Cobertura de formatters.py, con foco en el separador decimal del factor
UTM: en los teclados de celular el punto suele ser lo único disponible,
así que aceptarlo no es una comodidad sino un requisito.
"""

import pytest

from pensiontracker.formatters import fmt_factor, limpiar_entero, limpiar_factor
from pensiontracker.services.calculation_service import formatear_pesos


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
    ("1.234",  1.234),
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


@pytest.mark.parametrize("entrada,esperado", [
    ("3,5.",    3.5),
    ("3.5,",    3.5),
    ("3,0561.", 3.0561),
    ("3,",      3.0),
])
def test_limpiar_factor_separador_final_suelto_no_decuplica(entrada, esperado):
    """
    Regresión C1: un separador final sin dígitos detrás (ej. '3,5.') no debe
    tratarse como el separador decimal (que dejaría la parte decimal vacía y
    descartaría el punto/coma anterior, que sí era el decimal). Se ignora y
    el separador previo sigue siendo el decimal.
    """
    assert limpiar_factor(entrada) == pytest.approx(esperado)


@pytest.mark.parametrize("entrada", [",", ".", ",,", "..", " . , "])
def test_limpiar_factor_solo_separadores_es_invalido(entrada):
    """Si tras descartar los separadores finales sueltos no queda nada, es inválido."""
    with pytest.raises(ValueError):
        limpiar_factor(entrada)


@pytest.mark.parametrize("entrada", ["nan", "NaN", "inf", "-inf", "Infinity", "-Infinity"])
def test_limpiar_factor_rechaza_no_finitos(entrada):
    """
    I2: float() acepta 'nan'/'inf' como valores válidos, pero un factor UTM
    no finito no tiene sentido de negocio y no debe poder persistirse.
    """
    with pytest.raises(ValueError):
        limpiar_factor(entrada)


@pytest.mark.parametrize("entrada", ["1e10", "3.5e2", "+3,5"])
def test_limpiar_factor_rechaza_notacion_cientifica_y_signo_mas(entrada):
    """
    Regresión: un factor UTM en notación científica no existe en la
    realidad ('3e5' llegaba a pasar la validación factor > 0 de
    routes/pagos.py y quedaba persistido). TypeScript ya era estricto
    (regex ^-?\\d*\\.?\\d+$); Python se alinea acá.
    """
    with pytest.raises(ValueError):
        limpiar_factor(entrada)


def test_limpiar_factor_doble_separador_sin_sufijo():
    """
    Documenta el resultado de '3,,5' bajo la regla acordada: el último
    separador presente (la segunda coma) es el decimal, así que da 3.5.
    Antes solo estaba cubierto '3,,5x', donde el rechazo lo provoca la 'x',
    no el doble separador en sí.
    """
    assert limpiar_factor("3,,5") == pytest.approx(3.5)


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


# ----------------------------------------------------------------
# formatear_pesos (calculation_service): tabla de paridad con TypeScript
# ----------------------------------------------------------------
# Python es la implementación de referencia. Estos valores esperados
# salieron de ejecutar formatear_pesos directamente, no de criterio propio.
# formatearPesos en mobile/src/core/formatters.ts debe igualar esta tabla,
# incluido el signo conservado en montos que redondean a magnitud cero.

@pytest.mark.parametrize("entrada,esperado", [
    (-0.01, "$-0"),
    (-0.25, "$-0"),
    (-0.5,  "$-0"),
    (-0.51, "$-1"),
    (-1,    "$-1"),
    (0,     "$0"),
    (-5898, "$-5.898"),
    (5898,  "$5.898"),
])
def test_formatear_pesos_conserva_signo_cerca_de_cero(entrada, esperado):
    assert formatear_pesos(entrada) == esperado
