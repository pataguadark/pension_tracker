# Importador de respaldos — escritorio

> **Para agentes:** SUB-SKILL REQUERIDA: usa `superpowers:subagent-driven-development`
> (recomendado) o `superpowers:executing-plans` para ejecutar este plan tarea por
> tarea. Los pasos usan casillas (`- [ ]`) para el seguimiento.

**Objetivo:** que el escritorio pueda importar un respaldo `.db`, reemplazando
el contenido de la base viva de forma atómica y dejando una copia de la
anterior.

**Arquitectura:** un módulo de servicio sin Flask adentro (`services/importador.py`)
hace todo el trabajo: abre el archivo recibido en solo lectura, lo valida, copia
la base actual y reemplaza las tres tablas en una transacción. La ruta solo
materializa la subida en un temporal y traduce excepciones a mensajes flash.

**Stack:** Python 3.12, Flask, Flask-WTF (CSRF), sqlite3 de la stdlib, pytest.

**Spec:** `docs/specs/2026-08-10-importador-respaldo.md`. Este plan cubre la
mitad del escritorio; el móvil va en un plan aparte.

## Restricciones globales

- **Cero datos personales**, tampoco en tests: valores sintéticos y redondos
  (regla 1 de `CONTRIBUTING.md`).
- **Comentarios y nombres en español**, docstrings en módulos y funciones no
  triviales.
- **Todo endpoint que escribe va por POST y con CSRF** (Flask-WTF).
- **Límite de subida: 25 MB**, en `MAX_CONTENT_LENGTH`.
- **Se conservan las 3 copias previas más recientes**, las demás se borran.
- **Los `id` del respaldo se conservan** al insertar.
- **Ningún mensaje de error incluye la ruta del archivo subido ni fragmentos de
  su contenido.**
- La suite entera tiene que quedar verde: `uv run pytest`.

## Estructura de archivos

| Archivo | Responsabilidad |
|---|---|
| `src/pensiontracker/services/importador.py` | **Nuevo.** Validar, respaldar y reemplazar. Sin Flask. |
| `src/pensiontracker/routes/export.py` | **Modificar.** Suma `POST /importar`. |
| `src/pensiontracker/__init__.py` | **Modificar.** `MAX_CONTENT_LENGTH` y el manejador de 413. |
| `src/pensiontracker/templates/historial.html` | **Modificar.** Formulario de subida en `.historial-actions`. |
| `tests/test_importador.py` | **Nuevo.** El servicio, aislado. |
| `tests/test_routes.py` | **Modificar.** La ruta, vía el test client. |

---

### Tarea 1: El validador

**Archivos:**
- Crear: `src/pensiontracker/services/importador.py`
- Test: `tests/test_importador.py`

**Interfaces:**
- Consume: `pensiontracker.database.db_manager` (solo para el esquema esperado).
- Produce:
  - `class RespaldoInvalido(Exception)` — mensaje apto para mostrar al usuario.
  - `@dataclass(frozen=True) class InformeValidacion: tiene_utm_factor: bool`
  - `def validar(ruta: Path) -> InformeValidacion`

- [ ] **Paso 1: Escribir las pruebas que fallan**

Crear `tests/test_importador.py`:

```python
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
```

- [ ] **Paso 2: Correr las pruebas y verificar que fallan**

```bash
uv run pytest tests/test_importador.py -q
```

Esperado: todas fallan con `ModuleNotFoundError: No module named 'pensiontracker.services.importador'`.

- [ ] **Paso 3: Escribir el validador**

Crear `src/pensiontracker/services/importador.py`:

