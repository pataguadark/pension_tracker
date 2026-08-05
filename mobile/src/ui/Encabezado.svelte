<script lang="ts">
  import type { Vista } from './App.svelte';

  let { vista, alCambiar }: { vista: Vista; alCambiar: (v: Vista) => void } = $props();
</script>

<header class="site-header">
  <div class="header-inner">
    <a
      href="#historial"
      class="brand"
      onclick={(e) => { e.preventDefault(); alCambiar('historial'); }}>
      <div class="brand-text">
        <span class="brand-title">Pensión</span>
        <span class="brand-sub">TRACKER</span>
      </div>
    </a>
    <nav class="main-nav">
      <a
        href="#registro"
        class="nav-link {vista === 'registro' ? 'active' : ''}"
        onclick={(e) => { e.preventDefault(); alCambiar('registro'); }}>Registrar Pago</a>
      <a
        href="#historial"
        class="nav-link {vista === 'historial' ? 'active' : ''}"
        onclick={(e) => { e.preventDefault(); alCambiar('historial'); }}>Historial</a>
    </nav>
  </div>
</header>
