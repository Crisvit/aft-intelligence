// Agente 5 — Demanda y SEO. Genera candidatos de keyword a partir de datos
// reales del catálogo (marca + categoría + descripción) para las
// oportunidades ya detectadas por el Agente 4 (src/oportunidades.js), y
// consulta volumen de búsqueda/competencia REAL solo si hay una
// integración autorizada y conectada (DataForSEO — la misma fuente que
// usaba la primera versión del panel, confirmada al revisar un backup real
// de ese workflow). Sin credenciales configuradas, el agente termina con
// status 'no_conectado' — nunca 'success' fingiendo tener datos reales — y
// guarda únicamente los candidatos derivados del catálogo, marcados
// explícitamente "sugeridos, sin verificar" (verificado=false,
// volumen_busqueda/competencia=NULL).
//
// Por qué esto importa: el backup de la primera versión revisado para este
// trabajo mostraba que su sistema de "scores_v3" asignaba una demanda por
// DEFECTO (12.5 sobre 25 puntos) incluso sin ninguna señal real conectada,
// es decir, inventaba un número plausible para rellenar el hueco. Este
// agente nunca hace eso: sin una fuente real, el dato queda NULL.
//
// Aviso de ingeniería: la llamada a DataForSEO está construida contra su
// documentación pública oficial (endpoint, cuerpo de la petición y
// autenticación Basic con login/password), pero no se ha podido validar
// contra una cuenta real en este entorno (no hay credenciales disponibles
// para probarla). Antes de confiar en ella en producción, verificar una
// respuesta real una vez configuradas DATAFORSEO_LOGIN/DATAFORSEO_PASSWORD
// y revisar que los nombres de campo (search_volume, competition) siguen
// vigentes en su API.
const { pool } = require('./db');

const DATAFORSEO_LOGIN = process.env.DATAFORSEO_LOGIN || '';
const DATAFORSEO_PASSWORD = process.env.DATAFORSEO_PASSWORD || '';
const DATAFORSEO_LOCATION = process.env.DATAFORSEO_LOCATION_NAME || 'Spain';
const DATAFORSEO_LANGUAGE = process.env.DATAFORSEO_LANGUAGE_CODE || 'es';
// Límite de keywords por ejecución — controla el coste de la llamada
// externa (DataForSEO cobra por petición, no por keyword, pero igualmente
// se acota para no crecer sin control junto con el catálogo).
const MAX_KEYWORDS_POR_EJECUCION = Number(process.env.DEMANDA_MAX_KEYWORDS) || 50;

function hayIntegracionConfigurada() {
  return !!(DATAFORSEO_LOGIN && DATAFORSEO_PASSWORD);
}

// Candidatos derivados literalmente del catálogo real — nunca generados
// por un modelo de IA, nunca con un volumen o tendencia inventados. Solo
// combinaciones simples y defendibles de datos que ya existen en hmt-db.
function generarCandidatosDesdeCatalogo(row) {
  const candidatos = new Set();
  const marca = String(row.marca || '').trim();
  const categoria = String(row.categoria_nombre || '').trim();
  const descripcion = String(row.descripcion || '').trim();
  if (marca && categoria) candidatos.add(`${marca} ${categoria}`.toLowerCase());
  if (descripcion) candidatos.add(descripcion.toLowerCase());
  if (marca && descripcion) candidatos.add(`${marca} ${descripcion}`.toLowerCase());
  return [...candidatos].filter(Boolean);
}

// Llamada real a DataForSEO (keywords_data/google_ads/search_volume/live).
// Lanza si la API responde con error — quien llama decide cómo degradar.
async function consultarVolumenRealDataForSEO(keywords) {
  const auth = Buffer.from(`${DATAFORSEO_LOGIN}:${DATAFORSEO_PASSWORD}`).toString('base64');
  const resp = await fetch('https://api.dataforseo.com/v3/keywords_data/google_ads/search_volume/live', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Basic ${auth}` },
    body: JSON.stringify([{ keywords, location_name: DATAFORSEO_LOCATION, language_code: DATAFORSEO_LANGUAGE }])
  });
  if (!resp.ok) {
    throw new Error(`DataForSEO respondió HTTP ${resp.status}`);
  }
  const json = await resp.json();
  if (json.status_code != null && json.status_code !== 20000) {
    throw new Error(`DataForSEO status_code ${json.status_code}: ${json.status_message || 'sin detalle'}`);
  }
  const resultados = (json.tasks && json.tasks[0] && json.tasks[0].result) || [];
  const porKeyword = {};
  for (const r of resultados) {
    if (!r || !r.keyword) continue;
    porKeyword[String(r.keyword).toLowerCase()] = {
      volumen: r.search_volume != null ? Number(r.search_volume) : null,
      competencia: r.competition != null ? String(r.competition) : null
    };
  }
  return porKeyword;
}

async function registrarResultado(runId, f) {
  await pool.query(
    `INSERT INTO demanda_resultados (run_id, ref, keyword, origen, volumen_busqueda, competencia, verificado)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [runId, f.ref, f.keyword, f.origen, f.volumen ?? null, f.competencia ?? null, f.verificado]
  );
}

