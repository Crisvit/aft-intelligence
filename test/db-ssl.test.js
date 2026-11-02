// Configuración TLS de src/db.js — revisada en la auditoría de seguridad.
// pg.Pool no abre ninguna conexión real al construirse (perezoso), así que
// esto puede probarse sin Postgres real, inspeccionando pool.options.ssl.
const { test } = require('node:test');
const assert = require('node:assert/strict');

function cargarDbConEnv(env) {
  const originales = {};
  for (const k of ['PGSSL', 'PGSSL_REJECT_UNAUTHORIZED', 'PGHOST', 'PGDATABASE', 'PGUSER', 'PGPASSWORD']) {
    originales[k] = process.env[k];
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = env[k];
  }
  delete require.cache[require.resolve('../src/db')];
  const { pool } = require('../src/db');
  for (const k of Object.keys(originales)) {
    if (originales[k] === undefined) delete process.env[k];
    else process.env[k] = originales[k];
  }
  return pool;
}

test('PGSSL=false: TLS completamente desactivado (solo Postgres local de pruebas)', () => {
  const pool = cargarDbConEnv({ PGSSL: 'false' });
  assert.equal(pool.options.ssl, false);
  pool.end();
});

test('PGSSL=true sin PGSSL_REJECT_UNAUTHORIZED: TLS activo pero sin validar el certificado (comportamiento por defecto, documentado como riesgo conocido)', () => {
  const pool = cargarDbConEnv({ PGSSL: 'true' });
  assert.deepEqual(pool.options.ssl, { rejectUnauthorized: false });
  pool.end();
});

test('PGSSL_REJECT_UNAUTHORIZED=true: valida de verdad el certificado del servidor', () => {
  const pool = cargarDbConEnv({ PGSSL: 'true', PGSSL_REJECT_UNAUTHORIZED: 'true' });
  assert.deepEqual(pool.options.ssl, { rejectUnauthorized: true });
  pool.end();
});

test('PGSSL_REJECT_UNAUTHORIZED con cualquier otro valor se trata como no activado (nunca a medias)', () => {
  const pool = cargarDbConEnv({ PGSSL: 'true', PGSSL_REJECT_UNAUTHORIZED: 'claro' });
  assert.deepEqual(pool.options.ssl, { rejectUnauthorized: false });
  pool.end();
});
