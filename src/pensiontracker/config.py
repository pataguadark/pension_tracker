"""
config.py
---------
Configuración de la aplicación y seguridad de los datos locales (D6).

  - La BD y la secret key viven en el directorio de datos del usuario
    (platformdirs), no en el árbol del código: sobreviven a reinstalaciones
    y quedan fuera del control de versiones.
  - La secret key se autogenera en el primer arranque; no hay fallback
    hardcodeado ni dependencia de un .env.
  - Si existe una BD "legacy" (guardada dentro del árbol del código en
    versiones previas), se copia una sola vez al directorio de datos.
"""

import os
import secrets
import shutil
from pathlib import Path

import platformdirs

APP_NAME = "PensionTracker"

DATA_DIR = Path(platformdirs.user_data_dir(APP_NAME))
DB_PATH = DATA_DIR / "pension_tracker.db"
SECRET_KEY_PATH = DATA_DIR / "secret_key"

# Rutas donde pudo haber quedado la BD antes de esta migración a
# platformdirs: la raíz del repo (versiones anteriores a la Fase 2) y
# src/pensiontracker/ (durante la Fase 2).
_CANDIDATOS_DB_LEGACY = [
    Path(__file__).resolve().parent.parent.parent / "pension_tracker.db",
    Path(__file__).resolve().parent / "pension_tracker.db",
]

PORT = int(os.environ.get("PT_PORT", 7040))
DEBUG = os.environ.get("PT_DEBUG", "") == "1"


def ensure_data_dir() -> None:
    """Crea el directorio de datos del usuario si no existe, con permisos 0700."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if os.name == "posix":
        os.chmod(DATA_DIR, 0o700)


def load_or_create_secret_key() -> str:
    """
    Retorna la secret key persistida en el directorio de datos, generando
    una nueva con secrets.token_hex(32) si aún no existe (permisos 0600).
    """
    ensure_data_dir()

    if SECRET_KEY_PATH.exists():
        return SECRET_KEY_PATH.read_text().strip()

    clave = secrets.token_hex(32)
    SECRET_KEY_PATH.write_text(clave)
    if os.name == "posix":
        os.chmod(SECRET_KEY_PATH, 0o600)
    return clave


def migrate_legacy_db() -> None:
    """
    Si la BD ya existe en el directorio de datos, no hace nada.
    Si no, busca una BD legacy en el árbol del código y la copia
    (no la mueve: el archivo original queda intacto por seguridad).
    """
    if DB_PATH.exists():
        return

    ensure_data_dir()

    for legacy in _CANDIDATOS_DB_LEGACY:
        if legacy.exists():
            shutil.copy2(legacy, DB_PATH)
            if os.name == "posix":
                os.chmod(DB_PATH, 0o600)
            return
