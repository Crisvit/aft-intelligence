// [dashboard] Validación móvil (auditoría): un texto largo dentro de una
// celda de tabla (p. ej. la explicación del transporte en Rentabilidad)
// debe poder partirse en varias líneas en la vista de tarjetas de móvil
// (max-width:700px) en vez de quedar cortado por el ancho de la tarjeta —
// confirmado visualmente con Playwright contra datos sintéticos; esta
// prueba fija en código la regla CSS que lo permite, para detectar si se
// pierde en un cambio futuro.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildDashboardHtml } = require('../src/buildDashboardHtml');

test('[dashboard] la regla móvil de tabla permite que el contenido de una celda haga salto de línea (min-width:0)', () => {
  const html = buildDashboardHtml({
    productosShopify: [], ultimoSync: null, ultimaImport: null, matchRows: [], incidenciaRows: [],
    oportunidadRows: [], historialSyncRows: [], ultimaRentabilidad: null, ultimoPipeline: null,
    rentabilidadResultados: [], rentabilidadAlertas: [], rentabilidadRecomendaciones: [],
    pvpComplementoMax: 15, stockMinimoOportunidad: 1, totalesCatalogo: {}, shopifyAdminStore: null,
    ultimaReposicion: null, reposicionEventos: [], shopifyWriteEnabled: false, ultimaOportunidades: null,
    ultimaDemanda: null, demandaResultados: [], demandaConectada: false, ultimaFichas: null,
    fichasBorradores: [], iaConectada: false
  });
  const bloqueMovil = html.match(/@media\(max-width:700px\)\{[^]*?\}\}/)[0];
  assert.match(bloqueMovil, /table td>\*\{min-width:0;white-space:normal;\}/);
});
