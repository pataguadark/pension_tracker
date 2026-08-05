<script lang="ts">
  import type { Vista } from './App.svelte';

  let { vista, alCambiar }: { vista: Vista; alCambiar: (v: Vista) => void } = $props();

  // El escritorio no necesita este estado: navega recargando la página, así
  // que el menú nunca queda "abierto" entre una vista y otra. Acá es una SPA:
  // el menú vive en memoria y hay que cerrarlo explícitamente al elegir una
  // vista, o quedaría tapando el contenido después de cada navegación.
  let menuAbierto = $state(false);

  function elegir(v: Vista): void {
    alCambiar(v);
    menuAbierto = false;
  }
</script>

<header class="site-header">
  <div class="header-inner">
    <a
      href="#historial"
      class="brand"
      onclick={(e) => { e.preventDefault(); elegir('historial'); }}>
      <div class="brand-text">
        <span class="brand-title">Pensión</span>
        <span class="brand-sub">TRACKER</span>
      </div>
    </a>
    <button
      type="button"
      class="nav-toggle"
      aria-expanded={menuAbierto}
      aria-controls="mainNav"
      aria-label="Abrir menú"
      onclick={() => (menuAbierto = !menuAbierto)}>
      <span class="nav-toggle-icon"></span>
    </button>
    <nav class="main-nav {menuAbierto ? 'open' : ''}" id="mainNav">
      <a
        href="#registro"
        class="nav-link {vista === 'registro' ? 'active' : ''}"
        onclick={(e) => { e.preventDefault(); elegir('registro'); }}>Registrar Pago</a>
      <a
        href="#historial"
        class="nav-link {vista === 'historial' ? 'active' : ''}"
        onclick={(e) => { e.preventDefault(); elegir('historial'); }}>Historial</a>
    </nav>
  </div>
</header>
