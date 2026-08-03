# Fixtures doradas

Casos de prueba compartidos entre las dos implementaciones de la aritmética
del tracker: la de Python (`src/pensiontracker/`) y la de TypeScript
(`mobile/src/core/`).

`tests/test_fixtures_doradas.py` los ejecuta con pytest y
`mobile/src/core/fixtures.test.ts` con vitest. Ambas suites leen **estos
mismos archivos**, así que si una implementación se desvía de la otra, una
de las dos se pone roja.

## Reglas

- Todos los valores son **sintéticos**. Nunca datos reales de nadie.
- Las fixtures verifican **números y estados**, nunca cadenas de
  descripción: esas son presentación y hacerlas coincidir carácter a
  carácter entre dos lenguajes produce tests frágiles.
- Un caso que debe lanzar error se marca con `"esperado": {"error": true}`.
- Al agregar un caso, agrégalo aquí: las dos suites lo recogen solas.