// ---------------------------------------------------------------------------
// Universo: las oportunidades ya puntuadas por el Agente 4 (mejor score
// primero), acotado a MAX_KEYWORDS_POR_EJECUCION keywords en total — no
// recorre todo el catálogo AFT sin límite.
// ---------------------------------------------------------------------------
async function ejecutarAnalisisDemanda(existingRunId) {
  let runId = existingRunId;
  if (runId) {
    await pool.query(`UPDATE demanda_runs SET fase = 'iniciando' WHERE id = $1`, [runId]);
  } else {
    const { rows } = await pool.query(`INSERT INTO demanda_runs (status, fase) VALUES ('running', 'iniciando') RETURNING id`);
    runId = rows[0].id;
  }

  try {
    // Igual que rentabilidad_resultados/oportunidades_resultados: se
    // reemplazan los resultados de ejecuciones anteriores, es una foto de
    // la última ejecución (el historial de ejecuciones vive en demanda_runs).
    await pool.query(`DELETE FROM demanda_resultados WHERE run_id != $1`, [runId]);

    const { rows: oportunidades } = await pool.query(
      `SELECT ref, marca, categoria_nombre, descripcion FROM oportunidades_resultados ORDER BY score DESC NULLS LAST LIMIT 200`
    );

    // Candidatos por referencia, deduplicados globalmente, acotados al límite configurado.
    const candidatosPorRef = [];
    const vistos = new Set();
    for (const row of oportunidades) {
      for (const kw of generarCandidatosDesdeCatalogo(row)) {
        if (vistos.has(kw)) continue;
        if (candidatosPorRef.length >= MAX_KEYWORDS_POR_EJECUCION) break;
        vistos.add(kw);
        candidatosPorRef.push({ ref: row.ref, keyword: kw });
      }
      if (candidatosPorRef.length >= MAX_KEYWORDS_POR_EJECUCION) break;
    }

    await pool.query(`UPDATE demanda_runs SET fase = 'generando_candidatos', total_keywords = $2 WHERE id = $1`, [runId, candidatosPorRef.length]);

    if (!candidatosPorRef.length) {
      await pool.query(
        `UPDATE demanda_runs SET status = 'success', finished_at = now(), fase = 'done', fuente = 'catalogo_interno', total_keywords = 0, verificadas = 0, sugeridas_sin_verificar = 0 WHERE id = $1`,
        [runId]
      );
      return { runId, totalKeywords: 0, verificadas: 0, sugeridasSinVerificar: 0, conectado: hayIntegracionConfigurada() };
    }

    if (!hayIntegracionConfigurada()) {
      // Sin credenciales: SOLO candidatos internos, sin ningún volumen ni
      // competencia — nunca 'success' fingiendo una fuente real.
      for (const c of candidatosPorRef) {
        await registrarResultado(runId, { ref: c.ref, keyword: c.keyword, origen: 'catalogo_interno', volumen: null, competencia: null, verificado: false });
      }
      await pool.query(
        `UPDATE demanda_runs SET status = 'no_conectado', finished_at = now(), fase = 'done', fuente = 'catalogo_interno',
           total_keywords = $2, verificadas = 0, sugeridas_sin_verificar = $2,
           error_message = 'DATAFORSEO_LOGIN/DATAFORSEO_PASSWORD no configurados — solo candidatos derivados del catálogo, sin volumen de búsqueda real.'
         WHERE id = $1`,
        [runId, candidatosPorRef.length]
      );
      return { runId, totalKeywords: candidatosPorRef.length, verificadas: 0, sugeridasSinVerificar: candidatosPorRef.length, conectado: false };
    }

    // Integración configurada: intenta la consulta real; si falla, degrada
    // a candidatos sin verificar en vez de fingir un resultado.
    await pool.query(`UPDATE demanda_runs SET fase = 'consultando_dataforseo' WHERE id = $1`, [runId]);
    let datosReales = null;
    let errorConsulta = null;
    try {
      datosReales = await consultarVolumenRealDataForSEO(candidatosPorRef.map((c) => c.keyword));
    } catch (e) {
      errorConsulta = e.message;
    }

    let verificadas = 0, sinVerificar = 0;
    for (const c of candidatosPorRef) {
      const real = datosReales ? datosReales[c.keyword] : null;
      if (real) {
        verificadas++;
        await registrarResultado(runId, { ref: c.ref, keyword: c.keyword, origen: 'dataforseo', volumen: real.volumen, competencia: real.competencia, verificado: true });
      } else {
        sinVerificar++;
        await registrarResultado(runId, { ref: c.ref, keyword: c.keyword, origen: 'catalogo_interno', volumen: null, competencia: null, verificado: false });
      }
    }

    await pool.query(
      `UPDATE demanda_runs SET status = 'success', finished_at = now(), fase = 'done',
         fuente = $2, total_keywords = $3, verificadas = $4, sugeridas_sin_verificar = $5, error_message = $6
       WHERE id = $1`,
      [runId, datosReales ? 'dataforseo' : 'catalogo_interno', candidatosPorRef.length, verificadas, sinVerificar, errorConsulta]
    );

    return { runId, totalKeywords: candidatosPorRef.length, verificadas, sugeridasSinVerificar: sinVerificar, conectado: !!datosReales, errorConsulta };
  } catch (e) {
    await pool.query(
      `UPDATE demanda_runs SET status = 'error', finished_at = now(), fase = 'error', error_message = $2 WHERE id = $1`,
      [runId, e.message]
    );
    throw e;
  }
}

module.exports = { ejecutarAnalisisDemanda, hayIntegracionConfigurada, generarCandidatosDesdeCatalogo };
