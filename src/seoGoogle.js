// Agente 7 — Demanda real de búsqueda (Google Search Console + GA4).
//
// Cruza páginas reales de producto (/products/<handle>) leídas de Search
// Console con el catálogo ya sincronizado (shopify_catalogo.shopify_handle,
// ver src/sync.js) para priorizar qué productos tienen demanda real de
// búsqueda pero están mal posicionados — el mismo análisis en dos niveles
// ya entregado una vez en vivo (consultando OpenRush), ahora como agente
// permanente del propio sistema, con sus propias credenciales de Google.
//
// Sin GOOGLE_SERVICE_ACCOUNT_JSON/GOOGLE_SEARCH_CONSOLE_SITE_URL
// configurados, termina con status 'no_conectado' y no guarda ninguna fila
// — nunca 'success' fingiendo datos reales (mismo criterio que
// src/demanda.js con DataForSEO). GA4 es un dato complementario: si no está
// configurado o falla, el análisis sigue con sesiones=NULL en vez de
// abortar — sesiones_ga4 nunca se inventa, solo queda ausente.
//
// Deliberadamente NO se llama desde lanzarPipelineCompleto() ni tiene
// columna en pipeline_runs (ver sql/schema.sql): es un agente bajo demanda,
// aislado del pipeline automático diario AFT->Shopify.
//
// Aviso de ingeniería: las llamadas a Search Console API (searchAnalytics
// query) y GA4 Data API (runReport, dimensión landingPagePlusQueryString)
// están construidas contra la documentación pública oficial de Google, pero
// no se han podido validar contra una cuenta real en este entorno (no hay
// credenciales disponibles para probarlas). Antes de confiar en ellas en
// producción, verificar una respuesta real una vez configuradas las
// credenciales y revisar que los nombres de campo siguen vigentes.

const { pool } = require('./db');
const googleAuth = require('./googleAuth');

const GOOGLE_SEARCH_CONSOLE_SITE_URL = process.env.GOOGLE_SEARCH_CONSOLE_SITE_URL || '';
const GOOGLE_ANALYTICS_PROPERTY_ID = process.env.GOOGLE_ANALYTICS_PROPERTY_ID || '';

const DIAS_ANALISIS = Number(process.env.SEO_GOOGLE_DIAS_ANALISIS) || 28;
const IMPRESIONES_MINIMAS = Number(process.env.SEO_GOOGLE_IMPRESIONES_MINIMAS) || 50;
const POSICION_UMBRAL = Number(process.env.SEO_GOOGLE_POSICION_UMBRAL) || 10;
// Límite de filas pedidas a Search Console por ejecución — acota el coste
// y el tamaño de la respuesta, igual que DEMANDA_MAX_KEYWORDS en demanda.js.
const MAX_PAGINAS_GSC = Number(process.env.SEO_GOOGLE_MAX_PAGINAS) || 2000;

const SCOPE_GSC = 'https://www.googleapis.com/auth/webmasters.readonly';
const SCOPE_GA4 = 'https://www.googleapis.com/auth/analytics.readonly';

function hayIntegracionGoogleConfigurada() {
  return googleAuth.hayCredencialesConfiguradas() && !!GOOGLE_SEARCH_CONSOLE_SITE_URL;
}

function hayGa4Configurado() {
  return !!GOOGLE_ANALYTICS_PROPERTY_ID;
}

