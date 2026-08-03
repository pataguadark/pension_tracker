// app.js — Pensión Tracker
// Lógica compartida de los formularios (registro y edición): formateo de
// campos, preview en vivo, refresco de UTM y confirmaciones de borrado.
// Sin dependencias externas; se apoya en atributos data-* en vez de
// handlers inline para ser compatible con una CSP estricta.

function formatearMiles(input) {
    let val = input.value.replace(/\D/g, '');
    if (val === '') { input.value = ''; return; }
    input.value = Number(val).toLocaleString('es-CL');
    calcularPreview();
}

function formatearFactor(input) {
    // Se acepta punto además de coma: en los teclados decimales de celular
    // el punto suele ser lo único disponible. Se normaliza a coma, que es
    // el separador decimal chileno y lo que el usuario espera ver.
    let val = input.value.replace(/[^0-9.,]/g, '').replace(/\./g, ',');

    const partes = val.split(',');
    if (partes.length > 2) {
        // Varios separadores: el último manda, los anteriores eran de miles.
        if (partes[partes.length - 1] === '') {
            // Separador suelto al final: se ignora, el anterior sigue siendo el decimal.
            val = partes[0] + ',' + partes.slice(1).join('');
        } else {
            val = partes.slice(0, -1).join('') + ',' + partes[partes.length - 1];
        }
    }

    const [entero, decimales] = val.split(',');
    if (decimales !== undefined && decimales.length > 4) {
        val = entero + ',' + decimales.slice(0, 4);
    }

    input.value = val;
    calcularPreview();
}

function fmtPesos(n) {
    return '$' + Math.round(n).toLocaleString('es-CL');
}

function calcularPreview() {
    const factorEl = document.getElementById('utm_factor');
    const utmEl = document.getElementById('utm_valor');
    const pagadoEl = document.getElementById('monto_pagado');
    if (!factorEl || !utmEl || !pagadoEl) return;

    const factorRaw = factorEl.value.replace(/\./g, '').replace(/,/g, '.');
    const utmRaw = utmEl.value.replace(/\./g, '');
    const pagadoRaw = pagadoEl.value.replace(/\./g, '');

    const factor = parseFloat(factorRaw) || 0;
    const utm = parseInt(utmRaw, 10) || 0;
    const pagado = parseInt(pagadoRaw, 10) || 0;

    const prevCuota = document.getElementById('prevCuota');
    const prevPagado = document.getElementById('prevPagado');
    const prevDiff = document.getElementById('prevDiff');
    const prevEstado = document.getElementById('prevEstado');

    if (factor <= 0 || utm <= 0) {
        prevCuota.textContent = '—';
        prevPagado.textContent = '—';
        prevDiff.textContent = '—';
        prevEstado.textContent = '';
        return;
    }

    const cuota = factor * utm;
    const diff = pagado - cuota;

    prevCuota.textContent = fmtPesos(cuota);
    prevPagado.textContent = pagado > 0 ? fmtPesos(pagado) : '—';

    if (pagado > 0) {
        prevDiff.textContent = (diff >= 0 ? '+' : '') + fmtPesos(diff);
        prevDiff.className = 'preview-value ' + (diff > 0 ? 'diff-pos' : diff < 0 ? 'diff-neg' : 'diff-zero');

        if (diff > 0) { prevEstado.textContent = 'EXCEDENTE — pagó de más'; prevEstado.className = 'preview-estado estado-excedente'; }
        else if (diff < 0) { prevEstado.textContent = 'DEUDA — pagó de menos'; prevEstado.className = 'preview-estado estado-deuda'; }
        else { prevEstado.textContent = 'EXACTO — pago justo'; prevEstado.className = 'preview-estado estado-exacto'; }
    }
}

// Obtener la UTM actual on-demand desde el backend (que a su vez consulta
// mindicador.cl); la URL y el token CSRF vienen de atributos data-* para
// no requerir JS inline en la plantilla.
async function refrescarUtm(btn) {
    const banner = document.getElementById('utmBanner');
    const valorEl = document.getElementById('utmValor');
    const sourceEl = document.getElementById('utmSource');

    btn.classList.add('loading');
    btn.disabled = true;

    try {
        const resp = await fetch(btn.dataset.url, {
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'X-CSRFToken': btn.dataset.csrf,
            },
        });
        const data = await resp.json();

        if (data.ok && data.utm_fmt) {
            valorEl.textContent = '$ ' + data.utm_fmt;
            valorEl.classList.remove('utm-nd');
            const input = document.getElementById('utm_valor');
            input.value = data.utm_fmt;
            calcularPreview();

            banner.className = 'utm-banner utm-ok';
            sourceEl.className = 'utm-source';
            sourceEl.textContent = '● Fuente: mindicador.cl';
        } else {
            banner.className = 'utm-banner utm-error';
            sourceEl.className = 'utm-source utm-source-error';
            sourceEl.textContent = '● No se pudo obtener la UTM';
        }
    } catch (e) {
        banner.className = 'utm-banner utm-error';
        sourceEl.className = 'utm-source utm-source-error';
        sourceEl.textContent = '● Error de conexión';
    } finally {
        btn.classList.remove('loading');
        btn.disabled = false;
    }
}

