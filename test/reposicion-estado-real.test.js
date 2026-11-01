// Regresión de los 5 fallos operativos reportados sobre src/reposicion.js:
// 1) el pipeline podía acabar en status='success' con la escritura real en
//    dry run; 2) "actualizados" subía sin escribir nada de verdad en
//    Shopify; 3) un error de escritura individual no se reflejaba en el
//    resultado global; 4) las referencias con AFT=0 que Shopify sigue
//    mostrando disponible no se priorizaban; 5) no había desglose de
//    bloqueadas ni de la última sincronización EFECTIVA.
//
// Igual que test/reposicion-preview.test.js: pool.query, shopifyClient y
// shopifyWriteClient van mockeados por require.cache — nunca una base de
// datos ni una llamada real a Shopify, para que corra en CI sin ninguna de
// las dos. La corrección del SQL en sí (ORDER BY, filtros) se verifica
// aparte contra Postgres local con datos sintéticos.
const { test } = require('node:test');
const assert = require('node:assert/strict');

function instalarPoolMock({ candidatos = [], omitidos = 0 } = {}) {
  const dbPath = require.resolve('../src/db');
  const llamadas = { eventos: [], updatesFinales: [], updatesError: [], sqls: [] };
  let nextRunId = 1;
  require.cache[dbPath] = {
    id: dbPath, filename: dbPath, loaded: true,
    exports: {
      pool: {
        query: async (sqlCrudo, params = []) => {
          const sql = sqlCrudo.trim();
          llamadas.sqls.push(sql);
          if (/^INSERT INTO reposicion_runs/.test(sql)) return { rows: [{ id: nextRunId++ }] };
          if (/^INSERT INTO reposicion_eventos/.test(sql)) { llamadas.eventos.push(params); return {}; }
          if (/UPDATE reposicion_runs SET status='error'/.test(sql)) { llamadas.updatesError.push({ sql, params }); return {}; }
          if (/fase='done'/.test(sql) && /UPDATE reposicion_runs/.test(sql)) { llamadas.updatesFinales.push({ sql, params }); return {}; }
          if (/^UPDATE reposicion_runs/.test(sql)) return {}; // fase/dry_run intermedios
          if (/SELECT COUNT\(\*\)::int AS n/.test(sql)) return { rows: [{ n: omitidos }] };
          if (/FROM shopify_match/.test(sql)) return { rows: candidatos };
          throw new Error('Consulta inesperada en el mock de pool.query: ' + sql);
        }
      }
    }
  };
  return llamadas;
}

function instalarShopifyMock({ scopeOk = true, leer = async () => null, escribir = async () => ({}) } = {}) {
  const clientPath = require.resolve('../src/shopifyClient');
  require.cache[clientPath] = { id: clientPath, filename: clientPath, loaded: true, exports: { getShopifyToken: async () => 'tok-test' } };
  const writePath = require.resolve('../src/shopifyWriteClient');
  require.cache[writePath] = {
    id: writePath, filename: writePath, loaded: true,
    exports: { tieneScopeEscrituraInventario: async () => scopeOk, leerStockDisponible: leer, establecerStockDisponible: escribir }
  };
}

function instalarAlertasMock() {
  const path = require.resolve('../src/alertas');
  const llamadas = [];
  require.cache[path] = { id: path, filename: path, loaded: true, exports: { notificarFallo: async (arg) => { llamadas.push(arg); } } };
  return llamadas;
}

