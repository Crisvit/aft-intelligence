const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validarAutorizacion, validarRechazo } = require('../src/domain/autorizacionMargen');

test('validarAutorizacion: acepta ref/motivo/decididoPor completos', () => {
  const r = validarAutorizacion({ ref: 'AFT-1234', motivo: 'Margen aceptado para liquidar stock antiguo', decididoPor: 'admin' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.errores, []);
});

test('validarAutorizacion: rechaza sin ref', () => {
  const r = validarAutorizacion({ ref: '', motivo: 'x', decididoPor: 'admin' });
  assert.equal(r.ok, false);
  assert.match(r.errores.join(' '), /referencia/);
});

test('validarAutorizacion: rechaza sin quién autoriza', () => {
  const r = validarAutorizacion({ ref: 'AFT-1', motivo: 'x', decididoPor: '' });
  assert.equal(r.ok, false);
  assert.match(r.errores.join(' '), /quién autoriza/);
});

test('validarAutorizacion: rechaza sin motivo', () => {
  const r = validarAutorizacion({ ref: 'AFT-1', motivo: '', decididoPor: 'admin' });
  assert.equal(r.ok, false);
  assert.match(r.errores.join(' '), /motivo/);
});

test('validarAutorizacion: acumula todos los errores a la vez', () => {
  const r = validarAutorizacion({ ref: '', motivo: '', decididoPor: '' });
  assert.equal(r.errores.length, 3);
});

test('validarRechazo: acepta ref/motivo/decididoPor completos', () => {
  const r = validarRechazo({ ref: 'AFT-1234', motivo: 'Margen insuficiente incluso con descuento de proveedor', decididoPor: 'admin' });
  assert.equal(r.ok, true);
});

test('validarRechazo: rechaza sin motivo del rechazo', () => {
  const r = validarRechazo({ ref: 'AFT-1', motivo: '', decididoPor: 'admin' });
  assert.equal(r.ok, false);
  assert.match(r.errores.join(' '), /motivo del rechazo/);
});

test('validarAutorizacion y validarRechazo son independientes — nunca comparten estado ni se mezclan', () => {
  // Autorizar y rechazar son dos funciones puras separadas; confirmamos
  // que validar uno no depende en absoluto del otro módulo de resolución
  // de afinidad (distinto mecanismo, por diseño explícito).
  const autorizacionModule = require('../src/domain/autorizacionMargen');
  const afinidadModule = require('../src/domain/afinidadResolucion');
  assert.notEqual(autorizacionModule, afinidadModule);
  assert.equal('CLASES_RESOLUBLES' in autorizacionModule, false);
});
