"""
test_interoperabilidad_db.py
----------------------------
El archivo .db es el único puente entre el escritorio y el móvil: no hay
sincronización, se exporta de un lado y se importa en el otro. Estas
pruebas verifican que el esquema que crea cada plataforma sea legible por
la otra.

Se comparan **estructuras**, no el texto del CREATE TABLE: el escritorio
crea `pagos` sin `utm_factor` y la agrega con ALTER, así que el SQL
guardado difiere aunque las columnas sean idénticas. Una comparación
textual rechazaría archivos perfectamente válidos.
"""

import json
import sqlite3
import subprocess
import uuid
from pathlib import Path

import pytest

from pensiontracker.database import db_manager
from tests.test_fixtures_doradas import TOLERANCIA_ABSOLUTA_PARIDAD_TS

RAIZ = Path(__file__).resolve().parent.parent
MOBILE = RAIZ / "mobile"


def estructura(ruta_db: Path) -> dict:
    """Tablas y columnas de una base, en forma comparable entre plataformas.

    Por columna se compara nombre, tipo declarado y si admite NULL: `c[1]`
    (name), `c[2]` (type) y `c[3]` (notnull) de `PRAGMA table_info`. No se
    compara el texto crudo del CREATE TABLE (ver docstring del módulo), así
    que una columna agregada con ALTER TABLE (como `utm_factor` en el
    escritorio) es equivalente a una declarada inline con el mismo tipo y
    la misma nulabilidad: es justamente el caso que este archivo necesita
    tratar como compatible.

    La única excepción a "no comparar el texto crudo" es AUTOINCREMENT:
    PRAGMA table_info no lo reporta -una tabla con esa palabra y otra sin
    ella, mismas columnas, dan filas idénticas-, pero cambia el
    comportamiento real: sin AUTOINCREMENT, sqlite recicla el id de la fila
    borrada más alta al insertar de nuevo; con AUTOINCREMENT, siempre
    asigna uno nuevo. Que un id pase a referirse a otro pago es serio en un
    contexto legal, así que se agrega un indicador por tabla leyendo
    `sqlite_master.sql` (el único lugar donde AUTOINCREMENT queda
    registrado).
    """
    conn = sqlite3.connect(ruta_db)
    try:
        tablas = [
            fila[0]
            for fila in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table' "
                "AND name NOT LIKE 'sqlite_%' ORDER BY name"
            )
        ]
        return {
            tabla: (
                [
                    (c[1], c[2].upper(), bool(c[3]))
                    for c in conn.execute(f"PRAGMA table_info('{tabla}')")
                ],
                _tiene_autoincrement(conn, tabla),
            )
            for tabla in tablas
        }
    finally:
        conn.close()


def _tiene_autoincrement(conn: sqlite3.Connection, tabla: str) -> bool:
    """Si el DDL guardado en sqlite_master declara AUTOINCREMENT para `tabla`."""
    fila = conn.execute(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name=?", (tabla,)
    ).fetchone()
    sql = fila[0] if fila and fila[0] else ""
    return "AUTOINCREMENT" in sql.upper()


@pytest.fixture
def db_del_escritorio(tmp_path, monkeypatch) -> Path:
    ruta = tmp_path / "escritorio.db"
    monkeypatch.setattr(db_manager, "DB_PATH", ruta)
    db_manager.inicializar_db()
    return ruta


@pytest.fixture
def db_del_movil(tmp_path) -> Path:
    """Crea una base con el esquema del móvil, ejecutando el TypeScript real.

    `vite-node` 2.1.9 no soporta ejecutar un script inline (no tiene `-e`
    funcional: solo acepta rutas de archivo), así que el script se escribe a
    un archivo temporal dentro de `mobile/` -para que sus imports relativos
    ('./src/...') resuelvan igual que si fuera código del proyecto- y se
    borra al terminar.
    """
    ruta = tmp_path / "movil.db"
    script = (
        "import { EjecutorNode } from './src/data/ejecutor-node.ts';\n"
        "import { inicializarBd } from './src/data/esquema.ts';\n"
        f"const e = new EjecutorNode({json.dumps(str(ruta))});\n"
        "await inicializarBd(e);\n"
        "e.cerrar();\n"
    )
    script_temporal = MOBILE / f".tmp-interop-{uuid.uuid4().hex}.mts"
    script_temporal.write_text(script, encoding="utf-8")
    try:
        resultado = subprocess.run(
            ["npx", "vite-node", str(script_temporal)],
            cwd=MOBILE, capture_output=True, text=True,
        )
    finally:
        script_temporal.unlink(missing_ok=True)
    assert resultado.returncode == 0, (
        f"No se pudo crear la BD del móvil:\n{resultado.stdout}\n{resultado.stderr}"
    )
    return ruta


