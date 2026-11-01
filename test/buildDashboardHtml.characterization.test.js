// [fase 3] Caracterización PREVIA a extraer la sección de Oportunidades de
// src/buildDashboardHtml.js a src/views/oportunidadesView.js — fija el
// comportamiento actual (antes de tocar nada) para que la extracción no
// pueda cambiarlo por accidente. Mismo patrón usado en fase 1 antes de
// mover funciones a src/domain/.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildDashboardHtml } = require('../src/buildDashboardHtml');

// Fixture mínima: todo lo que no es relevante para esta caracterización
// queda vacío/nulo — el objetivo es que la función no reviente, no cubrir
// cada página.
function fixtureBase(overrides) {
  return Object.assign({
    productosShopify: [], ultimoSync: null, ultimaImport: null, matchRows: [], incidenciaRows: [],
    oportunidadRows: [], historialSyncRows: [], ultimaRentabilidad: null, ultimoPipeline: null,
    rentabilidadResultados: [], rentabilidadAlertas: [], rentabilidadRecomendaciones: [],
    pvpComplementoMax: 15, stockMinimoOportunidad: 1,
    totalesCatalogo: { total_variantes: 0, total_productos: 0 }, shopifyAdminStore: '',
    ultimaReposicion: null, reposicionEventos: [], shopifyWriteEnabled: false,
    ultimaOportunidades: null, ultimaDemanda: null, demandaResultados: [], demandaConectada: false,
    ultimaFichas: null, fichasBorradores: [], iaConectada: false
  }, overrides);
}

test('[caracterización] sin oportunidades, muestra el estado vacío', () => {
  const html = buildDashboardHtml(fixtureBase({}));
  assert.match(html, /Ninguna referencia de tus marcas\/categorías comerciales está pendiente/);
});

