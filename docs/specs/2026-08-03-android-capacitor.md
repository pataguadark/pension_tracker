# Diseño — App Android con Capacitor + restauración de respaldos

**Fecha:** 2026-08-03
**Estado:** aprobado, pendiente de plan de implementación

---

## 1. Objetivo

Llevar Pensión Tracker a Android como **app autónoma**, con paridad completa de
funcionalidad respecto del escritorio, y cerrar la historia de respaldo
construyendo la **restauración de respaldos en las dos plataformas**.

El móvil pasa a ser la plataforma principal en cantidad de usuarios: la mayoría
de la gente lleva este registro desde el teléfono, no desde un computador. Una
versión recortada sería la única experiencia que esa mayoría conocería, y por eso
la v1 apunta a paridad y no a un mínimo viable.

### Restricciones

- **Costo cero.** Se distribuye el APK por GitHub Releases. Sin Play Store
  (US$25, pago único) y sin iOS (US$99/año, obligatorio para generar un `.ipa`
  distribuible). El criterio es apuntar solo a plataformas sin costo.
- **La premisa de privacidad no se toca:** los datos siguen viviendo solo en el
  dispositivo. La única petición de red sigue siendo la consulta de la UTM a
  mindicador.cl, que no lleva datos del usuario.

### Fuera de alcance

Play Store, iOS, y sincronización automática entre dispositivos. El intercambio
entre escritorio y teléfono se resuelve con el archivo `.db` (sección 4).

---

## 2. Por qué Capacitor no es "empaquetar lo que ya existe"

Capacitor envuelve una **aplicación web** en un WebView nativo. **No ejecuta
Python.** La app actual es Flask con plantillas Jinja renderizadas en el
servidor y SQLite accedido desde Python, así que nada de eso corre dentro de
Capacitor.

El trabajo real es portar a TypeScript la lógica de negocio (~1.170 líneas entre
`calculation_service.py`, `db_manager.py`, `utm_service.py` y `formatters.py`) y
reemplazar las plantillas Jinja por una SPA. El shell de Capacitor es la parte
menor.

---

## 3. Ubicación y estructura

Monorepo: todo en el repositorio actual.

```
pension_tracker/
├── src/pensiontracker/      # escritorio (Flask), se mantiene
├── shared/fixtures/         # casos dorados en JSON (sección 6)
└── mobile/
    ├── src/core/            # lógica pura: cálculos y formateo
    ├── src/data/            # repositorio sobre SQLite
    ├── src/utm/             # cliente mindicador.cl + caché
    ├── src/ui/              # componentes Svelte
    └── android/             # proyecto nativo generado por Capacitor
```

**Por qué un solo repositorio:** es el mismo producto, con un README, una página
de releases y un lugar para reportar bugs. Y sobre todo, mantiene visible la
duplicación de la lógica de negocio: con ambas implementaciones en el mismo
árbol, las fixtures compartidas de la sección 6 detienen el CI cuando divergen.
En repositorios separados esa divergencia la descubre un usuario.

El costo es convivencia de toolchains (`uv` y `npm`) en un mismo árbol, que se
maneja con filtros por path en los workflows.

---

## 4. Arquitectura

### Capas

| Capa | Responsabilidad | Depende de |
|---|---|---|
| `core/` | Cálculos y formateo. **Funciones puras.** | nada |
| `data/` | Único lugar que sabe SQL. Repositorio sobre `@capacitor-community/sqlite`. | core (tipos) |
| `utm/` | Consulta a mindicador.cl, caché por año, fallback offline. | data |
| `ui/` | Componentes Svelte sobre el `style.css` existente. | todas |

### Cambio deliberado respecto del Python

Hoy `calculation_service.calcular_desbalance_acumulado()` lee de la base de
datos por dentro, así que probarlo exige una BD. En TypeScript el core **recibe
la lista de pagos como argumento** y devuelve el resultado. Se prueba sin
infraestructura y es más fácil de razonar.

No se refactoriza el Python en este proyecto. Queda como patrón por si más
adelante se aborda.

### Interfaz

Svelte, reutilizando `src/pensiontracker/static/style.css` casi tal cual: ya
tiene el sistema de variables, el tema oscuro, las fuentes embebidas y el layout
de tarjetas para pantallas angostas. Svelte compila a JS plano sin runtime, lo
que da el bundle más liviano — relevante en teléfonos modestos.

Pantallas: registro, historial, edición, y ajustes/acerca-de (que aloja respaldo
y restauración).

### Consulta de la UTM

`CapacitorHttp`, que va por la capa nativa y por eso no lo afecta CORS. Cachea
por año en la BD, igual que el escritorio. Sin red: último valor guardado, aviso
no bloqueante e ingreso manual siempre disponible.

---

## 5. Esquema de datos idéntico al escritorio

Las mismas tres tablas (`pagos`, `utm_historial`, `configuracion`) con las
mismas columnas.

Esto hace que **el archivo `.db` sea intercambiable entre el teléfono y el
computador**. Sin escribir sincronización, quien use ambos exporta de uno e
importa en el otro. Es la respuesta barata al principal inconveniente de una app
autónoma.

---

## 6. Sincronía entre Python y TypeScript

