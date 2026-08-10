# Diseño — Importador de respaldos y respaldo en el móvil

Desarrolla la sección 7 de `docs/specs/2026-08-03-android-capacitor.md`, que
dejó el procedimiento definido pero sin bajar a decisiones concretas.

## 1. Objetivo

Cerrar el ciclo del respaldo en las dos plataformas:

- **Importar** un `.db` recibido de afuera, en el escritorio y en el móvil.
- **Respaldar** desde el móvil, que hoy no tiene ninguna forma de emitir un
  archivo.

Exportar CSV y respaldar el `.db` ya existen en el escritorio y no se tocan.

### Por qué las dos mitades van juntas

Un importador sin respaldo en el móvil solo sirve en una dirección: se puede
llevar la base del computador al teléfono, nunca al revés. La vía de escape que
la sección 10 del spec de Android exige para migrar entre GitHub Releases y
F-Droid —exportar el respaldo **desde el teléfono** antes de desinstalar— no
existiría, y es justamente el escenario en que perder los datos es
irreversible.

### Restricciones

- El formato del respaldo es el archivo SQLite completo, el mismo en ambas
  plataformas. Es lo que hace que un respaldo del computador se abra en el
  teléfono y viceversa.
- Nada sale del equipo del usuario. El respaldo lo entrega el sistema
  operativo a donde el usuario decida.
- Cadena de construcción libre: sin Google Play Services ni bibliotecas
  privativas (política de inclusión de F-Droid).

### Fuera de alcance

- **Semántica de mezcla.** Importar siempre reemplaza.
- **Restaurar la copia interna desde la interfaz.** Ver sección 6.
- **Cifrado de la base.** Sigue en el roadmap, aparte.

## 2. Decisiones tomadas

| Decisión | Elegido | Por qué |
|---|---|---|
| Cómo se lee el archivo recibido | Abrirlo como base SQLite **de solo lectura** y copiar filas | Es el procedimiento del spec; cada plataforma usa el motor que ya tiene; ninguna dependencia nueva para leer |
| Respaldo previo a reemplazar | Copia interna automática, rotada, con aviso de dónde quedó | Red de seguridad sin pasos extra para el usuario |
| Respaldo de esquema viejo (sin `utm_factor`) | Se acepta y se migra al vuelo | Un archivo que la app abre feliz como base propia no puede ser rechazado como importación |
| Alcance del reemplazo | Las tres tablas | Es un respaldo completo: restaurar a medias mezcla el factor y el histórico de UTM del equipo viejo con los pagos del nuevo |

### Alternativas descartadas

- **Mover el archivo a la carpeta del plugin de SQLite en el móvil**
  (`moveDatabasesAndAddSuffix`) y abrirlo como una base más. Es el camino más
  trillado del plugin, pero lo abre en lectura/escritura y lo deja dentro del
  área gestionada: un fallo a medio camino deja una base huérfana con datos
  ajenos adentro.
- **Reemplazar el archivo entero** en vez de copiar filas. Tres líneas de
  código, y adopta contenido no confiable como base de la aplicación. Además
  cierra la puerta a semántica de mezcla más adelante.

## 3. Ubicación

| Pieza | Responsabilidad |
|---|---|
| `src/pensiontracker/services/importador.py` | Validar un `.db` candidato y reemplazar el contenido de la base viva. Sin Flask adentro. |
| `src/pensiontracker/routes/export.py` | Suma `POST /importar`: subida `multipart/form-data`, CSRF y límite de tamaño |
| `mobile/src/data/importador.ts` | Espejo del anterior, escrito contra `EjecutorSql` |
| `mobile/src/data/respaldo.ts` | Produce el `.db` del teléfono y lo entrega a Share |
| `mobile/src/ui/` | Los dos botones nuevos en el historial |
| `README.md` | Sección de resguardo de la información (abajo) |

`importador.ts` se escribe contra la interfaz `EjecutorSql` que ya existe, así
que corre en vitest con `ejecutor-node.ts` sin teléfono ni emulador, igual que
el resto de la capa de datos.

El módulo `routes/export.py` pasa a contener también la importación. Se
actualiza su docstring en vez de renombrarlo: el renombre arrastraría el
registro del blueprint y sus tests sin comprar nada.

### Documentación