function pad2(n) { return String(n).padStart(2, '0'); }
function formatearFecha(d) { return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`; }

// Search Console procesa los datos con 2-3 días de retraso real — pedir el
// día de hoy o de ayer siempre devuelve filas incompletas o vacías. Función
// pura (ahora inyectable para pruebas).
function calcularRangoFechas(dias = DIAS_ANALISIS, ahora = new Date()) {
  const fin = new Date(ahora.getTime() - 3 * 24 * 60 * 60 * 1000);
  const inicio = new Date(fin.getTime() - dias * 24 * 60 * 60 * 1000);
  return { startDate: formatearFecha(inicio), endDate: formatearFecha(fin) };
}

// Extrae el handle de una URL de producto real (.../products/<handle>,
// ignorando querystring/hash y una barra final). null para cualquier otra
// página (inicio, colecciones, blog, etc.) — este agente solo prioriza
// fichas de producto, que son las que el catálogo puede identificar.
// Función pura.
function extraerHandleDeUrl(url) {
  if (!url) return null;
  let ruta;
  try {
    ruta = new URL(url).pathname;
  } catch (e) {
    ruta = String(url);
  }
  const m = ruta.match(/\/products\/([^/?#]+)/);
  return m ? m[1] : null;
}

// Clasifica una página en los dos niveles de prioridad, o null si no
// alcanza el umbral de "alta demanda" configurado — nunca se inventa una
// categoría para una página sin suficiente señal real. Función pura.
function clasificarPagina({ impresiones, posicion }, { impresionesMinimas = IMPRESIONES_MINIMAS, posicionUmbral = POSICION_UMBRAL } = {}) {
  if (impresiones == null || impresiones < impresionesMinimas) return null;
  if (posicion == null) return null;
  return posicion > posicionUmbral ? 'alta_demanda_mal_posicionada' : 'alta_demanda_bien_posicionada';
}

// Combina una fila real de Search Console con el catálogo (por handle) y,
// si existe, las sesiones GA4 de esa misma página — y aplica la
// clasificación. Devuelve null cuando no hay handle (no es una página de
// producto) o no alcanza el umbral de alta demanda. Función pura.
function combinarFilaSeo(filaGsc, { catalogoPorHandle, sesionesPorHandle }, opts) {
  const handle = extraerHandleDeUrl(filaGsc.url);
  if (!handle) return null;
  const categoria = clasificarPagina({ impresiones: filaGsc.impresiones, posicion: filaGsc.posicion }, opts);
  if (!categoria) return null;
  const infoCatalogo = (catalogoPorHandle && catalogoPorHandle.get(handle)) || null;
  const sesiones = sesionesPorHandle && sesionesPorHandle.has(handle) ? sesionesPorHandle.get(handle) : null;
  return {
    pagina_url: filaGsc.url,
    shopify_handle: handle,
    ref: infoCatalogo ? infoCatalogo.ref : null,
    marca: infoCatalogo ? infoCatalogo.marca : null,
    descripcion: infoCatalogo ? infoCatalogo.titulo : null,
    clics: filaGsc.clics ?? null,
    impresiones: filaGsc.impresiones ?? null,
    ctr: filaGsc.ctr ?? null,
    posicion: filaGsc.posicion ?? null,
    sesiones_ga4: sesiones,
    categoria
  };
}

// ---------------------------------------------------------------------------
// Llamadas reales a Google (Search Console API + GA4 Data API).
// ---------------------------------------------------------------------------
async function consultarSearchConsole(accessToken, { startDate, endDate }) {
  const url = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(GOOGLE_SEARCH_CONSOLE_SITE_URL)}/searchAnalytics/query`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ startDate, endDate, dimensions: ['page'], rowLimit: MAX_PAGINAS_GSC })
  });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(`Search Console respondió HTTP ${resp.status}: ${(json.error && json.error.message) || 'sin detalle'}`);
  }
  const filas = json.rows || [];
  return filas.map((r) => ({
    url: r.keys && r.keys[0],
    clics: r.clicks != null ? Number(r.clicks) : null,
    impresiones: r.impressions != null ? Number(r.impressions) : null,
    ctr: r.ctr != null ? Number(r.ctr) : null,
    posicion: r.position != null ? Number(r.position) : null
  }));
}

async function consultarGA4(accessToken, { startDate, endDate }) {
  const url = `https://analyticsdata.googleapis.com/v1beta/properties/${encodeURIComponent(GOOGLE_ANALYTICS_PROPERTY_ID)}:runReport`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({
      dateRanges: [{ startDate, endDate }],
      dimensions: [{ name: 'landingPagePlusQueryString' }],
      metrics: [{ name: 'sessions' }],
      limit: MAX_PAGINAS_GSC
    })
  });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(`GA4 Data API respondió HTTP ${resp.status}: ${(json.error && json.error.message) || 'sin detalle'}`);
  }
  const filas = json.rows || [];
  const sesionesPorHandle = new Map();
  for (const fila of filas) {
    const ruta = fila.dimensionValues && fila.dimensionValues[0] && fila.dimensionValues[0].value;
    const handle = extraerHandleDeUrl(ruta);
    if (!handle) continue;
    const sesiones = Number((fila.metricValues && fila.metricValues[0] && fila.metricValues[0].value) || 0);
    sesionesPorHandle.set(handle, (sesionesPorHandle.get(handle) || 0) + sesiones);
  }
  return sesionesPorHandle;
}

async function obtenerCatalogoPorHandles(handles) {
  if (!handles.length) return new Map();
  const { rows } = await pool.query(
    `SELECT sc.shopify_handle, sc.titulo, sm.ref, sm.marca
     FROM shopify_catalogo sc
     LEFT JOIN shopify_match sm ON sm.shopify_variant_id = sc.shopify_variant_id
     WHERE sc.shopify_handle = ANY($1::text[])`,
    [handles]
  );
  const mapa = new Map();
  for (const r of rows) {
    if (!mapa.has(r.shopify_handle)) mapa.set(r.shopify_handle, { titulo: r.titulo, ref: r.ref, marca: r.marca });
  }
  return mapa;
}

const SEO_RESULTADOS_COLS = [
  'run_id', 'pagina_url', 'shopify_handle', 'ref', 'marca', 'descripcion',
  'clics', 'impresiones', 'ctr', 'posicion', 'sesiones_ga4', 'categoria'
];
async function guardarResultados(runId, filas) {
  await pool.query(`DELETE FROM seo_resultados WHERE run_id != $1`, [runId]);
  if (!filas.length) return;
  const nCols = SEO_RESULTADOS_COLS.length;
  const grupos = filas.map((_, i) => `(${SEO_RESULTADOS_COLS.map((__, c) => `$${i * nCols + c + 1}`).join(',')}, now())`);
  const params = filas.flatMap((f) => [runId, ...SEO_RESULTADOS_COLS.slice(1).map((c) => (f[c] !== undefined ? f[c] : null))]);
  await pool.query(
    `INSERT INTO seo_resultados (${SEO_RESULTADOS_COLS.join(',')}, checked_at) VALUES ${grupos.join(', ')}`,
    params
  );
}

