// [dashboard SaaS] Inicio (tarjetas de sincronización + centro de alertas +
// evolución), Coincidencias (estado real por fila + referencias bloqueadas)
// y Cambios AFT (evolución de costes/stock/PVP) — construidos solo con
// datos reales pasados como props; nunca una estadística inventada, y
// «Sin datos» cuando no hay información.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildDashboardHtml } = require('../src/buildDashboardHtml');

const BASE = {
  productosShopify: [], ultimoSync: null, ultimaImport: null, matchRows: [], incidenciaRows: [],
  oportunidadRows: [], historialSyncRows: [], ultimaRentabilidad: null, ultimoPipeline: null,
  rentabilidadResultados: [], rentabilidadAlertas: [], rentabilidadRecomendaciones: [],
  pvpComplementoMax: 15, stockMinimoOportunidad: 1, totalesCatalogo: {}, shopifyAdminStore: null,
  ultimaReposicion: null, reposicionEventos: [], ultimaReposicionEfectiva: null, reposicionBloqueados: null,
  reposicionEvolucion: [], referenciasBloqueadas: [], ultimoEventoPorRef: {},
  shopifyWriteEnabled: false, ultimaOportunidades: null,
  ultimaDemanda: null, demandaResultados: [], demandaConectada: false, ultimaFichas: null,
  fichasBorradores: [], iaConectada: false,
  cambiosRows: [], cambiosTotal: 0, cambiosAlertas: [], cambiosRetencion: null,
  cambiosRetencionMeses: 12, cambiosUmbralAlertaPct: 10, cambiosEvolucion: []
};

function filaMatch(overrides) {
  return { ref: 'REF-1', descripcion: 'Taladro', marca_aft: 'Wolfpack', matched_by: 'ean', stock_aft: 5, shopify_stock: 5, stock_diferencia: 0, estado: 'sin_cambio', ...overrides };
}

// --- Inicio: tarjetas de sincronización ---

test('[dashboard] tarjetas de sincronización muestran actualizados/simulados/bloqueados/errores reales', () => {
  const html = buildDashboardHtml({
    ...BASE,
    ultimaReposicion: { status: 'success', finished_at: new Date(), actualizados: 4, simulados: 2, errores: 0, verificaciones_fallidas: 0 },
    referenciasBloqueadas: [{ ref: 'X', motivos: ['sin coincidencia EAN/SKU fiable'] }]
  });
  assert.match(html, /Sincronización de inventario AFT → Shopify/);
  assert.match(html, /<div class="kpi-n" style="color:#059669;">4<\/div><div class="kpi-l">Actualizado de verdad en Shopify<\/div>/);
  assert.match(html, /<div class="kpi-n" style="color:#6B7280;">2<\/div><div class="kpi-l">Simulado \(dry run, sin escribir\)<\/div>/);
  assert.match(html, /<div class="kpi-n" style="color:#D97706;">1<\/div><div class="kpi-l">Bloqueadas \(no candidatas\)<\/div>/);
  assert.match(html, /<div class="kpi-n" style="color:#DC2626;">0<\/div><div class="kpi-l">Errores reales<\/div>/);
});

test('[dashboard] sin ninguna reposición ejecutada todavía, las tarjetas dicen «Sin datos», nunca un cero inventado', () => {
  const html = buildDashboardHtml({ ...BASE });
  assert.match(html, /<div class="kpi-n" style="color:#059669;">Sin datos<\/div>/);
  assert.match(html, /Última ejecución:<\/strong> Sin datos/);
});

test('[dashboard] última sincronización efectiva se distingue de la última ejecución', () => {
  const html = buildDashboardHtml({
    ...BASE,
    ultimaReposicion: { status: 'parcial', finished_at: new Date(), actualizados: 1, simulados: 0, errores: 1, verificaciones_fallidas: 0 },
    ultimaReposicionEfectiva: { finished_at: new Date(Date.now() - 86400000), actualizados: 3 }
  });
  assert.match(html, /Parcial, con errores/);
  assert.match(html, /Última escritura real verificada:<\/strong> .*3 actualizados/);
});

test('[dashboard] sin ninguna escritura real efectiva nunca, lo dice explícitamente', () => {
  const html = buildDashboardHtml({ ...BASE, ultimaReposicionEfectiva: null });
  assert.match(html, /Sin datos — nunca ha habido una escritura real confirmada en Shopify/);
});

// --- Inicio: gráfico de evolución ---

test('[dashboard] sin historial de reposición todavía, el gráfico muestra el estado vacío, nunca un gráfico con ceros', () => {
  const html = buildDashboardHtml({ ...BASE, reposicionEvolucion: [] });
  assert.match(html, /la evolución aparecerá aquí tras la primera ejecución diaria/);
});

