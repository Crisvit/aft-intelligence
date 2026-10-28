// Prueba previsualizarReposicion() con src/db mockeado (pool.query
// interceptado por texto de la consulta) — nunca una base de datos real,
// para que corra en CI sin Postgres. La corrección del propio SQL (filtro
// de fiabilidad, JOIN, columnas) se valida aparte contra Postgres local
// con datos sintéticos, como el resto de este proyecto.
const { test } = require('node:test');
const assert = require('node:assert/strict');

function instalarPoolMock({ sincRow, candidatos }) {
  const dbPath = require.resolve('../src/db');
  require.cache[dbPath] = {
    id: dbPath,
    filename: dbPath,
    loaded: true,
    exports: {
      pool: {
        query: async (sql) => {
          if (/FROM sync_runs/.test(sql)) return { rows: sincRow ? [sincRow] : [] };
          if (/FROM shopify_match/.test(sql)) return { rows: candidatos };
          throw new Error('Consulta inesperada en el mock de pool.query: ' + sql);
        }
      }
    }
  };
}

function cargarReposicionFresco() {
  delete require.cache[require.resolve('../src/reposicion')];
  delete require.cache[require.resolve('../src/shopifyClient')];
  delete require.cache[require.resolve('../src/shopifyWriteClient')];
  return require('../src/reposicion');
}

function filaCandidato(overrides) {
  return {
    ref: 'REF', ean: 'EAN', marca: 'MARCA', shopify_variant_id: 'gid://v/1', shopify_inventory_item_id: 'gid://inv/1',
    shopify_stock: 5, stock_aft: 5, shopify_product_title: 'Producto', matched_by: 'ean', estado: 'cambiaria',
    checked_at: new Date('2026-10-28T09:00:00Z'),
    alerta_duplicado: false, alerta_multiples_ubicaciones: false, alerta_ubicacion_no_encontrada: false, bloquear_escritura: false,
    ...overrides
  };
}

test('previsualizarReposicion: sin sync_runs -> datosDesactualizados=true y ultimaSync null', async () => {
  instalarPoolMock({ sincRow: null, candidatos: [] });
  const { previsualizarReposicion } = cargarReposicionFresco();
  const r = await previsualizarReposicion();
  assert.equal(r.datosDesactualizados, true);
  assert.equal(r.ultimaSync, null);
  assert.equal(r.candidatos.length, 0);
});

test('previsualizarReposicion: excluye candidatos sin diferencia de stock real', async () => {
  instalarPoolMock({
    sincRow: { finished_at: new Date(), status: 'success' },
    candidatos: [
      filaCandidato({ ref: 'SIN-DIF', shopify_stock: 5, stock_aft: 5 }), // solo cambió el precio, no el stock
      filaCandidato({ ref: 'CON-DIF', shopify_stock: 5, stock_aft: 8 })
    ]
  });
  const { previsualizarReposicion } = cargarReposicionFresco();
  const r = await previsualizarReposicion();
  assert.equal(r.totalCandidatosFiables, 2);
  assert.equal(r.totalConDiferencia, 1);
  assert.equal(r.candidatos.length, 1);
  assert.equal(r.candidatos[0].ref, 'CON-DIF');
});

test('previsualizarReposicion: ordena por menor diferencia absoluta de stock', async () => {
  instalarPoolMock({
    sincRow: { finished_at: new Date(), status: 'success' },
    candidatos: [
      filaCandidato({ ref: 'DIF-GRANDE', shopify_stock: 0, stock_aft: 40 }),
      filaCandidato({ ref: 'DIF-PEQUENA', shopify_stock: 10, stock_aft: 11 }),
      filaCandidato({ ref: 'DIF-MEDIA', shopify_stock: 3, stock_aft: 8 })
    ]
  });
  const { previsualizarReposicion } = cargarReposicionFresco();
  const r = await previsualizarReposicion();
  assert.deepEqual(r.candidatos.map((c) => c.ref), ['DIF-PEQUENA', 'DIF-MEDIA', 'DIF-GRANDE']);
});

