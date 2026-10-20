// AFT 2.0 — dashboard independiente de Herramitienda.
// Lee AFT y Shopify (solo lectura), guarda en hmt-db (Postgres propio),
// sirve el panel con el renderer original. No existe código de escritura
// hacia Shopify en todo este proyecto.

const express = require('express');
const bcrypt = require('bcryptjs');
const { pool } = require('./src/db');
const { runInventorySync } = require('./src/sync');
const shopify = require('./src/shopifyClient');
const { buildDashboardHtml } = require('./src/buildDashboardHtml');

const app = express();
const PORT = process.env.PORT || 3000;

const DASHBOARD_USER = process.env.DASHBOARD_USER;
const DASHBOARD_PASSWORD_HASH = process.env.DASHBOARD_PASSWORD_HASH;

function basicAuth(req, res, next) {
  if (!DASHBOARD_USER || !DASHBOARD_PASSWORD_HASH) {
    res.status(500).send('Faltan DASHBOARD_USER / DASHBOARD_PASSWORD_HASH en el entorno.');
    return;
  }
  const header = req.headers.authorization || '';
  const [scheme, encoded] = header.split(' ');
  if (scheme !== 'Basic' || !encoded) {
    res.set('WWW-Authenticate', 'Basic realm="AFT Intelligence"');
    return res.status(401).send('Autenticación requerida.');
  }
  const decoded = Buffer.from(encoded, 'base64').toString('utf8');
  const idx = decoded.indexOf(':');
  const user = decoded.slice(0, idx);
  const pass = decoded.slice(idx + 1);
  if (user !== DASHBOARD_USER || !bcrypt.compareSync(pass, DASHBOARD_PASSWORD_HASH)) {
    res.set('WWW-Authenticate', 'Basic realm="AFT Intelligence"');
    return res.status(401).send('Credenciales incorrectas.');
  }
  next();
}

app.use((req, res, next) => {
  res.set('X-Robots-Tag', 'noindex, nofollow');
  next();
});

app.get('/healthz', (req, res) => res.status(200).send('ok'));

// Estado real de las conexiones — sin exponer ningún secreto.
app.get('/status', basicAuth, async (req, res) => {
  const result = { db: null, shopify: null, checkedAt: new Date().toISOString() };
  try {
    const { rows } = await pool.query(
      `SELECT (SELECT count(*) FROM aft_catalogo) AS catalogo,
              (SELECT count(*) FROM aft_stock_precios) AS stock,
              (SELECT count(*) FROM shopify_match) AS matches,
              (SELECT count(*) FROM incidencias WHERE estado='pendiente') AS incidencias_pendientes`
    );
    result.db = { ok: true, ...rows[0] };
  } catch (e) {
    result.db = { ok: false, error: e.message };
  }
  try {
    await shopify.getShopifyToken();
    result.shopify = { ok: true };
  } catch (e) {
    result.shopify = { ok: false, error: e.message };
  }
  res.json(result);
});

// Lanza una comparación real AFT <-> Shopify, solo lectura. Nunca escribe
// en Shopify — no existe ningún endpoint ni función que lo haga.
app.post('/api/sync-run', basicAuth, async (req, res) => {
  try {
    const result = await runInventorySync();
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message });
  }
});

// Informe de diferencias de inventario, en JSON, para integraciones o revisión manual.
app.get('/api/diff', basicAuth, async (req, res) => {
  const { rows } = await pool.query(`SELECT * FROM shopify_match ORDER BY checked_at DESC`);
  const { rows: incRows } = await pool.query(`SELECT * FROM incidencias WHERE estado='pendiente' ORDER BY detectado_en DESC`);
  res.json({
    totalIdentificados: rows.length,
    cambiarian: rows.filter((r) => r.estado === 'cambiaria'),
    aCero: rows.filter((r) => r.estado === 'a_cero'),
    sinCambio: rows.filter((r) => r.estado === 'sin_cambio').length,
    incidencias: incRows,
    noEncontrados: rows.filter((r) => r.estado === 'no_encontrado')
  });
});

let cache = { html: null, builtAt: 0 };
const CACHE_MS = 30 * 1000;

async function renderDashboard() {
  const now = Date.now();
  if (cache.html && (now - cache.builtAt) < CACHE_MS) return cache.html;

  const { rows: syncRows } = await pool.query(
    `SELECT id, started_at, finished_at, total_matched AS actualizados, total_no_encontrados AS "noEncontrados",
            0 AS errores, status AS estado, started_at AS "createdAt"
     FROM sync_runs ORDER BY started_at DESC LIMIT 20`
  );
  const { rows: detailRows } = await pool.query(
    `SELECT ref, ean, shopify_product_title AS titulo, shopify_price AS "precioAnterior",
            precio_venta_aft AS "precioNuevo", shopify_stock AS "stockAnterior",
            stock_aft AS "stockNuevo", checked_at AS fecha
     FROM shopify_match WHERE estado IN ('cambiaria','a_cero') ORDER BY checked_at DESC LIMIT 500`
  );

  let shopifyProductsRaw = { data: { products: { edges: [] } } };
  try {
    const token = await shopify.getShopifyToken();
    shopifyProductsRaw = await shopify.listProducts(token);
  } catch (e) {
    console.error('[dashboard] No se pudo leer productos de Shopify:', e.message);
  }

  const html = buildDashboardHtml({
    syncRows,
    shopifyProductsRaw,
    candRows: [],
    draftRows: [],
    detailRows,
    demandSignalsRows: [],
    scoresV3Rows: []
  });

  cache = { html, builtAt: now };
  return html;
}

app.get('/', basicAuth, async (req, res) => {
  try {
    const html = await renderDashboard();
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err) {
    console.error('Error generando el dashboard:', err.message);
    res.status(502).send('No se pudo generar el dashboard. Revisa los logs del servicio o /status.');
  }
});

app.listen(PORT, () => {
  console.log('AFT Intelligence escuchando en el puerto', PORT);
});
