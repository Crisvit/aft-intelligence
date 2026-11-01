// Agente 4 — Oportunidades comerciales, convertido en proceso independiente
// con su propio historial (antes se recalculaba en cada carga del
// dashboard, en server.js). Reutiliza exactamente el mismo universo ya
// calculado por sync.js (shopify_match.es_oportunidad_comercial — stock
// AFT real cruzado con marcas/categorías comerciales) sin tocar ni
// duplicar ese cálculo protegido.
//
// Puntuación explicable, nunca una caja negra: score = marca prioritaria +
// margen proyectado + stock disponible, cada componente visible en
// "motivo". No se inventa ninguna señal de demanda externa aquí — eso es
// responsabilidad exclusiva del Agente 5, y solo con una fuente real
// conectada (ver src/demanda.js). Una referencia revisada por un backup
// real de la primera versión del panel (n8n) usaba exactamente este tipo
// de fabricación de "demanda" cuando no había datos reales (un valor por
// defecto de 12.5/25 puntos incluso sin ninguna señal) — ese patrón se
// descarta aquí a propósito: sin dato real, el componente vale 0, no un
// valor intermedio inventado.
const { pool } = require('./db');
const { STOCK_MINIMO_OPORTUNIDAD } = require('./sync');
const { calcularOportunidad, esMarcaPrioritaria, PVP_COMPLEMENTO_MAX, seleccionarRanking, calcularTotalesOportunidades } = require('./domain/oportunidades');
const { clasificarMargen } = require('./domain/margen');
const { normalizarCategoria } = require('./domain/afinidad');
const { resolucionDesdeFila } = require('./domain/afinidadResolucion');
const { fechaMadrid } = require('./domain/fecha');
const afinidadResolucionRepo = require('./repositories/afinidadResolucionRepo');
const snapshotsRepo = require('./repositories/snapshotsRepo');

// Fase 3 — afinidad persistente: una decisión humana sobre una categoría
// (tabla afinidad_categorias_resueltas) prevalece siempre sobre la
// clasificación automática, mientras esté vigente ('activa'). Se carga
// una vez por ejecución (nunca una consulta por fila) y se aplica aquí,
// en la capa exterior — el dominio (calcularOportunidad) sigue siendo
// puro: solo recibe la resolución ya resuelta como dato, nunca consulta
// nada por sí mismo. Un fallo al cargar las resoluciones no bloquea la
// ejecución: se continúa sin ninguna resolución aplicada (equivalente a
// modo observación — ninguna categoría queda peor que sin esta función).
async function cargarMapaResolucionesAfinidad() {
  const mapa = new Map();
  try {
    const filas = await afinidadResolucionRepo.listarActivas();
    for (const fila of filas) mapa.set(fila.categoria_normalizada, resolucionDesdeFila(fila));
  } catch (e) {
    console.error(`[oportunidades] No se pudieron cargar las resoluciones de afinidad persistidas: ${e.message}. Se continúa sin ninguna aplicada.`);
  }
  return mapa;
}

// Fase 2 — límites del ranking principal, configurables. NO filtran lo que
// se guarda (ver seleccionarRanking): solo decide cuáles quedan marcadas
// 'recomendada' frente a 'excedente_categoria'/'excedente_total'. Todos los
// candidatos válidos se persisten siempre en oportunidades_resultados.
const MAX_POR_CATEGORIA = Number(process.env.OPORTUNIDADES_MAX_POR_CATEGORIA) || 4;
const MAX_CANDIDATOS_TOTAL = Number(process.env.OPORTUNIDADES_MAX_CANDIDATOS_TOTAL) || 60;
// Gate independiente del peso de afinidad (OPORTUNIDADES_PESO_AFINIDAD):
// con este flag en false (por defecto), la afinidad nunca decide
// elegibilidad, solo se calcula y se muestra en "motivo" — modo observación
// completo, sin alterar ninguna recomendación existente.
const FILTRO_AFINIDAD_ACTIVO = process.env.OPORTUNIDADES_FILTRO_AFINIDAD_ACTIVO === 'true';

