// Dos defectos reales de seguridad corregidos en src/authSeguridad.js:
// 1) comparación de usuario en tiempo variable (fuga de usuario correcto
//    por temporización), 2) sin límite de intentos de login.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const {
  credencialesValidas, puedeIntentar, registrarIntentoFallido, registrarExito, _resetParaPruebas,
  MAX_INTENTOS, VENTANA_MS
} = require('../src/authSeguridad');

const HASH_REAL = bcrypt.hashSync('contraseña-real-de-prueba', 10);
const CFG = { dashboardUser: 'admin', dashboardPasswordHash: HASH_REAL };

test('credencialesValidas: true solo con usuario y contraseña correctos', () => {
  assert.equal(credencialesValidas('admin', 'contraseña-real-de-prueba', CFG), true);
});

test('credencialesValidas: false con usuario correcto y contraseña incorrecta', () => {
  assert.equal(credencialesValidas('admin', 'lo-que-sea', CFG), false);
});

test('credencialesValidas: false con usuario incorrecto, aunque la contraseña sea la real', () => {
  assert.equal(credencialesValidas('otro', 'contraseña-real-de-prueba', CFG), false);
});

test('credencialesValidas: nunca lanza con password/usuario vacíos, null o undefined', () => {
  assert.equal(credencialesValidas('', '', CFG), false);
  assert.equal(credencialesValidas(null, null, CFG), false);
  assert.equal(credencialesValidas(undefined, undefined, CFG), false);
});

test('credencialesValidas: el tiempo de respuesta no depende de si el usuario es correcto (siempre llama a bcrypt)', () => {
  // No se puede medir tiempo real de forma fiable en CI, pero sí se puede
  // confirmar el mecanismo: ambas rutas (usuario correcto y usuario
  // incorrecto) ejecutan bcrypt.compareSync contra un hash real — nunca
  // hay un camino que devuelva false sin pasar por bcrypt.
  let llamadasCompareSync = 0;
  const original = bcrypt.compareSync;
  bcrypt.compareSync = (...args) => { llamadasCompareSync++; return original(...args); };
  try {
    credencialesValidas('admin', 'x', CFG);
    credencialesValidas('usuario-que-no-existe', 'x', CFG);
  } finally {
    bcrypt.compareSync = original;
  }
  assert.equal(llamadasCompareSync, 2);
});

test('puedeIntentar/registrarIntentoFallido: bloquea tras MAX_INTENTOS fallos en la misma ventana', () => {
  _resetParaPruebas();
  const ip = '203.0.113.5';
  const ahora = 1000000;
  for (let i = 0; i < MAX_INTENTOS; i++) {
    assert.equal(puedeIntentar(ip, ahora), true);
    registrarIntentoFallido(ip, ahora);
  }
  assert.equal(puedeIntentar(ip, ahora), false);
});

test('puedeIntentar: el bloqueo se levanta pasada la ventana de tiempo', () => {
  _resetParaPruebas();
  const ip = '203.0.113.6';
  const ahora = 2000000;
  for (let i = 0; i < MAX_INTENTOS; i++) registrarIntentoFallido(ip, ahora);
  assert.equal(puedeIntentar(ip, ahora), false);
  assert.equal(puedeIntentar(ip, ahora + VENTANA_MS + 1), true);
});

test('registrarExito: limpia el contador de intentos fallidos de esa IP', () => {
  _resetParaPruebas();
  const ip = '203.0.113.7';
  const ahora = 3000000;
  for (let i = 0; i < MAX_INTENTOS - 1; i++) registrarIntentoFallido(ip, ahora);
  registrarExito(ip);
  assert.equal(puedeIntentar(ip, ahora), true);
  // tras el éxito, hay margen de MAX_INTENTOS fallos de nuevo, no solo 1
  for (let i = 0; i < MAX_INTENTOS - 1; i++) {
    assert.equal(puedeIntentar(ip, ahora), true);
    registrarIntentoFallido(ip, ahora);
  }
});

test('puedeIntentar: dos IPs distintas no se bloquean entre sí', () => {
  _resetParaPruebas();
  const ahora = 4000000;
  for (let i = 0; i < MAX_INTENTOS; i++) registrarIntentoFallido('203.0.113.8', ahora);
  assert.equal(puedeIntentar('203.0.113.8', ahora), false);
  assert.equal(puedeIntentar('203.0.113.9', ahora), true);
});
