const { test } = require('node:test');
const assert = require('node:assert/strict');
const { calcularOportunidad, esMarcaPrioritaria, seleccionarRanking } = require('../src/oportunidades');

test('esMarcaPrioritaria: reconoce las marcas prioritarias por defecto', () => {
  assert.equal(esMarcaPrioritaria('WOLFPACK'), true);
  assert.equal(esMarcaPrioritaria('samurai'), true); // insensible a mayúsculas
  assert.equal(esMarcaPrioritaria('OTRA MARCA'), false);
  assert.equal(esMarcaPrioritaria(null), false);
});

test('calcularOportunidad: marca prioritaria + margen alto + stock alto -> score alto, motivo trazable', () => {
  const r = calcularOportunidad({ marca: 'WOLFPACK', margenPct: 50, stock: 25, precio: 20 });
  assert.equal(r.esPrioritaria, true);
  assert.equal(r.score, 100); // 40 (marca) + 40 (margen satura en 50) + 20 (stock satura en 20)
  assert.match(r.motivo, /marca prioritaria \(WOLFPACK, \+40 pts\)/);
  assert.match(r.motivo, /margen proyectado 50% \(\+40 pts\)/);
  assert.match(r.motivo, /stock AFT 25 uds\. \(\+20 pts\)/);
});

test('calcularOportunidad: sin datos de margen no inventa ningún punto, va a 0', () => {
  const r = calcularOportunidad({ marca: 'OTRA', margenPct: null, stock: 0, precio: null });
  assert.equal(r.score, 0);
  assert.match(r.motivo, /margen proyectado no disponible \(\+0 pts\)/);
});

test('calcularOportunidad: candidata a venta complementaria solo con margen>=0 y PVP bajo', () => {
  const complementaria = calcularOportunidad({ marca: 'MAURER', margenPct: 10, stock: 5, precio: 12 });
  assert.equal(complementaria.esComplementaria, true);

  const noComplementariaPorPrecio = calcularOportunidad({ marca: 'MAURER', margenPct: 10, stock: 5, precio: 50 });
  assert.equal(noComplementariaPorPrecio.esComplementaria, false);

  const noComplementariaPorMargenNegativo = calcularOportunidad({ marca: 'MAURER', margenPct: -5, stock: 5, precio: 10 });
  assert.equal(noComplementariaPorMargenNegativo.esComplementaria, false);
});

// --- Características adicionales (caracterización previa a mover la
// función a src/domain/, para detectar cualquier cambio de comportamiento
// en el traslado) ---

test('[caracterización] margen negativo nunca resta puntos, se queda en 0 para ese componente', () => {
  const r = calcularOportunidad({ marca: 'OTRA', margenPct: -30, stock: 0, precio: null });
  assert.equal(r.score, 0); // ni margen ni stock aportan, nunca negativo
  assert.match(r.motivo, /margen proyectado -30% \(\+0 pts\)/);
});

test('[caracterización] margen y stock por encima del umbral de saturación no superan el peso máximo', () => {
  const r = calcularOportunidad({ marca: 'OTRA', margenPct: 500, stock: 100000, precio: null });
  // margen satura en MARGEN_REFERENCIA_SATURACION=50 -> PESO_MARGEN_MAX=40;
  // stock satura en STOCK_REFERENCIA_SATURACION=20 -> PESO_STOCK_MAX=20.
  assert.equal(r.score, 60); // 0 (no prioritaria) + 40 (margen saturado) + 20 (stock saturado)
});

test('[caracterización] marca no prioritaria se refleja literalmente en el motivo', () => {
  const r = calcularOportunidad({ marca: 'MARCA INVENTADA', margenPct: null, stock: 0, precio: null });
  assert.equal(r.esPrioritaria, false);
  assert.match(r.motivo, /marca no prioritaria \(\+0 pts\)/);
});

