"""
formatters.py
-------------
Parsing y formateo de números en el formato chileno (miles con puntos,
decimales con coma). Compartido entre blueprints (routes/pagos.py,
routes/utm.py).
"""

import math
import re

_FACTOR_VALIDO = re.compile(r"^-?[0-9]*\.?[0-9]+$")
_ENTERO_VALIDO = re.compile(r"^-?[0-9]+$")


def limpiar_entero(valor: str) -> int:
    """
    Convierte texto formateado en Chile (miles con puntos) a entero.
    Ej: '69.889' → 69889 | '213.588' → 213588 | '1000' → 1000
    Rechaza comas (separador decimal no permitido para enteros).

    int() de Python acepta formas que no son enteros chilenos válidos:
    signo '+' explícito ('+69889'), guión bajo como separador de dígitos
    ('1_000') y dígitos Unicode no ASCII (p. ej. arábigo-índicos). El
    TypeScript ya rechaza las tres con el regex ^-?\\d+$ (donde \\d sin
    flag /u solo matchea 0-9); acá se exige la misma forma estricta
    ([0-9] explícito, no \\d, que en un patrón Python sí matchea dígitos
    Unicode) antes de convertir, para que ambos lados rechacen igual.
    """
    if not valor:
        raise ValueError("Valor vacío")
    limpio = valor.strip()
    if "," in limpio:
        raise ValueError("No se permiten decimales en este campo")
    limpio = limpio.replace(".", "")
    if not _ENTERO_VALIDO.match(limpio):
        raise ValueError(f"Entero inválido: {valor!r}")
    return int(limpio)


def limpiar_factor(valor: str) -> float:
    """
    Convierte texto de factor UTM a float.

    Acepta punto o coma como separador decimal: en los teclados decimales
    de celular el punto suele ser lo único disponible, así que rechazarlo
    convertiría '3.5' en 35 y decuplicaría la cuota pactada.

    Regla: el último separador presente es el decimal; los anteriores son
    separadores de miles y se descartan.

    Ej: '3,0561' → 3.0561 | '3.0561' → 3.0561 | '1.234,56' → 1234.56
    """
    if not valor:
        raise ValueError("Valor vacío")

    limpio = valor.strip()
    if not limpio:
        raise ValueError("Valor vacío")

    # Un separador final sin dígitos detrás (ej. '3,5.') no es el decimal:
    # tratarlo como tal dejaría la parte decimal vacía y descartaría el
    # separador anterior, que sí lo era, decuplicando el resultado. Se
    # ignora y el separador previo (si existe) sigue siendo el decimal.
    while limpio and limpio[-1] in ".,":
        limpio = limpio[:-1]
    if not limpio:
        raise ValueError(f"Factor UTM inválido: {valor!r}")

    corte = max(limpio.rfind("."), limpio.rfind(","))
    if corte == -1:
        entero, decimales = limpio, ""
    else:
        entero, decimales = limpio[:corte], limpio[corte + 1:]

    entero = entero.replace(".", "").replace(",", "")
    normalizado = f"{entero}.{decimales}" if decimales else entero

    # float() acepta notación científica ('1e10'), signo '+' y 'nan'/'inf',
    # pero un factor UTM no admite ninguna de esas formas en la realidad.
    # Se exige la misma forma estricta que el TypeScript (^-?\d*\.?\d+$,
    # donde \d sin flag /u solo matchea 0-9); acá se usa [0-9] explícito
    # en vez de \d, que en un patrón Python sí matchea dígitos Unicode
    # (p. ej. arábigo-índicos), para que ambos lados rechacen igual.
    if not _FACTOR_VALIDO.match(normalizado):
        raise ValueError(f"Factor UTM inválido: {valor!r}")

    try:
        resultado = float(normalizado)
    except ValueError:
        raise ValueError(f"Factor UTM inválido: {valor!r}")

    if not math.isfinite(resultado):
        raise ValueError(f"Factor UTM inválido: {valor!r}")

    return resultado


def fmt_factor(n):
    """Formatea un factor UTM para el frontend: '3.0561' → '3,0561' (sin ceros de más)."""
    if n is None:
        return ""
    s = f"{float(n):.4f}".replace(".", ",")
    return s.rstrip("0").rstrip(",") if "," in s else s