```python
"""
services/importador.py
----------------------
Importación de un respaldo `.db` recibido de afuera.

Un archivo que llega de fuera es contenido no confiable: se abre en modo
solo lectura, se valida, y solo entonces se copian sus filas a la base
propia. Nunca se adopta el archivo ajeno como base de la aplicación.

Diseño completo: docs/specs/2026-08-10-importador-respaldo.md
"""

import sqlite3
from dataclasses import dataclass
from pathlib import Path

# Estructura que tiene que tener el archivo recibido: por columna, su
# nombre, su tipo declarado y si admite NULL.
#
# Se comparan estructuras y no el texto del CREATE TABLE porque el
# escritorio crea `pagos` sin `utm_factor` y la agrega con ALTER: el SQL
# guardado difiere aunque las columnas sean idénticas. Es el mismo criterio
# que usa tests/test_interoperabilidad_db.py, y ahí está explicado largo.
COLUMNAS_ESPERADAS: dict[str, list[tuple[str, str, int]]] = {
    "pagos": [
        ("id", "INTEGER", 0),
        ("fecha", "TEXT", 1),
        ("mes_pago", "INTEGER", 1),
        ("anio_pago", "INTEGER", 1),
        ("utm_valor", "REAL", 1),
        ("cuota_pactada", "REAL", 1),
        ("monto_pagado", "REAL", 1),
        ("desbalance", "REAL", 1),
        ("utm_factor", "REAL", 0),
    ],
    "utm_historial": [
        ("id", "INTEGER", 0),
        ("anio", "INTEGER", 1),
        ("mes", "INTEGER", 1),
        ("utm_valor", "REAL", 1),
        ("fecha_registro", "TEXT", 1),
    ],
    "configuracion": [
        ("clave", "TEXT", 0),
        ("valor", "TEXT", 1),
    ],
}

MENSAJE_NO_SQLITE = "No parece un respaldo de Pensión Tracker."
MENSAJE_DANADA = "El archivo está dañado y no se puede leer."
MENSAJE_ESQUEMA_AJENO = "Es una base de datos, pero no de esta aplicación."


class RespaldoInvalido(Exception):
    """
    El archivo no sirve como respaldo.

    El mensaje se muestra tal cual al usuario, así que nunca incluye la ruta
    del archivo ni fragmentos de su contenido.
    """


@dataclass(frozen=True)
class InformeValidacion:
    """Lo que el validador averiguó y el importador necesita saber."""

    tiene_utm_factor: bool


def _abrir_solo_lectura(ruta: Path) -> sqlite3.Connection:
    """
    Abre el archivo con `mode=ro`: sqlite se niega a escribir aunque el
    código de más arriba se equivoque. Es la primera de las dos defensas,
    la otra es no adoptar nunca el archivo como base propia.
    """
    conn = sqlite3.connect(f"file:{ruta}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    return conn


def _estructura(conn: sqlite3.Connection, tabla: str) -> list[tuple[str, str, int]]:
    filas = conn.execute(f"PRAGMA table_info({tabla})").fetchall()
    return [(f["name"], f["type"].upper(), f["notnull"]) for f in filas]


def validar(ruta: Path) -> InformeValidacion:
    """
    Comprueba que el archivo sea un respaldo de esta aplicación.

    Levanta RespaldoInvalido con un mensaje mostrable si no lo es.
    """
    try:
        conn = _abrir_solo_lectura(ruta)
    except sqlite3.Error as exc:
        raise RespaldoInvalido(MENSAJE_NO_SQLITE) from exc

    try:
        try:
            resultado = conn.execute("PRAGMA integrity_check").fetchone()
        except sqlite3.DatabaseError as exc:
            # sqlite abre en diferido: un archivo que no es una base no
            # falla en connect(), falla en la primera consulta.
            raise RespaldoInvalido(MENSAJE_NO_SQLITE) from exc

        if resultado[0] != "ok":
            raise RespaldoInvalido(MENSAJE_DANADA)

        estructura_pagos = _estructura(conn, "pagos")
        esperada_pagos = COLUMNAS_ESPERADAS["pagos"]
        # Una base anterior a `utm_factor` tiene las mismas ocho primeras
        # columnas y ninguna más. Se acepta y se migra al importar.
        legacy = estructura_pagos == esperada_pagos[:-1]
        if not legacy and estructura_pagos != esperada_pagos:
            raise RespaldoInvalido(MENSAJE_ESQUEMA_AJENO)

        for tabla in ("utm_historial", "configuracion"):
            if _estructura(conn, tabla) != COLUMNAS_ESPERADAS[tabla]:
                raise RespaldoInvalido(MENSAJE_ESQUEMA_AJENO)
    finally:
        conn.close()

    return InformeValidacion(tiene_utm_factor=not legacy)
```