def test_ambas_plataformas_crean_la_misma_estructura(db_del_escritorio, db_del_movil):
    assert estructura(db_del_movil) == estructura(db_del_escritorio)


def test_estructura_distingue_tablas_con_y_sin_autoincrement(tmp_path):
    """PRAGMA table_info no reporta AUTOINCREMENT, así que dos tablas con
    las mismas columnas -una con AUTOINCREMENT y la otra sin- se veían
    iguales para `estructura()`. La diferencia es seria: al borrar una fila
    y volver a insertar, la tabla CON AUTOINCREMENT asigna un id nuevo; la
    tabla SIN, recicla el id borrado. Un id que pasa a referirse a otro
    pago es grave en un contexto legal.
    """
    con_autoincrement = tmp_path / "con_autoincrement.db"
    sin_autoincrement = tmp_path / "sin_autoincrement.db"

    conn = sqlite3.connect(con_autoincrement)
    conn.execute("CREATE TABLE pagos (id INTEGER PRIMARY KEY AUTOINCREMENT, x INTEGER)")
    conn.commit()
    conn.close()

    conn = sqlite3.connect(sin_autoincrement)
    conn.execute("CREATE TABLE pagos (id INTEGER PRIMARY KEY, x INTEGER)")
    conn.commit()
    conn.close()

    assert estructura(con_autoincrement) != estructura(sin_autoincrement)


def test_autoincrement_evita_que_un_id_borrado_se_reutilice(tmp_path):
    """Demuestra el riesgo concreto que motiva la prueba anterior: sin
    AUTOINCREMENT, sqlite reutiliza el id de la fila borrada más alta."""
    con_autoincrement = tmp_path / "con_autoincrement.db"
    sin_autoincrement = tmp_path / "sin_autoincrement.db"

    for ruta, ddl in (
        (con_autoincrement, "CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT, x INTEGER)"),
        (sin_autoincrement, "CREATE TABLE t (id INTEGER PRIMARY KEY, x INTEGER)"),
    ):
        conn = sqlite3.connect(ruta)
        conn.execute(ddl)
        for i in range(1, 4):
            conn.execute("INSERT INTO t (x) VALUES (?)", (i,))
        conn.execute("DELETE FROM t WHERE id = 3")
        conn.execute("INSERT INTO t (x) VALUES (99)")
        conn.commit()
        conn.close()

    def ultimo_id(ruta):
        conn = sqlite3.connect(ruta)
        try:
            return conn.execute("SELECT id FROM t WHERE x = 99").fetchone()[0]
        finally:
            conn.close()

    assert ultimo_id(con_autoincrement) == 4
    assert ultimo_id(sin_autoincrement) == 3


def test_el_escritorio_lee_una_base_creada_por_el_movil(db_del_movil, monkeypatch):
    monkeypatch.setattr(db_manager, "DB_PATH", db_del_movil)
    pago_id = db_manager.insertar_pago(
        fecha="2025-01-05", mes_pago=1, anio_pago=2025, utm_valor=67294,
        cuota_pactada=201882.0, monto_pagado=200000, desbalance=-1882.0,
        utm_factor=3.0,
    )
    pagos = db_manager.obtener_todos_los_pagos()
    assert len(pagos) == 1
    assert pagos[0]["id"] == pago_id
    assert pagos[0]["utm_factor"] == 3.0


def test_el_escritorio_no_migra_una_base_del_movil(db_del_movil, monkeypatch):
    """La migración de utm_factor debe verla ya presente y no volver a agregarla."""
    monkeypatch.setattr(db_manager, "DB_PATH", db_del_movil)
    db_manager.inicializar_db()
    columnas = estructura(db_del_movil)["pagos"][0]
    nombres = [c[0] for c in columnas]
    assert nombres.count("utm_factor") == 1


