// Integración de ejecutarAnalisisOportunidades() con src/db mockeado: comprueba
// que el Score v3 y el filtro de candidatos se guardan junto al score
// existente, sin tocar Shopify ni AFT y sin ninguna escritura fuera de las
// tablas propias de oportunidades.
const { test } = require('node:test');
const assert = require('node:assert/strict');

function instalarPoolMock(filas) {
  const llamadas = [];
  const dbPath = require.resolve('../src/db');
  require.cache[dbPath] = {
    id: dbPath, filename: dbPath, loaded: true,
    exports: {
      pool: {
        query: async (sql, params) => {
          llamadas.push({ sql, params });
          if (/INSERT INTO oportunidades_runs/.test(sql)) return { rows: [{ id: 7 }] };
          if (/FROM shopify_match sm/.test(sql)) return { rows: filas };
          return { rows: [] };
        }
      }
    }
  };
  return llamadas;
}

function cargarFresco() {
  for (const m of ['../src/oportunidades', '../src/sync', '../src/aftClient', '../src/shopifyClient']) {
    try { delete require.cache[require.resolve(m)]; } catch (e) { /* ignorar */ }
  }
  return require('../src/oportunidades');
}

function filaBd(o) {
  return {
    ref: 'R1', ean: '1', marca: 'WOLFPACK', descripcion: 'Amoladora 900W', categoria_nombre: 'AMOLADORAS', portes: null,
    stock: 20, precio: 100, coste: 60, margenPct: 40, volumenDemanda: null, ...o
  };
}

test('guarda score v3, candidatos y motivos; las referencias descartadas NO se eliminan', async () => {
  const llamadas = instalarPoolMock([
    filaBd({ ref: 'OK1' }),
    filaBd({ ref: 'POCO', stock: 3 }),
    filaBd({ ref: 'ACC', descripcion: 'Cadena para motosierra' })
  ]);
  const { ejecutarAnalisisOportunidades } = cargarFresco();
  const r = await ejecutarAnalisisOportunidades();
  assert.equal(r.totalCandidatos, 3);
  assert.equal(r.guardados, 3);

  const insert = llamadas.find((c) => /INSERT INTO oportunidades_resultados/.test(c.sql));
  assert.ok(insert, 'debe insertar resultados');
  assert.match(insert.sql, /score_v3/);
  assert.match(insert.sql, /es_candidato/);
  assert.match(insert.sql, /motivo_descarte/);

  const NCOLS = 21;
  const fila = (i) => insert.params.slice(i * NCOLS, (i + 1) * NCOLS);
  const COLS = ['ref', 'ean', 'marca', 'descripcion', 'categoria_nombre', 'stock_aft', 'coste', 'portes_proveedor_aft',
    'pvp_recomendado', 'margen_pct', 'es_marca_prioritaria', 'es_candidato_complementario', 'score', 'motivo',
    'score_v3', 'score_v3_cobertura', 'score_v3_etiqueta', 'score_v3_detalle', 'es_candidato', 'motivo_descarte', 'ranking_categoria'];
  const por = {};
  for (let i = 0; i < 3; i++) {
    const f = fila(i);
    por[f[0]] = Object.fromEntries(COLS.map((c, k) => [c, f[k]]));
  }

  assert.equal(por.OK1.es_candidato, true);
  assert.equal(por.POCO.es_candidato, false);
  assert.match(por.POCO.motivo_descarte, /stock AFT 3 uds\. < mínimo 10/);
  assert.equal(por.ACC.es_candidato, false);
  assert.match(por.ACC.motivo_descarte, /CADENA PARA/);

  // el score existente sigue calculándose igual: 40 (marca) + 32 (margen 40/50 de 40) + 20 (stock satura) = 92
  assert.equal(por.OK1.score, 92);

  // v3: demanda y competitividad «Sin datos» (volumenDemanda null), jamás valores neutros
  const detalle = JSON.parse(por.OK1.score_v3_detalle);
  assert.equal(detalle.componentes.demanda.puntos, null);
  assert.equal(detalle.componentes.competitividad.puntos, null);
  assert.equal(detalle.componentes.demanda.estado, 'Sin datos');
  assert.equal(por.OK1.score_v3_cobertura, 0.55);
  assert.equal(por.OK1.score_v3_etiqueta, 'Analizar');
});

test('una demanda verificada en demanda_resultados llega al score v3 como dato real', async () => {
  const llamadas = instalarPoolMock([filaBd({ ref: 'D1', volumenDemanda: 1000 })]);
  const { ejecutarAnalisisOportunidades } = cargarFresco();
  await ejecutarAnalisisOportunidades();
  const insert = llamadas.find((c) => /INSERT INTO oportunidades_resultados/.test(c.sql));
  const detalle = JSON.parse(insert.params[17]);
  assert.equal(detalle.componentes.demanda.estado, 'ok');
  assert.equal(detalle.componentes.demanda.puntos, 18.8); // 25 × log10(1001)/4
});

test('la consulta de demanda solo usa volúmenes verificados y la ejecución nunca escribe fuera de las tablas de oportunidades', async () => {
  const llamadas = instalarPoolMock([filaBd()]);
  const { ejecutarAnalisisOportunidades } = cargarFresco();
  await ejecutarAnalisisOportunidades();
  const select = llamadas.find((c) => /FROM shopify_match sm/.test(c.sql));
  assert.match(select.sql, /d\.verificado = true/);
  for (const c of llamadas) {
    if (/^\s*(INSERT|UPDATE|DELETE)/i.test(c.sql)) {
      assert.match(c.sql, /oportunidades_(runs|resultados)/, 'escritura inesperada: ' + c.sql.slice(0, 60));
    }
  }
});