- [ ] **Paso 4: Correr las pruebas y verificar que pasan**

```bash
uv run pytest tests/test_importador.py -q
```

Esperado: `6 passed`.

- [ ] **Paso 5: Comitear**

```bash
git add src/pensiontracker/services/importador.py tests/test_importador.py
git commit -m "Valida un respaldo antes de dejarlo entrar"
```

---

### Tarea 2: La copia de la base actual, con rotación

**Archivos:**
- Modificar: `src/pensiontracker/services/importador.py`
- Test: `tests/test_importador.py`

**Interfaces:**
- Consume: `validar()` de la tarea 1, `db_manager.DB_PATH`, `db_manager.get_connection()`.
- Produce: `def respaldar_base_actual() -> Path` — devuelve la ruta de la copia.
- Produce: `COPIAS_A_CONSERVAR: int = 3`

- [ ] **Paso 1: Escribir las pruebas que fallan**

Agregar a `tests/test_importador.py`:

```python
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
```

- [ ] **Paso 2: Correr las pruebas y verificar que fallan**

```bash
uv run pytest tests/test_importador.py -q -k "copia or conservan or segundo"
```

Esperado: `AttributeError: module 'pensiontracker.services.importador' has no attribute 'respaldar_base_actual'`.

- [ ] **Paso 3: Implementar la copia y la rotación**

Agregar los imports arriba de `src/pensiontracker/services/importador.py`:

```python
import os
from datetime import datetime

from pensiontracker.database import db_manager
```

Y al final del módulo:

```python
COPIAS_A_CONSERVAR = 3
SUFIJO_COPIA = "previo-"


def _ruta_para_la_copia() -> Path:
    """
    Ruta libre para la copia de esta importación.

    La marca de tiempo llega al segundo, así que dos importaciones seguidas
    la comparten; el contador desambigua para que la segunda no pise a la
    primera y la rotación no cuente de menos.
    """
    base = db_manager.DB_PATH
    marca = datetime.now().strftime("%Y%m%d-%H%M%S")
    candidata = base.parent / f"{base.name}.{SUFIJO_COPIA}{marca}"
    contador = 2
    while candidata.exists():
        candidata = base.parent / f"{base.name}.{SUFIJO_COPIA}{marca}-{contador}"
        contador += 1
    return candidata


def _rotar_copias() -> None:
    """Deja solo las COPIAS_A_CONSERVAR más recientes."""
    base = db_manager.DB_PATH
    copias = sorted(base.parent.glob(f"{base.name}.{SUFIJO_COPIA}*"))
    for vieja in copias[:-COPIAS_A_CONSERVAR]:
        vieja.unlink()


def respaldar_base_actual() -> Path:
    """
    Copia la base viva antes de reemplazarla y devuelve dónde quedó.

    Usa la API `.backup` de sqlite, que produce una copia consistente
    aunque haya escrituras en curso; copiar el archivo a mano no lo
    garantiza.
    """
    destino = _ruta_para_la_copia()
    origen = db_manager.get_connection()
    copia = sqlite3.connect(destino)
    try:
        origen.backup(copia)
    finally:
        copia.close()
        origen.close()

    if os.name == "posix":
        os.chmod(destino, 0o600)

    _rotar_copias()
    return destino
```

- [ ] **Paso 4: Correr las pruebas y verificar que pasan**

```bash
uv run pytest tests/test_importador.py -q
```

Esperado: `9 passed`.