El README gana una sección de **resguardo de la información** que explique el
ciclo completo: cada cuánto conviene respaldar, dónde guardar el archivo, cómo
restaurarlo en cada plataforma, y que perder el teléfono sin respaldo significa
perder el registro. Sale del roadmap la línea "restaurar respaldo desde la
propia interfaz", y de las limitaciones conocidas la mención a que no existe.
Lo pide la sección 7 del spec de Android y es el criterio de aceptación 8.

## 4. Procedimiento de importación

Idéntico en ambas plataformas:

1. **Materializar el archivo en disco.** Escritorio: `tempfile` desde la
   subida. Móvil: Filesystem, desde el `<input type="file">`.
2. **Abrir en solo lectura.** Escritorio:
   `sqlite3.connect(f"file:{ruta}?mode=ro", uri=True)`, que hace que sqlite se
   niegue a escribir aunque el código se equivoque. Móvil:
   `getNCDatabasePath()` + `createNCConnection()`, la API del plugin para
   bases fuera de su carpeta gestionada, que abre en solo lectura por diseño.
3. **`PRAGMA integrity_check`** tiene que devolver `ok`.
4. **Validar la estructura** (sección 5).
5. **Copia interna de la base viva** (sección 6). Si no se puede escribir, se
   aborta acá, antes de tocar nada.
6. **Transacción:** `DELETE FROM` las tres tablas —no `DROP`, que se llevaría
   el esquema por delante— e insertar las filas leídas **conservando sus
   `id`**. Cualquier fallo hace rollback y no modifica nada.

   Conservar los `id` es lo que hace que restaurar sea idempotente y que las
   dos plataformas den exactamente la misma base: si se reasignaran, un
   respaldo importado dos veces produciría archivos distintos y la
   comprobación de interoperabilidad no podría comparar nada.
7. **Cerrar y borrar el temporal**, pase lo que pase.

Si la base venía sin `utm_factor`, esas filas entran con `NULL`: es exactamente
lo que hace hoy la migración de arranque (`db_manager.py:88-97`,
`esquema.ts::migrarUtmFactorSiFalta`), así que no hay lógica nueva que
inventar ni que mantener sincronizada.

## 5. Esquema aceptado

Se comparan **estructuras**, no el texto del `CREATE TABLE`: el escritorio crea
`pagos` sin `utm_factor` y la agrega con `ALTER`, así que el SQL guardado
difiere aunque las columnas sean idénticas. Es el mismo criterio que ya usa
`tests/test_interoperabilidad_db.py::estructura`, y la razón está explicada en
el docstring de ese módulo.

Por cada tabla de `TABLAS_ESPERADAS` se exige nombre, tipo declarado y
nulabilidad de cada columna. Única excepción admitida: `pagos` sin
`utm_factor`, que se acepta y se migra.

Columnas de más, tablas de más o tipos distintos se rechazan. Es la
comprobación que existe para no adoptar un archivo ajeno, y aflojarla la
vuelve decorativa.

## 6. Copia interna previa

Antes de reemplazar, se copia la base viva junto a ella con marca de tiempo
(`pension_tracker.db.previo-YYYYMMDD-HHMMSS`), conservando las **3 más
recientes** y borrando las anteriores. Hereda los permisos del directorio de
datos: `0700` en el directorio, `0600` en el archivo.

El mensaje de éxito nombra el archivo que se guardó y dónde quedó.

**Limitación conocida, aceptada a conciencia:** en el móvil ese archivo queda
en el almacenamiento privado de la aplicación, donde el usuario no puede
llegar sin `adb` o root. En el escritorio la copia sirve; en el teléfono
existe pero es inalcanzable. Exponerla como origen en la propia pantalla de
importar la volvería útil, y queda anotado como mejora posible — no entra en
esta tanda.

## 7. Respaldo en el móvil

1. `PRAGMA wal_checkpoint(TRUNCATE)` sobre la base viva. Sin esto, la copia
   puede salir incompleta: los últimos escritos siguen en el archivo `-wal` y
   el `.db` por sí solo no los tiene.
2. Obtener la ruta del archivo con `getUrl()` del plugin.
3. Leerlo con Filesystem y escribirlo en el directorio de caché como
   `pension_tracker_backup_YYYYMMDD.db`, el mismo nombre que usa el
   escritorio (`export.py::respaldar_datos`).
4. Entregarlo a `Share`, que deja al usuario elegir destino: correo, Drive,
   lo que use.

## 8. Interfaz

**Escritorio.** En `.historial-actions`, junto a "Exportar CSV" y "Respaldar
datos", un "Importar respaldo" con formulario `multipart/form-data` y su
`csrf_token`, siguiendo el marcado que ya está en `historial.html:214-221`.