function cargarReposicionFresco() {
  delete require.cache[require.resolve('../src/reposicion')];
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

async function conEnv(vars, fn) {
  const anteriores = {};
  for (const k of Object.keys(vars)) { anteriores[k] = process.env[k]; process.env[k] = vars[k]; }
  try { return await fn(); }
  finally { for (const k of Object.keys(vars)) { if (anteriores[k] === undefined) delete process.env[k]; else process.env[k] = anteriores[k]; } }
}

// ---------------------------------------------------------------------------
// clasificarResultado — pura
// ---------------------------------------------------------------------------
test('clasificarResultado: sin_cambios cuando el tipo de evento ya era sin_cambios', () => {
  const { clasificarResultado } = require('../src/reposicion');
  assert.equal(clasificarResultado({ tipo: 'sin_cambios', escrito: false, verificado: null, error: false }), 'sin_cambios');
});

test('clasificarResultado: error cuando r.error es true', () => {
  const { clasificarResultado } = require('../src/reposicion');
  assert.equal(clasificarResultado({ tipo: 'error', escrito: false, verificado: null, error: true }), 'error');
});

test('[regresión del bug original] clasificarResultado: "actualizado" SOLO cuando escrito===true — nunca por haber calculado un cambio', () => {
  const { clasificarResultado } = require('../src/reposicion');
  assert.equal(clasificarResultado({ tipo: 'reposicion_detectada', escrito: true, verificado: true, error: false }), 'actualizado');
  // Escrito pero sin verificar todavía: sigue siendo una escritura real, no un cálculo.
  assert.equal(clasificarResultado({ tipo: 'reposicion_detectada', escrito: true, verificado: false, error: false }), 'actualizado');
  // El caso que causaba el bug: se calculó un cambio real (tipo distinto de sin_cambios) pero NUNCA se escribió (dry run).
  assert.equal(clasificarResultado({ tipo: 'reposicion_detectada', escrito: false, verificado: null, error: false }), 'simulado');
  assert.equal(clasificarResultado({ tipo: 'correccion_a_la_baja', escrito: false, verificado: null, error: false }), 'simulado');
});

// ---------------------------------------------------------------------------
// obtenerCandidatos — ORDER BY de prioridad (stock cero) + invariante
// ---------------------------------------------------------------------------
test('obtenerCandidatos: el SQL prioriza AFT=0 con Shopify todavía disponible, y protege el invariante stock_aft IS NOT NULL', async () => {
  const dbPath = require.resolve('../src/db');
  let sqlCapturado = null;
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { pool: { query: async (sql) => { sqlCapturado = sql; return { rows: [] }; } } } };
  const { obtenerCandidatos } = cargarReposicionFresco();
  await obtenerCandidatos();
  assert.match(sqlCapturado, /stock_aft IS NOT NULL/);
  assert.match(sqlCapturado, /WHEN stock_aft = 0 AND shopify_stock > 0 THEN 0 ELSE 1/);
  assert.match(sqlCapturado, /ORDER BY/);
});

// ---------------------------------------------------------------------------
// obtenerBloqueadosPorMotivo / obtenerUltimaReposicionEfectiva
// ---------------------------------------------------------------------------
test('obtenerBloqueadosPorMotivo: expone el desglose por motivo', async () => {
  const dbPath = require.resolve('../src/db');
  require.cache[dbPath] = {
    id: dbPath, filename: dbPath, loaded: true,
    exports: { pool: { query: async () => ({ rows: [{ duplicado: 2, multiples_ubicaciones: 1, ubicacion_no_encontrada: 0, bloqueo_manual: 1, sin_match_fiable: 3, sin_inventory_item_id: 0, sin_stock_shopify: 0, sin_stock_aft: 4, stock_aft_negativo: 0 }] }) } }
  };
  const { obtenerBloqueadosPorMotivo } = cargarReposicionFresco();
  const r = await obtenerBloqueadosPorMotivo();
  assert.equal(r.duplicado, 2);
  assert.equal(r.sin_stock_aft, 4);
  assert.equal(r.bloqueo_manual, 1);
});

test('obtenerUltimaReposicionEfectiva: filtra por dry_run=false y actualizados>0 — nunca una simulación', async () => {
  const dbPath = require.resolve('../src/db');
  let sqlCapturado = null;
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { pool: { query: async (sql) => { sqlCapturado = sql; return { rows: [{ id: 7, actualizados: 3 }] }; } } } };
  const { obtenerUltimaReposicionEfectiva } = cargarReposicionFresco();
  const r = await obtenerUltimaReposicionEfectiva();
  assert.match(sqlCapturado, /dry_run = false/);
  assert.match(sqlCapturado, /actualizados > 0/);
  assert.equal(r.id, 7);
});

test('obtenerUltimaReposicionEfectiva: null cuando nunca hubo una sincronización real efectiva', async () => {
  const dbPath = require.resolve('../src/db');
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { pool: { query: async () => ({ rows: [] }) } } };
  const { obtenerUltimaReposicionEfectiva } = cargarReposicionFresco();
  assert.equal(await obtenerUltimaReposicionEfectiva(), null);
});

// ---------------------------------------------------------------------------
// ejecutarReposicionStock — contadores, status, alertas (con mocks completos)
// ---------------------------------------------------------------------------
test('[regresión del bug original] dry run: "actualizados" se queda en 0 aunque haya diferencias reales — "simulados" las cuenta aparte', async () => {
  await conEnv({ SHOPIFY_WRITE_ENABLED: 'false' }, async () => {
    instalarAlertasMock();
    instalarShopifyMock({});
    instalarPoolMock({
      candidatos: [
        filaCandidato({ ref: 'A', shopify_stock: 0, stock_aft: 5 }),
        filaCandidato({ ref: 'B', shopify_stock: 10, stock_aft: 3 })
      ]
    });
    const { ejecutarReposicionStock } = cargarReposicionFresco();
    const r = await ejecutarReposicionStock();
    assert.equal(r.dryRun, true);
    assert.equal(r.actualizados, 0);
    assert.equal(r.simulados, 2);
    assert.equal(r.status, 'success');
  });
});

