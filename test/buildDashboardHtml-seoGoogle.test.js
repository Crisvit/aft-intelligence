// [dashboard] Demanda real de búsqueda (Agente 7 — Google Search Console +
// GA4). Nunca inventa un volumen/posición/sesión: "No conectado" cuando
// falta la integración, "Sin identificar en el catálogo" cuando una página
// real no tiene handle correspondiente todavía.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildDashboardHtml } = require('../src/buildDashboardHtml');

const BASE = {
  productosShopify: [], ultimoSync: null, ultimaImport: null, matchRows: [], incidenciaRows: [],
  oportunidadRows: [], historialSyncRows: [], ultimaRentabilidad: null, ultimoPipeline: null,
  rentabilidadResultados: [], rentabilidadAlertas: [], rentabilidadRecomendaciones: [],
  pvpComplementoMax: 15, stockMinimoOportunidad: 1, totalesCatalogo: {}, shopifyAdminStore: null,
  ultimaReposicion: null, reposicionEventos: [], shopifyWriteEnabled: false, ultimaOportunidades: null,
  ultimaDemanda: null, demandaResultados: [], demandaConectada: false,
  ultimaFichas: null, fichasBorradores: [], iaConectada: false
};

function filaSeo(overrides) {
  return {
    pagina_url: 'https://herramitienda.es/products/taladro-18v', shopify_handle: 'taladro-18v',
    ref: 'AFT-1', marca: 'Wolfpack', descripcion: 'Taladro percutor 18V',
    clics: 12, impresiones: 300, ctr: 0.04, posicion: 18, sesiones_ga4: 42,
    categoria: 'alta_demanda_mal_posicionada',
    ...overrides
  };
}

test('[dashboard] sin GOOGLE_SERVICE_ACCOUNT_JSON/GSC configurados, muestra "No conectado" y nunca inventa filas', () => {
  const html = buildDashboardHtml({
    ...BASE, ultimaSeoGoogle: { status: 'no_conectado', finished_at: new Date().toISOString(), dias_analizados: 28 },
    seoGoogleResultados: [], seoGoogleConectado: false, seoGoogleGa4Configurado: false,
    seoGoogleImpresionesMinimas: 50, seoGooglePosicionUmbral: 10
  });
  assert.match(html, /Demanda real de búsqueda \(Google\)/);
  assert.match(html, /No conectado/);
  assert.match(html, /no hay demanda real de Search Console que analizar/);
});

test('[dashboard] antes de la primera ejecución, no muestra la sección de resultados (solo la tarjeta de integración)', () => {
  const html = buildDashboardHtml({ ...BASE, ultimaSeoGoogle: null, seoGoogleResultados: [], seoGoogleConectado: false, seoGoogleGa4Configurado: false });
  assert.doesNotMatch(html, /Páginas de producto reales con alta demanda/);
  assert.match(html, /Nunca ejecutado/);
});

test('[dashboard] con resultados reales, clasifica mal posicionada vs bien posicionada, con producto cruzado por handle', () => {
  const html = buildDashboardHtml({
    ...BASE,
    ultimaSeoGoogle: { status: 'success', finished_at: new Date().toISOString(), dias_analizados: 28, total_paginas_gsc: 50, total_cruzadas_catalogo: 2, alta_demanda_mal_posicionada: 1, alta_demanda_bien_posicionada: 1, ga4_disponible: true },
    seoGoogleResultados: [
      filaSeo({}),
      filaSeo({ ref: 'AFT-2', shopify_handle: 'pala-jardin', pagina_url: 'https://herramitienda.es/products/pala-jardin', posicion: 3, categoria: 'alta_demanda_bien_posicionada', descripcion: 'Pala de jardín' })
    ],
    seoGoogleConectado: true, seoGoogleGa4Configurado: true,
    seoGoogleImpresionesMinimas: 50, seoGooglePosicionUmbral: 10
  });
  assert.match(html, /Alta demanda — mal posicionada/);
  assert.match(html, /Alta demanda — bien posicionada/);
  assert.match(html, /Wolfpack — Taladro percutor 18V/);
  assert.match(html, /AFT-1/);
  assert.match(html, /42/); // sesiones GA4 reales
  assert.match(html, /18\.0/); // posición media con un decimal
  assert.match(html, /4\.0%/); // ctr formateado como porcentaje
});

test('[dashboard] una página real sin fila de catálogo todavía se marca "Sin identificar", nunca con datos inventados', () => {
  const html = buildDashboardHtml({
    ...BASE,
    ultimaSeoGoogle: { status: 'success', finished_at: new Date().toISOString(), dias_analizados: 28, total_paginas_gsc: 10, total_cruzadas_catalogo: 0, alta_demanda_mal_posicionada: 1, alta_demanda_bien_posicionada: 0, ga4_disponible: false },
    seoGoogleResultados: [filaSeo({ ref: null, marca: null, descripcion: null, sesiones_ga4: null })],
    seoGoogleConectado: true, seoGoogleGa4Configurado: false
  });
  assert.match(html, /Sin identificar en el catálogo/);
});
