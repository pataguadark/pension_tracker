"""
pensiontracker
--------------
Registro y seguimiento de pagos de pensión alimenticia (Chile, UTM).

Expone create_app(), la application factory de Flask.
"""

from dotenv import load_dotenv
from flask import Flask, send_from_directory
from flask_wtf.csrf import CSRFProtect

from pensiontracker import config, formatters
from pensiontracker.database import db_manager
from pensiontracker.services import utm_service


def create_app(test_config: dict | None = None) -> Flask:
    """
    Construye y configura la aplicación Flask.

    test_config permite sobreescribir la configuración por defecto (usado
    por la suite de tests). Si incluye la clave "DB_PATH", esa ruta
    reemplaza a la BD real de platformdirs y se omiten la generación de
    secret key y la migración de la BD legacy en el directorio de datos
    del usuario.
    """
    load_dotenv()

    if test_config is not None and "DB_PATH" in test_config:
        db_manager.DB_PATH = test_config["DB_PATH"]
        secret_key = test_config.get("SECRET_KEY", "test-secret-key")
    else:
        config.ensure_data_dir()
        secret_key = config.load_or_create_secret_key()
        config.migrate_legacy_db()

    app = Flask(__name__)
    app.config.from_mapping(
        SECRET_KEY=secret_key,
        DEBUG=config.DEBUG,
    )

    if test_config is not None:
        app.config.update(test_config)

    CSRFProtect(app)

    with app.app_context():
        db_manager.inicializar_db()
        if not app.config.get("TESTING"):
            utm_service.refrescar_utm_si_falta()

    @app.after_request
    def _security_headers(response):
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; img-src 'self' data:"
        )
        return response

    @app.route("/sw.js")
    def service_worker():
        # Servido desde la raíz (no /static/) para que su scope cubra
        # toda la app; solo cachea estáticos, ver static/sw.js.
        return send_from_directory(
            app.static_folder, "sw.js", mimetype="application/javascript"
        )

    # `fmt_factor` como filtro de plantilla: hasta ahora las rutas lo
    # aplicaban antes de renderizar (registro y edición reciben el factor ya
    # formateado), pero el historial imprimía el float crudo de Python y
    # mostraba "3.0561" con punto donde el resto de la app muestra "3,0561".
    # La coma es el separador decimal chileno, así que el historial era el
    # que estaba mal.
    app.jinja_env.filters["fmt_factor"] = formatters.fmt_factor

    from pensiontracker.routes.export import export_bp
    from pensiontracker.routes.pagos import pagos_bp
    from pensiontracker.routes.utm import utm_bp

    app.register_blueprint(pagos_bp)
    app.register_blueprint(utm_bp)
    app.register_blueprint(export_bp)

    return app