def _crear_base_legacy_del_escritorio(ruta: Path) -> None:
    """Crea una base como la dejaría una versión del escritorio anterior a
    utm_factor: tabla `pagos` de 8 columnas, sin esa, con una fila de datos.
    """
    conn = sqlite3.connect(ruta)
    try:
        conn.execute("""
            CREATE TABLE pagos (
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
        conn.execute("""
            INSERT INTO pagos
                (fecha, mes_pago, anio_pago, utm_valor,
                 cuota_pactada, monto_pagado, desbalance)
            VALUES ('2024-05-05', 5, 2024, 65000, 195000.0, 195000, 0.0)
        """)
        conn.commit()
    finally:
        conn.close()


def _correr_script_movil(ruta_db: Path, script: str) -> subprocess.CompletedProcess:
    script_temporal = MOBILE / f".tmp-interop-{uuid.uuid4().hex}.mts"
    script_temporal.write_text(script, encoding="utf-8")
    try:
        return subprocess.run(
            ["npx", "vite-node", str(script_temporal)],
            cwd=MOBILE, capture_output=True, text=True,
        )
    finally:
        script_temporal.unlink(missing_ok=True)


def test_el_movil_migra_una_base_legacy_del_escritorio(tmp_path, monkeypatch):
    """Una base creada por un escritorio anterior a utm_factor (8 columnas
    en `pagos`, sin esa) debe ser migrada por `inicializarBd`, no rechazada.

    Es el hallazgo crítico de la revisión final: el escritorio migra estas
    bases al arrancar (ALTER TABLE condicional, ver db_manager.py:88-97);
    el móvil, al no replicar esa migración, fallaba con "no such column:
    utm_factor" en cualquier lectura o escritura sobre `pagos`.
    """
    ruta = tmp_path / "legacy.db"
    _crear_base_legacy_del_escritorio(ruta)

    # El móvil abre la base legacy y debería migrarla.
    resultado = _correr_script_movil(ruta, (
        "import { EjecutorNode } from './src/data/ejecutor-node.ts';\n"
        "import { inicializarBd } from './src/data/esquema.ts';\n"
        f"const e = new EjecutorNode({json.dumps(str(ruta))});\n"
        "await inicializarBd(e);\n"
        "e.cerrar();\n"
    ))
    assert resultado.returncode == 0, (
        f"inicializarBd falló sobre una base legacy:\n"
        f"{resultado.stdout}\n{resultado.stderr}"
    )

    # (a) inicializarBd migró: la columna utm_factor ahora existe.
    columnas = estructura(ruta)["pagos"][0]
    nombres = [c[0] for c in columnas]
    assert "utm_factor" in nombres

    # (b) el móvil lee la fila existente, y (c) su utm_factor queda en nulo.
    visto = _leer_con_typescript(ruta)
    assert len(visto["pagos"]) == 1
    anio, mes, monto_pagado, desbalance, utm_factor = visto["pagos"][0]
    assert (anio, mes, monto_pagado, desbalance) == (2024, 5, 195000.0, 0.0)
    assert utm_factor is None

    # Tras la migración del móvil, el escritorio la sigue leyendo bien.
    monkeypatch.setattr(db_manager, "DB_PATH", ruta)
    pagos = db_manager.obtener_todos_los_pagos()
    assert len(pagos) == 1
    assert pagos[0]["mes_pago"] == 5
    assert pagos[0]["utm_factor"] is None


def test_la_migracion_del_movil_da_la_misma_estructura_que_la_del_escritorio(
    tmp_path, monkeypatch,
):
    """El ALTER TABLE que migra bases legacy debe declarar el mismo tipo en
    ambas plataformas, no solo el mismo nombre de columna.

    Las otras dos pruebas de este archivo no fijan esto:
    `test_ambas_plataformas_crean_la_misma_estructura` compara bases
    frescas, que usan el CREATE TABLE inline y nunca pasan por el ALTER;
    `test_el_movil_migra_una_base_legacy_del_escritorio` solo comprueba que
    el nombre `utm_factor` esté presente, no su tipo declarado. Un ALTER
    TABLE pagos ADD COLUMN utm_factor TEXT (en vez de REAL) pasaría ambas
    pruebas sin que ninguna se diera cuenta, y dejaría al escritorio
    leyendo el factor como cadena: '3.0561' * 68785 no lanza excepción en
    Python, repite la cadena, y la cuota calculada es una aberración de
    decenas de miles de caracteres.

    Acá se migra la MISMA base legacy con cada plataforma -una copia por
    cada una, para no compartir el archivo- y se compara la estructura
    completa (nombre, tipo y nulabilidad de cada columna) del resultado.
    """
    ruta_escritorio = tmp_path / "legacy_escritorio.db"
    ruta_movil = tmp_path / "legacy_movil.db"
    _crear_base_legacy_del_escritorio(ruta_escritorio)
    _crear_base_legacy_del_escritorio(ruta_movil)

    monkeypatch.setattr(db_manager, "DB_PATH", ruta_escritorio)
    db_manager.inicializar_db()

    resultado = _correr_script_movil(ruta_movil, (
        "import { EjecutorNode } from './src/data/ejecutor-node.ts';\n"
        "import { inicializarBd } from './src/data/esquema.ts';\n"
        f"const e = new EjecutorNode({json.dumps(str(ruta_movil))});\n"
        "await inicializarBd(e);\n"
        "e.cerrar();\n"
    ))
    assert resultado.returncode == 0, (
        f"inicializarBd falló sobre una base legacy:\n"
        f"{resultado.stdout}\n{resultado.stderr}"
    )

    assert estructura(ruta_movil) == estructura(ruta_escritorio)


def test_el_movil_migra_una_base_legacy_de_forma_idempotente(tmp_path):
    """Correr inicializarBd dos veces sobre una base legacy no debe fallar
    ni duplicar la columna utm_factor."""
    ruta = tmp_path / "legacy_idempotente.db"
    _crear_base_legacy_del_escritorio(ruta)

    script = (
        "import { EjecutorNode } from './src/data/ejecutor-node.ts';\n"
        "import { inicializarBd } from './src/data/esquema.ts';\n"
        f"const e = new EjecutorNode({json.dumps(str(ruta))});\n"
        "await inicializarBd(e);\n"
        "await inicializarBd(e);\n"
        "e.cerrar();\n"
    )
    resultado = _correr_script_movil(ruta, script)
    assert resultado.returncode == 0, (
        f"la segunda migración falló:\n{resultado.stdout}\n{resultado.stderr}"
    )

    columnas = estructura(ruta)["pagos"][0]
    nombres = [c[0] for c in columnas]
    assert nombres.count("utm_factor") == 1


# ---------------------------------------------------------------------
# Interoperabilidad de DATOS: no solo el esquema, también los pagos y
# los cálculos que se hacen sobre ellos. Es la promesa que sostiene el
# respaldo intercambiable entre plataformas.
# ---------------------------------------------------------------------

PAGOS_SINTETICOS = [
    # (mes, anio, utm_valor, cuota_pactada, monto_pagado, desbalance, utm_factor)
    #
    # Los desbalances de este bloque son deliberadamente NO enteros. Con
    # desbalances enteros (versión anterior de esta constante), el saldo
    # corrido que arma obtener_historial_desbalances() / obtenerHistorial-
    # Desbalances() da el mismo número se redondee o no en cada paso, así
    # que un mutante que le quitara el redondeo a `acumuladoCorrido` en el
    # lado TypeScript (mobile/src/core/calculos.ts) pasaba las 6 pruebas de
    # este archivo sin que ninguna se diera cuenta. Ver docstring del
    # módulo de mutación y el reporte de la tarea 5.
    #
    # Aquí monto_pagado (lo efectivamente transferido) es un peso redondo
    # -como en la vida real, no se transfieren centavos- pero cuota_pactada
    # lleva milésimos de peso -como los deja el valor UTM oficial, que el
    # SII publica con dos decimales, multiplicado por un factor con más
    # decimales-, así que desbalance = monto_pagado - cuota_pactada hereda
    # esos milésimos. El pago de noviembre-2024 deja el acumulado crudo
    # (sin redondear) justo en -0.005: un empate de redondeo real, el
    # punto exacto donde Python (par más cercano) y un `Math.round` u otro
    # redondeo "hacia arriba" en JavaScript discreparían si el port
    # estuviera mal. Los valores esperados de estas pruebas nunca se
    # calculan a mano: los produce en tiempo de ejecución
    # calculation_service (la referencia), tanto para el resumen como
    # para el historial (ver test_los_calculos_coinciden_sobre_la_misma_base).
    #
    # Continuación de la tarea 5: el mismo hueco reaparecía en la columna
    # "Valor UTM" del historial (desbalance_utm_mes_pesos /
    # desbalance_utm_corrido_pesos, líneas 243-244 de calculos.ts) por DOS
    # motivos que había que atacar juntos, no uno solo:
    #
    #   1. desbalance_utm_mes_pesos ni siquiera se leía del lado
    #      TypeScript en _leer_con_typescript(): un mutante que le
    #      quitara el redondeo no podía detectarse porque el campo no se
    #      comparaba con nada. Se agregó a la proyección del historial.
    #   2. Las comparaciones usaban pytest.approx(...) sin tolerancia
    #      explícita (rel=1e-6 por defecto). Con montos del orden de
    #      miles de pesos, la diferencia entre redondear y no redondear a
    #      2 decimales (a lo sumo 0.005) puede caer por debajo de esa
    #      tolerancia relativa y pasar inadvertida — es el mismo problema
    #      que TOLERANCIA_ABSOLUTA_PARIDAD_TS ya resuelve en
    #      test_fixtures_doradas.py. Se reutiliza esa misma constante acá
    #      en vez de inventar otra, para no reabrir la asimetría de
    #      sensibilidad entre las dos suites que ese comentario describe.
    #
    # Con esos dos cambios, los pagos de enero y marzo de 2025 ya bastan
    # para delatar el mutante: el producto diferencia_en_UTM × utm_vigente
    # de esas filas no cae en un número entero de pesos, así que redondear
    # o no cambia el resultado en varios milésimos — muy por encima de
    # 5e-11. (Los pagos de febrero-2025 y noviembre-2024 dan diferencia_en_
    # UTM exactamente 0 -su monto_pagado es un múltiplo exacto de
    # utm_valor- así que no discriminan este mutante en particular, pero
    # siguen siendo necesarios para los otros casos descritos arriba.)
    #
    # Al verificar los cuatro mutantes de la tarea 5 (líneas 225, 243, 244
    # y 279 de calculos.ts) se encontró que, con solo estas cuatro filas,
    # el mutante de la línea 279 (redondeo del `desbalanceAcumulado` del
    # RESUMEN, no del historial corrido) tampoco se detectaba: los
    # milésimos de -1881.995/+0.005 se cancelan exactamente entre sí, y lo
    # mismo pasa con +5898.505/-0.005, así que la suma cruda de los cuatro
    # desbalances cae EXACTAMENTE en 4016.51 (bit a bit igual a su versión
    # redondeada) -no es cosa de tolerancia, sino que no hay ninguna
    # diferencia que detectar-. El pago de abril-2025 rompe esa
    # cancelación: su desbalance (-0.123) no tiene contrapartida que lo
    # anule en la suma total, así que la suma cruda de las cinco filas
    # (4016.387) difiere de su versión redondeada (4016.39) en ~0.003,
    # muy por encima de TOLERANCIA_ABSOLUTA_PARIDAD_TS. Se agrega DESPUÉS
    # de noviembre-2024 en el orden cronológico para no alterar el empate
    # de redondeo que ese pago fija como el primero acumulado.
    (1, 2025, 67294, 201881.995, 200000, -1881.995, 3.0),
    (2, 2025, 67429, 202286.995, 202287, 0.005, 3.0),
    (3, 2025, 68034, 204101.495, 210000, 5898.505, 3.0),
    (11, 2024, 66000, 198000.005, 198000, -0.005, 3.0),  # año distinto: cubre el orden
    (4, 2025, 68350, 205000.123, 205000, -0.123, 3.0),
    #
    # Hallazgo 5 de la revisión final: el redondeo de `totalPagado` en
    # resumirEstadoCuenta() no estaba fijado por estas pruebas -todos los
    # monto_pagado de arriba son pesos enteros-, mientras que el de
    # `totalPactado` sí lo estaba (cuota_pactada siempre lleva milésimos
    # acá). Se verificó quitando el redondeo de `totalPagado` en
    # calculos.ts: con solo las cinco filas de arriba, la prueba de
    # cálculos seguía pasando -el mutante no se detectaba-. Esta fila le da
    # milésimos a monto_pagado (200000.006, no un peso redondo) para que
    # la suma cruda y la redondeada difieran en más de
    # TOLERANCIA_ABSOLUTA_PARIDAD_TS y el mutante quede cubierto.
    (5, 2025, 68785, 206355.0, 200000.006, -6354.994, 3.0),
]


def _leer_con_typescript(ruta_db: Path) -> dict:
    """Lee la base con el repositorio TypeScript y devuelve lo que ve.

    El script se escribe a un archivo temporal dentro de `mobile/` -para
    que sus imports relativos ('./src/...') resuelvan igual que si fuera
    código del proyecto- y se borra al terminar, igual que en
    `db_del_movil` (ver docstring de esa fixture: vite-node 2.1.9 no
    soporta `-e` con un script inline).
    """
    script = (
        "import { EjecutorNode } from './src/data/ejecutor-node.ts';\n"
        "import { RepositorioPagos, RepositorioUtm } from './src/data/repositorio.ts';\n"
        "import { obtenerHistorialDesbalances, resumirEstadoCuenta } from './src/core/calculos.ts';\n"
        f"const e = new EjecutorNode({json.dumps(str(ruta_db))});\n"
        "const repo = new RepositorioPagos(e);\n"
        "const utm = new RepositorioUtm(e);\n"
        "const pagos = await repo.obtenerTodosLosPagos();\n"
        "const salida = {\n"
        "  pagos: pagos.map(p => [p.anioPago, p.mesPago, p.montoPagado, p.desbalance, p.utmFactor]),\n"
        "  resumen: resumirEstadoCuenta(pagos),\n"
        "  historial: obtenerHistorialDesbalances(pagos, 70000)\n"
        "    .map(f => [f.anioPago, f.mesPago, f.desbalanceCorrido,\n"
        "               f.desbalanceUtmMesPesos, f.desbalanceUtmCorridoPesos]),\n"
        "  ultimoFactor: await utm.obtenerUltimoFactorUtm(),\n"
        "};\n"
        "console.log('__JSON__' + JSON.stringify(salida)); e.cerrar();\n"
    )
    script_temporal = MOBILE / f".tmp-interop-{uuid.uuid4().hex}.mts"
    script_temporal.write_text(script, encoding="utf-8")
    try:
        r = subprocess.run(["npx", "vite-node", str(script_temporal)],
                           cwd=MOBILE, capture_output=True, text=True)
    finally:
        script_temporal.unlink(missing_ok=True)
    assert r.returncode == 0, f"El TypeScript falló:\n{r.stdout}\n{r.stderr}"
    marca = [ln for ln in r.stdout.splitlines() if ln.startswith("__JSON__")]
    assert marca, f"No se encontró la salida JSON:\n{r.stdout}"
    return json.loads(marca[0][len("__JSON__"):])


def test_typescript_lee_los_pagos_que_escribio_el_escritorio(db_del_escritorio, monkeypatch):
    monkeypatch.setattr(db_manager, "DB_PATH", db_del_escritorio)
    for mes, anio, utm, cuota, pagado, desb, factor in PAGOS_SINTETICOS:
        db_manager.insertar_pago(
            fecha=f"{anio}-{mes:02d}-05", mes_pago=mes, anio_pago=anio,
            utm_valor=utm, cuota_pactada=cuota, monto_pagado=pagado,
            desbalance=desb, utm_factor=factor,
        )

    visto = _leer_con_typescript(db_del_escritorio)

    esperado = [
        [anio, mes, float(pagado), desb, factor]
        for mes, anio, _u, _c, pagado, desb, factor in PAGOS_SINTETICOS
    ]
    esperado.sort(key=lambda p: (p[0], p[1]), reverse=True)
    assert visto["pagos"] == esperado


def test_los_calculos_coinciden_sobre_la_misma_base(db_del_escritorio, monkeypatch):
    """Misma base, mismos números: es la promesa que sostiene el .db intercambiable."""
    from pensiontracker.services import calculation_service

    monkeypatch.setattr(db_manager, "DB_PATH", db_del_escritorio)
    for mes, anio, utm, cuota, pagado, desb, factor in PAGOS_SINTETICOS:
        db_manager.insertar_pago(
            fecha=f"{anio}-{mes:02d}-05", mes_pago=mes, anio_pago=anio,
            utm_valor=utm, cuota_pactada=cuota, monto_pagado=pagado,
            desbalance=desb, utm_factor=factor,
        )

    visto = _leer_con_typescript(db_del_escritorio)

    pagos_py = db_manager.obtener_todos_los_pagos()
    resumen_py = calculation_service.resumir_estado_cuenta(pagos_py)
    historial_py = calculation_service.obtener_historial_desbalances(70000, pagos_py)

    assert visto["resumen"]["cantidadPagos"] == resumen_py["cantidad_pagos"]
    assert visto["resumen"]["totalPagado"] == pytest.approx(
        resumen_py["total_pagado"], abs=TOLERANCIA_ABSOLUTA_PARIDAD_TS)
    assert visto["resumen"]["desbalanceAcumulado"] == pytest.approx(
        resumen_py["desbalance_acumulado"], abs=TOLERANCIA_ABSOLUTA_PARIDAD_TS)
    assert visto["resumen"]["estado"] == resumen_py["estado"]

    assert len(visto["historial"]) == len(historial_py)
    for fila_ts, fila_py in zip(visto["historial"], historial_py):
        assert fila_ts[0] == fila_py["anio_pago"]
        assert fila_ts[1] == fila_py["mes_pago"]
        assert fila_ts[2] == pytest.approx(
            fila_py["desbalance_corrido"], abs=TOLERANCIA_ABSOLUTA_PARIDAD_TS)
        assert fila_ts[3] == pytest.approx(
            fila_py["desbalance_utm_mes_pesos"], abs=TOLERANCIA_ABSOLUTA_PARIDAD_TS)
        assert fila_ts[4] == pytest.approx(
            fila_py["desbalance_utm_corrido_pesos"], abs=TOLERANCIA_ABSOLUTA_PARIDAD_TS)

    assert visto["ultimoFactor"] == pytest.approx(
        db_manager.obtener_ultimo_factor_utm(), abs=TOLERANCIA_ABSOLUTA_PARIDAD_TS)


def test_el_escritorio_lee_los_pagos_que_escribio_typescript(db_del_movil, monkeypatch):
    """La dirección contraria: móvil escribe, escritorio lee."""
    script = (
        "import { EjecutorNode } from './src/data/ejecutor-node.ts';\n"
        "import { RepositorioPagos } from './src/data/repositorio.ts';\n"
        f"const e = new EjecutorNode({json.dumps(str(db_del_movil))});\n"
        "const repo = new RepositorioPagos(e);\n"
        "await repo.insertarPago({ fecha: '2025-05-05', mesPago: 5, anioPago: 2025,\n"
        "  utmValor: 68785, cuotaPactada: 206355.0, montoPagado: 200000,\n"
        "  desbalance: -6355.0, utmFactor: 3.0 });\n"
        "e.cerrar();\n"
    )
    script_temporal = MOBILE / f".tmp-interop-{uuid.uuid4().hex}.mts"
    script_temporal.write_text(script, encoding="utf-8")
    try:
        r = subprocess.run(["npx", "vite-node", str(script_temporal)],
                           cwd=MOBILE, capture_output=True, text=True)
    finally:
        script_temporal.unlink(missing_ok=True)
    assert r.returncode == 0, f"El TypeScript falló:\n{r.stdout}\n{r.stderr}"

    monkeypatch.setattr(db_manager, "DB_PATH", db_del_movil)
    pagos = db_manager.obtener_todos_los_pagos()
    assert len(pagos) == 1
    p = pagos[0]
    assert (p["mes_pago"], p["anio_pago"]) == (5, 2025)
    assert p["monto_pagado"] == 200000
    assert p["desbalance"] == pytest.approx(-6355.0)
    assert p["utm_factor"] == pytest.approx(3.0)