// ---------------------------------------------------------------------------
// Orquestación del agente — igual forma que ejecutarAnalisisDemanda().
// ---------------------------------------------------------------------------
async function ejecutarAnalisisSeoGoogle(existingRunId) {
  let runId = existingRunId;
  if (runId) {
    await pool.query(`UPDATE seo_runs SET fase = 'iniciando' WHERE id = $1`, [runId]);
  } else {
    const { rows } = await pool.query(`INSERT INTO seo_runs (status, fase) VALUES ('running', 'iniciando') RETURNING id`);
    runId = rows[0].id;
  }

  if (!hayIntegracionGoogleConfigurada()) {
    await pool.query(
      `UPDATE seo_runs SET status = 'no_conectado', finished_at = now(), fase = 'done',
         dias_analizados = $2, error_message = $3
       WHERE id = $1`,
      [runId, DIAS_ANALISIS, 'GOOGLE_SERVICE_ACCOUNT_JSON/GOOGLE_SEARCH_CONSOLE_SITE_URL no configurados — sin esta conexión no hay demanda real de Search Console que analizar.']
    );
    return { runId, conectado: false, totalPaginasGsc: 0, totalCruzadas: 0 };
  }

  try {
    const rango = calcularRangoFechas(DIAS_ANALISIS);
    await pool.query(`UPDATE seo_runs SET fase = 'consultando_search_console', dias_analizados = $2 WHERE id = $1`, [runId, DIAS_ANALISIS]);

    const tokenGsc = await googleAuth.obtenerAccessToken(hayGa4Configurado() ? [SCOPE_GSC, SCOPE_GA4] : [SCOPE_GSC]);
    const filasGsc = await consultarSearchConsole(tokenGsc, rango);

    let sesionesPorHandle = new Map();
    let ga4Disponible = false;
    if (hayGa4Configurado()) {
      await pool.query(`UPDATE seo_runs SET fase = 'consultando_ga4' WHERE id = $1`, [runId]);
      try {
        sesionesPorHandle = await consultarGA4(tokenGsc, rango);
        ga4Disponible = true;
      } catch (e) {
        // GA4 es complementario: su fallo no invalida el análisis de
        // Search Console, pero queda registrado — sesiones_ga4 queda NULL
        // en vez de inventar un valor.
        console.error('[seoGoogle] GA4 no disponible para esta ejecución:', e.message);
      }
    }

    await pool.query(`UPDATE seo_runs SET fase = 'cruzando_catalogo' WHERE id = $1`, [runId]);
    const handlesUnicos = [...new Set(filasGsc.map((f) => extraerHandleDeUrl(f.url)).filter(Boolean))];
    const catalogoPorHandle = await obtenerCatalogoPorHandles(handlesUnicos);

    const resultados = [];
    for (const fila of filasGsc) {
      const combinada = combinarFilaSeo(fila, { catalogoPorHandle, sesionesPorHandle });
      if (combinada) resultados.push(combinada);
    }

    await guardarResultados(runId, resultados);

    const malPosicionadas = resultados.filter((r) => r.categoria === 'alta_demanda_mal_posicionada').length;
    const bienPosicionadas = resultados.filter((r) => r.categoria === 'alta_demanda_bien_posicionada').length;
    const totalCruzadas = resultados.filter((r) => r.ref != null).length;

    await pool.query(
      `UPDATE seo_runs SET status = 'success', finished_at = now(), fase = 'done',
         total_paginas_gsc = $2, total_cruzadas_catalogo = $3,
         alta_demanda_mal_posicionada = $4, alta_demanda_bien_posicionada = $5,
         ga4_disponible = $6, error_message = NULL
       WHERE id = $1`,
      [runId, filasGsc.length, totalCruzadas, malPosicionadas, bienPosicionadas, ga4Disponible]
    );

    return { runId, conectado: true, totalPaginasGsc: filasGsc.length, totalCruzadas, malPosicionadas, bienPosicionadas, ga4Disponible };
  } catch (e) {
    await pool.query(
      `UPDATE seo_runs SET status = 'error', finished_at = now(), fase = 'error', error_message = $2 WHERE id = $1`,
      [runId, e.message]
    );
    throw e;
  }
}

module.exports = {
  hayIntegracionGoogleConfigurada, hayGa4Configurado, calcularRangoFechas, extraerHandleDeUrl,
  clasificarPagina, combinarFilaSeo, ejecutarAnalisisSeoGoogle,
  DIAS_ANALISIS, IMPRESIONES_MINIMAS, POSICION_UMBRAL
};