test('ejecutarReposicionStock: SHOPIFY_WRITE_ENABLED=true pero sin scope write_inventory -> cae a dry run, sin contar "actualizados"', async () => {
  await conEnv({ SHOPIFY_WRITE_ENABLED: 'true' }, async () => {
    instalarAlertasMock();
    const escrituras = [];
    instalarShopifyMock({ scopeOk: false, leer: async () => 2, escribir: async (t, a) => { escrituras.push(a); return {}; } });
    instalarPoolMock({ candidatos: [filaCandidato({ ref: 'S', shopify_stock: 2, stock_aft: 9 })] });
    const { ejecutarReposicionStock } = cargarReposicionFresco();
    const r = await ejecutarReposicionStock();
    assert.equal(r.dryRun, true);
    assert.equal(escrituras.length, 0);
    assert.equal(r.actualizados, 0);
    assert.equal(r.simulados, 1);
    assert.equal(r.status, 'success');
  });
});

test('ejecutarReposicionStock: SHOPIFY_WRITE_UNA_REF_ENABLED=true NO activa el lote completo (gates independientes)', async () => {
  await conEnv({ SHOPIFY_WRITE_ENABLED: 'false', SHOPIFY_WRITE_UNA_REF_ENABLED: 'true' }, async () => {
    instalarAlertasMock();
    const escrituras = [];
    instalarShopifyMock({ scopeOk: true, leer: async () => 2, escribir: async (t, a) => { escrituras.push(a); return {}; } });
    instalarPoolMock({ candidatos: [filaCandidato({ ref: 'BATCH', shopify_stock: 2, stock_aft: 9 })] });
    const { ejecutarReposicionStock } = cargarReposicionFresco();
    const r = await ejecutarReposicionStock();
    assert.equal(r.dryRun, true);
    assert.equal(escrituras.length, 0);
  });
});

test('ejecutarReposicionStock: usa el stock LEÍDO EN VIVO (no el snapshot) como base del compare-and-set y de la clasificación', async () => {
  await conEnv({ SHOPIFY_WRITE_ENABLED: 'true' }, async () => {
    instalarAlertasMock();
    let llamadasLeer = 0;
    const escrituras = [];
    instalarShopifyMock({
      scopeOk: true,
      // El snapshot de la última sync dice shopify_stock=5, pero en vivo (justo
      // antes de escribir) ya está a 0 — una venta ocurrida después de la sync.
      leer: async () => { llamadasLeer++; return llamadasLeer === 1 ? 0 : 7; },
      escribir: async (t, a) => { escrituras.push(a); return {}; }
    });
    instalarPoolMock({ candidatos: [filaCandidato({ ref: 'X', shopify_stock: 5, stock_aft: 7 })] });
    const { ejecutarReposicionStock } = cargarReposicionFresco();
    const r = await ejecutarReposicionStock();
    assert.equal(escrituras.length, 1);
    assert.equal(escrituras[0].cantidadEsperadaActual, 0, 'la base del compare-and-set debe ser el valor EN VIVO, no el snapshot (5)');
    assert.equal(r.recuperados_stock_cero, 1, 'con el valor en vivo (0->7) es un producto recuperado de stock cero, no lo que saldría del snapshot (5->7)');
    assert.equal(r.actualizados, 1);
  });
});

test('ejecutarReposicionStock: si la lectura en vivo ya coincide con AFT, no escribe (aunque el snapshot decía que había diferencia)', async () => {
  await conEnv({ SHOPIFY_WRITE_ENABLED: 'true' }, async () => {
    instalarAlertasMock();
    const escrituras = [];
    instalarShopifyMock({ scopeOk: true, leer: async () => 9, escribir: async (t, a) => { escrituras.push(a); return {}; } });
    instalarPoolMock({ candidatos: [filaCandidato({ ref: 'Y', shopify_stock: 2, stock_aft: 9 })] });
    const { ejecutarReposicionStock } = cargarReposicionFresco();
    const r = await ejecutarReposicionStock();
    assert.equal(escrituras.length, 0);
    assert.equal(r.sin_cambios, 1);
    assert.equal(r.actualizados, 0);
    assert.equal(r.status, 'success');
  });
});

