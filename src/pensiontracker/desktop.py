"""
desktop.py
----------
Launcher de escritorio (D1): Flask corre en un thread daemon sobre
127.0.0.1 con puerto efímero; pywebview abre una ventana nativa que
apunta a esa URL (WebView2 en Windows, WKWebView en macOS, WebKitGTK
en Linux — ningún motor de navegador se empaqueta). Cerrar la ventana
termina el proceso.

Si no hay backend de webview disponible (típicamente Linux sin
webkit2gtk), cae automáticamente al modo navegador del sistema en vez
de fallar.
"""

import webbrowser
from threading import Thread

from werkzeug.serving import make_server

from pensiontracker import create_app


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


def main() -> None:
    # El refresco de UTM al arrancar (D2) vive en create_app(), no aquí:
    # así los tres modos de lanzamiento (ventana nativa, --browser, --lan)
    # lo reciben por igual.
    app = create_app()

    host = "127.0.0.1"
    servidor = _ServidorFlask(app, host, port=0)
    servidor.start()
    url = f"http://{host}:{servidor.port}/registro"

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


if __name__ == "__main__":
    main()
