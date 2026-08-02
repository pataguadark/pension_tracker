"""
db_manager.py
-------------
Responsabilidad: TODA la interacción con SQLite.
  - Conexión y creación de tablas
  - Insertar, consultar y eliminar pagos
  - Guardar/recuperar UTM para fallback del scraper

Esquema de la tabla principal `pagos`:
  id              INTEGER  PRIMARY KEY AUTOINCREMENT
  fecha           TEXT     Fecha del pago registrado (YYYY-MM-DD)
  mes_pago        INTEGER  Mes al que corresponde el pago (1-12)
  anio_pago       INTEGER  Año al que corresponde el pago
  utm_valor       REAL     Valor UTM vigente al momento del registro
  cuota_pactada   REAL     Monto pactado en pesos (calculado: UTM × factor)
  monto_pagado    REAL     Monto efectivamente pagado en pesos
  desbalance      REAL     Diferencia: monto_pagado - cuota_pactada

Esquema de la tabla auxiliar `utm_historial`:
  id              INTEGER  PRIMARY KEY AUTOINCREMENT
  anio            INTEGER
  mes             INTEGER
  utm_valor       REAL
  fecha_registro  TEXT     Cuándo se guardó este dato (YYYY-MM-DD HH:MM:SS)
  UNIQUE(anio, mes)        Solo un valor UTM por mes/año

Esquema de la tabla auxiliar `configuracion` (clave/valor genérico):
  clave           TEXT     PRIMARY KEY
  valor           TEXT
"""

import sqlite3
import os
from datetime import datetime

from pensiontracker import config

# La ruta de la BD vive en el directorio de datos del usuario (ver config.py),
# no en el árbol del código.
DB_PATH = config.DB_PATH

CLAVE_FACTOR_UTM_PREDETERMINADO = "factor_utm_predeterminado"


# -------------------------------------------------------------------
# Conexión
# -------------------------------------------------------------------

def get_connection() -> sqlite3.Connection:
    """
    Retorna una conexión a SQLite con Row Factory activado
    (permite acceder a columnas por nombre: row['fecha']).
    """
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    # Habilita claves foráneas (buena práctica aunque no las usemos aún)
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


# -------------------------------------------------------------------
# Inicialización (crear tablas si no existen)
# -------------------------------------------------------------------

def inicializar_db() -> None:
    """
    Crea las tablas necesarias si aún no existen.
    Llamar desde create_app(), nunca como efecto secundario del import.
    """
    conn = get_connection()
    try:
        cursor = conn.cursor()

        # Tabla principal de pagos
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS pagos (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                fecha         TEXT    NOT NULL,
                mes_pago      INTEGER NOT NULL,
                anio_pago     INTEGER NOT NULL,
                utm_valor     REAL    NOT NULL,
                cuota_pactada REAL    NOT NULL,
                monto_pagado  REAL    NOT NULL,
                desbalance    REAL    NOT NULL
            )
        """)

        # Tabla auxiliar para historial de UTMs (sirve como caché/fallback)
        # Migración: agregar utm_factor si no existe (tabla antigua)
        cursor.execute("""
            SELECT COUNT(*) FROM pragma_table_info('pagos') WHERE name='utm_factor'
        """)
        if cursor.fetchone()[0] == 0:
            cursor.execute("""
                ALTER TABLE pagos ADD COLUMN utm_factor REAL
            """)

        cursor.execute("""
            CREATE TABLE IF NOT EXISTS utm_historial (
                id             INTEGER PRIMARY KEY AUTOINCREMENT,
                anio           INTEGER NOT NULL,
                mes            INTEGER NOT NULL,
                utm_valor      REAL    NOT NULL,
                fecha_registro TEXT    NOT NULL,
                UNIQUE(anio, mes)
            )
        """)

        cursor.execute("""
            CREATE TABLE IF NOT EXISTS configuracion (
                clave TEXT PRIMARY KEY,
                valor TEXT NOT NULL
            )
        """)

        conn.commit()
    finally:
        conn.close()

    if os.name == "posix":
        os.chmod(DB_PATH, 0o600)


# -------------------------------------------------------------------
# Operaciones sobre PAGOS
# -------------------------------------------------------------------

def insertar_pago(fecha: str, mes_pago: int, anio_pago: int,
                  utm_valor: float, cuota_pactada: float,
                  monto_pagado: float, desbalance: float,
                  utm_factor: float = None) -> int:
    """
    Inserta un nuevo pago en la tabla `pagos`.

    Retorna el ID del registro insertado.
    """
    conn = get_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO pagos
                (fecha, mes_pago, anio_pago, utm_valor,
                 cuota_pactada, monto_pagado, desbalance, utm_factor)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (fecha, mes_pago, anio_pago, utm_valor,
              cuota_pactada, monto_pagado, desbalance, utm_factor))
        conn.commit()
        return cursor.lastrowid
    finally:
        conn.close()


def obtener_todos_los_pagos() -> list:
    """
    Retorna todos los pagos ordenados por año y mes descendente
    (el más reciente primero).
    """
    conn = get_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT * FROM pagos
            ORDER BY anio_pago DESC, mes_pago DESC
        """)
        return [dict(row) for row in cursor.fetchall()]
    finally:
        conn.close()


