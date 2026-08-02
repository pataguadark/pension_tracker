# AppImage — Pensión Tracker

## Dependencia del sistema: `webkit2gtk`

El formato AppImage no tiene un mecanismo real para declarar ni instalar
dependencias del sistema (no es un gestor de paquetes: es un squashfs
autocontenido). Por eso el AppImage **no empaqueta WebKitGTK** — deliberadamente,
para no arrastrar un motor de navegador completo dentro del binario (ver D1
del plan de refactor).

En su lugar, la app depende de que la distribución del usuario tenga instalado
`webkit2gtk` (paquete `webkit2gtk-4.1` o `libwebkit2gtk-4.0-37` según la
distro) para poder abrir la ventana nativa de pywebview.

**Si `webkit2gtk` no está instalado, la app no falla**: `desktop.py` detecta
que no hay backend de ventana disponible y cae automáticamente al modo
navegador del sistema (`webbrowser.open()`), sirviendo la misma app Flask
sobre `127.0.0.1`. Esa caída es la verdadera "declaración" de la dependencia
desde el punto de vista del usuario — no un instalador ni una advertencia,
sino que la app simplemente sigue funcionando.

## Build

```bash
uv run pyinstaller packaging/pensiontracker.spec
packaging/appimage/build-appimage.sh
```

Requiere `appimagetool` en el PATH (el workflow de CI lo descarga antes de
invocar `build-appimage.sh`).
