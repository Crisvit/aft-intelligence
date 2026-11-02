const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { construirJwtFirmado, leerCredenciales, hayCredencialesConfiguradas, base64url } = require('../src/googleAuth');

function base64urlDecode(s) {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

function credencialDePrueba() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  return {
    credenciales: { client_email: 'cuenta@proyecto.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs1', format: 'pem' }) },
    publicKey
  };
}

test('leerCredenciales: null si falta la variable, si no es JSON, o si faltan campos', () => {
  assert.equal(leerCredenciales(''), null);
  assert.equal(leerCredenciales('esto no es json'), null);
  assert.equal(leerCredenciales(JSON.stringify({ client_email: 'solo@esto.com' })), null);
});

test('leerCredenciales: devuelve el objeto cuando el JSON tiene client_email y private_key', () => {
  const { credenciales } = credencialDePrueba();
  const resultado = leerCredenciales(JSON.stringify(credenciales));
  assert.equal(resultado.client_email, credenciales.client_email);
});

test('hayCredencialesConfiguradas: booleano coherente con el entorno de este proceso', () => {
  assert.equal(typeof hayCredencialesConfiguradas(), 'boolean');
});

test('construirJwtFirmado: cabecera y payload reales, nunca inventados, y firma verificable', () => {
  const { credenciales, publicKey } = credencialDePrueba();
  const ahora = new Date('2026-01-01T10:00:00Z');
  const scopes = ['https://www.googleapis.com/auth/webmasters.readonly'];
  const { jwt, header, payload } = construirJwtFirmado(credenciales, scopes, ahora);

  assert.equal(header.alg, 'RS256');
  assert.equal(payload.iss, credenciales.client_email);
  assert.equal(payload.scope, scopes.join(' '));
  assert.equal(payload.iat, Math.floor(ahora.getTime() / 1000));
  assert.equal(payload.exp, payload.iat + 3600);

  const partes = jwt.split('.');
  assert.equal(partes.length, 3);
  assert.deepEqual(JSON.parse(base64urlDecode(partes[0])), header);
  assert.deepEqual(JSON.parse(base64urlDecode(partes[1])), payload);

  const firmaValida = crypto.createVerify('RSA-SHA256')
    .update(partes[0] + '.' + partes[1])
    .verify(publicKey, Buffer.from(partes[2].replace(/-/g, '+').replace(/_/g, '/'), 'base64'));
  assert.equal(firmaValida, true);
});

test('base64url: sin relleno "=" y con el alfabeto URL-safe', () => {
  const codificado = base64url('hola');
  assert.equal(codificado.includes('='), false);
  assert.match(codificado, /^[A-Za-z0-9_-]+$/);
});
