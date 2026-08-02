"""
utm_service.py
---------------
Responsabilidad: Obtener el valor de la UTM.

Fuente: API REST pública de mindicador.cl
  - UTM del mes/año actual:      GET https://mindicador.cl/api/utm
  - UTM de un año completo:      GET https://mindicador.cl/api/utm/<aaaa>
  - UTM de una fecha puntual:    GET https://mindicador.cl/api/utm/<dd-mm-aaaa>

Respuesta (JSON):
  {
    "codigo": "utm",
    "serie": [ {"fecha": "2026-07-01T04:00:00.000Z", "valor": 71649}, ... ]
  }

Soporta:
  - UTM del mes/año actual
  - UTM de meses/años anteriores (historial)
  - Fallback: si la API no responde, retorna la última UTM guardada en la BD
"""

import requests
from datetime import datetime

from pensiontracker.database import db_manager


# -------------------------------------------------------------------
# Constantes
# -------------------------------------------------------------------

API_BASE = "https://mindicador.cl/api/utm"
API_ANIO = "https://mindicador.cl/api/utm/{anio}"
API_FECHA = "https://mindicador.cl/api/utm/{dia:02d}-{mes:02d}-{anio}"

HEADERS = {
    "User-Agent": "pension-tracker/1.0 (personal)",
    "Accept": "application/json",
}

TIMEOUT = 10  # segundos


# -------------------------------------------------------------------
# Función principal
# -------------------------------------------------------------------

def obtener_utm(anio: int = None, mes: int = None) -> dict:
    """
    Obtiene el valor de la UTM desde mindicador.cl para un mes y año dado.

    Parámetros:
        anio (int): Año a consultar. Si es None, usa el año actual.
        mes  (int): Mes a consultar (1-12). Si es None, usa el mes actual.

    Retorna un diccionario con:
        {
            "utm":      float,   # Valor de la UTM en pesos chilenos
            "mes":      int,     # Mes consultado
            "anio":     int,     # Año consultado
            "fuente":   str,     # "mindicador" | "base_de_datos" | "no_disponible"
            "error":    str,     # Mensaje de error si hubo alguno (puede ser None)
        }
    """
    hoy = datetime.today()
    anio = anio or hoy.year
    mes = mes or hoy.month

    resultado = {
        "utm":    None,
        "mes":    mes,
        "anio":   anio,
        "fuente": None,
        "error":  None,
    }

    # --- Intento 1: API REST de mindicador.cl ---
    try:
        utm_valor = _consultar_mindicador(anio, mes)
        resultado["utm"] = utm_valor
        resultado["fuente"] = "mindicador"
        return resultado

    except ScraperError as e:
        # La API falló: guardamos el error y pasamos al fallback
        resultado["error"] = str(e)

    # --- Intento 2: Fallback a la última UTM guardada en la BD ---
    try:
        ultima = db_manager.obtener_ultima_utm_guardada()
        if ultima:
            resultado["utm"] = ultima["utm_valor"]
            resultado["fuente"] = "base_de_datos"
            resultado["error"] = (resultado["error"] or "") + (
                f" | AVISO: Se está usando la última UTM registrada "
                f"({ultima['utm_valor']} de {ultima['fecha']})."
            )
        else:
            resultado["fuente"] = "no_disponible"
            resultado["error"] = (resultado["error"] or "") + " | No hay UTM guardada en la base de datos."
    except Exception as db_error:
        resultado["fuente"] = "no_disponible"
        resultado["error"] = (resultado["error"] or "") + f" | Error al consultar BD de fallback: {db_error}"

    return resultado


def obtener_utm_actual() -> dict:
    """Atajo: obtiene la UTM del mes y año actual."""
    return obtener_utm()


# -------------------------------------------------------------------
# Refresco al arrancar y referencia para la UI
# -------------------------------------------------------------------

def refrescar_utm_si_falta() -> None:
    """
    D2: si la UTM del mes actual no está guardada, la obtiene de
    mindicador.cl y la persiste. Se llama una vez al arrancar la app
    (desde create_app()); nunca bloquea el arranque ni propaga errores
    de red.
    """
    hoy = datetime.today()
    if db_manager.obtener_utm_guardada(hoy.year, hoy.month):
        return
    try:
        resultado = obtener_utm_actual()
    except Exception:
        return
    if resultado["utm"] is not None and resultado["fuente"] == "mindicador":
        db_manager.guardar_utm(resultado["anio"], resultado["mes"], resultado["utm"])


def obtener_utm_referencia() -> dict:
    """
    UTM a mostrar/usar como referencia "actual" en la UI: prioriza la
    del mes en curso; si no está, cae a la última guardada (de un mes
    distinto) y lo marca explícitamente para que la UI pueda avisarlo.

    Retorna {"utm_valor": float|None, "es_actual": bool}.
    """
    hoy = datetime.today()
    actual = db_manager.obtener_utm_guardada(hoy.year, hoy.month)
    if actual:
        return {"utm_valor": actual["utm_valor"], "es_actual": True}

    ultima = db_manager.obtener_ultima_utm_guardada()
    if ultima:
        return {"utm_valor": ultima["utm_valor"], "es_actual": False}

    return {"utm_valor": None, "es_actual": False}


# -------------------------------------------------------------------
# Completar meses pasados: año completo en una sola petición + caché
# -------------------------------------------------------------------