// Guarda el factor UTM actual del formulario como predeterminado: la
// próxima vez que se abra /registro, vendrá pre-cargado con este valor.
async function guardarFactorPredeterminado(btn) {
    const factorEl = document.getElementById('utm_factor');
    if (!factorEl) return;

    btn.classList.add('loading');
    btn.disabled = true;

    try {
        const resp = await fetch(btn.dataset.url, {
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'X-CSRFToken': btn.dataset.csrf,
            },
            body: JSON.stringify({ utm_factor: factorEl.value }),
        });
        const data = await resp.json();

        if (data.ok) {
            btn.classList.add('saved');
            setTimeout(function () { btn.classList.remove('saved'); }, 1500);
        }
    } catch (e) {
        // Guardar el predeterminado es una comodidad, no algo crítico:
        // si falla la red, simplemente no se guarda, sin interrumpir al usuario.
    } finally {
        btn.classList.remove('loading');
        btn.disabled = false;
    }
}

// Vínculo mes↔UTM: para completar meses pasados. Cuando está activo,
// cambiar el mes o el año dispara una búsqueda automática de la UTM de
// ese período (con caché en el backend; ver /utm/historico). La última
// elección del usuario se recuerda entre visitas (localStorage).
const LINK_UTM_STORAGE_KEY = 'pensiontracker.utmVinculado';

function aplicarEstadoLinkUtm(btn, vinculado) {
    btn.dataset.linked = String(vinculado);
    btn.classList.toggle('linked', vinculado);
    btn.setAttribute('aria-pressed', String(vinculado));
}

function toggleLinkUtm(btn) {
    const vinculado = btn.dataset.linked !== 'true';
    aplicarEstadoLinkUtm(btn, vinculado);
    try {
        localStorage.setItem(LINK_UTM_STORAGE_KEY, String(vinculado));
    } catch (e) {
        // localStorage puede no estar disponible (ej. navegación privada);
        // no recordar la elección no es motivo para romper el flujo.
    }

    if (vinculado) {
        actualizarUtmPorMesAnio(btn);
    }
}

async function actualizarUtmPorMesAnio(btn) {
    if (btn.dataset.linked !== 'true') return;

    const mesEl = document.getElementById('mes_pago');
    const anioEl = document.getElementById('anio_pago');
    const utmEl = document.getElementById('utm_valor');
    const statusEl = document.getElementById('utmLinkStatus');
    if (!mesEl || !anioEl || !utmEl) return;

    const mes = parseInt(mesEl.value, 10);
    const anio = parseInt(anioEl.value, 10);
    if (!mes || !anio) return;

    btn.classList.add('loading');
    btn.disabled = true;
    if (statusEl) statusEl.textContent = `Buscando UTM ${mes}/${anio}…`;

    try {
        const resp = await fetch(btn.dataset.url, {
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'X-CSRFToken': btn.dataset.csrf,
            },
            body: JSON.stringify({ anio: anio, mes: mes }),
        });
        const data = await resp.json();

        if (data.ok && data.utm_fmt) {
            utmEl.value = data.utm_fmt;
            calcularPreview();
            const origen = data.fuente === 'mindicador' ? 'mindicador.cl' : 'caché';
            if (statusEl) statusEl.textContent = `UTM ${mes}/${anio} vinculada (${origen})`;
        } else if (statusEl) {
            statusEl.textContent = `UTM ${mes}/${anio} no publicada aún; puedes ingresarla manualmente.`;
        }
    } catch (e) {
        if (statusEl) statusEl.textContent = 'Error de conexión al buscar la UTM de ese mes.';
    } finally {
        btn.classList.remove('loading');
        btn.disabled = false;
    }
}