const RESULT_COLS = [
  'ref', 'ean', 'marca', 'descripcion', 'categoria_nombre', 'stock_aft', 'coste', 'portes_proveedor_aft',
  'pvp_recomendado', 'margen_pct', 'es_marca_prioritaria', 'es_candidato_complementario', 'score', 'motivo',
  'afinidad_clase', 'afinidad_motivo', 'margen_clasificacion', 'margen_prioridad_adicional', 'estado_elegibilidad'
];
function valoresResultado(f) { return RESULT_COLS.map((c) => (f[c] !== undefined ? f[c] : null)); }
function construirInsertResultados(numFilas) {
  const nCols = RESULT_COLS.length;
  const grupos = [];
  for (let i = 0; i < numFilas; i++) {
    const placeholders = RESULT_COLS.map((_, c) => `$${i * nCols + c + 1}`);
    grupos.push(`(${placeholders.join(',')}, now())`);
  }
  return `INSERT INTO oportunidades_resultados (${RESULT_COLS.join(',')}, checked_at) VALUES ${grupos.join(', ')}`;
}

const BATCH_SIZE = 500;
async function guardarResultadosEnLotes(filas) {
  await pool.query('DELETE FROM oportunidades_resultados');
  let guardadas = 0;
  for (let i = 0; i < filas.length; i += BATCH_SIZE) {
    const lote = filas.slice(i, i + BATCH_SIZE);
    try {
      await pool.query(construirInsertResultados(lote.length), lote.flatMap(valoresResultado));
      guardadas += lote.length;
    } catch (e) {
      console.error(`[oportunidades] Fallo el lote de resultados (filas ${i}-${i + lote.length - 1}): ${e.message}. Reintentando fila a fila.`);
      for (const fila of lote) {
        try {
          await pool.query(construirInsertResultados(1), valoresResultado(fila));
          guardadas++;
        } catch (e2) {
          console.error(`[oportunidades] Error SQL guardando resultado ref=${fila.ref}: ${e2.message}`);
        }
      }
    }
  }
  return guardadas;
}

