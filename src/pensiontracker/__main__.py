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

La implementación vive en `desktop.py`, que es el entry point de los
binarios empaquetados: una sola definición de la CLI para que el
comportamiento sea idéntico desde el código fuente y desde el binario.
"""

from pensiontracker.desktop import main

if __name__ == "__main__":
    main()