def obtener_utm_anio(anio: int) -> dict:
    """
    Obtiene TODOS los valores UTM publicados para un año en una sola
    petición a mindicador.cl. Retorna {mes: valor} solo para los meses
    presentes en la serie (los meses futuros/no publicados no aparecen).

    Lanza ScraperError si la petición falla (igual que _get_json).
    """
    serie = _get_json(API_ANIO.format(anio=anio)).get("serie", [])
    valores = {}
    for item in serie:
        fecha = item.get("fecha", "")
        if len(fecha) >= 7:
            try:
                y = int(fecha[0:4])
                m = int(fecha[5:7])
            except ValueError:
                continue
            if y == anio and item.get("valor") is not None:
                valores[m] = float(item["valor"])
    return valores


def obtener_utm_mes_con_cache(anio: int, mes: int) -> dict:
    """
    Pensado para completar meses pasados (vínculo mes↔UTM en el
    formulario de registro): si el mes ya está cacheado en la BD, no
    hace ninguna petición de red. Si no, trae el AÑO COMPLETO en una
    sola petición y cachea todo lo que recibe (no solo el mes pedido),
    para no gastar una petición por mes al completar varios del mismo año.

    Mismo shape de retorno que obtener_utm().
    """
    resultado = {
        "utm":    None,
        "mes":    mes,
        "anio":   anio,
        "fuente": None,
        "error":  None,
    }

    guardado = db_manager.obtener_utm_guardada(anio, mes)
    if guardado:
        resultado["utm"] = guardado["utm_valor"]
        resultado["fuente"] = "base_de_datos"
        return resultado

    try:
        serie_anio = obtener_utm_anio(anio)
    except ScraperError as e:
        resultado["fuente"] = "no_disponible"
        resultado["error"] = str(e)
        return resultado

    if serie_anio:
        db_manager.guardar_utm_bulk(anio, serie_anio)

    if mes in serie_anio:
        resultado["utm"] = serie_anio[mes]
        resultado["fuente"] = "mindicador"
    else:
        resultado["fuente"] = "no_disponible"
        resultado["error"] = (
            f"mindicador.cl no tiene UTM publicada para {mes:02d}/{anio}. "
            f"Es posible que el mes aún no esté disponible."
        )

    return resultado


# -------------------------------------------------------------------
# Lógica interna: consulta a mindicador.cl
# -------------------------------------------------------------------

def _consultar_mindicador(anio: int, mes: int) -> float:
    """
    Consulta la API de mindicador.cl y extrae el valor UTM del mes/año dado.

    Estrategia:
      1. Pide el año completo (GET /api/utm/<aaaa>) y busca el mes en la serie.
      2. Si no aparece, intenta la fecha puntual (GET /api/utm/01-<mm>-<aaaa>).

    Lanza ScraperError si la API no responde o el mes/año no está publicado.
    """
    if not 1 <= mes <= 12:
        raise ScraperError(f"Número de mes inválido: {mes}. Debe ser entre 1 y 12.")

    # 1. Serie anual (una sola petición trae todos los meses publicados)
    serie_anio = obtener_utm_anio(anio)
    if mes in serie_anio:
        return serie_anio[mes]

    # 2. Fecha puntual (día 1 del mes)
    serie = _get_json(
        API_FECHA.format(dia=1, mes=mes, anio=anio)
    ).get("serie", [])
    valor = _buscar_mes_en_serie(serie, anio, mes)
    if valor is not None:
        return valor

    raise ScraperError(
        f"mindicador.cl no tiene UTM publicada para {mes:02d}/{anio}. "
        f"Es posible que el mes aún no esté disponible."
    )


def _get_json(url: str) -> dict:
    """Realiza el GET y devuelve el JSON, o lanza ScraperError con el motivo."""
    try:
        respuesta = requests.get(url, headers=HEADERS, timeout=TIMEOUT)
        respuesta.raise_for_status()
        return respuesta.json()
    except requests.exceptions.Timeout:
        raise ScraperError(
            f"mindicador.cl tardó más de {TIMEOUT}s en responder ({url})."
        )
    except requests.exceptions.ConnectionError:
        raise ScraperError(
            "No se pudo conectar a mindicador.cl. Verifica tu conexión a internet."
        )
    except requests.exceptions.HTTPError as e:
        raise ScraperError(
            f"mindicador.cl devolvió un error HTTP: "
            f"{e.response.status_code} para {url}"
        )
    except ValueError:
        raise ScraperError(f"mindicador.cl devolvió una respuesta no válida ({url}).")


def _buscar_mes_en_serie(serie: list, anio: int, mes: int) -> float | None:
    """
    Busca en la serie el registro cuyo 'fecha' coincide con anio/mes.
    Retorna el valor como float, o None si no está en la serie.
    """
    for item in serie:
        fecha = item.get("fecha", "")
        # fecha ISO: "2026-07-01T04:00:00.000Z"
        if len(fecha) >= 7:
            try:
                y = int(fecha[0:4])
                m = int(fecha[5:7])
            except ValueError:
                continue
            if y == anio and m == mes and item.get("valor") is not None:
                return float(item["valor"])
    return None


# -------------------------------------------------------------------
# Excepción personalizada
# -------------------------------------------------------------------

class ScraperError(Exception):
    """
    Se lanza cuando la obtención de la UTM falla por cualquier motivo:
    - Timeout de red
    - Error HTTP
    - Respuesta no válida
    - Mes/año no publicado todavía
    """
    pass