// Fase 2 — una incidencia 'afinidad_ambigua' por ref con categoría que no
// coincide con ninguna lista configurada, para revisión humana. Siempre se
// registra (independiente de OPORTUNIDADES_FILTRO_AFINIDAD_ACTIVO: ese flag
// solo decide si afecta al ranking, nunca si se avisa de la ambigüedad).
// ON CONFLICT DO NOTHING sobre el índice único parcial — seguro frente a
// ejecuciones simultáneas, sin "SELECT primero" con condición de carrera.
// Deliberadamente separado de cualquier tabla/campo de autorización
// comercial excepcional de márgenes (ver src/domain/margen.js) — no se
// mezclan estos dos mecanismos de resolución.
async function registrarIncidenciasAfinidadAmbigua(ranking) {
  const ambiguas = ranking.filter((c) => c.afinidad && c.afinidad.clase === 'ambigua');
  for (const c of ambiguas) {
    try {
      await pool.query(
        `INSERT INTO incidencias (ref, ean, tipo, detalle, categoria_normalizada)
         VALUES ($1, $2, 'afinidad_ambigua', $3, $4)
         ON CONFLICT (ref) WHERE tipo = 'afinidad_ambigua' AND estado = 'pendiente' DO NOTHING`,
        [c.ref, c.ean, c.afinidad.motivo, normalizarCategoria(c.categoria)]
      );
    } catch (e) {
      console.error(`[oportunidades] Error SQL registrando incidencia afinidad_ambigua ref=${c.ref}: ${e.message}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Universo: referencias AFT de marcas/categorías comerciales (filtro ya
// aplicado por sync.js) con stock mínimo configurado, que la última
// comparación NO encontró en Shopify. No se vuelve a leer AFT ni Shopify
// aquí — solo se puntúa y explica lo que ya calculó el agente 2.
// ---------------------------------------------------------------------------
async function ejecutarAnalisisOportunidades(existingRunId) {
  let runId = existingRunId;
  if (runId) {
    await pool.query(`UPDATE oportunidades_runs SET fase = 'iniciando' WHERE id = $1`, [runId]);
  } else {
    const { rows } = await pool.query(`INSERT INTO oportunidades_runs (status, fase) VALUES ('running', 'iniciando') RETURNING id`);
    runId = rows[0].id;
  }

  try {
    const { rows } = await pool.query(
      `SELECT sm.ref, sm.ean, sm.marca, c.descripcion_corta AS descripcion, c.categoria_nombre, c.portes,
              sm.stock_aft AS stock, sm.precio_venta_aft AS precio, sm.coste_para_margen AS coste,
              sm.margen_con_precio_aft_pct AS "margenPct"
       FROM shopify_match sm
       JOIN aft_catalogo c ON c.ref = sm.ref
       WHERE sm.estado = 'no_encontrado' AND sm.es_oportunidad_comercial = true AND sm.stock_aft >= $1`,
      [STOCK_MINIMO_OPORTUNIDAD]
    );

    await pool.query(`UPDATE oportunidades_runs SET fase = 'calculando', total_candidatos = $2 WHERE id = $1`, [runId, rows.length]);

    const resolucionesAfinidad = await cargarMapaResolucionesAfinidad();

    let prioritarias = 0, complementarias = 0;
    const calculados = rows.map((row) => {
      const resolucionAfinidad = resolucionesAfinidad.get(normalizarCategoria(row.categoria_nombre)) || undefined;
      const o = calcularOportunidad({ ...row, categoria: row.categoria_nombre, resolucionAfinidad });
      if (o.esPrioritaria) prioritarias++;
      if (o.esComplementaria) complementarias++;
      const margen = clasificarMargen(row.margenPct != null ? Number(row.margenPct) : null);
      return {
        ref: row.ref, ean: row.ean, marca: row.marca, descripcion: row.descripcion, categoria: row.categoria_nombre,
        stock: row.stock, coste: row.coste, portes: row.portes,
        precio: row.precio, margenPct: row.margenPct,
        esPrioritaria: o.esPrioritaria, esComplementaria: o.esComplementaria,
        score: o.score, motivo: o.motivo, afinidad: o.afinidad, margen
      };
    });

    const ranking = seleccionarRanking(calculados, {
      maxPorCategoria: MAX_POR_CATEGORIA,
      maxCandidatosTotal: MAX_CANDIDATOS_TOTAL,
      filtroAfinidadActivo: FILTRO_AFINIDAD_ACTIVO
    });

    const resultados = ranking.map((c) => ({
      ref: c.ref, ean: c.ean, marca: c.marca, descripcion: c.descripcion, categoria_nombre: c.categoria,
      stock_aft: c.stock, coste: c.coste, portes_proveedor_aft: c.portes,
      pvp_recomendado: c.precio, margen_pct: c.margenPct,
      es_marca_prioritaria: c.esPrioritaria, es_candidato_complementario: c.esComplementaria,
      score: c.score, motivo: c.motivo,
      afinidad_clase: c.afinidad.clase, afinidad_motivo: c.afinidad.motivo,
      margen_clasificacion: c.margen.tier, margen_prioridad_adicional: c.margen.prioridadAdicional,
      estado_elegibilidad: c.estadoElegibilidad
    }));

    await pool.query(`UPDATE oportunidades_runs SET fase = 'guardando' WHERE id = $1`, [runId]);
    const guardadas = await guardarResultadosEnLotes(resultados);
    await registrarIncidenciasAfinidadAmbigua(ranking);

    await pool.query(
      `UPDATE oportunidades_runs SET status = 'success', finished_at = now(), fase = 'done',
         total_candidatos = $2, prioritarias = $3, complementarias = $4
       WHERE id = $1`,
      [runId, guardadas, prioritarias, complementarias]
    );

    // Fase 3 — snapshot diario, solo tras éxito confirmado. Reduce sobre
    // el ranking ya calculado en memoria, sin volver a consultar nada; un
    // fallo al escribirlo nunca bloquea ni revierte la ejecución.
    try {
      const totales = calcularTotalesOportunidades(ranking);
      await snapshotsRepo.upsertOportunidadesSnapshot({ fecha: fechaMadrid(), runId, totales });
    } catch (e) {
      console.error(`[oportunidades] No se pudo escribir el snapshot diario (run ${runId}): ${e.message}`);
    }

    return { runId, totalCandidatos: rows.length, guardados: guardadas, prioritarias, complementarias };
  } catch (e) {
    await pool.query(
      `UPDATE oportunidades_runs SET status = 'error', finished_at = now(), fase = 'error', error_message = $2 WHERE id = $1`,
      [runId, e.message]
    );
    throw e;
  }
}

module.exports = {
  ejecutarAnalisisOportunidades, calcularOportunidad, esMarcaPrioritaria, PVP_COMPLEMENTO_MAX,
  seleccionarRanking, registrarIncidenciasAfinidadAmbigua,
  MAX_POR_CATEGORIA, MAX_CANDIDATOS_TOTAL, FILTRO_AFINIDAD_ACTIVO
};