def obtener_pago_por_id(pago_id: int) -> dict | None:
    """Retorna un pago específico por su ID, o None si no existe."""
    conn = get_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM pagos WHERE id = ?", (pago_id,))
        row = cursor.fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def obtener_pagos_por_anio(anio: int) -> list:
    """Retorna todos los pagos de un año específico."""
    conn = get_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT * FROM pagos
            WHERE anio_pago = ?
            ORDER BY mes_pago ASC
        """, (anio,))
        return [dict(row) for row in cursor.fetchall()]
    finally:
        conn.close()


def actualizar_pago(pago_id: int, fecha: str, mes_pago: int, anio_pago: int,
                    utm_valor: float, cuota_pactada: float,
                    monto_pagado: float, desbalance: float,
                    utm_factor: float = None) -> bool:
    """
    Actualiza todos los campos de un pago existente.
    Retorna True si se actualizó, False si el ID no existía.
    """
    conn = get_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("""
            UPDATE pagos SET
                fecha         = ?,
                mes_pago      = ?,
                anio_pago     = ?,
                utm_valor     = ?,
                cuota_pactada = ?,
                monto_pagado  = ?,
                desbalance    = ?,
                utm_factor    = ?
            WHERE id = ?
        """, (fecha, mes_pago, anio_pago, utm_valor,
              cuota_pactada, monto_pagado, desbalance, utm_factor, pago_id))
        conn.commit()
        return cursor.rowcount > 0
    finally:
        conn.close()


def eliminar_pago(pago_id: int) -> bool:
    """
    Elimina un pago por ID.
    Retorna True si se eliminó algo, False si el ID no existía.
    """
    conn = get_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM pagos WHERE id = ?", (pago_id,))
        conn.commit()
        return cursor.rowcount > 0
    finally:
        conn.close()


def obtener_resumen_anual(anio: int) -> dict:
    """
    Retorna un resumen estadístico de los pagos de un año:
      - total_pagado
      - total_pactado
      - desbalance_acumulado
      - cantidad_pagos
    """
    conn = get_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT
                COUNT(*)            AS cantidad_pagos,
                SUM(monto_pagado)   AS total_pagado,
                SUM(cuota_pactada)  AS total_pactado,
                SUM(desbalance)     AS desbalance_acumulado
            FROM pagos
            WHERE anio_pago = ?
        """, (anio,))
        row = cursor.fetchone()
        return dict(row) if row else {}
    finally:
        conn.close()


# -------------------------------------------------------------------
# Operaciones sobre UTM_HISTORIAL (caché / fallback)
# -------------------------------------------------------------------

def guardar_utm(anio: int, mes: int, utm_valor: float) -> None:
    """
    Guarda o actualiza el valor UTM para un mes/año en el historial.
    Usar INSERT OR REPLACE para no duplicar si ya existe.
    """
    conn = get_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("""
            INSERT OR REPLACE INTO utm_historial
                (anio, mes, utm_valor, fecha_registro)
            VALUES (?, ?, ?, ?)
        """, (anio, mes, utm_valor,
              datetime.now().strftime("%Y-%m-%d %H:%M:%S")))
        conn.commit()
    finally:
        conn.close()


def guardar_utm_bulk(anio: int, valores: dict) -> None:
    """
    Guarda varios meses de un mismo año de una vez (una sola conexión,
    una sola transacción). Usado al completar meses pasados: mindicador.cl
    trae el año completo en una petición, así que cacheamos todo lo
    recibido en vez de hacer un guardar_utm() por mes.

    valores: {mes: utm_valor}
    """
    if not valores:
        return
    ahora = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    conn = get_connection()
    try:
        cursor = conn.cursor()
        cursor.executemany("""
            INSERT OR REPLACE INTO utm_historial
                (anio, mes, utm_valor, fecha_registro)
            VALUES (?, ?, ?, ?)
        """, [(anio, mes, valor, ahora) for mes, valor in valores.items()])
        conn.commit()
    finally:
        conn.close()


def obtener_utm_guardada(anio: int, mes: int) -> dict | None:
    """
    Busca un valor UTM guardado para un mes/año específico.
    Retorna dict con {utm_valor, fecha_registro} o None.
    """
    conn = get_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT utm_valor, fecha_registro
            FROM utm_historial
            WHERE anio = ? AND mes = ?
        """, (anio, mes))
        row = cursor.fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def obtener_ultima_utm_guardada() -> dict | None:
    """
    Retorna la UTM más reciente guardada en el historial.
    Usado como fallback cuando el SII no responde.
    Retorna dict con {utm_valor, fecha, anio, mes} o None.
    """
    conn = get_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT utm_valor, fecha_registro AS fecha, anio, mes
            FROM utm_historial
            ORDER BY anio DESC, mes DESC
            LIMIT 1
        """)
        row = cursor.fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def obtener_ultimo_factor_utm() -> float | None:
    """
    Retorna el último factor UTM usado en un pago registrado.
    Útil para pre-cargar el formulario de registro.
    """
    conn = get_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT utm_factor FROM pagos
            WHERE utm_factor IS NOT NULL
            ORDER BY anio_pago DESC, mes_pago DESC, id DESC
            LIMIT 1
        """)
        row = cursor.fetchone()
        return row["utm_factor"] if row else None
    finally:
        conn.close()


# -------------------------------------------------------------------
# Operaciones sobre CONFIGURACION (clave/valor genérico)
# -------------------------------------------------------------------

def guardar_configuracion(clave: str, valor: str) -> None:
    """Guarda o actualiza un valor de configuración (upsert)."""
    conn = get_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO configuracion (clave, valor) VALUES (?, ?)
            ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor
        """, (clave, valor))
        conn.commit()
    finally:
        conn.close()


def obtener_configuracion(clave: str) -> str | None:
    """Retorna el valor guardado para una clave de configuración, o None."""
    conn = get_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT valor FROM configuracion WHERE clave = ?", (clave,))
        row = cursor.fetchone()
        return row["valor"] if row else None
    finally:
        conn.close()
