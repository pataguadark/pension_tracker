<!--
  Formulario de pago compartido por registro y edición: los seis campos y la
  tarjeta de preview en vivo.

  Port del bloque <form> de templates/registro_pago.html (líneas 45-171) y
  templates/editar_pago.html (líneas 17-127): las dos plantillas del
  escritorio duplican exactamente estos seis campos y la misma tarjeta de
  preview; acá se escriben una sola vez.

  El formateo mientras se teclea, el preview y la validación vienen enteros
  de ./formulario.ts (que a su vez porta static/app.js y
  routes/pagos.py::_validar_formulario_pago). Este componente no reimplementa
  nada de esa lógica: solo la conecta al DOM.

  Diferencias entre registro y edición que este componente deja abiertas,
  siguiendo el marcado de las dos plantillas:
  - Los botones de "guardar factor predeterminado" (★, registro_pago.html
    líneas 64-70) y "vincular UTM al mes" (🔗, líneas 88-95) NO se portaron:
    son features diferidas del escritorio. Cuando se porten, cada campo
    necesita envolverse en `.input-with-action` junto al botón, como hace
    registro_pago.html; hoy va el `.input-wrapper` simple de
    editar_pago.html, que es lo que ambas pantallas usan.
  - Los `form-hint` de factor, UTM y monto cambian de texto entre pantallas
    ("Cuántas UTMs equivale la pensión" vs "Guardado en el registro", etc.):
    se reciben por prop, con el texto de registro_pago.html como valor por
    defecto.
  - El texto del botón de envío también difiere ("Registrar Pago →" en
    registro_pago.html línea 168 vs "Guardar cambios →" en editar_pago.html
    línea 135): mismo mecanismo, prop con default de registro.
  - editar_pago.html envuelve el botón en `.edit-actions` junto a un enlace
    "← Cancelar" que aquí no se reproduce: ese enlace no necesita estar
    dentro de un <form> (no dispara envío), así que queda a criterio de
    quien arme la pantalla de edición colocarlo alrededor de este componente.

  Los errores de validación se encolan en `mensajes` (mensajes.svelte.ts),
  el equivalente del flash de sesión de Flask: el escritorio no tiene
  marcado de error por campo, y ese es el único mecanismo de aviso que ya
  existe en el móvil.
-->
<script lang="ts">

  import {
    calcularPreview,
    formatearFactorTecleado,
    formatearMiles,
    validarFormulario,
    type CamposFormulario,
    type ValoresFormulario,
  } from './formulario';
  import { mensajes } from './mensajes.svelte';

  /** Los doce meses completos, en el mismo orden que las plantillas Jinja. */
  const MESES = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
  ];

  let {
    campos = $bindable(),
    alEnviar,
    pistaFactor = 'Cuántas UTMs equivale la pensión',
    pistaUtm = 'Pre-cargado desde la BD',
    pistaMonto = 'Lo que se transfirió este mes',
    textoBoton = 'Registrar Pago →',
  }: {
    /** Los seis campos en crudo, tal como se ven en los inputs. */
    campos: CamposFormulario;
    /** Se llama con los valores ya parseados, y solo cuando la validación pasa. */
    alEnviar: (valores: ValoresFormulario) => void;
    pistaFactor?: string;
    pistaUtm?: string;
    pistaMonto?: string;
    textoBoton?: string;
  } = $props();

  const preview = $derived(calcularPreview({
    factor: campos.factor,
    utmValor: campos.utmValor,
    montoPagado: campos.montoPagado,
  }));

  // Literal de static/app.js (calcularPreview()): mismas clases y mismo
  // texto para cada estado.
  const CLASE_DIFF = { EXCEDENTE: 'diff-pos', DEUDA: 'diff-neg', EXACTO: 'diff-zero' } as const;
  const CLASE_ESTADO = {
    EXCEDENTE: 'estado-excedente', DEUDA: 'estado-deuda', EXACTO: 'estado-exacto',
  } as const;
  const TEXTO_ESTADO = {
    EXCEDENTE: 'EXCEDENTE — pagó de más',
    DEUDA: 'DEUDA — pagó de menos',
    EXACTO: 'EXACTO — pago justo',
  } as const;

  const claseDiff = $derived(preview.estado ? CLASE_DIFF[preview.estado] : '');
  const claseEstado = $derived(preview.estado ? CLASE_ESTADO[preview.estado] : '');
  const textoEstado = $derived(preview.estado ? TEXTO_ESTADO[preview.estado] : '');

  // Cada handler reasigna `campos` entero (en vez de mutar un campo suelto):
  // como `campos` puede llegar como objeto plano —no necesariamente creado
  // con $state() del lado de quien lo pasa—, mutar una propiedad no dispara
  // reactividad. Reasignar el prop sí, porque es lo que hace que $bindable
  // avise al padre y que el preview ($derived, más abajo) se recalcule.
  function alTeclearFactor(e: Event): void {
    campos = { ...campos, factor: formatearFactorTecleado((e.target as HTMLInputElement).value) };
  }

  function alTeclearUtm(e: Event): void {
    campos = { ...campos, utmValor: formatearMiles((e.target as HTMLInputElement).value) };
  }

  function alTeclearMonto(e: Event): void {
    campos = { ...campos, montoPagado: formatearMiles((e.target as HTMLInputElement).value) };
  }

  function alTeclearAnio(e: Event): void {
    campos = { ...campos, anioPago: (e.target as HTMLInputElement).value };
  }

  function alTeclearMes(e: Event): void {
    campos = { ...campos, mesPago: (e.target as HTMLSelectElement).value };
  }

  function alTeclearFecha(e: Event): void {
    campos = { ...campos, fecha: (e.target as HTMLInputElement).value };
  }

  /**
   * Igual que registro_post/editar_pago_post: junta todos los errores y los
   * encola, sin llamar a `alEnviar`. Si no hay ninguno, `alEnviar` recibe
   * los valores ya convertidos a número.
   */
  function enviar(e: SubmitEvent): void {
    e.preventDefault();
    const { valores, errores } = validarFormulario(campos);
    if (errores.length > 0) {
      for (const error of errores) mensajes.agregar(error, 'error');
      return;
    }
    alEnviar(valores as ValoresFormulario);
  }