- [ ] **Paso 5: Comitear**

```bash
git add src/pensiontracker/services/importador.py tests/test_importador.py
git commit -m "Copia la base viva antes de reemplazarla, conservando tres"
```

---

### Tarea 3: El reemplazo en transacción

**Archivos:**
- Modificar: `src/pensiontracker/services/importador.py`
- Test: `tests/test_importador.py`

**Interfaces:**
- Consume: `validar()`, `respaldar_base_actual()`, `InformeValidacion`.
- Produce:
  - `@dataclass(frozen=True) class ResumenImportacion: pagos: int, utm_historial: int, configuracion: int, copia_previa: Path`
  - `def importar(ruta: Path) -> ResumenImportacion`

- [ ] **Paso 1: Escribir las pruebas que fallan**

Agregar a `tests/test_importador.py`:

```python
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
```

- [ ] **Paso 2: Correr las pruebas y verificar que fallan**

```bash
uv run pytest tests/test_importador.py -q -k "importar or invalido or transaccion"
```

Esperado: `AttributeError: module ... has no attribute 'importar'`.

- [ ] **Paso 3: Implementar la importación**

Agregar al final de `src/pensiontracker/services/importador.py`:

```python
TABLAS = ("pagos", "utm_historial", "configuracion")


@dataclass(frozen=True)
class ResumenImportacion:
    """Cuántas filas entró cada tabla y dónde quedó la base anterior."""

    pagos: int
    utm_historial: int
    configuracion: int
    copia_previa: Path


def _insertar_filas(
    conn: sqlite3.Connection,
    tabla: str,
    filas: list[sqlite3.Row],
    informe: InformeValidacion,
) -> None:
    """
    Inserta las filas leídas conservando sus `id`.

    Conservarlos es lo que hace que restaurar sea idempotente: si se
    reasignaran, importar dos veces el mismo respaldo produciría bases
    distintas.
    """
    if not filas:
        return

    columnas = [c[0] for c in COLUMNAS_ESPERADAS[tabla]]
    if tabla == "pagos" and not informe.tiene_utm_factor:
        # La base de origen no tiene la columna: entra como NULL, que es lo
        # mismo que hace la migración de arranque (db_manager.py:88-97).
        valores = [
            tuple(fila[c] for c in columnas[:-1]) + (None,) for fila in filas
        ]
    else:
        valores = [tuple(fila[c] for c in columnas) for fila in filas]

    marcadores = ", ".join("?" * len(columnas))
    conn.executemany(
        f"INSERT INTO {tabla} ({', '.join(columnas)}) VALUES ({marcadores})",
        valores,
    )


def importar(ruta: Path) -> ResumenImportacion:
    """
    Reemplaza el contenido de la base viva por el del respaldo.

    El orden importa: validar antes de copiar nada, copiar la base actual
    antes de abrir la transacción, y hacer todo el reemplazo dentro de ella.
    Si algo falla en cualquier punto, la base viva queda como estaba.
    """
    informe = validar(ruta)
    copia_previa = respaldar_base_actual()

    origen = _abrir_solo_lectura(ruta)
    destino = db_manager.get_connection()
    try:
        filas = {t: origen.execute(f"SELECT * FROM {t}").fetchall() for t in TABLAS}

        # `with destino:` confirma al salir y revierte si sale por excepción.
        # No cierra la conexión: de eso se encarga el finally.
        with destino:
            for tabla in TABLAS:
                destino.execute(f"DELETE FROM {tabla}")
            for tabla in TABLAS:
                _insertar_filas(destino, tabla, filas[tabla], informe)
    finally:
        origen.close()
        destino.close()

    return ResumenImportacion(
        pagos=len(filas["pagos"]),
        utm_historial=len(filas["utm_historial"]),
        configuracion=len(filas["configuracion"]),
        copia_previa=copia_previa,
    )
```

- [ ] **Paso 4: Correr las pruebas y verificar que pasan**

