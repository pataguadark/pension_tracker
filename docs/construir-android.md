# Construir la app Android

El proyecto nativo (`mobile/android/`) lo genera Capacitor y está versionado.
Lo que sigue es lo mínimo para compilar un APK desde cero.

## Requisitos

| Herramienta | Versión probada |
|---|---|
| Node | 22 |
| JDK | Temurin 21 |
| Android SDK | platform-tools, platforms;android-36, build-tools;35.0.0 |

La plataforma tiene que ser la **36**: es la que declara `compileSdkVersion` en
`mobile/android/variables.gradle`. Las build-tools son la **35.0.0** porque es
la versión que el plugin de Android 8.13 elige por defecto; no hay que
declararla en ningún `.gradle`, pero sí tiene que estar instalada.

Ninguna necesita instalarse en el sistema: bastan un JDK y un SDK
descomprimidos donde sea, con las variables de entorno apuntando ahí. En la
máquina de desarrollo viven fuera del disco raíz porque el SDK más las cachés
de Gradle pasan holgadamente de 1 GB.

```bash
export JAVA_HOME=/ruta/a/jdk-21
export ANDROID_HOME=/ruta/a/android-sdk
export GRADLE_USER_HOME=/ruta/a/cache-gradle   # opcional, pero evita llenar ~/
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$PATH"
```

El SDK se instala con las herramientas de línea de comandos de Android:

```bash
sdkmanager "platform-tools" "platforms;android-36" "build-tools;35.0.0"
```

## Compilar

```bash
cd mobile
npm ci
npm run build           # genera mobile/dist/
npx cap sync android    # copia dist/ al proyecto nativo
cd android && ./gradlew assembleDebug
```

El APK queda en `mobile/android/app/build/outputs/apk/debug/app-debug.apk`.

**Los comandos se corren desde `mobile/`, no desde la raíz.** `npm` acepta
`--prefix mobile`, pero `npx --prefix mobile cap sync android` **no funciona**:
Capacitor busca el proyecto en el directorio actual, ignora el prefijo y corta
con "android platform has not been added yet".

**`cap sync` no es opcional.** Copia `mobile/dist/` dentro del proyecto
nativo; sin ese paso Gradle empaqueta el bundle de la compilación anterior y
el APK sale con código viejo sin que nada falle.

Esta misma secuencia la corre el job `android` de `.github/workflows/tests.yml`
en cada push, así que si acá cambia algo, allá también.

## Instalar en un dispositivo

Con depuración USB activada y el equipo autorizado:

```bash
adb install -r mobile/android/app/build/outputs/apk/debug/app-debug.apk
adb shell am start -n cl.pensiontracker.app/.MainActivity
```

Para ver la consola del WebView y las llamadas al plugin de SQLite:

```bash
adb logcat | grep -iE "Capacitor|Console"
```

## Verificar que el `.db` sigue siendo intercambiable

Es la promesa central del diseño: el mismo archivo se abre en el computador y
en el teléfono. Para comprobarlo sobre un dispositivo real:

```bash
# sacar la base que creó la app
adb shell "run-as cl.pensiontracker.app cat databases/pensiontrackerSQLite.db" > telefono.db

# ... abrirla con el escritorio, escribir, y devolverla ...
adb shell am force-stop cl.pensiontracker.app
cat telefono.db | adb shell "run-as cl.pensiontracker.app sh -c 'cat > databases/pensiontrackerSQLite.db'"
```

`run-as` solo funciona con un APK de depuración; con uno de release firmado
hay que usar la función de respaldo de la propia aplicación.

## Firmar el APK de release

El APK que se publica lo construye el job `android` de
`.github/workflows/build.yml` cuando se empuja un tag `vMAYOR.MENOR.PARCHE`.
Toma el keystore de los secretos del repositorio; el archivo **no se versiona**
en ninguna forma.

### Generar el keystore

Una sola vez en la vida del proyecto:

```bash
keytool -genkeypair -v -keystore pensiontracker-release.jks \
  -alias pensiontracker -keyalg RSA -keysize 4096 -validity 10000 \
  -dname "CN=Pensión Tracker, O=pataguadark, C=CL"
```

`-validity 10000` son unos 27 años: si el certificado expira, no se puede
publicar ninguna actualización más.

### Cargarlo en GitHub

```bash
base64 -w0 pensiontracker-release.jks   # el contenido va en el primer secreto
```

En *Settings → Secrets and variables → Actions*, cuatro secretos:

| Secreto | Contenido |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | la salida del `base64 -w0` de arriba |
| `ANDROID_KEYSTORE_PASSWORD` | la contraseña del almacén |
| `ANDROID_KEY_ALIAS` | `pensiontracker` |
| `ANDROID_KEY_PASSWORD` | la contraseña de la clave |

Si falta el primero, el workflow corta antes de compilar en vez de publicar un
APK sin firmar: Android se niega a instalar uno, y sin ese corte el fallo se
descubriría recién en el teléfono de quien lo descargue.

### El keystore es permanente

**Guarda una copia fuera del repositorio y fuera de GitHub** — un gestor de
contraseñas, un disco cifrado, lo que sea, pero que exista. Android rechaza una
actualización firmada con otra llave: si el keystore se pierde, nadie puede
actualizar sin desinstalar, y quien no haya exportado su respaldo pierde el
registro completo de pagos. Es el archivo más importante del proyecto después
del código.

### Versión

El `versionCode` y el `versionName` salen del tag, no del `build.gradle`:
`v1.2.3` produce `versionName 1.2.3` y `versionCode 10203` (`mayor * 10000 +
menor * 100 + parche`, con menor y parche topados en 99). Compilar a mano sin
esas variables deja `1` y `"1.0"`, que sirven para depuración y no para
distribuir.

## Pendiente
- **La publicación del APK está en pausa deliberada.** El móvil todavía no
  tiene forma de sacar los datos del teléfono (no existen
  `mobile/src/data/respaldo.ts` ni un importador), así que quien instalara
  un APK publicado se quedaría sin vía de escape para su registro de pagos.
  Por eso el job `android` de `.github/workflows/build.yml` ya no corre al
  etiquetar: solo se dispara a mano (`workflow_dispatch`), para poder seguir
  ejercitando el pipeline sin publicar. La firma y el cálculo de versión
  desde el tag (secciones de arriba) ya están hechos y probados, no hay que
  rehacerlos: para reactivar la publicación basta con implementar el
  respaldo y volver a agregar `android` al `needs` del job `release`.
- **F-Droid.** Compila desde el código y firma con su propia llave, así que su
  APK y el de GitHub Releases no son intercambiables: quien instale desde un
  canal tendrá que desinstalar para cambiarse al otro.
- El APK de depuración pesa 24 MB, la mayor parte del runtime de Capacitor y
  del plugin de SQLite. Con `minifyEnabled` y recursos reducidos debería bajar
  bastante en release; no se ha medido.
