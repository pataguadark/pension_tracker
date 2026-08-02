"""
__main__.py
-----------
Entrada CLI: python -m pensiontracker [--browser | --lan]

  (sin flags)  modo por defecto: ventana nativa vía pywebview
               (desktop.py); si no hay backend de ventana disponible,
               cae solo al modo navegador del sistema.
  --browser    servidor Flask plano, sin ventana nativa
  --lan        expone el servidor en la red local (0.0.0.0) para acceder
               desde el móvil e instalar la PWA; por defecto siempre
               127.0.0.1
"""

import argparse

from pensiontracker import config, create_app


def main() -> None:
    parser = argparse.ArgumentParser(prog="pensiontracker")
    parser.add_argument(
        "--browser", action="store_true",
        help="Ejecuta el servidor Flask sin ventana nativa.",
    )
    parser.add_argument(
        "--lan", action="store_true",
        help="Expone el servidor en la red local (0.0.0.0). Úsalo solo en redes de confianza.",
    )
    args = parser.parse_args()

    if not args.browser and not args.lan:
        from pensiontracker.desktop import main as desktop_main
        desktop_main()
        return

    app = create_app()

    host = "127.0.0.1"
    if args.lan:
        host = "0.0.0.0"
        print("AVISO: modo --lan activo. El servidor es accesible desde cualquier "
              "dispositivo de tu red local.")

    app.run(host=host, port=config.PORT, debug=config.DEBUG)


if __name__ == "__main__":
    main()
