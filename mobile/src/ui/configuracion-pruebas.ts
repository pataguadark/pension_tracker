// Suma los matchers de jest-dom (toBeInTheDocument, toHaveClass, etc.) a los
// `expect` de vitest. Se carga como `setupFiles` en vitest.config.ts, antes
// de cada archivo de prueba.
import '@testing-library/jest-dom/vitest';