La confirmación es de un paso, no de dos. Previsualizar "tienes N pagos, el
archivo trae M" obligaría a conservar el temporal entre dos peticiones, y ese
estado en el servidor no vale lo que compra. En su lugar, confirmación
explícita en el cliente antes de enviar, advirtiendo que los datos actuales se
sustituyen.

**Móvil.** Las mismas dos acciones en el historial, que hoy solo lleva
"+ Nuevo pago". La confirmación reusa el camino que ya tiene el borrado en
`ui/acciones.ts`.

## 9. Manejo de errores

| Situación | Comportamiento |
|---|---|
| El archivo no es SQLite | "No parece un respaldo de Pensión Tracker" |
| `integrity_check` falla | "El archivo está dañado" |
| Faltan tablas o columnas | "Es una base de datos, pero no de esta aplicación" |
| Supera el límite de tamaño | Se rechaza antes de leerlo |
| Falla a mitad de la transacción | Rollback, aviso, datos intactos |
| No se puede escribir la copia previa | Aborta antes de tocar nada |

Ningún mensaje incluye la ruta del archivo subido ni fragmentos de su
contenido.

## 10. Dependencias nuevas

Solo en el móvil, las dos oficiales de Capacitor, MIT y sin Google Play
Services:

- `@capacitor/filesystem` — volcar el archivo recibido y escribir el respaldo.
- `@capacitor/share` — entregar el respaldo al sistema.

El selector de archivos **no** necesita plugin: `<input type="file">` funciona
dentro del WebView porque el bridge de Capacitor implementa
`onShowFileChooser`.

En el escritorio hay que **configurar `MAX_CONTENT_LENGTH`**, que hoy no está
puesto: sin él, Flask acepta una subida de cualquier tamaño.

### Límite de tamaño: 25 MB

Un registro de pensión es una fila al mes. Con dos décadas de pagos la base no
llega a un megabyte, así que 25 MB deja margen de sobra para cualquier uso
real y sigue descartando de inmediato un archivo que no tiene nada que hacer
acá. El mismo número rige en las dos plataformas: en el escritorio como
`MAX_CONTENT_LENGTH`, y en el móvil comprobando `File.size` antes de volcar
los bytes a disco.

## 11. Pruebas

Las bases de prueba se construyen dentro del propio test, con valores
sintéticos y redondos. Nunca datos reales — regla 1 de `CONTRIBUTING.md`.

**Por plataforma** (pytest y vitest, los mismos casos en ambas):

- Archivo que no es SQLite.
- Base SQLite válida con esquema ajeno.
- Base dañada que falla `integrity_check`.
- Base legacy sin `utm_factor`: se importa y sus filas quedan con `NULL`.
- Importación feliz: las tres tablas quedan con el contenido del archivo.
- Fallo a mitad de la transacción: la base viva queda exactamente como estaba.
- La copia previa se creó, y con más de tres importaciones solo quedan las 3
  más recientes.

**Interoperabilidad**, en `tests/test_interoperabilidad_db.py`, que hoy no
cubre ninguno de los dos:

- Un `.db` respaldado por el móvil se importa en el escritorio y da los mismos
  saldos, y a la inversa (criterio de aceptación 4 del spec de Android).
- Un archivo inválido se rechaza sin alterar los datos existentes (criterio 5).

## 12. Criterios de aceptación

1. Un respaldo del escritorio se importa en el móvil y muestra los mismos
   saldos; y a la inversa.
2. Un archivo inválido —no SQLite, dañado, o de otra aplicación— se rechaza
   con un mensaje que distingue los tres casos, y deja los datos intactos.
3. Un respaldo sin `utm_factor` se importa y sus pagos quedan legibles.
4. Un fallo a mitad de la importación deja la base exactamente como estaba.
5. El móvil genera un respaldo que el escritorio abre, y el archivo lo entrega
   el sistema a donde el usuario elija.
6. Antes de cada reemplazo queda una copia de la base anterior, y solo se
   conservan las 3 más recientes.
7. La subida del escritorio va por POST, con CSRF y con un tamaño máximo.
8. El README explica el ciclo completo: cada cuánto conviene respaldar, dónde
   guardar el archivo y cómo restaurarlo en cada plataforma. Se elimina del
   roadmap "restaurar respaldo desde la propia interfaz" y de las limitaciones
   conocidas la mención a que no existe.
