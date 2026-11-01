// [dashboard] Reposición automática de stock — el panel debe distinguir
// actualizaciones REALES de simulaciones, mostrar un estado "parcial"
// cuando hubo errores o verificaciones sin confirmar (nunca ocultarlo bajo
// "completa"), mostrar la última sincronización EFECTIVA por separado de
// la última ejecución, y el desglose de referencias bloqueadas por motivo.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildDashboardHtml } = require('../src/buildDashboardHtml');

const BASE = {
  productosShopify: [], ultimoSync: null, ultimaImport: null, matchRows: [], incidenciaRows: [],
  historialSyncRows: [], ultimaRentabilidad: null, ultimoPipeline: null,
  rentabilidadResultados: [], rentabilidadAlertas: [], rentabilidadRecomendaciones: [],
  pvpComplementoMax: 15, stockMinimoOportunidad: 1, totalesCatalogo: {}, shopifyAdminStore: null,
  oportunidadRows: [], shopifyWriteEnabled: false, ultimaOportunidades: null,
  ultimaDemanda: null, demandaResultados: [], demandaConectada: false, ultimaFichas: null,
  fichasBorradores: [], iaConectada: false,
  ultimaReposicion: null, reposicionEventos: [], ultimaReposicionEfectiva: null, reposicionBloqueados: null
};

test('[dashboard] una ejecución "parcial" se muestra como tal, nunca como completa', () => {
  const html = buildDashboardHtml({
    ...BASE,
    ultimaReposicion: { status: 'parcial', finished_at: new Date(), total_candidatos: 10, actualizados: 3, simulados: 0, recuperados_stock_cero: 1, reposiciones_detectadas: 1, correcciones_a_la_baja: 1, errores: 1, verificaciones_fallidas: 1 }
  });
  assert.match(html, /Parcial \(con errores o sin verificar\)/);
  assert.doesNotMatch(html, /id="repoEstadoTexto">Completa/);
});

test('[dashboard] el resumen distingue "actualizados de verdad" de "simulados", nunca los mezcla', () => {
  const html = buildDashboardHtml({
    ...BASE,
    ultimaReposicion: { status: 'success', finished_at: new Date(), total_candidatos: 8, actualizados: 2, simulados: 6, recuperados_stock_cero: 0, reposiciones_detectadas: 2, correcciones_a_la_baja: 0, errores: 0, verificaciones_fallidas: 0 }
  });
  assert.match(html, /<strong>2 actualizados de verdad en Shopify<\/strong>/);
  assert.match(html, /6 solo simulados \(dry run\)/);
});

test('[dashboard] sin ninguna sincronización efectiva todavía, lo dice explícitamente (nunca lo oculta)', () => {
  const html = buildDashboardHtml({ ...BASE, ultimaReposicionEfectiva: null });
  assert.match(html, /Todavía no ha habido ninguna sincronización con escritura real confirmada en Shopify/);
});

test('[dashboard] con una sincronización efectiva, muestra cuándo fue y cuántos se actualizaron', () => {
  const html = buildDashboardHtml({
    ...BASE,
    ultimaReposicionEfectiva: { finished_at: new Date(Date.now() - 3600000), actualizados: 5, status: 'success' }
  });
  assert.match(html, /Última sincronización EFECTIVA \(con escritura real confirmada en Shopify\)/);
  assert.match(html, /5 actualizados/);
});

test('[dashboard] el desglose de bloqueados solo muestra motivos con al menos una referencia, y avisa que no son sumables', () => {
  const html = buildDashboardHtml({
    ...BASE,
    reposicionBloqueados: { sin_match_fiable: 0, duplicado: 3, multiples_ubicaciones: 0, ubicacion_no_encontrada: 0, bloqueo_manual: 0, sin_inventory_item_id: 0, sin_stock_shopify: 0, sin_stock_aft: 7, stock_aft_negativo: 0 }
  });
  assert.match(html, /Referencias bloqueadas \(no candidatas a actualizarse\), por motivo/);
  assert.match(html, /coincidencia duplicada: 3/);
  assert.match(html, /sin stock de AFT \(referencia no vista en la última importación\): 7/);
  assert.doesNotMatch(html, /múltiples ubicaciones: 0/);
  assert.match(html, /no son sumables entre sí/);
});

test('[dashboard] sin ningún bloqueado, no muestra la sección de bloqueados', () => {
  const html = buildDashboardHtml({
    ...BASE,
    reposicionBloqueados: { sin_match_fiable: 0, duplicado: 0, multiples_ubicaciones: 0, ubicacion_no_encontrada: 0, bloqueo_manual: 0, sin_inventory_item_id: 0, sin_stock_shopify: 0, sin_stock_aft: 0, stock_aft_negativo: 0 }
  });
  assert.doesNotMatch(html, /Referencias bloqueadas \(no candidatas a actualizarse\), por motivo/);
});
