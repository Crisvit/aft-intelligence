const { test } = require('node:test');
const assert = require('node:assert/strict');
const { clasificarMargen } = require('../src/domain/margen');

test('clasificarMargen: sin dato -> sin_dato, nunca se asume una franja', () => {
  for (const v of [null, undefined, NaN]) {
    const r = clasificarMargen(v);
    assert.equal(r.tier, 'sin_dato');
    assert.equal(r.prioridadAdicional, false);
  }
});

test('clasificarMargen: por debajo de 10% -> autorizacion_excepcional', () => {
  assert.equal(clasificarMargen(0).tier, 'autorizacion_excepcional');
  assert.equal(clasificarMargen(9.99).tier, 'autorizacion_excepcional');
  assert.equal(clasificarMargen(-5).tier, 'autorizacion_excepcional');
});

test('clasificarMargen: frontera 10% -> revision_comercial (ambos extremos inclusive)', () => {
  assert.equal(clasificarMargen(10).tier, 'revision_comercial');
  assert.equal(clasificarMargen(15).tier, 'revision_comercial');
  assert.equal(clasificarMargen(12.5).tier, 'revision_comercial');
});

test('clasificarMargen: por encima de 15% -> apto_evaluacion', () => {
  assert.equal(clasificarMargen(15.01).tier, 'apto_evaluacion');
  assert.equal(clasificarMargen(19.99).tier, 'apto_evaluacion');
});

test('clasificarMargen: prioridadAdicional solo a partir de 20% inclusive, dentro de apto_evaluacion', () => {
  const r19 = clasificarMargen(19.99);
  assert.equal(r19.tier, 'apto_evaluacion');
  assert.equal(r19.prioridadAdicional, false);

  const r20 = clasificarMargen(20);
  assert.equal(r20.tier, 'apto_evaluacion');
  assert.equal(r20.prioridadAdicional, true);

  const r30 = clasificarMargen(30);
  assert.equal(r30.tier, 'apto_evaluacion');
  assert.equal(r30.prioridadAdicional, true);
});

test('clasificarMargen: siempre incluye motivo trazable', () => {
  for (const v of [null, -5, 10, 15, 30]) {
    const r = clasificarMargen(v);
    assert.ok(r.motivo && r.motivo.length > 0);
  }
});

test('clasificarMargen: es puramente informativa, no devuelve ningún campo de score', () => {
  const r = clasificarMargen(30);
  assert.deepEqual(Object.keys(r).sort(), ['motivo', 'prioridadAdicional', 'tier']);
});