test('previsualizarReposicion: respeta el límite y lo acota entre 1 y 50', async () => {
  const candidatos = [];
  for (let i = 0; i < 20; i++) candidatos.push(filaCandidato({ ref: 'REF-' + i, shopify_stock: 10, stock_aft: 10 + i + 1 }));
  instalarPoolMock({ sincRow: { finished_at: new Date(), status: 'success' }, candidatos });
  const { previsualizarReposicion } = cargarReposicionFresco();

  assert.equal((await previsualizarReposicion()).candidatos.length, 10); // por defecto
  assert.equal((await previsualizarReposicion(3)).candidatos.length, 3);
  assert.equal((await previsualizarReposicion(999)).candidatos.length, 20); // acotado por el propio universo, el tope es 50
  // 0 es falsy en JS, así que "limite=0" se trata igual que "sin definir"
  // (mismo criterio que ya usa GET /api/pipeline-run/historial) -> por defecto 10.
  assert.equal((await previsualizarReposicion(0)).candidatos.length, 10);
  assert.equal((await previsualizarReposicion(-5)).candidatos.length, 1); // negativo real -> se acota al mínimo
});

test('previsualizarReposicion: cada candidato trae nombre, EAN, matchedBy, ubicación verificada y "No verificado" para reservas', async () => {
  instalarPoolMock({
    sincRow: { finished_at: new Date(), status: 'success' },
    candidatos: [filaCandidato({
      ref: 'REF-1', ean: 'EAN-1', shopify_product_title: 'Taladro X', matched_by: 'sku',
      shopify_stock: 4, stock_aft: 9
    })]
  });
  const { previsualizarReposicion } = cargarReposicionFresco();
  const r = await previsualizarReposicion();
  const c = r.candidatos[0];
  assert.equal(c.nombre, 'Taladro X');
  assert.equal(c.ean, 'EAN-1');
  assert.equal(c.matchedBy, 'sku');
  assert.equal(c.stockAft, 9);
  assert.equal(c.stockShopify, 4);
  assert.equal(c.diferencia, 5);
  assert.equal(c.tipoEvento, 'reposicion_detectada');
  assert.equal(c.ubicacionVerificada, true);
  assert.deepEqual(c.alertas, { duplicado: false, multiplesUbicaciones: false, ubicacionNoEncontrada: false, bloqueado: false });
  // Nunca "sin riesgo": el sistema no comprueba reservas/pedidos pendientes.
  assert.equal(c.reservasPendientes, 'No verificado');
});

test('previsualizarReposicion: datosDesactualizados=true cuando la última sync tiene más de 26 horas', async () => {
  const hace30h = new Date(Date.now() - 30 * 3600 * 1000);
  instalarPoolMock({ sincRow: { finished_at: hace30h, status: 'success' }, candidatos: [] });
  const { previsualizarReposicion } = cargarReposicionFresco();
  const r = await previsualizarReposicion();
  assert.equal(r.datosDesactualizados, true);
  assert.equal(r.horasLimiteDesactualizado, 26);
});

test('previsualizarReposicion: datosDesactualizados=false cuando la última sync es reciente', async () => {
  const hace2h = new Date(Date.now() - 2 * 3600 * 1000);
  instalarPoolMock({ sincRow: { finished_at: hace2h, status: 'success' }, candidatos: [] });
  const { previsualizarReposicion } = cargarReposicionFresco();
  const r = await previsualizarReposicion();
  assert.equal(r.datosDesactualizados, false);
});

test('previsualizarReposicion: expone la ubicación de escritura configurada', async () => {
  instalarPoolMock({ sincRow: { finished_at: new Date(), status: 'success' }, candidatos: [] });
  const { previsualizarReposicion } = cargarReposicionFresco();
  const r = await previsualizarReposicion();
  assert.equal(typeof r.ubicacionConfigurada, 'string');
  assert.match(r.ubicacionConfigurada, /^gid:\/\/shopify\/Location\//);
});

test('previsualizarReposicion: nunca escribe — pool.query solo recibe SELECT (sin INSERT/UPDATE)', async () => {
  const consultas = [];
  const dbPath = require.resolve('../src/db');
  require.cache[dbPath] = {
    id: dbPath, filename: dbPath, loaded: true,
    exports: {
      pool: {
        query: async (sql) => {
          consultas.push(sql);
          if (/FROM sync_runs/.test(sql)) return { rows: [] };
          if (/FROM shopify_match/.test(sql)) return { rows: [] };
          throw new Error('Consulta inesperada: ' + sql);
        }
      }
    }
  };
  const { previsualizarReposicion } = cargarReposicionFresco();
  await previsualizarReposicion();
  assert.equal(consultas.length, 2);
  consultas.forEach((sql) => {
    assert.match(sql.trim(), /^SELECT/i);
    assert.doesNotMatch(sql, /INSERT|UPDATE|DELETE/i);
  });
});
