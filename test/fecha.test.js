const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fechaMadrid } = require('../src/domain/fecha');

test('fechaMadrid: devuelve formato YYYY-MM-DD', () => {
  assert.match(fechaMadrid(new Date('2026-06-01T10:00:00Z')), /^\d{4}-\d{2}-\d{2}$/);
});

test('fechaMadrid: en invierno (UTC+1), un instante tras las 23:00 UTC ya es el día siguiente en Madrid', () => {
  assert.equal(fechaMadrid(new Date('2026-01-15T23:30:00Z')), '2026-01-16');
});

test('fechaMadrid: en verano (UTC+2, horario de verano), el cambio de día ocurre una hora antes en UTC', () => {
  assert.equal(fechaMadrid(new Date('2026-07-15T21:30:00Z')), '2026-07-15');
  assert.equal(fechaMadrid(new Date('2026-07-15T22:30:00Z')), '2026-07-16');
});

test('fechaMadrid: sin argumento, usa la hora actual del sistema (no revienta)', () => {
  assert.match(fechaMadrid(), /^\d{4}-\d{2}-\d{2}$/);
});