test('[caracterización] fila de oportunidad: marca, prioritaria, complementaria, score y motivo visibles', () => {
  const row = {
    ref: 'CARAC-1', ean: '1234567890123', marca: 'WOLFPACK', descripcion: 'Taladro percutor de prueba',
    categoria_nombre: 'Taladro', stock: 10, coste: 20, precio: 30, margenPct: 25,
    esPrioritaria: true, esComplementaria: true, score: 74,
    motivo: 'Puntuación 74/100: marca prioritaria (WOLFPACK, +40 pts) · margen proyectado 25% (+20 pts) · stock AFT 10 uds. (+10 pts) · afinidad principal (+0 pts).'
  };
  const html = buildDashboardHtml(fixtureBase({ oportunidadRows: [row] }));

  assert.match(html, /Taladro Percutor De Prueba/); // titleCase sobre la descripción
  assert.match(html, /CARAC-1/);
  assert.match(html, /<span class="badge badge-ok">Prioritaria<\/span>/);
  assert.match(html, /background:#F5F3FF;color:#7C3AED;">Complementaria<\/span>/);
  assert.match(html, /74\/100/);
  assert.match(html, /30\.00€/); // eur(precio)
  assert.match(html, /25\.0%/); // pct(margenPct)
  assert.match(html, />Score</);
  assert.match(html, /marca prioritaria \(WOLFPACK, \+40 pts\)/); // fila de motivo expandida
});

test('[fase 3] cabecera de la tabla de Oportunidades incluye Elegibilidad/Afinidad/Margen (clasificación)', () => {
  const row = { ref: 'CARAC-2', marca: 'OTRA', descripcion: 'x', categoria_nombre: 'Taladro', stock: 1, coste: 1, precio: 1, margenPct: 1, esPrioritaria: false, esComplementaria: false, score: 1, motivo: 'x' };
  const html = buildDashboardHtml(fixtureBase({ oportunidadRows: [row] }));
  assert.match(html, /<th>Producto<\/th><th>Marca<\/th><th>Elegibilidad<\/th><th>Afinidad<\/th><th>Margen \(clasificación\)<\/th><th>Stock AFT<\/th><th>Coste<\/th><th>PVP recomendado<\/th><th>Margen<\/th><th>Score<\/th><th>Enlaces<\/th>/);
});

test('[fase 3] estado_elegibilidad se muestra con su badge, y nunca se pierde un candidato excedente', () => {
  const rows = [
    { ref: 'REC-1', marca: 'A', descripcion: 'x', categoria_nombre: 'Taladro', stock: 1, coste: 1, precio: 1, margenPct: 1, esPrioritaria: false, esComplementaria: false, score: 90, motivo: 'x', estadoElegibilidad: 'recomendada', afinidadClase: 'principal', afinidadMotivo: 'y', margenClasificacion: 'apto_evaluacion', margenPrioridadAdicional: false },
    { ref: 'EXC-1', marca: 'A', descripcion: 'x', categoria_nombre: 'Taladro', stock: 1, coste: 1, precio: 1, margenPct: 1, esPrioritaria: false, esComplementaria: false, score: 80, motivo: 'x', estadoElegibilidad: 'excedente_categoria', afinidadClase: 'principal', afinidadMotivo: 'y', margenClasificacion: 'apto_evaluacion', margenPrioridadAdicional: false },
    { ref: 'AMB-1', marca: 'A', descripcion: 'x', categoria_nombre: 'Rara', stock: 1, coste: 1, precio: 1, margenPct: 1, esPrioritaria: false, esComplementaria: false, score: 10, motivo: 'x', estadoElegibilidad: 'recomendada', afinidadClase: 'ambigua', afinidadMotivo: 'y', margenClasificacion: 'sin_dato', margenPrioridadAdicional: false }
  ];
  const html = buildDashboardHtml(fixtureBase({ oportunidadRows: rows }));
  // Las 3 referencias aparecen — nunca se recorta el conjunto en la vista.
  assert.match(html, /REC-1/);
  assert.match(html, /EXC-1/);
  assert.match(html, /AMB-1/);
  assert.match(html, /<span class="badge badge-ok">Recomendada<\/span>/);
  assert.match(html, /Excedente de categoría/);
  assert.match(html, /Afinidad ambigua<\/span>/);
  assert.match(html, /Apto para evaluación/);
  // La categoría original (sin titleCase) se muestra tal cual, no normalizada.
  assert.match(html, /Taladro/);
});

test('[fase 3] sin estado_elegibilidad (datos antiguos), muestra "Sin clasificar" en vez de inventar un estado', () => {
  const row = { ref: 'VIEJO-1', marca: 'A', descripcion: 'x', categoria_nombre: 'Taladro', stock: 1, coste: 1, precio: 1, margenPct: 1, esPrioritaria: false, esComplementaria: false, score: 1, motivo: 'x' };
  const html = buildDashboardHtml(fixtureBase({ oportunidadRows: [row] }));
  assert.match(html, /Sin clasificar/);
});

test('[fase 3] filtros nuevos de estado y afinidad presentes en el filterbar', () => {
  const row = { ref: 'CARAC-3', marca: 'A', descripcion: 'x', categoria_nombre: 'Taladro', stock: 1, coste: 1, precio: 1, margenPct: 1, esPrioritaria: false, esComplementaria: false, score: 1, motivo: 'x' };
  const html = buildDashboardHtml(fixtureBase({ oportunidadRows: [row] }));
  assert.match(html, /id="filtroEstadoOportunidad"/);
  assert.match(html, /id="filtroAfinidadOportunidad"/);
});

test('[caracterización] filtro de marcas del filterbar se construye a partir de las marcas presentes', () => {
  const rows = [
    { ref: 'A', marca: 'Wolfpack', descripcion: 'x', categoria_nombre: 'c', stock: 1, coste: 1, precio: 1, margenPct: 1, esPrioritaria: false, esComplementaria: false, score: 1, motivo: 'x' },
    { ref: 'B', marca: 'Samurai', descripcion: 'x', categoria_nombre: 'c', stock: 1, coste: 1, precio: 1, margenPct: 1, esPrioritaria: false, esComplementaria: false, score: 1, motivo: 'x' }
  ];
  const html = buildDashboardHtml(fixtureBase({ oportunidadRows: rows }));
  assert.match(html, /<option value="Samurai">Samurai<\/option>/);
  assert.match(html, /<option value="Wolfpack">Wolfpack<\/option>/);
});
