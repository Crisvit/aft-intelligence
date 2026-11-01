// [dashboard] Página «Cambios AFT» — historial real de coste/PVP/stock
// (ver src/historialCambios.js), alertas de subida de coste y la política
// de retención DEFINIDA pero NUNCA ejecutada desde el panel.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildDashboardHtml } = require('../src/buildDashboardHtml');

const BASE = {
  productosShopify: [], ultimoSync: null, ultimaImport: null, matchRows: [], incidenciaRows: [],
  oportunidadRows: [], historialSyncRows: [], ultimaRentabilidad: null, ultimoPipeline: null,
  rentabilidadResultados: [], rentabilidadAlertas: [], rentabilidadRecomendaciones: [],
  pvpComplementoMax: 15, stockMinimoOportunidad: 1, totalesCatalogo: {}, shopifyAdminStore: null,
  ultimaReposicion: null, reposicionEventos: [], shopifyWriteEnabled: false, ultimaOportunidades: null,
  ultimaDemanda: null, demandaResultados: [], demandaConectada: false, ultimaFichas: null,
  fichasBorradores: [], iaConectada: false,
  cambiosRows: [], cambiosTotal: 0, cambiosAlertas: [],
  cambiosRetencion: { meses: 12, corte: '2025-11-01T00:00:00Z', pendientesDePurga: 0 },
  cambiosRetencionMeses: 12, cambiosUmbralAlertaPct: 10
};

function cambio(overrides) {
  return {
    ref: 'AFT-1', marca: 'Wolfpack', descripcion: 'Taladro percutor', campo: 'costo',
    valor_anterior: 10, valor_nuevo: 11, fecha_cambio_aft: '2026-10-15T00:00:00Z',
    detectado_en: '2026-10-30T09:00:00Z', ...overrides
  };
}

test('[dashboard] el enlace de navegación «Cambios AFT» existe', () => {
  const html = buildDashboardHtml({ ...BASE });
  assert.match(html, /data-page="cambios-aft"[^>]*>.*Cambios AFT/);
  assert.match(html, /<div class="page" id="page-cambios-aft">/);
});

test('[dashboard] sin cambios registrados se muestra el estado vacío, no una tabla rota', () => {
  const html = buildDashboardHtml({ ...BASE });
  assert.match(html, /Todavía no se ha registrado ningún cambio real de AFT/);
});

test('[dashboard] un cambio de coste se muestra con valor anterior, nuevo y variación', () => {
  const html = buildDashboardHtml({ ...BASE, cambiosRows: [cambio({})], cambiosTotal: 1 });
  assert.match(html, /AFT-1/);
  assert.match(html, /10\.00€/);
  assert.match(html, /11\.00€/);
  assert.match(html, /\+10\.0%/);
});

test('[dashboard] el filtro por campo distingue Coste, PVP sin IVA y Stock', () => {
  const html = buildDashboardHtml({ ...BASE });
  assert.match(html, /<option value="costo">Coste<\/option>/);
  assert.match(html, /<option value="pvp_sin_iva">PVP sin IVA<\/option>/);
  assert.match(html, /<option value="stock">Stock<\/option>/);
});

test('[dashboard] filtros de referencia y fecha (desde/hasta) presentes', () => {
  const html = buildDashboardHtml({ ...BASE });
  assert.match(html, /id="filtroCambiosRef"/);
  assert.match(html, /type="date" id="filtroCambiosDesde"/);
  assert.match(html, /type="date" id="filtroCambiosHasta"/);
  assert.match(html, /function filtrarCambiosAft\(\)/);
});

test('[dashboard] una subida de coste del 20% aparece como alerta', () => {
  const alerta = { ref: 'AFT-2', marca: 'Truper', descripcion: 'Generador', valor_anterior: 100, valor_nuevo: 120, variacion_pct: 20, detectado_en: '2026-10-30T09:00:00Z' };
  const html = buildDashboardHtml({ ...BASE, cambiosAlertas: [alerta] });
  assert.match(html, /1 alerta/);
  assert.match(html, /AFT-2/);
  assert.match(html, /\+20\.0%/);
});

test('[dashboard] sin alertas de coste se muestra el estado vacío en esa sección, no "0 alertas" como tabla rota', () => {
  const html = buildDashboardHtml({ ...BASE, cambiosAlertas: [] });
  assert.match(html, /Ninguna subida de coste igual o mayor al umbral configurado/);
  assert.doesNotMatch(html, />0 alertas</);
});

test('[dashboard] el umbral de alerta mostrado refleja el valor configurado, no un 10% fijo en el texto', () => {
  const html = buildDashboardHtml({ ...BASE, cambiosUmbralAlertaPct: 15 });
  assert.match(html, /Coste subido un 15% o más/);
});

test('[dashboard] la retención se muestra como política DEFINIDA, nunca como una acción ejecutable', () => {
  const html = buildDashboardHtml({ ...BASE, cambiosRetencion: { meses: 12, corte: '2025-11-01T00:00:00Z', pendientesDePurga: 5 }, cambiosRetencionMeses: 12 });
  assert.match(html, /Retención definida: 12 meses/);
  assert.match(html, /5 registros superan esa retención/);
  assert.match(html, /purga pendiente de verificar backups y de aprobación del procedimiento/);
  assert.match(html, /no se ejecuta ninguna purga automática/);
  // Nunca debe existir ningún botón o endpoint de purga en el HTML servido.
  assert.doesNotMatch(html, /purgar|eliminar.*historial|DELETE FROM aft_cambios/i);
});

test('[dashboard] sin registros pendientes de retención lo indica explícitamente', () => {
  const html = buildDashboardHtml({ ...BASE, cambiosRetencion: { meses: 12, corte: '2025-11-01T00:00:00Z', pendientesDePurga: 0 } });
  assert.match(html, /Ningún registro supera todavía esa retención/);
});

test('[dashboard] el botón «Cargar más» se oculta cuando ya se muestran todos los cambios', () => {
  const html = buildDashboardHtml({ ...BASE, cambiosRows: [cambio({})], cambiosTotal: 1 });
  assert.match(html, /id="cambiosAftCargarMasBtn"[^>]*style="display:none;"/);
});

test('[dashboard] el botón «Cargar más» es visible cuando hay más cambios que los mostrados', () => {
  const html = buildDashboardHtml({ ...BASE, cambiosRows: [cambio({})], cambiosTotal: 50 });
  assert.doesNotMatch(html, /id="cambiosAftCargarMasBtn"[^>]*style="display:none;"/);
});

test('[dashboard] un cambio de stock se formatea como entero, no con decimales ni símbolo de euro', () => {
  const html = buildDashboardHtml({ ...BASE, cambiosRows: [cambio({ campo: 'stock', valor_anterior: 5, valor_nuevo: 0 })], cambiosTotal: 1 });
  assert.doesNotMatch(html, />0\.00€</);
});