test('[caracterización] stock negativo (dato anómalo) no resta puntos, se queda en 0 para ese componente', () => {
  const r = calcularOportunidad({ marca: 'OTRA', margenPct: null, stock: -10, precio: null });
  assert.equal(r.score, 0);
  assert.match(r.motivo, /stock AFT -10 uds\. \(\+0 pts\)/);
});

// --- Fase 2: afinidad comercial como componente del score, en modo
// observación por defecto (OPORTUNIDADES_PESO_AFINIDAD=0 en este proceso de
// test, al no estar definida la env var) ---

test('[fase 2 - regresión] con OPORTUNIDADES_PESO_AFINIDAD=0 (por defecto), el score es IDÉNTICO al de fase 1, con o sin categoría', () => {
  const sinCategoria = calcularOportunidad({ marca: 'WOLFPACK', margenPct: 50, stock: 25, precio: 20 });
  assert.equal(sinCategoria.score, 100);

  const conCategoriaPrincipal = calcularOportunidad({ marca: 'WOLFPACK', margenPct: 50, stock: 25, precio: 20, categoria: 'Taladro percutor' });
  assert.equal(conCategoriaPrincipal.score, 100);

  const conCategoriaAmbigua = calcularOportunidad({ marca: 'WOLFPACK', margenPct: 50, stock: 25, precio: 20, categoria: 'Categoría rarísima sin clasificar' });
  assert.equal(conCategoriaAmbigua.score, 100);

  // Las tres puntuaciones son iguales entre sí e iguales al score de fase 1:
  // la afinidad nunca cambia el resultado mientras el peso siga en 0.
  assert.equal(sinCategoria.score, conCategoriaPrincipal.score);
  assert.equal(conCategoriaPrincipal.score, conCategoriaAmbigua.score);
});

test('[fase 2] calcularOportunidad siempre devuelve "afinidad" trazable, visible en el motivo aunque no puntúe', () => {
  const r = calcularOportunidad({ marca: 'OTRA', margenPct: null, stock: 0, precio: null, categoria: 'Taladro' });
  assert.equal(r.afinidad.clase, 'principal');
  assert.match(r.motivo, /afinidad principal \(\+0 pts\)/);
});

test('[fase 2] categoría ambigua se refleja como tal en "afinidad", nunca como fuera_de_foco por defecto', () => {
  const r = calcularOportunidad({ marca: 'OTRA', margenPct: null, stock: 0, precio: null, categoria: 'Categoría jamás vista' });
  assert.equal(r.afinidad.clase, 'ambigua');
  assert.equal(r.afinidad.elegible, null);
});

// --- Fase 2: seleccionarRanking — determinista, nunca descarta candidatos ---

function candidato(ref, score, { margenPct = null, stock = 0, categoria = 'CAT', afinidad = { clase: 'principal' } } = {}) {
  return { ref, score, margenPct, stock, categoria, afinidad };
}

test('seleccionarRanking: nunca pierde candidatos, cualquiera que sea el resultado', () => {
  const candidatos = Array.from({ length: 15 }, (_, i) => candidato('R' + i, 100 - i, { categoria: 'CAT_UNICA' }));
  const ranking = seleccionarRanking(candidatos, { maxPorCategoria: 4, maxCandidatosTotal: 60, filtroAfinidadActivo: false });
  assert.equal(ranking.length, candidatos.length);
  assert.deepEqual(ranking.map((r) => r.ref).sort(), candidatos.map((c) => c.ref).sort());
});

test('seleccionarRanking: orden determinista por score DESC, margenPct DESC (sin dato al final), stock DESC, ref ASC', () => {
  const candidatos = [
    candidato('B', 50, { margenPct: 10, stock: 5 }),
    candidato('A', 50, { margenPct: 10, stock: 5 }), // mismo score/margen/stock que B -> desempate por ref ASC
    candidato('C', 50, { margenPct: null, stock: 100 }), // mismo score, sin margen -> va después de A y B
    candidato('D', 80, { margenPct: 5, stock: 1 }), // score más alto -> primero
  ];
  const ranking = seleccionarRanking(candidatos, { maxPorCategoria: 10, maxCandidatosTotal: 10, filtroAfinidadActivo: false });
  assert.deepEqual(ranking.map((r) => r.ref), ['D', 'A', 'B', 'C']);
});

