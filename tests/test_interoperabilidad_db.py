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
            tabla: [
                (c[1], c[2].upper(), bool(c[3]))
                for c in conn.execute(f"PRAGMA table_info('{tabla}')")
            ]
            for tabla in tablas
        }
    finally:
        conn.close()


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
    columnas = estructura(db_del_movil)["pagos"]
    nombres = [c[0] for c in columnas]
    assert nombres.count("utm_factor") == 1


# ---------------------------------------------------------------------
# Interoperabilidad de DATOS: no solo el esquema, también los pagos y
# los cálculos que se hacen sobre ellos. Es la promesa que sostiene el
# respaldo intercambiable entre plataformas.
# ---------------------------------------------------------------------

PAGOS_SINTETICOS = [
    # (mes, anio, utm_valor, cuota_pactada, monto_pagado, desbalance, utm_factor)
    (1, 2025, 67294, 201882.0, 200000, -1882.0, 3.0),
    (2, 2025, 67429, 202287.0, 202287, 0.0, 3.0),
    (3, 2025, 68034, 204102.0, 210000, 5898.0, 3.0),
    (11, 2024, 66000, 198000.0, 198000, 0.0, 3.0),
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
        "    .map(f => [f.anioPago, f.mesPago, f.desbalanceCorrido, f.desbalanceUtmCorridoPesos]),\n"
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
    assert visto["resumen"]["totalPagado"] == pytest.approx(resumen_py["total_pagado"])
    assert visto["resumen"]["desbalanceAcumulado"] == pytest.approx(
        resumen_py["desbalance_acumulado"])
    assert visto["resumen"]["estado"] == resumen_py["estado"]

    assert len(visto["historial"]) == len(historial_py)
    for fila_ts, fila_py in zip(visto["historial"], historial_py):
        assert fila_ts[0] == fila_py["anio_pago"]
        assert fila_ts[1] == fila_py["mes_pago"]
        assert fila_ts[2] == pytest.approx(fila_py["desbalance_corrido"])
        assert fila_ts[3] == pytest.approx(fila_py["desbalance_utm_corrido_pesos"])

    assert visto["ultimoFactor"] == pytest.approx(
        db_manager.obtener_ultimo_factor_utm())


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