**Este es el riesgo central del proyecto:** dos implementaciones de la misma
aritmética, sobre pensiones de alimentos. Si divergen, un usuario ve un saldo
distinto en cada dispositivo y no sabe cuál creer.

**Mecanismo:** un archivo JSON en `shared/fixtures/` con casos de entrada y
resultado esperado, cubriendo cuota pactada, desbalance mensual, desbalance
acumulado en pesos y en UTM, y el saldo corrido. `pytest` lo lee y verifica el
Python; `vitest` lo lee y verifica el TypeScript. Si una implementación se
desvía, el CI se detiene.

Las fixtures usan **valores sintéticos**, nunca datos reales.

*Alternativas descartadas:* portar sin verificación cruzada (la divergencia la
descubre un usuario); unificar todo en TypeScript y que el escritorio consuma
ese core (elimina la duplicación de raíz, pero implica reescribir el backend
recién estabilizado).

---

## 7. Respaldo y restauración

Se construye en **las dos plataformas** dentro de este proyecto.

### Situación actual

Exportar existe en el escritorio (CSV y `.db` binario). **Restaurar no existe en
ninguna parte.** En el escritorio se puede copiar el `.db` al directorio de datos
a mano — feo, pero funciona. En Android eso es imposible: el usuario no tiene
acceso al sistema de archivos de la app, así que sin importador dentro de la
interfaz el respaldo es un archivo que no se puede devolver.

### Formato

El respaldo es el archivo SQLite completo, generado con la API `.backup`. Mismo
formato en ambas plataformas, lo que habilita el intercambio de la sección 5.

### Procedimiento de importación (idéntico en las dos plataformas)

1. Abrir el archivo recibido **en modo solo lectura**.
2. `PRAGMA integrity_check`.
3. Verificar que el esquema tenga las tablas y columnas esperadas.
4. **Respaldar la base de datos actual** antes de tocar nada.
5. Leer las filas y reemplazar el contenido de la BD viva **en una transacción**.
6. Si cualquier paso falla, abortar sin haber modificado nada y explicar por qué.

**Por qué leer las filas en vez de reemplazar el archivo:** un `.db` recibido de
afuera es contenido no confiable. Abrirlo solo para leer, validarlo y copiar
filas a la base propia evita adoptar un archivo ajeno como base de datos de la
aplicación, y deja la puerta abierta a semántica de mezcla más adelante.

### Interfaz

- **Android:** selector de archivos del sistema; exportar usa Filesystem + Share
  (correo, Drive, lo que el usuario prefiera).
- **Escritorio:** subida de archivo por POST, protegida con CSRF y con límite de
  tamaño, siguiendo el patrón de los endpoints de escritura existentes.

Ambas piden **confirmación explícita** antes de reemplazar, advirtiendo que los
datos actuales se sustituyen.

### Documentación

El README pasa a tener una sección de **resguardo de la información** que
explique el ciclo completo: cada cuánto conviene exportar, dónde guardar el
archivo, cómo restaurarlo en cada plataforma, y que perder el teléfono sin
respaldo significa perder el registro. Se elimina del roadmap la línea
"restaurar respaldo desde la propia interfaz" y de las limitaciones conocidas la
mención a que no existe.

---

## 8. Manejo de errores

| Situación | Comportamiento |
|---|---|
| Sin red al consultar la UTM | Caché o último valor guardado, aviso no bloqueante, ingreso manual disponible |
| SQLite no inicializa | Error explícito en pantalla, nunca pantalla en blanco |
| Archivo de respaldo corrupto o de otra aplicación | Se rechaza en la validación; los datos actuales quedan intactos |
| Importación interrumpida a mitad de camino | La transacción revierte; queda el respaldo previo del paso 4 |

---

## 9. Testing

- `vitest` para `core/` y `data/`.
- Las fixtures doradas de la sección 6 corriendo en `pytest` y en `vitest`.
- Casos de importación con archivos deliberadamente inválidos: esquema
  incorrecto, archivo truncado, archivo que no es SQLite.
- Workflow de CI separado con filtros por path: tocar TypeScript no dispara el
  build de Python ni al revés.

---

## 10. Distribución y firma

APK firmado publicado en GitHub Releases. Costo: **$0**.

**El keystore es permanente.** Si se pierde, no se puede publicar una
actualización que se instale sobre la que ya tienen los usuarios: tendrían que
desinstalar, y perderían sus datos si no exportaron antes. Va cifrado en GitHub
Secrets para el CI, y **debe existir una copia fuera del repositorio**, en un
gestor de contraseñas o equivalente. Es el archivo más importante del proyecto
después del código.

---

## 11. Criterios de aceptación

1. El APK instala en Android y crea su base de datos local.
2. Paridad de funcionalidad con el escritorio: registrar, historial filtrable por
   año, editar, eliminar, UTM automática y manual, completar meses pasados,
   factor predeterminado, desbalance dual en pesos y en UTM, export CSV.
3. Las fixtures doradas pasan en `pytest` y en `vitest` con los mismos valores.
4. Un `.db` exportado desde el escritorio se importa en Android y muestra los
   mismos saldos, y a la inversa.
5. Un archivo inválido se rechaza sin alterar los datos existentes.
6. La app funciona sin red, salvo por el valor de la UTM.
7. Sin peticiones de red fuera de mindicador.cl.
