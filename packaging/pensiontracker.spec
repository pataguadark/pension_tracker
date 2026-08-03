# -*- mode: python ; coding: utf-8 -*-
"""
pensiontracker.spec
--------------------
PyInstaller (onedir): build más rápido y predecible en CI multi-SO que
onefile, y arranque más rápido para el usuario final.

Uso:
    uv run pyinstaller packaging/pensiontracker.spec

Produce dist/PensionTracker/ (Windows/Linux) o dist/PensionTracker.app
(macOS, con BUNDLE) listo para distribuir.
"""

import sys
from pathlib import Path

from PyInstaller.utils.hooks import collect_all

ROOT = Path(SPECPATH).resolve().parent
SRC = ROOT / "src" / "pensiontracker"

# pywebview carga su backend nativo (WebView2/WKWebView/WebKitGTK) de forma
# dinámica según el SO; nos aseguramos de que PyInstaller vea todos sus
# submódulos y datos aunque el hook por defecto no los detecte todos.
webview_datas, webview_binaries, webview_hidden = collect_all("webview")

if sys.platform == "win32":
    icon_path = str(ROOT / "packaging" / "icons" / "pensiontracker.ico")
elif sys.platform == "darwin":
    icon_path = str(ROOT / "packaging" / "icons" / "pensiontracker.icns")
else:
    icon_path = str(ROOT / "packaging" / "icons" / "pensiontracker.png")

a = Analysis(
    [str(SRC / "desktop.py")],
    pathex=[str(ROOT / "src")],
    binaries=webview_binaries,
    datas=[
        (str(SRC / "templates"), "pensiontracker/templates"),
        (str(SRC / "static"), "pensiontracker/static"),
        *webview_datas,
    ],
    hiddenimports=webview_hidden,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="PensionTracker",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,
    icon=icon_path,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name="PensionTracker",
)

if sys.platform == "darwin":
    app = BUNDLE(
        coll,
        name="PensionTracker.app",
        icon=icon_path,
        bundle_identifier="cl.pensiontracker.app",
        info_plist={
            "CFBundleName": "Pensión Tracker",
            "CFBundleShortVersionString": "1.0.3",
            "NSHighResolutionCapable": True,
        },
    )