test('ejecutarReposicionStock: si la lectura en vivo previa no encuentra el item/ubicación, NO escribe y lo cuenta como error (nunca inventa un "antes")', async () => {
  await conEnv({ SHOPIFY_WRITE_ENABLED: 'true' }, async () => {
    const alertas = instalarAlertasMock();
    const escrituras = [];
    instalarShopifyMock({ scopeOk: true, leer: async () => null, escribir: async (t, a) => { escrituras.push(a); return {}; } });
    instalarPoolMock({ candidatos: [filaCandidato({ ref: 'Z', shopify_stock: 2, stock_aft: 9 })] });
    const { ejecutarReposicionStock } = cargarReposicionFresco();
    const r = await ejecutarReposicionStock();
    assert.equal(escrituras.length, 0);
    assert.equal(r.errores, 1);
    assert.equal(r.actualizados, 0);
    assert.equal(r.status, 'parcial');
    assert.equal(alertas.length, 1);
  });
});

test('[regresión del bug original] ejecutarReposicionStock: un error real al escribir NO se oculta bajo status success — pasa a "parcial" y dispara alerta', async () => {
  await conEnv({ SHOPIFY_WRITE_ENABLED: 'true' }, async () => {
    const alertas = instalarAlertasMock();
    instalarShopifyMock({ scopeOk: true, leer: async () => 2, escribir: async () => { throw new Error('Shopify 429 Too Many Requests'); } });
    instalarPoolMock({ candidatos: [filaCandidato({ ref: 'E', shopify_stock: 2, stock_aft: 9 })] });
    const { ejecutarReposicionStock } = cargarReposicionFresco();
    const r = await ejecutarReposicionStock();
    assert.equal(r.status, 'parcial');
    assert.equal(r.errores, 1);
    assert.equal(r.actualizados, 0);
    assert.equal(alertas.length, 1);
    assert.match(alertas[0].mensaje, /error/);
  });
});

test('ejecutarReposicionStock: escritura confirmada pero verificación posterior no coincide -> cuenta como actualizado y marca verificaciones_fallidas + status parcial', async () => {
  await conEnv({ SHOPIFY_WRITE_ENABLED: 'true' }, async () => {
    const alertas = instalarAlertasMock();
    let n = 0;
    instalarShopifyMock({ scopeOk: true, leer: async () => { n++; return n === 1 ? 2 : 99; }, escribir: async () => ({}) });
    instalarPoolMock({ candidatos: [filaCandidato({ ref: 'V', shopify_stock: 2, stock_aft: 9 })] });
    const { ejecutarReposicionStock } = cargarReposicionFresco();
    const r = await ejecutarReposicionStock();
    assert.equal(r.actualizados, 1, 'la escritura sí ocurrió de verdad, así que cuenta como actualizado');
    assert.equal(r.verificaciones_fallidas, 1);
    assert.equal(r.status, 'parcial');
    assert.equal(alertas.length, 1);
  });
});

// ---------------------------------------------------------------------------
// ejecutarReposicionUnaReferencia — misma clasificación compartida
// ---------------------------------------------------------------------------
test('ejecutarReposicionUnaReferencia: con su gate propio activo escribe de verdad y reusa la misma clasificación de resultado que el lote', async () => {
  await conEnv({ SHOPIFY_WRITE_ENABLED: 'false', SHOPIFY_WRITE_UNA_REF_ENABLED: 'true' }, async () => {
    instalarAlertasMock();
    let n = 0;
    const escrituras = [];
    instalarShopifyMock({ scopeOk: true, leer: async () => { n++; return n === 1 ? 2 : 9; }, escribir: async (t, a) => { escrituras.push(a); return {}; } });
    instalarPoolMock({ candidatos: [filaCandidato({ ref: 'UNA', shopify_stock: 2, stock_aft: 9 })] });
    const { ejecutarReposicionUnaReferencia } = cargarReposicionFresco();
    const r = await ejecutarReposicionUnaReferencia('UNA', 'tester');
    assert.equal(escrituras.length, 1);
    assert.equal(r.escrito, true);
    assert.equal(r.verificado, true);
    assert.equal(r.status, 'success');
    assert.equal(r.dryRun, false);
  });
});

test('[regresión del bug original] ejecutarReposicionUnaReferencia: un error de escritura pasa a "parcial" y dispara alerta — nunca success', async () => {
  await conEnv({ SHOPIFY_WRITE_ENABLED: 'false', SHOPIFY_WRITE_UNA_REF_ENABLED: 'true' }, async () => {
    const alertas = instalarAlertasMock();
    instalarShopifyMock({ scopeOk: true, leer: async () => 2, escribir: async () => { throw new Error('Shopify caído'); } });
    instalarPoolMock({ candidatos: [filaCandidato({ ref: 'UNA2', shopify_stock: 2, stock_aft: 9 })] });
    const { ejecutarReposicionUnaReferencia } = cargarReposicionFresco();
    const r = await ejecutarReposicionUnaReferencia('UNA2', 'tester');
    assert.equal(r.status, 'parcial');
    assert.equal(r.error, true);
    assert.equal(alertas.length, 1);
  });
});