// Alterna entre "Valor" (pesos históricos) y "Valor UTM" (cartola) en
// /historial. Ambas versiones ya están renderizadas en el HTML; solo se
// invierte un atributo compartido y el CSS hace el resto (cero
// reescritura de texto por fila, sin importar cuántos pagos haya).
function toggleModoDesbalance() {
    const contenedor = document.getElementById('pageHistorial');
    if (!contenedor) return;

    const nuevoModo = contenedor.dataset.modoDesbalance === 'valor' ? 'utm' : 'valor';
    contenedor.dataset.modoDesbalance = nuevoModo;

    // La tarjeta resumen necesita recolorear su borde/texto: el estado
    // (EXCEDENTE/DEUDA/EXACTO) puede diferir entre los dos modos.
    const card = document.getElementById('cardDesbalance');
    if (card) {
        card.classList.remove('card-excedente', 'card-deuda', 'card-exacto');
        const claseEstado = nuevoModo === 'utm' ? card.dataset.estadoUtm : card.dataset.estadoValor;
        if (claseEstado) card.classList.add(claseEstado);
    }
}

function limpiarFormateoAntesDeEnviar(form) {
    const utmValor = form.querySelector('#utm_valor');
    const montoPagado = form.querySelector('#monto_pagado');
    if (utmValor) utmValor.value = utmValor.value.replace(/\./g, '');
    if (montoPagado) montoPagado.value = montoPagado.value.replace(/\./g, '');
    // El factor UTM se envía con coma; el backend la maneja.
}

document.addEventListener('DOMContentLoaded', function () {
    // Formularios de pago (registro y edición)
    document.querySelectorAll('.form-input[data-formato="miles"]').forEach(function (input) {
        input.addEventListener('input', function () { formatearMiles(input); });
    });
    document.querySelectorAll('.form-input[data-formato="factor"]').forEach(function (input) {
        input.addEventListener('input', function () { formatearFactor(input); });
    });

    const formPago = document.getElementById('formPago') || document.getElementById('formEditar');
    if (formPago) {
        formPago.addEventListener('submit', function () {
            limpiarFormateoAntesDeEnviar(formPago);
        });
        if (document.getElementById('previewCard') && document.getElementById('formPago')) {
            // Solo el formulario de registro necesita cálculo inicial en blanco;
            // el de edición ya llega pre-renderizado por el servidor.
            calcularPreview();
        }
    }

    // Botón de refresco de UTM
    const btnRefreshUtm = document.getElementById('btnRefreshUtm');
    if (btnRefreshUtm) {
        btnRefreshUtm.addEventListener('click', function () { refrescarUtm(btnRefreshUtm); });
    }

    // Botón de guardar factor UTM predeterminado
    const btnGuardarFactor = document.getElementById('btnGuardarFactor');
    if (btnGuardarFactor) {
        btnGuardarFactor.addEventListener('click', function () { guardarFactorPredeterminado(btnGuardarFactor); });
    }

    // Toggle Valor / Valor UTM en el historial
    const btnToggleDesbalance = document.getElementById('btnToggleDesbalance');
    if (btnToggleDesbalance) {
        btnToggleDesbalance.addEventListener('click', toggleModoDesbalance);
    }

    // Vínculo mes↔UTM (completar meses pasados): recuerda la última elección
    const btnLinkUtm = document.getElementById('btnLinkUtm');
    if (btnLinkUtm) {
        let vinculadoGuardado = false;
        try {
            vinculadoGuardado = localStorage.getItem(LINK_UTM_STORAGE_KEY) === 'true';
        } catch (e) {
            // Sin localStorage disponible, se parte desvinculado (default).
        }
        if (vinculadoGuardado) {
            aplicarEstadoLinkUtm(btnLinkUtm, true);
            actualizarUtmPorMesAnio(btnLinkUtm);
        }

        btnLinkUtm.addEventListener('click', function () { toggleLinkUtm(btnLinkUtm); });
        const mesEl = document.getElementById('mes_pago');
        const anioEl = document.getElementById('anio_pago');
        if (mesEl) mesEl.addEventListener('change', function () { actualizarUtmPorMesAnio(btnLinkUtm); });
        if (anioEl) anioEl.addEventListener('change', function () { actualizarUtmPorMesAnio(btnLinkUtm); });
    }

    // Confirmación antes de eliminar un pago
    document.querySelectorAll('[data-confirm]').forEach(function (form) {
        form.addEventListener('submit', function (ev) {
            if (!window.confirm(form.dataset.confirm)) {
                ev.preventDefault();
            }
        });
    });

    // Menú de navegación colapsable en móvil
    const navToggle = document.getElementById('navToggle');
    const mainNav = document.getElementById('mainNav');
    if (navToggle && mainNav) {
        navToggle.addEventListener('click', function () {
            const abierto = mainNav.classList.toggle('open');
            navToggle.setAttribute('aria-expanded', abierto ? 'true' : 'false');
        });
    }
});

if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
        navigator.serviceWorker.register('/sw.js').catch(function () { /* PWA es un extra, no bloquea la app */ });
    });
}
