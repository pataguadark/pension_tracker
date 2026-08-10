"""
test_importador.py
------------------
El validador y el importador de respaldos, aislados de Flask.

Las bases de prueba se construyen acá mismo con valores sintéticos: nunca
se lee un archivo real de nadie.
"""

import sqlite3
from pathlib import Path

import pytest

from pensiontracker.services import importador


def _crear_respaldo(ruta: Path, *, con_utm_factor: bool = True) -> None:
    """Crea un .db con el esquema de la aplicación y un pago sintético."""
    conn = sqlite3.connect(ruta)
    columna_factor = ",\n            utm_factor    REAL" if con_utm_factor else ""
    conn.executescript(f"""
        CREATE TABLE pagos (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            fecha         TEXT    NOT NULL,
            mes_pago      INTEGER NOT NULL,
            anio_pago     INTEGER NOT NULL,
            utm_valor     REAL    NOT NULL,
            cuota_pactada REAL    NOT NULL,
            monto_pagado  REAL    NOT NULL,
            desbalance    REAL    NOT NULL{columna_factor}
        );
        CREATE TABLE utm_historial (
            id             INTEGER PRIMARY KEY AUTOINCREMENT,
            anio           INTEGER NOT NULL,
            mes            INTEGER NOT NULL,
            utm_valor      REAL    NOT NULL,
            fecha_registro TEXT    NOT NULL,
            UNIQUE(anio, mes)
        );
        CREATE TABLE configuracion (
            clave TEXT PRIMARY KEY,
            valor TEXT NOT NULL
        );
    """)
    if con_utm_factor:
        conn.execute(
            "INSERT INTO pagos (id, fecha, mes_pago, anio_pago, utm_valor,"
            " cuota_pactada, monto_pagado, desbalance, utm_factor)"
            " VALUES (1, '2026-07-15', 7, 2026, 70000, 210000, 200000, -10000, 3.0)"
        )
    else:
        conn.execute(
            "INSERT INTO pagos (id, fecha, mes_pago, anio_pago, utm_valor,"
            " cuota_pactada, monto_pagado, desbalance)"
            " VALUES (1, '2026-07-15', 7, 2026, 70000, 210000, 200000, -10000)"
        )
    conn.commit()
    conn.close()


def test_acepta_un_respaldo_del_esquema_actual(tmp_path):
    ruta = tmp_path / "respaldo.db"
    _crear_respaldo(ruta)

    informe = importador.validar(ruta)

    assert informe.tiene_utm_factor is True


def test_acepta_un_respaldo_legacy_sin_utm_factor(tmp_path):
    """
    El escritorio y el móvil migran esa base al arrancar, así que rechazarla
    como importación sería incoherente: es un archivo que la app abre feliz
    como base propia.
    """
    ruta = tmp_path / "legacy.db"
    _crear_respaldo(ruta, con_utm_factor=False)

    informe = importador.validar(ruta)

    assert informe.tiene_utm_factor is False


def test_rechaza_un_archivo_que_no_es_sqlite(tmp_path):
    ruta = tmp_path / "cualquier_cosa.db"
    ruta.write_bytes(b"esto no es una base de datos")

    with pytest.raises(importador.RespaldoInvalido, match="No parece un respaldo"):
        importador.validar(ruta)


def test_rechaza_una_base_de_otra_aplicacion(tmp_path):
    ruta = tmp_path / "ajena.db"
    conn = sqlite3.connect(ruta)
    conn.execute("CREATE TABLE clientes (id INTEGER PRIMARY KEY, nombre TEXT)")
    conn.commit()
    conn.close()

    with pytest.raises(importador.RespaldoInvalido, match="no de esta aplicación"):
        importador.validar(ruta)


def test_rechaza_una_tabla_con_columnas_distintas(tmp_path):
    """
    Una base con las tres tablas pero con `pagos` de otra forma. Es el caso
    que la comparación de estructura existe para atrapar: sin ella, el
    importador leería columnas que no están.
    """
    ruta = tmp_path / "parecida.db"
    conn = sqlite3.connect(ruta)
    conn.executescript("""
        CREATE TABLE pagos (id INTEGER PRIMARY KEY, monto TEXT);
        CREATE TABLE utm_historial (
            id             INTEGER PRIMARY KEY AUTOINCREMENT,
            anio           INTEGER NOT NULL,
            mes            INTEGER NOT NULL,
            utm_valor      REAL    NOT NULL,
            fecha_registro TEXT    NOT NULL,
            UNIQUE(anio, mes)
        );
        CREATE TABLE configuracion (clave TEXT PRIMARY KEY, valor TEXT NOT NULL);
    """)
    conn.commit()
    conn.close()

    with pytest.raises(importador.RespaldoInvalido, match="no de esta aplicación"):
        importador.validar(ruta)


