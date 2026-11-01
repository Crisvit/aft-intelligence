const { test } = require('node:test');
const assert = require('node:assert/strict');
const { clasificarEvento } = require('../src/reposicion');

test('clasificarEvento: sin cambios cuando el stock ya coincide', () => {
  assert.equal(clasificarEvento(5, 5), 'sin_cambios');
  assert.equal(clasificarEvento(0, 0), 'sin_cambios');
});

test('clasificarEvento: producto recuperado de stock cero o negativo', () => {
  assert.equal(clasificarEvento(0, 12), 'producto_recuperado_stock_cero_negativo');
  assert.equal(clasificarEvento(-3, 1), 'producto_recuperado_stock_cero_negativo');
});

test('clasificarEvento: reposición detectada (stock ya positivo, AFT confirma más)', () => {
  assert.equal(clasificarEvento(2, 10), 'reposicion_detectada');
});

test('clasificarEvento: corrección a la baja, incluido llegar a 0', () => {
  assert.equal(clasificarEvento(10, 3), 'correccion_a_la_baja');
  assert.equal(clasificarEvento(5, 0), 'correccion_a_la_baja');
});

// [caracterización] previa a mover la función a src/domain/. En producción
// esta combinación nunca llega a clasificarEvento() (obtenerCandidatos()
// exige stock_aft >= 0), pero la función pura no lo sabe: con ambos
// valores negativos y "nuevo" mayor que "antes", cae en reposicion_detectada
// — se documenta tal cual para que el traslado no cambie este resultado.
test('[caracterización] ambos valores negativos: se clasifica por comparación numérica, no por signo', () => {
  assert.equal(clasificarEvento(-3, -1), 'reposicion_detectada');
  assert.equal(clasificarEvento(-1, -3), 'correccion_a_la_baja');
});
