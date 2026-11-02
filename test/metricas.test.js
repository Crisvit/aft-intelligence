// src/metricas.js — consultas de solo lectura para el panel SaaS. pool.query
// mockeado por require.cache (mismo patrón que test/reposicion-preview.test.js):
// nunca una base de datos real, para que corra en CI sin Postgres.
const { test } = require('node:test');
const assert = require('node:assert/strict');

function instalarPoolMock(impl) {
  const dbPath = require.resolve('../src/db');
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { pool: { query: impl } } };
  delete require.cache[require.resolve('../src/metricas')];
  return require('../src/metricas');
}

test('motivosBloqueo: sin coincidencia fiable', () => {
  const { motivosBloqueo } = instalarPoolMock(async () => ({ rows: [] }));
  const motivos = motivosBloqueo({ matched_by: 'nombre', alerta_duplicado: false, alerta_multiples_ubicaciones: false, alerta_ubicacion_no_encontrada: false, bloquear_escritura: false, shopify_inventory_item_id: 'gid://x', shopify_stock: 5, stock_aft: 5 });
  assert.deepEqual(motivos, ['sin coincidencia EAN/SKU fiable']);
});

test('motivosBloqueo: varios motivos a la vez, cada uno con su propio texto', () => {
  const { motivosBloqueo } = instalarPoolMock(async () => ({ rows: [] }));
  const motivos = motivosBloqueo({ matched_by: 'ean', alerta_duplicado: true, alerta_multiples_ubicaciones: false, alerta_ubicacion_no_encontrada: false, bloquear_escritura: true, shopify_inventory_item_id: null, shopify_stock: null, stock_aft: -3 });
  assert.ok(motivos.includes('coincidencia duplicada'));
  assert.ok(motivos.includes('bloqueo manual'));
  assert.ok(motivos.includes('sin inventory_item_id de Shopify'));
  assert.ok(motivos.includes('sin stock de Shopify leído'));
  assert.ok(motivos.includes('stock de AFT negativo'));
  assert.ok(!motivos.includes('sin coincidencia EAN/SKU fiable'));
});

test('motivosBloqueo: una coincidencia totalmente fiable no tiene ningún motivo', () => {
  const { motivosBloqueo } = instalarPoolMock(async () => ({ rows: [] }));
  const motivos = motivosBloqueo({ matched_by: 'sku', alerta_duplicado: false, alerta_multiples_ubicaciones: false, alerta_ubicacion_no_encontrada: false, bloquear_escritura: false, shopify_inventory_item_id: 'gid://x', shopify_stock: 3, stock_aft: 0 });
  assert.deepEqual(motivos, []);
});

test('obtenerEvolucionReposicion: pasa el número de días pedido y devuelve las filas tal cual', async () => {
  let sqlCapturado = null, paramsCapturados = null;
  const { obtenerEvolucionReposicion } = instalarPoolMock(async (sql, params) => {
    sqlCapturado = sql; paramsCapturados = params;
    return { rows: [{ dia: new Date('2026-10-20'), runs: 1, runs_parciales: 0, actualizados: 3, simulados: 0, errores: 0 }] };
  });
  const filas = await obtenerEvolucionReposicion(7);
  assert.match(sqlCapturado, /FROM reposicion_runs/);
  assert.match(sqlCapturado, /modo = 'lote'/);
  assert.deepEqual(paramsCapturados, [7]);
  assert.equal(filas.length, 1);
  assert.equal(filas[0].actualizados, 3);
});

test('obtenerEvolucionReposicion: días fuera de rango se acotan entre 1 y 90 (0/vacío -> 30 por defecto; negativo real -> mínimo 1)', async () => {
  const llamadas = [];
  const { obtenerEvolucionReposicion } = instalarPoolMock(async (sql, params) => { llamadas.push(params[0]); return { rows: [] }; });
  await obtenerEvolucionReposicion(0);
  await obtenerEvolucionReposicion(500);
  await obtenerEvolucionReposicion(-5);
  assert.deepEqual(llamadas, [30, 90, 1]);
});

test('obtenerReferenciasBloqueadas: añade los motivos a cada fila devuelta', async () => {
  const { obtenerReferenciasBloqueadas } = instalarPoolMock(async () => ({
    rows: [{ ref: 'REF-1', ean: 'E1', shopify_product_title: 'Taladro', matched_by: null, estado: 'cambiaria', alerta_duplicado: false, alerta_multiples_ubicaciones: false, alerta_ubicacion_no_encontrada: false, bloquear_escritura: false, shopify_inventory_item_id: 'gid://x', shopify_stock: 5, stock_aft: 5 }]
  }));
  const filas = await obtenerReferenciasBloqueadas(50);
  assert.equal(filas.length, 1);
  assert.deepEqual(filas[0].motivos, ['sin coincidencia EAN/SKU fiable']);
});

test('obtenerUltimoEventoPorRef: se queda con una fila por ref (la primera que llega, ya ordenada por el SQL)', async () => {
  const { obtenerUltimoEventoPorRef } = instalarPoolMock(async () => ({
    rows: [
      { ref: 'A', tipo_evento: 'reposicion_detectada', dry_run: false, escrito: true, verificado: true, detectado_en: new Date('2026-10-30') },
      { ref: 'B', tipo_evento: 'error', dry_run: false, escrito: false, verificado: null, detectado_en: new Date('2026-10-29') }
    ]
  }));
  const mapa = await obtenerUltimoEventoPorRef();
  assert.equal(mapa.A.tipo_evento, 'reposicion_detectada');
  assert.equal(mapa.B.tipo_evento, 'error');
  assert.equal(mapa.C, undefined);
});
