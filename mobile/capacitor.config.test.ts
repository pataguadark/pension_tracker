import { describe, expect, it } from 'vitest';

import config from './capacitor.config';

describe('capacitor.config', () => {
  it('habilita CapacitorHttp', () => {
    // Sin esto, fetch sale del WebView como petición de navegador y
    // mindicador.cl la rechaza por CORS: la app se queda sin UTM en el
    // teléfono, sin que ninguna otra prueba lo note.
    expect(config.plugins?.CapacitorHttp?.enabled).toBe(true);
  });

  it('sirve el bundle que produce Vite', () => {
    expect(config.webDir).toBe('dist');
  });

  it('usa el identificador de aplicación del proyecto', () => {
    expect(config.appId).toBe('cl.pensiontracker.app');
  });
});
