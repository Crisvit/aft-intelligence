// AFT 2.0 — dashboard independiente de Herramitienda.
// Lee AFT y Shopify (solo lectura), guarda en hmt-db (Postgres propio),
// sirve el panel con el renderer original. No existe código de escritura
// hacia Shopify en todo este proyecto.

const express = require('express');
const bcrypt = require('bcryptjs');
const { pool } = require('./src/db');
const { runInventorySync, ingestAft, BRANDS_PRIORITARIAS, STOCK_MINIMO_OPORTUNIDAD } = require('./src/sync');
const { ejecutarAnalisisRentabilidad } = require('./src/rentabilidad');
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

// Los cuatro agentes en segundo plano (importar AFT, sincronizar Shopify,
// rentabilidad, pipeline completo) comparten un único candado: antes de
// lanzar cualquiera de ellos se comprueba que ninguno de los otros esté
// "running", para evitar ejecuciones simultáneas entre agentes (no solo
// dentro del mismo agente). Un "running" más viejo que PROCESO_STALE_MS se
// considera un proceso interrumpido (p.ej. por un reinicio del servicio) y
// se marca como error en vez de bloquear para siempre.
const PROCESO_STALE_MS = 2 * 60 * 60 * 1000;
const TABLA_POR_TIPO = {
  aft_import: 'aft_import_runs', sync: 'sync_runs', rentabilidad: 'rentabilidad_runs', pipeline: 'pipeline_runs'
};

async function haySolapamiento() {
  const { rows } = await pool.query(`
    SELECT 'aft_import' AS tipo, id, started_at FROM aft_import_runs WHERE status = 'running'
    UNION ALL SELECT 'sync', id, started_at FROM sync_runs WHERE status = 'running'
    UNION ALL SELECT 'rentabilidad', id, started_at FROM rentabilidad_runs WHERE status = 'running'
    UNION ALL SELECT 'pipeline', id, started_at FROM pipeline_runs WHERE status = 'running'
    ORDER BY started_at ASC LIMIT 1
  `);
  if (!rows.length) return null;
  const activo = rows[0];
  const antiguedadMs = Date.now() - new Date(activo.started_at).getTime();
  if (antiguedadMs < PROCESO_STALE_MS) return activo;

  await pool.query(
    `UPDATE ${TABLA_POR_TIPO[activo.tipo]} SET status='error', finished_at=now(), error_message='Proceso interrumpido (reinicio del servicio o bloqueo de más de 2h)' WHERE id=$1`,
    [activo.id]
  );
  return null;
}

