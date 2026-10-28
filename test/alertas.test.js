const { test } = require('node:test');
const assert = require('node:assert/strict');

function cargarAlertasFresco() {
  delete require.cache[require.resolve('../src/alertas')];
  return require('../src/alertas');
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

test('notificarFallo: sin ALERT_WEBHOOK_URL es un no-op, nunca llama a fetch', async () => {
  delete process.env.ALERT_WEBHOOK_URL;
  const { notificarFallo } = cargarAlertasFresco();
  let llamado = false;
  await conFetchMock(async () => { llamado = true; return { ok: true }; }, () =>
    notificarFallo({ agente: 'Test', mensaje: 'algo falló', runId: 1 })
  );
  assert.equal(llamado, false);
});

test('notificarFallo: con ALERT_WEBHOOK_URL envía el payload esperado', async () => {
  process.env.ALERT_WEBHOOK_URL = 'https://hooks.example.com/fake';
  const { notificarFallo } = cargarAlertasFresco();
  let capturado = null;
  await conFetchMock(async (url, opts) => {
    capturado = { url, body: JSON.parse(opts.body) };
    return { ok: true };
  }, () => notificarFallo({ agente: 'Pipeline completo', mensaje: 'fallo X', runId: 42 }));

  assert.equal(capturado.url, 'https://hooks.example.com/fake');
  assert.match(capturado.body.text, /Pipeline completo/);
  assert.match(capturado.body.text, /#42/);
  assert.match(capturado.body.text, /fallo X/);
});

test('notificarFallo: nunca lanza si el webhook falla (ni error de red ni respuesta de error)', async () => {
  process.env.ALERT_WEBHOOK_URL = 'https://hooks.example.com/fake';
  const { notificarFallo } = cargarAlertasFresco();

  await conFetchMock(async () => { throw new Error('getaddrinfo ENOTFOUND'); }, () =>
    notificarFallo({ agente: 'Test', mensaje: 'x' })
  ); // no debe lanzar

  await conFetchMock(async () => ({ ok: false, status: 500 }), () =>
    notificarFallo({ agente: 'Test', mensaje: 'x' })
  ); // no debe lanzar
});
