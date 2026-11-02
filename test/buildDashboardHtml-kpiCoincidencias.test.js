// [dashboard] La tarjeta KPI "Coincidencias" de Inicio enlaza a la página
// Coincidencias — debe mostrar siempre el mismo número que esa página
// (matchRows.length, las coincidencias fiables), nunca el total bruto de
// la última sincronización (que incluye coincidencias bloqueadas/con
// alerta y antes creaba una discrepancia visible entre ambas pantallas).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildDashboardHtml } = require('../src/buildDashboardHtml');

const BASE = {
  productosShopify: [], ultimaImport: null, incidenciaRows: [], oportunidadRows: [],
  historialSyncRows: [], ultimaRentabilidad: null, ultimoPipeline: null,
  rentabilidadResultados: [], rentabilidadAlertas: [], rentabilidadRecomendaciones: [],
  pvpComplementoMax: 15, stockMinimoOportunidad: 1, totalesCatalogo: {}, shopifyAdminStore: null,
  ultimaReposicion: null, reposicionEventos: [], shopifyWriteEnabled: false, ultimaOportunidades: null,
  ultimaDemanda: null, demandaResultados: [], demandaConectada: false, ultimaFichas: null,
  fichasBorradores: [], iaConectada: false
};

function filaMatch(ref) {
  return {
    ref, descripcion: 'Producto ' + ref, marca_aft: 'Wolfpack', matched_by: 'ean',
    stock_aft: 5, shopify_stock: 5, stock_diferencia: 0, estado: 'sin_cambio', checked_at: new Date().toISOString()
  };
}

test('[dashboard] la tarjeta "Coincidencias" de Inicio muestra matchRows.length, no el total bruto de la sincronización', () => {
  const matchRows = [filaMatch('AFT-1'), filaMatch('AFT-2'), filaMatch('AFT-3')]; // 3 fiables
  const ultimoSync = { total_matched: 4, total_cambiarian: 0, total_a_cero: 0, total_incidencias: 1, total_aft_candidatos: 10, shopify_variantes_leidas: 20, finished_at: new Date().toISOString() }; // 4 en bruto (1 bloqueada)
  const html = buildDashboardHtml({ ...BASE, matchRows, ultimoSync });

  // El número que se ve en la tarjeta debe ser 3 (fiables), nunca 4 (bruto).
  assert.match(html, /<div class="kpi-n">3<\/div>/);
  assert.doesNotMatch(html, /<div class="kpi-n">4<\/div>\s*<div class="kpi-l">Coincidencias/);
  assert.match(html, /Coincidencias fiables AFT/);
});

test('[dashboard] sin ninguna sincronización todavía, la tarjeta muestra 0 (matchRows vacío), no revienta', () => {
  const html = buildDashboardHtml({ ...BASE, matchRows: [], ultimoSync: null });
  assert.match(html, /Coincidencias fiables AFT/);
});
