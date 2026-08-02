#!/usr/bin/env bash
# build-appimage.sh
# ------------------
# Arma el AppDir a partir del build onedir de PyInstaller
# (dist/PensionTracker/) y lo empaqueta con appimagetool.
#
# Requiere que ya exista dist/PensionTracker/ (ver packaging/pensiontracker.spec)
# y appimagetool en el PATH (lo descarga el workflow de CI antes de llamar
# a este script).
#
# Uso: packaging/appimage/build-appimage.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DIST="${ROOT}/dist/PensionTracker"
APPDIR="${ROOT}/dist/AppDir"

if [ ! -d "${DIST}" ]; then
    echo "No existe ${DIST}. Corré primero: uv run pyinstaller packaging/pensiontracker.spec" >&2
    exit 1
fi

rm -rf "${APPDIR}"
mkdir -p "${APPDIR}/usr/bin"

cp -r "${DIST}/." "${APPDIR}/usr/bin/"
cp "${ROOT}/packaging/appimage/AppRun" "${APPDIR}/AppRun"
chmod +x "${APPDIR}/AppRun"
cp "${ROOT}/packaging/appimage/pensiontracker.desktop" "${APPDIR}/pensiontracker.desktop"
cp "${ROOT}/packaging/icons/pensiontracker.png" "${APPDIR}/pensiontracker.png"

echo "AppDir listo en ${APPDIR}"
echo "Empaquetando con appimagetool..."
ARCH=x86_64 appimagetool "${APPDIR}" "${ROOT}/dist/PensionTracker-x86_64.AppImage"
