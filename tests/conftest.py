"""
conftest.py
-----------
Fixtures compartidas por la suite de tests.

Cada test recibe una aplicación Flask nueva con una BD SQLite temporal
(tmp_path), completamente aislada de la BD real del usuario.
"""

import re

import pytest

from pensiontracker import create_app
from pensiontracker.database import db_manager


@pytest.fixture
def app(tmp_path, monkeypatch):
    db_path = tmp_path / "test_pension_tracker.db"
    # monkeypatch, no asignación directa: create_app() también reasigna
    # db_manager.DB_PATH, pero solo monkeypatch garantiza revertirlo al
    # terminar el test (si no, el siguiente test hereda esta ruta).
    monkeypatch.setattr(db_manager, "DB_PATH", db_path)
    flask_app = create_app({
        "TESTING": True,
        "WTF_CSRF_ENABLED": True,
        "DB_PATH": db_path,
    })
    yield flask_app


@pytest.fixture
def client(app):
    return app.test_client()


def extraer_csrf_token(html: str) -> str:
    """Extrae el valor del input oculto csrf_token de un formulario renderizado."""
    match = re.search(r'name="csrf_token" value="([^"]+)"', html)
    assert match, "No se encontró csrf_token en el HTML de la respuesta"
    return match.group(1)