```bash
uv run pytest tests/test_importador.py -q
```

Esperado: `15 passed`.

- [ ] **Paso 5: Correr la suite entera**

```bash
uv run pytest -q
```

Esperado: todo verde, sin regresiones.

- [ ] **Paso 6: Comitear**

```bash
git add src/pensiontracker/services/importador.py tests/test_importador.py
git commit -m "Reemplaza las tres tablas en una transaccion"
```

---

### Tarea 4: La ruta y el límite de subida

**Archivos:**
- Modificar: `src/pensiontracker/routes/export.py`
- Modificar: `src/pensiontracker/__init__.py:39-42`
- Test: `tests/test_routes.py`

**Interfaces:**
- Consume: `importador.importar()`, `importador.RespaldoInvalido`.
- Produce: endpoint `export.importar_respaldo` en `POST /importar`.

- [ ] **Paso 1: Escribir las pruebas que fallan**

Agregar a `tests/test_routes.py`:

```python
import io
import sqlite3


def _respaldo_en_memoria(tmp_path):
    """Un .db mínimo y válido, devuelto como bytes para subirlo."""
    ruta = tmp_path / "para_subir.db"
    conn = sqlite3.connect(ruta)
    conn.executescript("""
        CREATE TABLE pagos (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            fecha         TEXT    NOT NULL,
            mes_pago      INTEGER NOT NULL,
            anio_pago     INTEGER NOT NULL,
            utm_valor     REAL    NOT NULL,
            cuota_pactada REAL    NOT NULL,
            monto_pagado  REAL    NOT NULL,
            desbalance    REAL    NOT NULL,
            utm_factor    REAL
        );
        CREATE TABLE utm_historial (
            id             INTEGER PRIMARY KEY AUTOINCREMENT,
            anio           INTEGER NOT NULL,
            mes            INTEGER NOT NULL,
            utm_valor      REAL    NOT NULL,
            fecha_registro TEXT    NOT NULL,
            UNIQUE(anio, mes)
        );
        CREATE TABLE configuracion (clave TEXT PRIMARY KEY, valor TEXT NOT NULL);
        INSERT INTO pagos (id, fecha, mes_pago, anio_pago, utm_valor,
                           cuota_pactada, monto_pagado, desbalance, utm_factor)
        VALUES (1, '2026-05-10', 5, 2026, 68000, 204000, 300000, 96000, 3.0);
    """)
    conn.commit()
    conn.close()
    return ruta.read_bytes()


def test_importar_sin_csrf_token_falla(client, tmp_path):
    resp = client.post("/importar", data={
        "respaldo": (io.BytesIO(_respaldo_en_memoria(tmp_path)), "respaldo.db"),
    }, content_type="multipart/form-data")
    assert resp.status_code == 400


def test_importar_reemplaza_el_historial(client, tmp_path):
    _registrar_pago(client)

    resp = client.get("/historial")
    token = extraer_csrf_token(resp.get_data(as_text=True))

    resp = client.post("/importar", data={
        "csrf_token": token,
        "respaldo": (io.BytesIO(_respaldo_en_memoria(tmp_path)), "respaldo.db"),
    }, content_type="multipart/form-data", follow_redirects=True)

    assert resp.status_code == 200
    # El pago del respaldo está y el que se había registrado ya no.
    assert b"300.000" in resp.data
    assert b"213.588" not in resp.data


def test_importar_un_archivo_invalido_avisa_y_no_borra_nada(client, tmp_path):
    _registrar_pago(client)

    resp = client.get("/historial")
    token = extraer_csrf_token(resp.get_data(as_text=True))

    resp = client.post("/importar", data={
        "csrf_token": token,
        "respaldo": (io.BytesIO(b"no soy una base"), "trucho.db"),
    }, content_type="multipart/form-data", follow_redirects=True)

    assert "No parece un respaldo".encode() in resp.data
    assert b"213.588" in resp.data


def test_importar_sin_archivo_avisa(client):
    # Hace falta un pago: `.historial-actions` -y con él el csrf_token- vive
    # dentro del `{% if %}` de "hay pagos", así que con la base vacía el
    # historial no trae token que extraer.
    _registrar_pago(client)

    resp = client.get("/historial")
    token = extraer_csrf_token(resp.get_data(as_text=True))

    resp = client.post("/importar", data={"csrf_token": token},
                       content_type="multipart/form-data",
                       follow_redirects=True)

    assert "Elige un archivo".encode() in resp.data


def test_importar_rechaza_get(client):
    assert client.get("/importar").status_code == 405
```