// Importa SOLO el catálogo/categorías/stock de AFT a hmt-db — no llama a
// Shopify en ningún punto (ingestAft() no referencia el cliente de Shopify).
// Corre en segundo plano (responde 202 de inmediato) con el progreso real
// guardado en aft_import_runs, para no depender de un timeout HTTP largo
// y para poder sondear el avance desde el dashboard.
app.post('/api/aft-import', basicAuth, async (req, res) => {
  try {
    const enCurso = await haySolapamiento();
    if (enCurso) {
      return res.status(409).json({ ok: false, error: `Ya hay un proceso en curso (${enCurso.tipo} #${enCurso.id}).` });
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
app.post('/api/sync-run', basicAuth, async (req, res) => {
  try {
    const enCurso = await haySolapamiento();
    if (enCurso) {
      return res.status(409).json({ ok: false, error: `Ya hay un proceso en curso (${enCurso.tipo} #${enCurso.id}).` });
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

// Agente de rentabilidad: coste desglosado + transporte al cliente
// configurado + margen real/proyectado + alertas. Solo lee shopify_match/
// aft_catalogo ya guardados — no llama a Shopify ni a AFT.
app.post('/api/rentabilidad-run', basicAuth, async (req, res) => {
  try {
    const enCurso = await haySolapamiento();
    if (enCurso) {
      return res.status(409).json({ ok: false, error: `Ya hay un proceso en curso (${enCurso.tipo} #${enCurso.id}).` });
    }

    const { rows: nuevoRows } = await pool.query(
      `INSERT INTO rentabilidad_runs (status, fase) VALUES ('running', 'iniciando') RETURNING id`
    );
    const runId = nuevoRows[0].id;

    res.status(202).json({ ok: true, runId, status: 'running' });

    ejecutarAnalisisRentabilidad(runId).catch((e) => {
      console.error('[rentabilidad-run] Error en el análisis en segundo plano:', e.message);
    });
  } catch (e) {
    console.error('[rentabilidad-run] Error al iniciar el análisis:', e.message);
    if (!res.headersSent) res.status(502).json({ ok: false, error: e.message });
  }
});

app.get('/api/rentabilidad-run/estado', basicAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT * FROM rentabilidad_runs ORDER BY id DESC LIMIT 1`);
    res.json({ ok: true, run: rows[0] || null });
  } catch (e) {
    console.error('[rentabilidad-run/estado] Error leyendo el progreso:', e.message);
    res.status(502).json({ ok: false, error: e.message });
  }
});

// Automatización (prioridad 2): encadena importación AFT -> sincronización
// Shopify (solo lectura) -> análisis de rentabilidad, en ese orden, en
// segundo plano. Cada etapa sigue usando su propia tabla de progreso —
// pipeline_runs solo guarda qué etapa va y enlaza los 3 run_id reales.
// Crea la fila de pipeline_runs y encadena las 3 etapas en segundo plano.
// La usan tanto la ruta POST /api/pipeline-run como el programador opcional
// (ver PIPELINE_SCHEDULE_HOURS más abajo) para no duplicar la secuencia.
async function lanzarPipelineCompleto() {
  const { rows: nuevoRows } = await pool.query(
    `INSERT INTO pipeline_runs (status, etapa) VALUES ('running', 'import_aft') RETURNING id`
  );
  const pipelineId = nuevoRows[0].id;

  (async () => {
    try {
      const { rows: importRows } = await pool.query(
        `INSERT INTO aft_import_runs (status, fase) VALUES ('running', 'iniciando') RETURNING id`
      );
      const importRunId = importRows[0].id;
      await pool.query(`UPDATE pipeline_runs SET aft_import_run_id = $2 WHERE id = $1`, [pipelineId, importRunId]);
      await ingestAft(importRunId);
      await pool.query(`UPDATE aft_import_runs SET status='success', finished_at=now() WHERE id=$1`, [importRunId]);

      await pool.query(`UPDATE pipeline_runs SET etapa = 'sync_shopify' WHERE id = $1`, [pipelineId]);
      const { rows: syncRows } = await pool.query(
        `INSERT INTO sync_runs (started_at, status, fase) VALUES (now(), 'running', 'iniciando') RETURNING id`
      );
      const syncRunId = syncRows[0].id;
      await pool.query(`UPDATE pipeline_runs SET sync_run_id = $2 WHERE id = $1`, [pipelineId, syncRunId]);
      await runInventorySync(syncRunId);

      await pool.query(`UPDATE pipeline_runs SET etapa = 'rentabilidad' WHERE id = $1`, [pipelineId]);
      const { rows: rentRows } = await pool.query(
        `INSERT INTO rentabilidad_runs (status, fase) VALUES ('running', 'iniciando') RETURNING id`
      );
      const rentRunId = rentRows[0].id;
      await pool.query(`UPDATE pipeline_runs SET rentabilidad_run_id = $2 WHERE id = $1`, [pipelineId, rentRunId]);
      await ejecutarAnalisisRentabilidad(rentRunId);

      await pool.query(`UPDATE pipeline_runs SET status = 'success', finished_at = now(), etapa = 'done' WHERE id = $1`, [pipelineId]);
    } catch (e) {
      console.error('[pipeline-run] Error en el pipeline en segundo plano:', e.message);
      await pool.query(
        `UPDATE pipeline_runs SET status = 'error', finished_at = now(), error_message = $2 WHERE id = $1`,
        [pipelineId, e.message]
      );
    }
  })();

  return pipelineId;
}

app.post('/api/pipeline-run', basicAuth, async (req, res) => {
  try {
    const enCurso = await haySolapamiento();
    if (enCurso) {
      return res.status(409).json({ ok: false, error: `Ya hay un proceso en curso (${enCurso.tipo} #${enCurso.id}).` });
    }
    const pipelineId = await lanzarPipelineCompleto();
    res.status(202).json({ ok: true, pipelineId, status: 'running' });
  } catch (e) {
    console.error('[pipeline-run] Error al iniciar el pipeline:', e.message);
    if (!res.headersSent) res.status(502).json({ ok: false, error: e.message });
  }
});

app.get('/api/pipeline-run/estado', basicAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT * FROM pipeline_runs ORDER BY id DESC LIMIT 1`);
    res.json({ ok: true, run: rows[0] || null });
  } catch (e) {
    console.error('[pipeline-run/estado] Error leyendo el progreso:', e.message);
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

  const { rows: ultimoSyncRows } = await pool.query(`SELECT * FROM sync_runs ORDER BY id DESC LIMIT 1`);
  const ultimoSync = ultimoSyncRows[0] || null;

  const { rows: ultimaImportRows } = await pool.query(`SELECT * FROM aft_import_runs ORDER BY id DESC LIMIT 1`);
  const ultimaImport = ultimaImportRows[0] || null;

  const { rows: ultimaRentabilidadRows } = await pool.query(`SELECT * FROM rentabilidad_runs ORDER BY id DESC LIMIT 1`);
  const ultimaRentabilidad = ultimaRentabilidadRows[0] || null;

  const { rows: ultimoPipelineRows } = await pool.query(`SELECT * FROM pipeline_runs ORDER BY id DESC LIMIT 1`);
  const ultimoPipeline = ultimoPipelineRows[0] || null;

  // Productos que requieren atención: pérdida o margen bajo, de la última
  // ejecución del agente de rentabilidad (prioridad 1).
  const { rows: rentabilidadResultados } = await pool.query(
    `SELECT * FROM rentabilidad_resultados WHERE estado_rentabilidad IN ('perdida','margen_bajo') ORDER BY margen_pct ASC NULLS LAST`
  );

  const { rows: rentabilidadAlertas } = await pool.query(
    `SELECT ref, tipo, detalle, valor, detectado_en FROM rentabilidad_alertas ORDER BY detectado_en DESC LIMIT 100`
  );

  const { rows: historialSyncRows } = await pool.query(
    `SELECT id, started_at, finished_at, status, error_message,
            total_matched, total_cambiarian, total_a_cero, total_sin_cambio, total_incidencias
     FROM sync_runs ORDER BY started_at DESC LIMIT 20`
  );

  // Coincidencias reales y FIABLES: solo lo que el matching por EAN/SKU
  // emparejó sin ambigüedad (cambios propuestos, a stock cero, sin cambios).
  // Las coincidencias ambiguas (EAN duplicado, múltiples ubicaciones, SKU no
  // inequívoco) quedan fuera a propósito — esas se gestionan como incidencia,
  // no como una coincidencia fiable. La marca mostrada es la de aft_catalogo
  // (AFT real), nunca el vendor de Shopify.
  const { rows: matchRows } = await pool.query(
    `SELECT sm.ref, c.descripcion_corta AS descripcion, c.marca AS marca_aft, sm.matched_by,
            sm.stock_aft, sm.shopify_stock, sm.stock_diferencia,
            sm.coste_aft_sin_iva, sm.coste_aft_con_impuestos, sm.shopify_cost, sm.shopify_price,
            sm.precio_venta_aft, sm.estado
     FROM shopify_match sm
     LEFT JOIN aft_catalogo c ON c.ref = sm.ref
     WHERE sm.estado IN ('cambiaria','a_cero','sin_cambio')
     ORDER BY sm.estado, sm.ref`
  );

  const { rows: incidenciaRows } = await pool.query(
    `SELECT ref, tipo, detalle, detectado_en FROM incidencias ORDER BY detectado_en DESC LIMIT 100`
  );

  // Oportunidades reales: referencias AFT de marcas/categorías comerciales
  // que el último control de inventario NO encontró en Shopify (prioridad 2
  // — separado del control de inventario, que cruza TODAS las referencias).
  // Se priorizan Wolfpack/Samurai/Maurer/Papillon/Saturnia (configurable vía
  // AFT_BRANDS_PRIORITARIAS), y dentro de cada grupo, por margen.
  const { rows: oportunidadRowsRaw } = await pool.query(
    `SELECT sm.ref, sm.ean, sm.marca, c.descripcion_corta AS descripcion, sm.stock_aft AS stock,
            sm.precio_venta_aft AS precio, sm.coste_para_margen AS coste,
            sm.margen_con_precio_aft_pct AS "margenPct"
     FROM shopify_match sm
     JOIN aft_catalogo c ON c.ref = sm.ref
     WHERE sm.estado = 'no_encontrado' AND sm.es_oportunidad_comercial = true AND sm.stock_aft >= $1
     LIMIT 500`,
    [STOCK_MINIMO_OPORTUNIDAD]
  );
  const esPrioritaria = (marca) => BRANDS_PRIORITARIAS.some((m) => String(marca || '').toUpperCase().includes(m));
  const oportunidadRows = oportunidadRowsRaw.slice().sort((a, b) => {
    const prioA = esPrioritaria(a.marca) ? 1 : 0;
    const prioB = esPrioritaria(b.marca) ? 1 : 0;
    if (prioA !== prioB) return prioB - prioA;
    return (Number(b.margenPct) || 0) - (Number(a.margenPct) || 0);
  }).slice(0, 200).map((r) => ({ ...r, esPrioritaria: esPrioritaria(r.marca) }));

  // Catálogo completo de Shopify (todas las variantes, ya leídas por
  // getAllVariants y guardadas por runInventorySync) cruzado con el
  // matching real para identificar el proveedor — nunca por vendor ni por
  // similitud de nombre. Si no hay coincidencia fiable, se marca "sin
  // identificar": no se adivina ni se etiqueta como ningún otro proveedor.
  const { rows: productosShopify } = await pool.query(
    `SELECT sc.shopify_variant_id, sc.titulo, sc.vendor_shopify, sc.estado, sc.sku, sc.barcode,
            sc.precio, sc.stock_ubicacion_principal AS stock, sc.imagen_url,
            sm.ref AS aft_ref
     FROM shopify_catalogo sc
     LEFT JOIN shopify_match sm
       ON sm.shopify_variant_id = sc.shopify_variant_id AND sm.estado IN ('cambiaria','a_cero','sin_cambio')
     ORDER BY sc.titulo NULLS LAST, sc.shopify_variant_id`
  );

  const html = buildDashboardHtml({
    productosShopify, ultimoSync, ultimaImport, matchRows, incidenciaRows, oportunidadRows, historialSyncRows,
    ultimaRentabilidad, ultimoPipeline, rentabilidadResultados, rentabilidadAlertas,
    stockMinimoOportunidad: STOCK_MINIMO_OPORTUNIDAD
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

// Programación automática del pipeline completo — DESACTIVADA por defecto.
// Solo se activa si se define PIPELINE_SCHEDULE_HOURS explícitamente en el
// entorno (no viene en .env.example con un valor real a propósito): desplegar
// este código no hace que se ejecute nada automáticamente por sí solo.
const PIPELINE_SCHEDULE_HOURS = Number(process.env.PIPELINE_SCHEDULE_HOURS) || 0;
if (PIPELINE_SCHEDULE_HOURS > 0) {
  const intervaloMs = PIPELINE_SCHEDULE_HOURS * 60 * 60 * 1000;
  console.log(`[pipeline] Programado automáticamente cada ${PIPELINE_SCHEDULE_HOURS}h (PIPELINE_SCHEDULE_HOURS).`);
  setInterval(async () => {
    try {
      const enCurso = await haySolapamiento();
      if (enCurso) {
        console.log(`[pipeline] Ejecución programada omitida: ya hay un proceso en curso (${enCurso.tipo} #${enCurso.id}).`);
        return;
      }
      console.log('[pipeline] Lanzando ejecución programada del pipeline completo...');
      await lanzarPipelineCompleto();
    } catch (e) {
      console.error('[pipeline] Error en la ejecución programada:', e.message);
    }
  }, intervaloMs);
}

app.listen(PORT, () => {
  console.log('AFT Intelligence escuchando en el puerto', PORT);
});