test('seleccionarRanking: respeta el tope por categoría, marcando el resto como excedente_categoria (nunca eliminado)', () => {
  const candidatos = [
    ...Array.from({ length: 6 }, (_, i) => candidato('A' + i, 90 - i, { categoria: 'CAT_A' })),
    ...Array.from({ length: 2 }, (_, i) => candidato('B' + i, 50 - i, { categoria: 'CAT_B' }))
  ];
  const ranking = seleccionarRanking(candidatos, { maxPorCategoria: 4, maxCandidatosTotal: 60, filtroAfinidadActivo: false });
  const catA = ranking.filter((r) => r.categoria === 'CAT_A');
  assert.equal(catA.filter((r) => r.estadoElegibilidad === 'recomendada').length, 4);
  assert.equal(catA.filter((r) => r.estadoElegibilidad === 'excedente_categoria').length, 2);
  assert.equal(ranking.filter((r) => r.categoria === 'CAT_B' && r.estadoElegibilidad === 'recomendada').length, 2);
  assert.equal(ranking.length, 8); // ninguno se pierde
});

test('seleccionarRanking: respeta el tope total del ranking principal, marcando el resto como excedente_total', () => {
  const candidatos = Array.from({ length: 10 }, (_, i) => candidato('R' + i, 100 - i, { categoria: 'CAT_' + i })); // 1 por categoría, nunca topan maxPorCategoria
  const ranking = seleccionarRanking(candidatos, { maxPorCategoria: 4, maxCandidatosTotal: 3, filtroAfinidadActivo: false });
  assert.equal(ranking.filter((r) => r.estadoElegibilidad === 'recomendada').length, 3);
  assert.equal(ranking.filter((r) => r.estadoElegibilidad === 'excedente_total').length, 7);
  assert.equal(ranking.length, 10);
});

test('seleccionarRanking: con filtroAfinidadActivo=false (por defecto), la afinidad NUNCA decide elegibilidad', () => {
  const candidatos = [
    candidato('A', 90, { afinidad: { clase: 'fuera_de_foco' } }),
    candidato('B', 80, { afinidad: { clase: 'ambigua' } })
  ];
  const ranking = seleccionarRanking(candidatos, { maxPorCategoria: 4, maxCandidatosTotal: 60, filtroAfinidadActivo: false });
  assert.equal(ranking.find((r) => r.ref === 'A').estadoElegibilidad, 'recomendada');
  assert.equal(ranking.find((r) => r.ref === 'B').estadoElegibilidad, 'recomendada');
});

test('seleccionarRanking: con filtroAfinidadActivo=true, fuera_de_foco y ambigua quedan marcadas aparte, pero NUNCA eliminadas', () => {
  const candidatos = [
    candidato('A', 90, { afinidad: { clase: 'fuera_de_foco' } }),
    candidato('B', 80, { afinidad: { clase: 'ambigua' } }),
    candidato('C', 70, { afinidad: { clase: 'principal' } })
  ];
  const ranking = seleccionarRanking(candidatos, { maxPorCategoria: 4, maxCandidatosTotal: 60, filtroAfinidadActivo: true });
  assert.equal(ranking.find((r) => r.ref === 'A').estadoElegibilidad, 'fuera_de_foco');
  assert.equal(ranking.find((r) => r.ref === 'B').estadoElegibilidad, 'ambigua_revision');
  assert.equal(ranking.find((r) => r.ref === 'C').estadoElegibilidad, 'recomendada');
  assert.equal(ranking.length, 3);
});
