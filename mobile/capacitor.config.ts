import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'cl.pensiontracker.app',
  appName: 'Pensión Tracker',
  webDir: 'dist',
  plugins: {
    // Hace que `fetch` vaya por la capa nativa. Sin esto, la consulta a
    // mindicador.cl muere por CORS dentro del WebView. Ver el comentario en
    // capacitor.config.test.ts.
    CapacitorHttp: { enabled: true },
  },
};

export default config;