def test_rechaza_una_base_con_una_tabla_de_mas(tmp_path):
    """
    Las tres tablas esperadas están, correctas, pero hay una cuarta ajena.
    Sin esta comprobación el validador adoptaría cualquier archivo que
    además de la estructura propia traiga contenido de otra aplicación.
    """
    ruta = tmp_path / "con_extra.db"
    _crear_respaldo(ruta)
    conn = sqlite3.connect(ruta)
    conn.execute("CREATE TABLE notas (id INTEGER PRIMARY KEY, texto TEXT)")
    conn.commit()
    conn.close()

    with pytest.raises(importador.RespaldoInvalido, match="no de esta aplicación"):
        importador.validar(ruta)


def test_rechaza_una_base_danada(tmp_path):
    """
    Un archivo con cabecera de SQLite pero con las páginas rotas: sqlite lo
    abre y falla al leerlo. Es lo que `integrity_check` está para detectar.
    """
    ruta = tmp_path / "danada.db"
    _crear_respaldo(ruta)
    contenido = bytearray(ruta.read_bytes())
    # Se conservan los primeros 16 bytes (la cadena "SQLite format 3\0")
    # y se destroza el resto: la cabecera sigue siendo válida, el cuerpo no.
    for i in range(16, len(contenido)):
        contenido[i] = 0
    ruta.write_bytes(bytes(contenido))

    with pytest.raises(importador.RespaldoInvalido):
        importador.validar(ruta)


@pytest.fixture
def base_viva(tmp_path, monkeypatch):
    """
    Una base de la aplicación en tmp_path, con un pago, puesta como la base
    activa. monkeypatch y no asignación directa: si no, el test siguiente
    hereda la ruta.
    """
    from pensiontracker.database import db_manager

    ruta = tmp_path / "pension_tracker.db"
    monkeypatch.setattr(db_manager, "DB_PATH", ruta)
    db_manager.inicializar_db()
    db_manager.insertar_pago("2026-06-10", 6, 2026, 69000.0, 207000.0,
                             207000.0, 0.0, 3.0)
    return ruta


def test_columnas_esperadas_coincide_con_el_esquema_real_de_db_manager(base_viva):
    """
    COLUMNAS_ESPERADAS es una copia a mano del esquema que db_manager.py
    crea con CREATE TABLE. Si alguien agrega una columna allá y olvida
    replicarla acá, el importador empieza a rechazar respaldos legítimos y
    ninguna prueba lo nota. Esta prueba cierra ese candado: compara el
    PRAGMA table_info real de una base creada por
    db_manager.inicializar_db() -la fixture base_viva ya la deja armada-
    contra COLUMNAS_ESPERADAS, tabla por tabla.
    """
    conn = sqlite3.connect(base_viva)
    try:
        for tabla, columnas_esperadas in importador.COLUMNAS_ESPERADAS.items():
            columnas_reales = [
                (fila[1], fila[2].upper(), fila[3])
                for fila in conn.execute(f"PRAGMA table_info({tabla})")
            ]
            assert columnas_reales == columnas_esperadas, tabla
    finally:
        conn.close()


def test_la_copia_previa_es_una_base_legible_con_los_mismos_pagos(base_viva):
    copia = importador.respaldar_base_actual()

    assert copia.exists()
    conn = sqlite3.connect(copia)
    filas = conn.execute("SELECT monto_pagado FROM pagos").fetchall()
    conn.close()
    assert filas == [(207000.0,)]


def test_solo_se_conservan_las_tres_copias_mas_recientes(base_viva):
    rutas = [importador.respaldar_base_actual() for _ in range(5)]

    vivas = sorted(base_viva.parent.glob(f"{base_viva.name}.previo-*"))
    assert len(vivas) == importador.COPIAS_A_CONSERVAR
    # Las que sobreviven son las últimas tres creadas.
    assert vivas == sorted(rutas[-3:])


def test_un_backup_a_medio_escribir_no_deja_copia_contada_como_buena(
    base_viva, monkeypatch
):
    """
    Si origen.backup(copia) falla a mitad de camino -disco lleno, error de
    E/S-, no debe quedar ningún archivo que matchee el patrón de copias: uno
    de 0 bytes se colaría en _rotar_copias() como si fuera una copia buena,
    empujando fuera de la ventana de tres a una copia real.

    `sqlite3.Connection` es un tipo inmutable de la extensión C: no admite
    parchar `.backup` en la clase. Se reemplaza en cambio la conexión que
    devuelve `db_manager.get_connection()` -la única que
    `respaldar_base_actual()` usa como origen- por un doble que falla al
    respaldar y delega el cierre en la conexión real.
    """
    from pensiontracker.database import db_manager

    conexion_real = db_manager.get_connection()

    class ConexionQueFallaAlRespaldar:
        def backup(self, *args, **kwargs):
            raise sqlite3.OperationalError("fallo sintético de E/S")

        def close(self):
            conexion_real.close()

    monkeypatch.setattr(
        db_manager, "get_connection", lambda: ConexionQueFallaAlRespaldar()
    )

    with pytest.raises(sqlite3.OperationalError):
        importador.respaldar_base_actual()

    copias = list(base_viva.parent.glob(f"{base_viva.name}.previo-*"))
    assert copias == []


