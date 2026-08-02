"""
desktop.py
----------
Launcher y CLI de la aplicación.

Este módulo es el entry point de los binarios empaquetados (ver
packaging/pensiontracker.spec) *y* el destino del script de consola
`pensiontracker`. Por eso la CLI vive acá y no en `__main__.py`: si
estuviera allá, los binarios descargados ignorarían `--browser`,
`--lan` y `PT_PORT`.

Modos:
  - Sin flags: Flask en un thread daemon sobre 127.0.0.1 con puerto
    efímero + ventana nativa de pywebview (WebView2 en Windows,
    WKWebView en macOS, WebKitGTK en Linux — ningún motor de navegador
    se empaqueta). Cerrar la ventana termina el proceso. Si no hay
    backend de webview disponible (típicamente Linux sin webkit2gtk),
    cae automáticamente al navegador del sistema en vez de fallar.
  - `--browser`: servidor Flask plano en 127.0.0.1:PT_PORT, sin ventana.
  - `--lan`: igual, pero escuchando en todas las interfaces, para entrar
    desde el celular e instalar la PWA. Imprime la URL a usar.
"""

import argparse
import socket
import webbrowser
from threading import Thread

from werkzeug.serving import make_server

from pensiontracker import config, create_app


class _ServidorFlask:
    """Envuelve el servidor de Werkzeug en un thread daemon para poder detenerlo."""

    def __init__(self, app, host: str, port: int):
        # port=0 le pide al SO un puerto TCP libre (D1: "puerto efímero").
        self._server = make_server(host, port, app)
        self.port = self._server.server_port
        self._thread = Thread(target=self._server.serve_forever, daemon=True)

    def start(self) -> None:
        self._thread.start()

    def stop(self) -> None:
        self._server.shutdown()
        self._thread.join(timeout=5)


def _parse_args(argv=None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="pensiontracker",
        description="Registro y seguimiento de pagos de pensión alimenticia (Chile, UTM).",
    )
    parser.add_argument(
        "--browser", action="store_true",
        help="Ejecuta el servidor Flask sin ventana nativa.",
    )
    parser.add_argument(
        "--lan", action="store_true",
        help="Expone el servidor en la red local (0.0.0.0) para entrar desde "
             "el celular. Úsalo solo en redes de confianza.",
    )
    return parser.parse_args(argv)


def _resolver_bind(args: argparse.Namespace) -> tuple[str, int]:
    """
    Retorna el (host, puerto) según el modo pedido.

    El modo ventana usa puerto efímero a propósito (D1): nadie escribe
    esa URL a mano, así que no vale la pena arriesgar un choque de
    puertos. `--browser` y `--lan` sí respetan PT_PORT, porque ahí la
    URL la usa una persona.
    """
    if args.lan:
        return "0.0.0.0", config.PORT
    if args.browser:
        return "127.0.0.1", config.PORT
    return "127.0.0.1", 0


def _ip_lan() -> str:
    """
    IP de este equipo en la red local.

    El `connect` sobre un socket UDP no envía tráfico: solo hace que el
    SO resuelva qué interfaz usaría para salir, que es justo la que el
    celular puede alcanzar.
    """
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.connect(("192.168.255.255", 1))
        return sock.getsockname()[0]
    except OSError:
        pass
    finally:
        sock.close()

    # Sin ruta por defecto: buscamos cualquier IPv4 no-loopback del host.
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ip = info[4][0]
            if not ip.startswith("127."):
                return ip
    except OSError:
        pass

    return "127.0.0.1"


def _url_lan(port: int) -> str:
    return f"http://{_ip_lan()}:{port}/registro"


def _abrir_ventana_nativa(app) -> None:
    """Modo por defecto: ventana nativa, con fallback al navegador del sistema."""
    servidor = _ServidorFlask(app, "127.0.0.1", 0)
    servidor.start()
    url = f"http://127.0.0.1:{servidor.port}/registro"

    try:
        import webview
        webview.create_window(
            "Pensión Tracker", url,
            width=1100, height=800, min_size=(480, 600),
        )
        webview.start()
    except Exception as e:
        # Sin backend de ventana nativa (QT/GTK) disponible: modo
        # navegador del sistema, sin interrumpir el flujo de arranque.
        print(f"[pensiontracker] Ventana nativa no disponible ({e}); "
              f"abriendo en el navegador del sistema.")
        webbrowser.open(url)
        print(f"[pensiontracker] Pensión Tracker corriendo en {url} "
              f"— Ctrl+C para salir.")
        try:
            while servidor._thread.is_alive():
                servidor._thread.join(timeout=1)
        except KeyboardInterrupt:
            pass
    finally:
        servidor.stop()


def main(argv=None) -> None:
    # El refresco de UTM al arrancar (D2) vive en create_app(), no acá:
    # así los tres modos de lanzamiento lo reciben por igual.
    args = _parse_args(argv)
    app = create_app()

    if not args.browser and not args.lan:
        _abrir_ventana_nativa(app)
        return

    host, port = _resolver_bind(args)

    if args.lan:
        print("AVISO: modo --lan activo. El servidor es accesible desde "
              "cualquier dispositivo de tu red local; úsalo solo en redes "
              "de confianza.")
        print(f"[pensiontracker] Desde tu celular, abre: {_url_lan(port)}")
    else:
        print(f"[pensiontracker] Pensión Tracker corriendo en "
              f"http://127.0.0.1:{port}/registro — Ctrl+C para salir.")

    # app.run (y no _ServidorFlask) para conservar el reloader de Flask
    # cuando PT_DEBUG=1.
    app.run(host=host, port=port, debug=config.DEBUG)


if __name__ == "__main__":
    main()
