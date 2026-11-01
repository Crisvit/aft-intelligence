const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  detectarCambios, registrarCambiosLote, consultarHistorial, normalizarFiltros,
  pctVariacion, esAlertaSubidaCoste, filtrarAlertasSubidaCoste, listarAlertasSubidaCoste,
  fechaCorteRetencion, contarPendientesDeRetencion, UMBRAL_ALERTA_COSTE_PCT, RETENCION_MESES
} = require('../src/historialCambios');

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

// --- [alertas] subida de coste >=10% (configurable) ---

test('pctVariacion: calcula el % sobre el valor anterior; null sin base real', () => {
  assert.equal(pctVariacion(10, 11), 10);
  assert.equal(pctVariacion(10, 12.5), 25);
  assert.equal(pctVariacion(10, 9), -10);
  assert.equal(pctVariacion(0, 50), null); // sin base real: nunca se inventa un porcentaje
  assert.equal(pctVariacion(null, 50), null);
  assert.equal(pctVariacion(10, null), null);
});

test('esAlertaSubidaCoste: solo el campo "costo" genera alerta, nunca PVP ni stock', () => {
  assert.equal(esAlertaSubidaCoste({ campo: 'costo', valor_anterior: 10, valor_nuevo: 11 }, 10), true); // exactamente 10%
  assert.equal(esAlertaSubidaCoste({ campo: 'costo', valor_anterior: 10, valor_nuevo: 10.5 }, 10), false); // 5%, por debajo
  assert.equal(esAlertaSubidaCoste({ campo: 'pvp_sin_iva', valor_anterior: 10, valor_nuevo: 20 }, 10), false);
  assert.equal(esAlertaSubidaCoste({ campo: 'stock', valor_anterior: 10, valor_nuevo: 20 }, 10), false);
});

test('esAlertaSubidaCoste: una bajada de coste nunca es alerta', () => {
  assert.equal(esAlertaSubidaCoste({ campo: 'costo', valor_anterior: 10, valor_nuevo: 5 }, 10), false);
});

test('esAlertaSubidaCoste: respeta un umbral distinto del por defecto', () => {
  const cambio = { campo: 'costo', valor_anterior: 100, valor_nuevo: 115 }; // +15%
  assert.equal(esAlertaSubidaCoste(cambio, 10), true);
  assert.equal(esAlertaSubidaCoste(cambio, 20), false);
});

test('UMBRAL_ALERTA_COSTE_PCT por defecto es 10 y RETENCION_MESES por defecto es 12', () => {
  assert.equal(UMBRAL_ALERTA_COSTE_PCT, 10);
  assert.equal(RETENCION_MESES, 12);
});

test('filtrarAlertasSubidaCoste: filtra y adjunta variacion_pct, descarta PVP/stock y bajadas', () => {
  const cambios = [
    { ref: 'A', campo: 'costo', valor_anterior: 10, valor_nuevo: 12 }, // +20% -> alerta
    { ref: 'B', campo: 'costo', valor_anterior: 10, valor_nuevo: 10.5 }, // +5% -> no
    { ref: 'C', campo: 'pvp_sin_iva', valor_anterior: 10, valor_nuevo: 20 }, // +100% pero no es coste
    { ref: 'D', campo: 'costo', valor_anterior: 10, valor_nuevo: 8 } // bajada
  ];
  const r = filtrarAlertasSubidaCoste(cambios, 10);
  assert.deepEqual(r.map((c) => c.ref), ['A']);
  assert.equal(r[0].variacion_pct, 20);
});

test('listarAlertasSubidaCoste: consulta solo cambios de coste y aplica el umbral, limitando el resultado', async () => {
  const llamadas = [];
  const pool = {
    query: async (sql, params) => {
      llamadas.push({ sql, params });
      return {
        rows: [
          { id: 1, ref: 'A', marca: 'Wolfpack', descripcion: 'Taladro', campo: 'costo', valor_anterior: 10, valor_nuevo: 12, detectado_en: '2026-10-30T10:00:00Z' },
          { id: 2, ref: 'B', marca: 'Truper', descripcion: 'Llave', campo: 'costo', valor_anterior: 10, valor_nuevo: 10.2, detectado_en: '2026-10-29T10:00:00Z' }
        ]
      };
    }
  };
  const r = await listarAlertasSubidaCoste(pool, { limite: 5, ventana: 100, umbralPct: 10 });
  assert.equal(r.length, 1);
  assert.equal(r[0].ref, 'A');
  assert.match(llamadas[0].sql, /WHERE h\.campo = 'costo'/);
  assert.equal(llamadas[0].params[0], 100); // ventana como límite de la consulta SQL
});

// --- [retención] política definida (12 meses), SOLO LECTURA, nunca borra ---

test('fechaCorteRetencion: resta exactamente los meses indicados', () => {
  const ahora = new Date('2026-11-01T12:00:00Z');
  const corte = fechaCorteRetencion(ahora, 12);
  assert.equal(corte.toISOString(), '2025-11-01T12:00:00.000Z');
  const corte6 = fechaCorteRetencion(ahora, 6);
  assert.equal(corte6.toISOString(), '2026-05-01T12:00:00.000Z');
});

test('contarPendientesDeRetencion: es una consulta de SOLO LECTURA (ningún DELETE), nunca purga nada', async () => {
  const llamadas = [];
  const pool = {
    query: async (sql, params) => {
      llamadas.push({ sql, params });
      return { rows: [{ total: 7 }] };
    }
  };
  const r = await contarPendientesDeRetencion(pool, 12);
  assert.equal(r.meses, 12);
  assert.equal(r.pendientesDePurga, 7);
  assert.equal(llamadas.length, 1);
  assert.match(llamadas[0].sql, /^\s*SELECT COUNT/i);
  assert.doesNotMatch(llamadas[0].sql, /DELETE/i);
});

test('contarPendientesDeRetencion: usa RETENCION_MESES (12) cuando no se especifica', async () => {
  const pool = {
    query: async (sql, params) => {
      // El corte debe corresponder a ~12 meses atrás, no a un valor arbitrario.
      assert.ok(params[0]);
      return { rows: [{ total: 0 }] };
    }
  };
  const r = await contarPendientesDeRetencion(pool);
  assert.equal(r.meses, 12);
});
