// Prueba las dos piezas añadidas para verificar SHOPIFY_MAIN_LOCATION_ID
// antes de activar escritura real:
//  1. obtenerVerificacionUbicacionPrincipal() (src/reposicion.js) — usa SOLO
//     datos ya leídos en la última sincronización (shopify_match), nunca
//     llama a Shopify.
//  2. listarUbicaciones() (src/shopifyClient.js) — lectura en vivo,
//     tolerante a la falta del scope read_locations.
const { test } = require('node:test');
const assert = require('node:assert/strict');

function cargarReposicionFresco() {
  delete require.cache[require.resolve('../src/reposicion')];
  return require('../src/reposicion');
}

function cargarShopifyClientFresco() {
  delete require.cache[require.resolve('../src/shopifyClient')];
  return require('../src/shopifyClient');
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

// ---------------------------------------------------------------------------
// obtenerVerificacionUbicacionPrincipal
// ---------------------------------------------------------------------------
test('obtenerVerificacionUbicacionPrincipal: consulta shopify_match, nunca llama a fetch/Shopify', async () => {
  const dbPath = require.resolve('../src/db');
  let sqlCapturado = null;
  require.cache[dbPath] = {
    id: dbPath, filename: dbPath, loaded: true,
    exports: {
      pool: {
        query: async (sql) => {
          sqlCapturado = sql;
          return { rows: [{ total_coincidencias: 100, ubicacion_encontrada: 97, ubicacion_no_encontrada: 3, multiples_ubicaciones: 1 }] };
        }
      }
    }
  };
  let fetchLlamado = false;
  await conFetchMock(async () => { fetchLlamado = true; return { ok: true, json: async () => ({}) }; }, async () => {
    const { obtenerVerificacionUbicacionPrincipal } = cargarReposicionFresco();
    const r = await obtenerVerificacionUbicacionPrincipal();
    assert.match(sqlCapturado, /FROM shopify_match/);
    assert.equal(r.totalCoincidencias, 100);
    assert.equal(r.ubicacionEncontrada, 97);
    assert.equal(r.ubicacionNoEncontrada, 3);
    assert.equal(r.probablementeIncorrecto, false);
  });
  assert.equal(fetchLlamado, false, 'no debe llamar a fetch/Shopify — solo usa datos ya guardados en Postgres');
});

test('obtenerVerificacionUbicacionPrincipal: probablementeIncorrecto=true cuando hay coincidencias pero NINGUNA encuentra la ubicación', async () => {
  const dbPath = require.resolve('../src/db');
  require.cache[dbPath] = {
    id: dbPath, filename: dbPath, loaded: true,
    exports: { pool: { query: async () => ({ rows: [{ total_coincidencias: 50, ubicacion_encontrada: 0, ubicacion_no_encontrada: 50, multiples_ubicaciones: 0 }] }) } }
  };
  const { obtenerVerificacionUbicacionPrincipal } = cargarReposicionFresco();
  const r = await obtenerVerificacionUbicacionPrincipal();
  assert.equal(r.probablementeIncorrecto, true);
});

test('obtenerVerificacionUbicacionPrincipal: probablementeIncorrecto=false cuando todavía no hay ninguna coincidencia (nunca se sincronizó)', async () => {
  const dbPath = require.resolve('../src/db');
  require.cache[dbPath] = {
    id: dbPath, filename: dbPath, loaded: true,
    exports: { pool: { query: async () => ({ rows: [{ total_coincidencias: 0, ubicacion_encontrada: 0, ubicacion_no_encontrada: 0, multiples_ubicaciones: 0 }] }) } }
  };
  const { obtenerVerificacionUbicacionPrincipal } = cargarReposicionFresco();
  const r = await obtenerVerificacionUbicacionPrincipal();
  assert.equal(r.probablementeIncorrecto, false, 'sin datos todavía no se puede concluir que está mal configurada');
});

// ---------------------------------------------------------------------------
// listarUbicaciones
// ---------------------------------------------------------------------------
test('listarUbicaciones: devuelve la lista real cuando la app tiene el scope read_locations', async () => {
  await conFetchMock(async () => ({
    ok: true,
    json: async () => ({ data: { locations: { edges: [
      { node: { id: 'gid://shopify/Location/1', name: 'Almacén principal', isActive: true } },
      { node: { id: 'gid://shopify/Location/2', name: 'Tienda física', isActive: false } }
    ] } } })
  }), async () => {
    const { listarUbicaciones } = cargarShopifyClientFresco();
    const r = await listarUbicaciones('tok');
    assert.equal(r.permisoConcedido, true);
    assert.equal(r.ubicaciones.length, 2);
    assert.equal(r.ubicaciones[0].id, 'gid://shopify/Location/1');
  });
});

test('listarUbicaciones: sin el scope read_locations lo indica explícitamente, no lanza ni devuelve una lista vacía engañosa', async () => {
  await conFetchMock(async () => ({
    ok: true,
    json: async () => ({ errors: [{ message: 'Access denied for locations field.', extensions: { code: 'ACCESS_DENIED' } }] })
  }), async () => {
    const { listarUbicaciones } = cargarShopifyClientFresco();
    const r = await listarUbicaciones('tok');
    assert.equal(r.permisoConcedido, false);
    assert.deepEqual(r.ubicaciones, []);
  });
});

test('listarUbicaciones: un error real de Shopify (no de permisos) sigue lanzando', async () => {
  await conFetchMock(async () => ({
    ok: true,
    json: async () => ({ errors: [{ message: 'Something else went wrong' }] })
  }), async () => {
    const { listarUbicaciones } = cargarShopifyClientFresco();
    await assert.rejects(() => listarUbicaciones('tok'), /Shopify GraphQL errors/);
  });
});