test('[dashboard] con historial, dibuja el SVG de evolución con botones de 7\\/30 días', () => {
  const dias = [{ dia: new Date('2026-10-20'), runs: 1, actualizados: 3, simulados: 1, errores: 0 }];
  const html = buildDashboardHtml({ ...BASE, reposicionEvolucion: dias });
  assert.match(html, /id="evo-repo7"/);
  assert.match(html, /id="evo-repo30"/);
  assert.match(html, /Últimos 7 días/);
  assert.match(html, /Últimos 30 días/);
  assert.match(html, /<svg viewBox="0 0 600/);
});

// --- Inicio: centro de alertas prioritarias ---

test('[dashboard] el stock cero pendiente aparece en el centro de alertas con prioridad máxima', () => {
  const html = buildDashboardHtml({ ...BASE, matchRows: [filaMatch({ estado: 'a_cero' })] });
  assert.match(html, /Centro de alertas prioritarias/);
  assert.match(html, /producto AFT a stock cero pendiente/);
});

test('[dashboard] una reposición con errores genera una alerta explícita, nunca oculta', () => {
  const html = buildDashboardHtml({
    ...BASE,
    ultimaReposicion: { status: 'parcial', finished_at: new Date(), actualizados: 2, simulados: 0, errores: 2, verificaciones_fallidas: 1 }
  });
  assert.match(html, /La reposición de stock terminó con errores/);
  assert.match(html, /2 error\(es\) y 1 verificación\(es\) sin confirmar/);
});

test('[dashboard] subidas de coste y fallos del pipeline generan sus propias alertas', () => {
  const html = buildDashboardHtml({
    ...BASE,
    cambiosAlertas: [{ id: 1, ref: 'A', valor_anterior: 10, valor_nuevo: 12, variacion_pct: 20 }],
    ultimoPipeline: { status: 'error', error_message: 'fallo de prueba' }
  });
  assert.match(html, /subida de coste relevante de AFT/);
  assert.match(html, /La última ejecución del pipeline completo terminó con error/);
});

test('[dashboard] sin ninguna situación real, el centro de alertas dice que todo está al día', () => {
  const html = buildDashboardHtml({
    ...BASE,
    ultimoSync: { status: 'success', finished_at: new Date(), total_incidencias: 0, permisos_incompletos: false },
    ultimaRentabilidad: { en_perdida: 0, margen_bajo: 0 }
  });
  assert.match(html, /Todo al día\. No hay nada que necesite tu atención ahora mismo\./);
});

// --- Coincidencias: estado real + referencias bloqueadas ---

test('[dashboard] cada coincidencia muestra su estado real de reposición, no solo si hay diferencia de stock', () => {
  const html = buildDashboardHtml({
    ...BASE,
    matchRows: [filaMatch({ ref: 'REF-ACT' })],
    ultimoEventoPorRef: { 'REF-ACT': { tipo_evento: 'reposicion_detectada', escrito: true, verificado: true } }
  });
  assert.match(html, /Actualizado y verificado/);
});

test('[dashboard] una coincidencia sin ningún evento todavía dice "Sin ejecutar todavía", nunca "Actualizado" por defecto', () => {
  const html = buildDashboardHtml({ ...BASE, matchRows: [filaMatch({ ref: 'REF-NUEVA' })], ultimoEventoPorRef: {} });
  assert.match(html, /Sin ejecutar todavía/);
});

test('[dashboard] referencias bloqueadas se listan aparte, con su motivo exacto', () => {
  const html = buildDashboardHtml({
    ...BASE,
    referenciasBloqueadas: [{ ref: 'BLOQ-1', shopify_product_title: 'Destornillador', stock_aft: 5, shopify_stock: 2, motivos: ['coincidencia duplicada', 'bloqueo manual'] }]
  });
  assert.match(html, /Referencias bloqueadas/);
  assert.match(html, /BLOQ-1/);
  assert.match(html, /coincidencia duplicada · bloqueo manual/);
});

test('[dashboard] sin ninguna referencia bloqueada, lo dice explícitamente', () => {
  const html = buildDashboardHtml({ ...BASE, referenciasBloqueadas: [] });
  assert.match(html, /Ninguna referencia bloqueada ahora mismo\./);
});

// --- Cambios AFT: evolución ---

test('[dashboard] sin cambios detectados todavía, la evolución de Cambios AFT muestra el estado vacío', () => {
  const html = buildDashboardHtml({ ...BASE, cambiosEvolucion: [] });
  assert.match(html, /la evolución aparecerá aquí en cuanto AFT informe algún cambio real/);
});

test('[dashboard] con historial de cambios, dibuja el gráfico de evolución de costes\\/stock\\/PVP', () => {
  const dias = [{ dia: new Date('2026-10-20'), coste: 3, pvp: 1, stock: 2 }];
  const html = buildDashboardHtml({ ...BASE, cambiosEvolucion: dias });
  assert.match(html, /Evolución de costes, stock y PVP/);
  assert.match(html, /id="evo-cambios7"/);
  assert.match(html, /id="evo-cambios30"/);
});
