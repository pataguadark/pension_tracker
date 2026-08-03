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
    """Tablas y columnas de una base, en forma comparable entre plataformas."""
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
            tabla: [c[1] for c in conn.execute(f"PRAGMA table_info('{tabla}')")]
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
    assert columnas.count("utm_factor") == 1