def test_dos_copias_en_el_mismo_segundo_no_se_pisan(base_viva):
    """
    La marca de tiempo llega al segundo. Cinco importaciones seguidas en un
    test caben de sobra dentro del mismo, y sin desambiguar la segunda
    sobreescribiría a la primera y la rotación contaría mal.
    """
    primera = importador.respaldar_base_actual()
    segunda = importador.respaldar_base_actual()

    assert primera != segunda
    assert primera.exists() and segunda.exists()


def test_importar_reemplaza_los_pagos_conservando_los_id(base_viva, tmp_path):
    respaldo = tmp_path / "respaldo.db"
    _crear_respaldo(respaldo)

    resumen = importador.importar(respaldo)

    from pensiontracker.database import db_manager
    pagos = db_manager.obtener_todos_los_pagos()
    assert len(pagos) == 1
    assert pagos[0]["id"] == 1
    assert pagos[0]["monto_pagado"] == 200000.0
    assert resumen.pagos == 1


def test_importar_un_respaldo_legacy_deja_utm_factor_en_null(base_viva, tmp_path):
    respaldo = tmp_path / "legacy.db"
    _crear_respaldo(respaldo, con_utm_factor=False)

    importador.importar(respaldo)

    from pensiontracker.database import db_manager
    pagos = db_manager.obtener_todos_los_pagos()
    assert pagos[0]["utm_factor"] is None


def test_importar_deja_una_copia_de_la_base_anterior(base_viva, tmp_path):
    respaldo = tmp_path / "respaldo.db"
    _crear_respaldo(respaldo)

    resumen = importador.importar(respaldo)

    conn = sqlite3.connect(resumen.copia_previa)
    anteriores = conn.execute("SELECT monto_pagado FROM pagos").fetchall()
    conn.close()
    # El pago que tenía la base viva antes de importar, no el del respaldo.
    assert anteriores == [(207000.0,)]


def test_un_archivo_invalido_no_toca_los_datos_existentes(base_viva, tmp_path):
    respaldo = tmp_path / "basura.db"
    respaldo.write_bytes(b"esto no es una base de datos")

    with pytest.raises(importador.RespaldoInvalido):
        importador.importar(respaldo)

    from pensiontracker.database import db_manager
    pagos = db_manager.obtener_todos_los_pagos()
    assert len(pagos) == 1
    assert pagos[0]["monto_pagado"] == 207000.0


def test_importar_aborta_si_no_se_puede_escribir_la_copia_previa(
    base_viva, tmp_path, monkeypatch
):
    """
    La copia previa se hace ANTES de abrir la transacción, justamente para
    que un disco lleno o un permiso denegado aborten sin haber tocado la
    base. Si el orden se invirtiera, esta prueba lo caza.
    """
    respaldo = tmp_path / "respaldo.db"
    _crear_respaldo(respaldo)

    def explota() -> Path:
        raise OSError("disco lleno sintético")

    monkeypatch.setattr(importador, "respaldar_base_actual", explota)

    with pytest.raises(OSError):
        importador.importar(respaldo)

    from pensiontracker.database import db_manager
    pagos = db_manager.obtener_todos_los_pagos()
    assert len(pagos) == 1
    assert pagos[0]["monto_pagado"] == 207000.0


def test_un_fallo_a_mitad_de_la_transaccion_deja_la_base_como_estaba(
    base_viva, tmp_path, monkeypatch
):
    """
    Se hace explotar la inserción de `configuracion`, que va después de la
    de `pagos`: si el reemplazo no fuera atómico, quedarían los pagos del
    respaldo y la configuración de la base vieja.
    """
    respaldo = tmp_path / "respaldo.db"
    _crear_respaldo(respaldo)

    original = importador._insertar_filas

    def explota(conn, tabla, filas, informe):
        if tabla == "configuracion":
            raise sqlite3.OperationalError("fallo sintético")
        return original(conn, tabla, filas, informe)

    monkeypatch.setattr(importador, "_insertar_filas", explota)

    with pytest.raises(sqlite3.OperationalError):
        importador.importar(respaldo)

    from pensiontracker.database import db_manager
    pagos = db_manager.obtener_todos_los_pagos()
    assert len(pagos) == 1
    assert pagos[0]["monto_pagado"] == 207000.0
