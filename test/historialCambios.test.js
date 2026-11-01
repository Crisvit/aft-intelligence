const { test } = require('node:test');
const assert = require('node:assert/strict');
const { detectarCambios, registrarCambiosLote, consultarHistorial, normalizarFiltros } = require('../src/historialCambios');

const previos = (obj) => new Map(Object.entries(obj));
const nueva = (o) => ({ ref: 'A', costo: 10, pvp_sin_iva: 20, stock: 5, fecha_cambio_aft: null, ...o });

test('detectarCambios: sin diferencias no registra nada', () => {
  const r = detectarCambios(previos({ A: { costo: '10.00', pvp_sin_iva: '20.00', stock: 5 } }), [nueva()]);
  assert.deepEqual(r, []);
});

test('detectarCambios: coste, PVP y stock cambiados -> un registro por campo con anterior y nuevo', () => {
  const f = new Date('2026-10-30T08:00:00Z');
  const r = detectarCambios(
    previos({ A: { costo: '10.00', pvp_sin_iva: '20.00', stock: 5 } }),
    [nueva({ costo: 12.5, pvp_sin_iva: 22, stock: 0, fecha_cambio_aft: f })]
  );
  assert.deepEqual(r.map((c) => [c.campo, c.valor_anterior, c.valor_nuevo]), [
    ['costo', 10, 12.5], ['pvp_sin_iva', 20, 22], ['stock', 5, 0]
  ]);
  assert.ok(r.every((c) => c.ref === 'A' && c.fecha_cambio_aft === f));
});

test('detectarCambios: una referencia nueva (alta) NO es un cambio', () => {
  assert.deepEqual(detectarCambios(previos({}), [nueva()]), []);
});

test('detectarCambios: ignora diferencias de redondeo menores que medio céntimo', () => {
  const r = detectarCambios(previos({ A: { costo: '10.00', pvp_sin_iva: '20.00', stock: 5 } }), [nueva({ costo: 10.004, pvp_sin_iva: 20.001 })]);
  assert.deepEqual(r, []);
  const r2 = detectarCambios(previos({ A: { costo: '10.00', pvp_sin_iva: '20.00', stock: 5 } }), [nueva({ costo: 10.01 })]);
  assert.equal(r2.length, 1);
});

test('detectarCambios: valores ausentes o no numéricos no generan cambios', () => {
  const r = detectarCambios(
    previos({ A: { costo: null, pvp_sin_iva: '20.00', stock: 5 } }),
    [nueva({ costo: 99, pvp_sin_iva: null, stock: 'abc' })]
  );
  assert.deepEqual(r, []);
});

test('detectarCambios: stock negativo o cero es un valor real y sí se registra', () => {
  const r = detectarCambios(previos({ A: { costo: 10, pvp_sin_iva: 20, stock: 3 } }), [nueva({ stock: -2 })]);
  assert.deepEqual(r.map((c) => [c.campo, c.valor_anterior, c.valor_nuevo]), [['stock', 3, -2]]);
});

function clienteFalso(filasPrevias) {
  const llamadas = [];
  return {
    llamadas,
    query: async (sql, params) => {
      llamadas.push({ sql, params });
      if (/FROM aft_stock_precios/.test(sql)) return { rows: filasPrevias };
      if (/INSERT INTO aft_cambios/.test(sql)) return { rowCount: params.length / 6 };
      throw new Error('consulta inesperada: ' + sql);
    }
  };
}

test('registrarCambiosLote: inserta solo los cambios reales y devuelve cuántos', async () => {
  const c = clienteFalso([{ ref: 'A', costo: '10.00', pvp_sin_iva: '20.00', stock: 5 }, { ref: 'B', costo: '1.00', pvp_sin_iva: '2.00', stock: 1 }]);
  // formato de valoresStock: [ref, costo, pvp_sin_iva, stock, fecha]
  const n = await registrarCambiosLote(c, [['A', 10, 20, 4, null], ['B', 1, 2, 1, null], ['NUEVA', 5, 6, 7, null]], 42);
  assert.equal(n, 1);
  const insert = c.llamadas.find((x) => /INSERT INTO aft_cambios/.test(x.sql));
  assert.deepEqual(insert.params, ['A', 'stock', 5, 4, null, 42]);
  assert.match(insert.sql, /ON CONFLICT \(import_run_id, ref, campo\)/);
});

test('registrarCambiosLote: sin cambios no hace ningún INSERT', async () => {
  const c = clienteFalso([{ ref: 'A', costo: '10.00', pvp_sin_iva: '20.00', stock: 5 }]);
  const n = await registrarCambiosLote(c, [['A', 10, 20, 5, null]], 1);
  assert.equal(n, 0);
  assert.equal(c.llamadas.some((x) => /INSERT/.test(x.sql)), false);
});

test('registrarCambiosLote: solo lee aft_stock_precios y solo escribe en aft_cambios', async () => {
  const c = clienteFalso([{ ref: 'A', costo: '10.00', pvp_sin_iva: '20.00', stock: 5 }]);
  await registrarCambiosLote(c, [['A', 11, 20, 5, null]], null);
  for (const x of c.llamadas) {
    if (/^\s*(INSERT|UPDATE|DELETE)/i.test(x.sql)) assert.match(x.sql, /aft_cambios/);
  }
  // sin runId (script manual) guarda NULL, no inventa un id
  assert.equal(c.llamadas.find((x) => /INSERT/.test(x.sql)).params[5], null);
});

test('normalizarFiltros: acota límite, ignora fechas inválidas y marca campo inválido', () => {
  assert.equal(normalizarFiltros({ limite: '99999' }).limite, 500);
  assert.equal(normalizarFiltros({ limite: '0' }).limite, 50);
  assert.equal(normalizarFiltros({ offset: '-5' }).offset, 0);
  assert.equal(normalizarFiltros({ desde: 'no-es-fecha' }).desde, null);
  assert.equal(normalizarFiltros({ campo: 'precio' }).campoInvalido, true);
  assert.equal(normalizarFiltros({ campo: 'stock' }).campo, 'stock');
});

test('consultarHistorial: solo SELECT, todo parametrizado (sin inyección por ref/campo)', async () => {
  const llamadas = [];
  const pool = {
    query: async (sql, params) => {
      llamadas.push({ sql, params });
      return /COUNT/.test(sql) ? { rows: [{ total: 1 }] } : { rows: [{ id: 1, ref: "X'; DROP TABLE aft_cambios;--" }] };
    }
  };
  const r = await consultarHistorial(pool, { ref: "X'; DROP TABLE aft_cambios;--", campo: 'stock', desde: '2026-10-01', limite: '10' });
  assert.equal(r.total, 1);
  assert.equal(r.limite, 10);
  for (const x of llamadas) {
    assert.match(x.sql, /^\s*SELECT/i);
    assert.doesNotMatch(x.sql, /DROP TABLE/i);
  }
  assert.ok(llamadas[1].params.includes("X'; DROP TABLE aft_cambios;--"));
  assert.match(llamadas[1].sql, /ORDER BY h\.detectado_en DESC/);
});

test('consultarHistorial: un campo inválido falla con status 400 sin consultar la base', async () => {
  let consultas = 0;
  const pool = { query: async () => { consultas++; return { rows: [] }; } };
  await assert.rejects(() => consultarHistorial(pool, { campo: 'precio' }), (e) => e.status === 400 && /costo, pvp_sin_iva, stock/.test(e.message));
  assert.equal(consultas, 0);
});
