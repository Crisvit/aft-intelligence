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
const { BRANDS_PRIORITARIAS, STOCK_MINIMO_OPORTUNIDAD, round2 } = require('./sync');

const PVP_COMPLEMENTO_MAX = Number(process.env.OPORTUNIDADES_PVP_COMPLEMENTO_MAX) || 15;
const PESO_MARCA_PRIORITARIA = Number(process.env.OPORTUNIDADES_PESO_MARCA_PRIORITARIA) || 40;
const PESO_MARGEN_MAX = Number(process.env.OPORTUNIDADES_PESO_MARGEN_MAX) || 40;
const PESO_STOCK_MAX = Number(process.env.OPORTUNIDADES_PESO_STOCK_MAX) || 20;
// Unidades de stock AFT a partir de las cuales el componente de stock
// satura (no sigue sumando por tener aún más unidades).
const STOCK_REFERENCIA_SATURACION = Number(process.env.OPORTUNIDADES_STOCK_REFERENCIA) || 20;
// Margen proyectado (%) a partir del cual el componente de margen satura.
const MARGEN_REFERENCIA_SATURACION = Number(process.env.OPORTUNIDADES_MARGEN_REFERENCIA) || 50;

function esMarcaPrioritaria(marca) {
  return BRANDS_PRIORITARIAS.some((m) => String(marca || '').toUpperCase().includes(m));
}

// Cada componente del score es trazable a un dato real de hmt-db; el
// "motivo" concatena exactamente esos mismos números, nunca una
// explicación genérica desconectada del cálculo.
function calcularOportunidad(row) {
  const prioritaria = esMarcaPrioritaria(row.marca);
  const margen = row.margenPct != null ? Number(row.margenPct) : null;
  const stock = row.stock != null ? Number(row.stock) : 0;
  const pvp = row.precio != null ? Number(row.precio) : null;

  const ptsMarca = prioritaria ? PESO_MARCA_PRIORITARIA : 0;
  const ptsMargen = margen != null ? round2(Math.max(0, Math.min(1, margen / MARGEN_REFERENCIA_SATURACION)) * PESO_MARGEN_MAX) : 0;
  const ptsStock = round2(Math.max(0, Math.min(1, stock / STOCK_REFERENCIA_SATURACION)) * PESO_STOCK_MAX);
  const score = round2(ptsMarca + ptsMargen + ptsStock);

  // Complementaria: margen proyectado no negativo y PVP recomendado bajo —
  // candidato a venta cruzada, nunca una señal de demanda real (no hay
  // ninguna fuente de demanda conectada en este cálculo).
  const esComplementaria = margen != null && margen >= 0 && pvp != null && pvp <= PVP_COMPLEMENTO_MAX;

  const partes = [];
  partes.push(prioritaria ? `marca prioritaria (${row.marca || '—'}, +${ptsMarca} pts)` : 'marca no prioritaria (+0 pts)');
  partes.push(margen != null ? `margen proyectado ${margen}% (+${ptsMargen} pts)` : 'margen proyectado no disponible (+0 pts)');
  partes.push(`stock AFT ${stock} uds. (+${ptsStock} pts)`);
  if (esComplementaria) partes.push(`PVP ${pvp}€ ≤ ${PVP_COMPLEMENTO_MAX}€ — candidata a venta complementaria`);
  const motivo = 'Puntuación ' + score + '/100: ' + partes.join(' · ') + '.';

  return { score, esPrioritaria: prioritaria, esComplementaria, motivo };
}

const RESULT_COLS = [
  'ref', 'ean', 'marca', 'descripcion', 'categoria_nombre', 'stock_aft', 'coste', 'portes_proveedor_aft',
  'pvp_recomendado', 'margen_pct', 'es_marca_prioritaria', 'es_candidato_complementario', 'score', 'motivo'
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

    let prioritarias = 0, complementarias = 0;
    const resultados = rows.map((row) => {
      const o = calcularOportunidad(row);
      if (o.esPrioritaria) prioritarias++;
      if (o.esComplementaria) complementarias++;
      return {
        ref: row.ref, ean: row.ean, marca: row.marca, descripcion: row.descripcion, categoria_nombre: row.categoria_nombre,
        stock_aft: row.stock, coste: row.coste, portes_proveedor_aft: row.portes,
        pvp_recomendado: row.precio, margen_pct: row.margenPct,
        es_marca_prioritaria: o.esPrioritaria, es_candidato_complementario: o.esComplementaria,
        score: o.score, motivo: o.motivo
      };
    });

    await pool.query(`UPDATE oportunidades_runs SET fase = 'guardando' WHERE id = $1`, [runId]);
    const guardadas = await guardarResultadosEnLotes(resultados);

    await pool.query(
      `UPDATE oportunidades_runs SET status = 'success', finished_at = now(), fase = 'done',
         total_candidatos = $2, prioritarias = $3, complementarias = $4
       WHERE id = $1`,
      [runId, guardadas, prioritarias, complementarias]
    );

    return { runId, totalCandidatos: rows.length, guardados: guardadas, prioritarias, complementarias };
  } catch (e) {
    await pool.query(
      `UPDATE oportunidades_runs SET status = 'error', finished_at = now(), fase = 'error', error_message = $2 WHERE id = $1`,
      [runId, e.message]
    );
    throw e;
  }
}

module.exports = { ejecutarAnalisisOportunidades, calcularOportunidad, esMarcaPrioritaria, PVP_COMPLEMENTO_MAX };
