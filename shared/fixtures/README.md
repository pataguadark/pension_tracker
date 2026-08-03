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
- JSON no tiene literal para `NaN` ni `Infinity`. Cuando un caso necesita
  ejercitar un valor no finito, se representa como la cadena `"NaN"` o
  `"Infinity"` (o `"-Infinity"`) en `entrada`, y cada suite la convierte al
  número no finito correspondiente antes de invocar la función (ver
  `convertirNoFinito` en `mobile/src/core/fixtures.test.ts` y
  `_convertir_no_finito` en `tests/test_fixtures_doradas.py`). Un caso así
  casi siempre espera `"esperado": {"error": true}`, porque ambas
  implementaciones rechazan explícitamente `nan`/`inf`.
- Al agregar un caso, agrégalo aquí: las dos suites lo recogen solas.