- [ ] **Paso 2: Correr las pruebas y verificar que fallan**

```bash
uv run pytest tests/test_routes.py -q -k importar
```

Esperado: fallan con 404 (la ruta no existe).

- [ ] **Paso 3: Configurar el límite de subida**

En `src/pensiontracker/__init__.py`, reemplazar el bloque de las líneas 39-42:

```python
    app = Flask(__name__)
    app.config.from_mapping(
        SECRET_KEY=secret_key,
        DEBUG=config.DEBUG,
        # Un registro de pensión es una fila al mes: dos décadas de pagos
        # no llegan a un megabyte. 25 MB deja margen de sobra y descarta de
        # inmediato un archivo que no tiene nada que hacer acá. Sin esto,
        # Flask acepta una subida de cualquier tamaño.
        MAX_CONTENT_LENGTH=25 * 1024 * 1024,
    )
```

Y agregar el manejador, junto a `_security_headers`:

```python
    @app.errorhandler(413)
    def _subida_demasiado_grande(_error):
        flash("El archivo supera el máximo de 25 MB.", "error")
        return redirect(url_for("pagos.historial"))
```

Agregar `flash`, `redirect` y `url_for` a los imports de Flask del módulo si
no están.

- [ ] **Paso 4: Escribir la ruta**

En `src/pensiontracker/routes/export.py`, actualizar el docstring del módulo:

```python
"""
routes/export.py
-----------------
Blueprint: entrada y salida de los datos del usuario.

Rutas:
  GET  /exportar          → Descarga CSV con todos los pagos
  POST /respaldar         → Descarga una copia binaria completa de la BD
                             (API .backup de sqlite3; POST + CSRF)
  POST /importar          → Reemplaza la BD con un respaldo recibido
                             (POST + CSRF; ver services/importador.py)
"""
```

Agregar a los imports:

```python
from pathlib import Path

from flask import request

from pensiontracker.services import importador
```

Y al final del módulo:

```python
@export_bp.route("/importar", methods=["POST"])
def importar_respaldo():
    """
    Reemplaza la base con el respaldo subido.

    La ruta no valida nada por su cuenta: materializa la subida en un
    temporal y deja que services/importador.py decida. Lo único que agrega
    es traducir su excepción a un mensaje flash.
    """
    archivo = request.files.get("respaldo")
    if archivo is None or archivo.filename == "":
        flash("Elige un archivo de respaldo.", "warning")
        return redirect(url_for("pagos.historial"))

    fd, tmp_path = tempfile.mkstemp(suffix=".db")
    os.close(fd)
    try:
        archivo.save(tmp_path)
        resumen = importador.importar(Path(tmp_path))
    except importador.RespaldoInvalido as exc:
        flash(str(exc), "error")
        return redirect(url_for("pagos.historial"))
    finally:
        os.remove(tmp_path)

    flash(
        f"Respaldo importado: {resumen.pagos} pagos. "
        f"Tu base anterior quedó guardada como {resumen.copia_previa.name}.",
        "success",
    )
    return redirect(url_for("pagos.historial"))
```

- [ ] **Paso 5: Agregar el formulario a la plantilla**

En `src/pensiontracker/templates/historial.html`, dentro de
`.historial-actions` (línea 214), después del formulario de respaldar:

```html
        <form action="{{ url_for('export.importar_respaldo') }}" method="POST"
              enctype="multipart/form-data" class="form-inline"
              onsubmit="return confirm('Esto reemplaza TODOS tus pagos actuales por los del archivo. ¿Continuar?');">
            <input type="hidden" name="csrf_token" value="{{ csrf_token() }}">
            <input type="file" name="respaldo" accept=".db" required class="form-input">
            <button type="submit" class="btn-exportar">↑ Importar respaldo</button>
        </form>
```

- [ ] **Paso 6: Correr las pruebas y verificar que pasan**

```bash
uv run pytest tests/test_routes.py -q -k importar
```

Esperado: `5 passed`.

- [ ] **Paso 7: Correr la suite entera**

```bash
uv run pytest -q
```

Esperado: todo verde.

- [ ] **Paso 8: Comitear**

```bash
git add src/pensiontracker/routes/export.py src/pensiontracker/__init__.py \
        src/pensiontracker/templates/historial.html tests/test_routes.py
git commit -m "Importar respaldo desde el historial, con CSRF y tope de 25 MB"
```

---

### Tarea 5: El README

**Archivos:**
- Modificar: `README.md`

- [ ] **Paso 1: Escribir la sección**

Agregar en `README.md`, justo antes de "## Limitaciones conocidas":

```markdown
## Resguardo de la información

Tus pagos viven en un solo archivo, en tu equipo. Nadie más tiene una copia:
ni este proyecto, ni un servidor, ni la nube. Eso es deliberado, y significa
que el respaldo es tuyo y de nadie más.

**Respaldar.** En el historial, "↓ Respaldar datos" descarga un archivo `.db`
con todo tu registro. Guárdalo donde no dependa del mismo equipo: un pendrive,
un correo a ti mismo, tu nube preferida. Conviene hacerlo cada vez que
registras un pago, y como mínimo una vez al mes.

**Restaurar.** En el mismo lugar, "↑ Importar respaldo" toma ese archivo y
reemplaza **todo** lo que tengas registrado. Antes de tocar nada, la
aplicación guarda una copia de tu base actual junto a ella (verás un archivo
`pension_tracker.db.previo-...` en el directorio de datos), y conserva las
tres más recientes. Si importas por error, ahí está lo que tenías.

**El archivo sirve en las dos plataformas.** El mismo `.db` se abre en el
computador y en el teléfono, así que respaldar en uno y restaurar en el otro
es la forma de mudarte de equipo.

Un archivo que no sea un respaldo válido se rechaza sin alterar nada, y te
dice por qué: no es una base de datos, está dañada, o es de otra aplicación.

**Si pierdes el equipo y no tienes un respaldo guardado en otra parte, pierdes
el registro completo.** No hay forma de recuperarlo desde acá.
```

- [ ] **Paso 2: Quitar lo que dejó de ser cierto**

En el roadmap, borrar la línea:

```markdown
- [ ] Restaurar respaldo desde la propia interfaz
```

En "Limitaciones conocidas", borrar la viñeta:

```markdown
- **No hay restauración de respaldo desde la interfaz**: puedes descargar el `.db`,
  pero para restaurarlo hay que copiarlo a mano al directorio de datos.
```

- [ ] **Paso 3: Verificar que no quedaron referencias muertas**

```bash
grep -n -i "restaurar\|restauración" README.md
```

Esperado: solo apariciones dentro de la sección nueva.

- [ ] **Paso 4: Comitear**

```bash
git add README.md
git commit -m "Documenta el ciclo de resguardo de la informacion"
```

---

## Al terminar

La suite entera en verde:

```bash
uv run pytest -q
```

Y una pasada a mano, que es la única que comprueba que el ciclo sirve de
verdad:

```bash
uv run pensiontracker --browser
```

Registrar un pago, respaldar, registrar otro, importar el respaldo, y
comprobar que vuelve el estado anterior y que aparece el archivo
`pension_tracker.db.previo-*` en el directorio de datos.
