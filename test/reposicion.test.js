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
