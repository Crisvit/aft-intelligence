// Prueba la lógica de reintento de src/aftClient.js con global.fetch
// mockeado — nunca una llamada de red real a AFT. Cada test restaura
// fetch al terminar, incluso si falla, para no contaminar otros tests.
const { test } = require('node:test');
const assert = require('node:assert/strict');

process.env.AFT_TOKEN_BODY_JSON = JSON.stringify({ grant_type: 'password', username: 'u', password: 'p' });
process.env.AFT_RETRY_ESPERA_MS = '5'; // acelera el test sin cambiar la lógica

function cargarAftClientFresco() {
  delete require.cache[require.resolve('../src/aftClient')];
  return require('../src/aftClient');
}

async function conFetchMock(mockFn, fn) {
  const original = global.fetch;
  global.fetch = mockFn;
  try {
    return await fn();
  } finally {
    global.fetch = original;
  }
}

test('getAftToken: reintenta ante error de red y acaba devolviendo el token', async () => {
  process.env.AFT_RETRY_INTENTOS = '3';
  const { getAftToken } = cargarAftClientFresco();
  let llamadas = 0;
  const token = await conFetchMock(async () => {
    llamadas++;
    if (llamadas < 3) throw new Error('ECONNRESET simulado');
    return { ok: true, json: async () => ({ access_token: 'tok-123' }) };
  }, () => getAftToken());
  assert.equal(llamadas, 3);
  assert.equal(token, 'tok-123');
});

test('aftGet: 503 se reintenta (transitorio) hasta tener éxito', async () => {
  process.env.AFT_RETRY_INTENTOS = '3';
  const { getProductos } = cargarAftClientFresco();
  let llamadas = 0;
  const productos = await conFetchMock(async () => {
    llamadas++;
    if (llamadas < 3) return { ok: false, status: 503 };
    return { ok: true, json: async () => ([{ ref: 'X' }]) };
  }, () => getProductos('tok'));
  assert.equal(llamadas, 3);
  assert.deepEqual(productos, [{ ref: 'X' }]);
});

test('aftGet: fallo persistente agota los intentos configurados y lanza', async () => {
  process.env.AFT_RETRY_INTENTOS = '3';
  const { getProductos } = cargarAftClientFresco();
  let llamadas = 0;
  await assert.rejects(
    () => conFetchMock(async () => { llamadas++; return { ok: false, status: 500 }; }, () => getProductos('tok')),
    /failed \(500\)/
  );
  assert.equal(llamadas, 3);
});

test('aftGet: un 401 (credenciales inválidas) falla a la primera, sin reintentar', async () => {
  process.env.AFT_RETRY_INTENTOS = '3';
  const { getProductos } = cargarAftClientFresco();
  let llamadas = 0;
  await assert.rejects(
    () => conFetchMock(async () => { llamadas++; return { ok: false, status: 401 }; }, () => getProductos('tok')),
    /failed \(401\)/
  );
  assert.equal(llamadas, 1);
});

test('aftGet: un 429 (rate limit) sí se reintenta', async () => {
  process.env.AFT_RETRY_INTENTOS = '3';
  const { getProductos } = cargarAftClientFresco();
  let llamadas = 0;
  await conFetchMock(async () => {
    llamadas++;
    if (llamadas < 2) return { ok: false, status: 429 };
    return { ok: true, json: async () => ([]) };
  }, () => getProductos('tok'));
  assert.equal(llamadas, 2);
});

test('getAftToken: respuesta 2xx sin access_token falla a la primera (no es un fallo de red)', async () => {
  process.env.AFT_RETRY_INTENTOS = '3';
  const { getAftToken } = cargarAftClientFresco();
  let llamadas = 0;
  await assert.rejects(
    () => conFetchMock(async () => { llamadas++; return { ok: true, status: 200, json: async () => ({}) }; }, () => getAftToken()),
    /sin access_token/
  );
  assert.equal(llamadas, 1);
});

test('AFT_RETRY_INTENTOS=1 desactiva los reintentos', async () => {
  process.env.AFT_RETRY_INTENTOS = '1';
  const { getProductos } = cargarAftClientFresco();
  let llamadas = 0;
  await assert.rejects(
    () => conFetchMock(async () => { llamadas++; return { ok: false, status: 500 }; }, () => getProductos('tok'))
  );
  assert.equal(llamadas, 1);
});
