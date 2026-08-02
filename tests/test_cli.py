"""
test_cli.py
-----------
Los binarios empaquetados usan `desktop.py` como entry point (ver
packaging/pensiontracker.spec), no `__main__.py`. Estos tests fijan que
la CLI viva en `desktop.py`, para que `--browser`, `--lan` y `PT_PORT`
funcionen igual desde el código fuente y desde el binario descargado.
"""

import pytest

from pensiontracker import config, desktop


# ----------------------------------------------------------------
# Parseo de argumentos
# ----------------------------------------------------------------

def test_sin_flags_no_activa_ningun_modo():
    args = desktop._parse_args([])
    assert args.browser is False
    assert args.lan is False


def test_flag_browser_se_reconoce():
    assert desktop._parse_args(["--browser"]).browser is True


def test_flag_lan_se_reconoce():
    assert desktop._parse_args(["--lan"]).lan is True


# ----------------------------------------------------------------
# Resolución de host y puerto
# ----------------------------------------------------------------

def test_modo_ventana_usa_loopback_y_puerto_efimero():
    """Sin flags: ventana nativa, siempre 127.0.0.1 y puerto efímero (D1)."""
    host, port = desktop._resolver_bind(desktop._parse_args([]))
    assert host == "127.0.0.1"
    assert port == 0


def test_modo_browser_usa_loopback_y_puerto_configurado(monkeypatch):
    monkeypatch.setattr(config, "PORT", 8123)
    host, port = desktop._resolver_bind(desktop._parse_args(["--browser"]))
    assert host == "127.0.0.1"
    assert port == 8123


def test_modo_lan_expone_todas_las_interfaces(monkeypatch):
    monkeypatch.setattr(config, "PORT", 8123)
    host, port = desktop._resolver_bind(desktop._parse_args(["--lan"]))
    assert host == "0.0.0.0"
    assert port == 8123


def test_modo_ventana_ignora_pt_port(monkeypatch):
    """El puerto efímero del modo ventana es deliberado: PT_PORT no aplica."""
    monkeypatch.setattr(config, "PORT", 8123)
    _, port = desktop._resolver_bind(desktop._parse_args([]))
    assert port == 0


@pytest.mark.parametrize("argv", [["--lan"], ["--browser"]])
def test_pt_port_se_respeta_en_ambos_modos_de_servidor(monkeypatch, argv):
    monkeypatch.setattr(config, "PORT", 7777)
    _, port = desktop._resolver_bind(desktop._parse_args(argv))
    assert port == 7777


# ----------------------------------------------------------------
# URL que se le muestra al usuario para entrar desde el celular
# ----------------------------------------------------------------

def test_url_lan_se_construye_con_la_ip_de_red_y_el_puerto(monkeypatch):
    monkeypatch.setattr(desktop, "_ip_lan", lambda: "192.168.1.42")
    assert desktop._url_lan(7040) == "http://192.168.1.42:7040/registro"


def test_ip_lan_no_devuelve_loopback():
    """Mostrar 127.0.0.1 al usuario haría inútil el modo --lan."""
    ip = desktop._ip_lan()
    assert not ip.startswith("127.")
