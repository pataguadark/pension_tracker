"""
formatters.py
-------------
Parsing y formateo de números en el formato chileno (miles con puntos,
decimales con coma). Compartido entre blueprints (routes/pagos.py,
routes/utm.py).
"""


def limpiar_entero(valor: str) -> int:
    """
    Convierte texto formateado en Chile (miles con puntos) a entero.
    Ej: '69.889' → 69889 | '213.588' → 213588 | '1000' → 1000
    Rechaza comas (separador decimal no permitido para enteros).
    """
    if not valor:
        raise ValueError("Valor vacío")
    limpio = valor.strip()
    if "," in limpio:
        raise ValueError("No se permiten decimales en este campo")
    limpio = limpio.replace(".", "")
    return int(limpio)


def limpiar_factor(valor: str) -> float:
    """
    Convierte texto de factor UTM a float.
    Acepta coma como separador decimal (formato chileno).
    Ej: '3,0561' → 3.0561 | '3.0561' → 3.0561 | '3' → 3.0
    """
    if not valor:
        raise ValueError("Valor vacío")
    limpio = valor.strip().replace(".", "").replace(",", ".")
    return float(limpio)


def fmt_factor(n):
    """Formatea un factor UTM para el frontend: '3.0561' → '3,0561' (sin ceros de más)."""
    if n is None:
        return ""
    s = f"{float(n):.4f}".replace(".", ",")
    return s.rstrip("0").rstrip(",") if "," in s else s
