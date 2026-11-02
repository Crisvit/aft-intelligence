// Comprobación pura de credenciales (src/auth.js) — la pieza que decide si
// un usuario/contraseña son válidos para abrir sesión. El flujo completo
// (login -> cookie -> sesión persistente -> logout) se verificó en vivo
// contra un servidor real (ver el informe de despliegue); aquí se fija el
// comportamiento que no depende de Express ni de una sesión real.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const { credencialesValidas, esRutaPaginaHtml } = require('../src/auth');

const HASH_REAL = bcrypt.hashSync('contraseña-correcta', 4);
const ENV = { dashboardUser: 'admin', dashboardPasswordHash: HASH_REAL };

test('credencialesValidas: usuario y contraseña correctos -> true', () => {
  assert.equal(credencialesValidas('admin', 'contraseña-correcta', ENV), true);
});

test('credencialesValidas: contraseña incorrecta -> false', () => {
  assert.equal(credencialesValidas('admin', 'otra-cosa', ENV), false);
});

test('credencialesValidas: usuario incorrecto -> false (nunca llega a comparar el hash)', () => {
  assert.equal(credencialesValidas('otro_usuario', 'contraseña-correcta', ENV), false);
});

test('credencialesValidas: sin DASHBOARD_USER/DASHBOARD_PASSWORD_HASH configurados -> false, nunca deja pasar', () => {
  assert.equal(credencialesValidas('admin', 'contraseña-correcta', {}), false);
  assert.equal(credencialesValidas('admin', 'contraseña-correcta', { dashboardUser: 'admin' }), false);
});

test('credencialesValidas: nunca lanza con entradas vacías o de tipo inesperado', () => {
  assert.equal(credencialesValidas(undefined, undefined, ENV), false);
  assert.equal(credencialesValidas(null, null, ENV), false);
  assert.equal(credencialesValidas(123, {}, ENV), false);
});

test('esRutaPaginaHtml: el dashboard ("/") es la única ruta de página que redirige a /login', () => {
  assert.equal(esRutaPaginaHtml('/'), true);
});

test('esRutaPaginaHtml: las rutas de API/diagnóstico no son "de página" -> 401 JSON, nunca un redirect que rompa fetch()', () => {
  assert.equal(esRutaPaginaHtml('/status'), false);
  assert.equal(esRutaPaginaHtml('/api/reposicion-run'), false);
  assert.equal(esRutaPaginaHtml('/api/reposicion-run/una-referencia'), false);
  assert.equal(esRutaPaginaHtml('/login'), false);
});