</script>

<form class="form-card" onsubmit={enviar}>
  <div class="form-grid">

    <!-- Factor UTM -->
    <div class="form-group">
      <label for="utm_factor" class="form-label">
        Factor UTM pactado
        <span class="form-hint">{pistaFactor}</span>
      </label>
      <div class="input-wrapper">
          <input type="text" inputmode="decimal" id="utm_factor" name="utm_factor" class="form-input"
            placeholder="ej: 3,0561" required
            value={campos.factor} oninput={alTeclearFactor} />
          <span class="input-suffix">UTM</span>
        </div>
    </div>

    <!-- Valor UTM (pre-cargado, editable) -->
    <div class="form-group">
      <label for="utm_valor" class="form-label">
        Valor UTM
        <span class="form-hint">{pistaUtm}</span>
      </label>
      <div class="input-wrapper">
          <input type="text" inputmode="numeric" id="utm_valor" name="utm_valor" class="form-input"
            placeholder="ej: 69.889" required
            value={campos.utmValor} oninput={alTeclearUtm} />
          <span class="input-suffix">$</span>
        </div>
    </div>

    <!-- Mes -->
    <div class="form-group">
      <label for="mes_pago" class="form-label">Mes del pago</label>
      <select id="mes_pago" name="mes_pago" class="form-input form-select" required
        value={campos.mesPago} onchange={alTeclearMes}>
        {#each MESES as nombre, i (i)}
          <option value={String(i + 1)}>{nombre}</option>
        {/each}
      </select>
    </div>

    <!-- Año -->
    <div class="form-group">
      <label for="anio_pago" class="form-label">Año del pago</label>
      <input type="number" id="anio_pago" name="anio_pago" class="form-input" min="2000" max="2100" required
        value={campos.anioPago} oninput={alTeclearAnio} />
    </div>

    <!-- Monto pagado -->
    <div class="form-group form-group-full">
      <label for="monto_pagado" class="form-label">
        Monto efectivamente pagado
        <span class="form-hint">{pistaMonto}</span>
      </label>
      <div class="input-wrapper">
        <input type="text" inputmode="numeric" id="monto_pagado" name="monto_pagado"
          class="form-input input-destacado" placeholder="ej: 200.000" required
          value={campos.montoPagado} oninput={alTeclearMonto} />
        <span class="input-suffix">$</span>
      </div>
    </div>

    <!-- Fecha de registro -->
    <div class="form-group form-group-full">
      <label for="fecha" class="form-label">Fecha de registro</label>
      <input type="date" id="fecha" name="fecha" class="form-input"
        value={campos.fecha} oninput={alTeclearFecha} />
    </div>

  </div>

  <!-- Preview en tiempo real -->
  <div class="preview-card">
    <div class="preview-row">
      <span class="preview-label">Cuota pactada</span>
      <span class="preview-value">{preview.cuota}</span>
    </div>
    <div class="preview-row">
      <span class="preview-label">Monto pagado</span>
      <span class="preview-value">{preview.pagado}</span>
    </div>
    <div class="preview-divider"></div>
    <div class="preview-row preview-resultado">
      <span class="preview-label">Diferencia</span>
      <span class="preview-value {claseDiff}">{preview.diferencia}</span>
    </div>
    <div class="preview-estado {claseEstado}">{textoEstado}</div>
  </div>

  <button type="submit" class="btn-submit">{textoBoton}</button>

</form>
