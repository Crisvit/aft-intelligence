// AFT 2.0 — dashboard independiente de Herramitienda.
// Lee AFT y Shopify (solo lectura), guarda en hmt-db (Postgres propio),
// sirve el panel con el renderer original. No existe código de escritura
// hacia Shopify en todo este proyecto.

const express = require('express');
const bcrypt = require('bcryptjs');
const { pool } = require('./src/db');
const { runInventorySync, ingestAft } = require('./src/sync');
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

// Importa SOLO el catálogo/categorías/stock de AFT a hmt-db — no llama a
// Shopify en ningún punto (ingestAft() no referencia el cliente de Shopify).
// Corre en segundo plano (responde 202 de inmediato) con el progreso real
// guardado en aft_import_runs, para no depender de un timeout HTTP largo
// y para poder sondear el avance desde el dashboard.
const IMPORT_STALE_MS = 2 * 60 * 60 * 1000; // una importación "running" más antigua que esto se considera un proceso interrumpido

app.post('/api/aft-import', basicAuth, async (req, res) => {
  try {
    const { rows: enCursoRows } = await pool.query(
      `SELECT id, started_at FROM aft_import_runs WHERE status = 'running' ORDER BY started_at DESC LIMIT 1`
    );
    if (enCursoRows.length) {
      const enCurso = enCursoRows[0];
      const antiguedadMs = Date.now() - new Date(enCurso.started_at).getTime();
      if (antiguedadMs < IMPORT_STALE_MS) {
        return res.status(409).json({ ok: false, error: 'Ya hay una importación de AFT en curso.', runId: enCurso.id });
      }
      await pool.query(
        `UPDATE aft_import_runs SET status='error', finished_at=now(), error_message='Proceso interrumpido (reinicio del servicio o bloqueo de más de 2h)' WHERE id=$1`,
        [enCurso.id]
      );
    }

    const { rows: nuevoRows } = await pool.query(
      `INSERT INTO aft_import_runs (status, fase) VALUES ('running', 'iniciando') RETURNING id`
    );
    const runId = nuevoRows[0].id;

    res.status(202).json({ ok: true, runId, status: 'running' });

    ingestAft(runId)
      .then(async () => {
        await pool.query(`UPDATE aft_import_runs SET status='success', finished_at=now() WHERE id=$1`, [runId]);
      })
      .catch(async (e) => {
        console.error('[aft-import] Error en la importación en segundo plano:', e.message);
        await pool.query(
          `UPDATE aft_import_runs SET status='error', finished_at=now(), error_message=$2 WHERE id=$1`,
          [runId, e.message]
        );
      });
  } catch (e) {
    console.error('[aft-import] Error al iniciar la importación:', e.message);
    if (!res.headersSent) res.status(502).json({ ok: false, error: e.message });
  }
});

// Progreso/resultado de la última importación AFT, para el polling del dashboard.
app.get('/api/aft-import/estado', basicAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT * FROM aft_import_runs ORDER BY id DESC LIMIT 1`);
    res.json({ ok: true, run: rows[0] || null });
  } catch (e) {
    console.error('[aft-import/estado] Error leyendo el progreso:', e.message);
    res.status(502).json({ ok: false, error: e.message });
  }
});

// Lanza una comparación real AFT <-> Shopify, solo lectura. Nunca escribe
// en Shopify — no existe ningún endpoint ni función que lo haga. Corre en
// segundo plano (202 inmediato) porque ahora pagina todo el catálogo de
// Shopify antes de comparar; el progreso real se sigue en sync_runs.
const SYNC_STALE_MS = 2 * 60 * 60 * 1000; // una sincronización "running" más antigua que esto se considera un proceso interrumpido

app.post('/api/sync-run', basicAuth, async (req, res) => {
  try {
    const { rows: enCursoRows } = await pool.query(
      `SELECT id, started_at FROM sync_runs WHERE status = 'running' ORDER BY started_at DESC LIMIT 1`
    );
    if (enCursoRows.length) {
      const enCurso = enCursoRows[0];
      const antiguedadMs = Date.now() - new Date(enCurso.started_at).getTime();
      if (antiguedadMs < SYNC_STALE_MS) {
        return res.status(409).json({ ok: false, error: 'Ya hay una sincronización Shopify en curso.', runId: enCurso.id });
      }
      await pool.query(
        `UPDATE sync_runs SET status='error', finished_at=now(), fase='error', error_message='Proceso interrumpido (reinicio del servicio o bloqueo de más de 2h)' WHERE id=$1`,
        [enCurso.id]
      );
    }

    const { rows: nuevoRows } = await pool.query(
      `INSERT INTO sync_runs (started_at, status, fase) VALUES (now(), 'running', 'iniciando') RETURNING id`
    );
    const runId = nuevoRows[0].id;

    res.status(202).json({ ok: true, runId, status: 'running' });

    runInventorySync(runId).catch((e) => {
      console.error('[sync-run] Error en la sincronización en segundo plano:', e.message);
    });
  } catch (e) {
    console.error('[sync-run] Error al iniciar la sincronización:', e.message);
    if (!res.headersSent) res.status(502).json({ ok: false, error: e.message });
  }
});

// Progreso/resultado de la última sincronización Shopify, para polling.
app.get('/api/sync-run/estado', basicAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT * FROM sync_runs ORDER BY id DESC LIMIT 1`);
    res.json({ ok: true, run: rows[0] || null });
  } catch (e) {
    console.error('[sync-run/estado] Error leyendo el progreso:', e.message);
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
