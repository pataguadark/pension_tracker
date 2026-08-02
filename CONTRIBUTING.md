# Contribuir a Pensión Tracker

Gracias por el interés. Este es un proyecto pequeño y de alcance acotado:
una herramienta local para llevar el registro de pagos de pensión alimenticia
en Chile. Las contribuciones son bienvenidas dentro de ese alcance.

## Antes de escribir código

Abre un **issue** primero si vas a proponer una funcionalidad nueva o un
cambio de comportamiento. Para correcciones de bugs evidentes o de
documentación, manda el pull request directo.

## Preparar el entorno

Necesitas Python 3.12+ y [uv](https://docs.astral.sh/uv/):

```bash
git clone https://github.com/pataguadark/pension_tracker.git
cd pension_tracker
uv sync
uv run pensiontracker --browser
```

## Antes de mandar el pull request

```bash
uv run pytest
```

La suite tiene que quedar **en verde**. Si agregas comportamiento, agrega el
test correspondiente. Los tests usan una base de datos SQLite temporal por
test (`tmp_path`), así que nunca tocan la base de datos real de nadie.

## Reglas que no se negocian

1. **Cero datos personales en el repositorio.** Ni bases de datos, ni CSV, ni
   capturas con montos o nombres reales, ni en el código ni en los tests ni en
   los mensajes de commit. Usa valores sintéticos y redondos.
2. **Los datos del usuario no salen de su equipo.** La única petición de red
   que hace la app es a `mindicador.cl` para consultar el valor de la UTM, y se
   hace desde el backend. No agregues analítica, telemetría, CDNs, fuentes
   remotas ni reporte de errores a servicios externos.
3. **Todo endpoint que escribe usa POST y va protegido con CSRF** (Flask-WTF).
4. **Por defecto se escucha en `127.0.0.1`.** El modo `--lan` es opt-in y
   avisa explícitamente.

## Estilo

Sigue el estilo del código que ya está: nombres y comentarios en español,
docstrings en los módulos y en las funciones no triviales, y la separación
`routes/` (HTTP) → `services/` (lógica) → `database/` (persistencia).

## Reportar un bug

Incluye tu sistema operativo, cómo lanzaste la app (ventana nativa,
`--browser` o `--lan`), qué esperabas y qué pasó. **No pegues capturas ni
exportaciones con tus datos reales** — reemplaza los montos y las fechas.

## Seguridad

Si encuentras un problema de seguridad, no abras un issue público: repórtalo
de forma privada a través de los
[security advisories](https://github.com/pataguadark/pension_tracker/security/advisories/new)
del repositorio.

## Licencia

Al contribuir, aceptas que tu aporte se publique bajo la
[licencia MIT](LICENSE) del proyecto.
