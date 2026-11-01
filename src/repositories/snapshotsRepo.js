// Capa de repositorio (Clean Architecture) — único lugar con el SQL de
// las 3 tablas de snapshots diarios (fase 3). Cada upsert* es una sola
// sentencia INSERT ... ON CONFLICT (fecha) DO UPDATE: estructuralmente
// imposible tener dos filas para el mismo día, así que varias ejecuciones
// el mismo día nunca duplican, solo actualizan la fila de ese día con los
// números de la ejecución más reciente. Quien llama decide CUÁNDO
// escribir (solo tras una ejecución con éxito) — este módulo no decide
// reglas de negocio, solo guarda/lee.
const { pool } = require('../db');

async function upsertStockSnapshot({ fecha, runId, totalSku, matched, conDiferencia, aCero, sinCambio }) {
  await pool.query(
    `INSERT INTO stock_snapshots_diarios (fecha, run_id, total_sku, matched, con_diferencia, a_cero, sin_cambio, generado_en)
     VALUES ($1,$2,$3,$4,$5,$6,$7, now())
     ON CONFLICT (fecha) DO UPDATE SET
       run_id = EXCLUDED.run_id, total_sku = EXCLUDED.total_sku, matched = EXCLUDED.matched,
       con_diferencia = EXCLUDED.con_diferencia, a_cero = EXCLUDED.a_cero, sin_cambio = EXCLUDED.sin_cambio,
       generado_en = now()`,
    [fecha, runId, totalSku, matched, conDiferencia, aCero, sinCambio]
  );
}

async function upsertOportunidadesSnapshot({ fecha, runId, totales }) {
  await pool.query(
    `INSERT INTO oportunidades_snapshots_diarios (
       fecha, run_id, total_candidatos, recomendadas, excedente_categoria, excedente_total,
       afinidad_principal, afinidad_complementaria, afinidad_estacional, afinidad_ambigua, afinidad_fuera_de_foco,
       margen_autorizacion_excepcional, margen_revision_comercial, margen_apto_evaluacion, margen_sin_dato, generado_en
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15, now())
     ON CONFLICT (fecha) DO UPDATE SET
       run_id = EXCLUDED.run_id, total_candidatos = EXCLUDED.total_candidatos, recomendadas = EXCLUDED.recomendadas,
       excedente_categoria = EXCLUDED.excedente_categoria, excedente_total = EXCLUDED.excedente_total,
       afinidad_principal = EXCLUDED.afinidad_principal, afinidad_complementaria = EXCLUDED.afinidad_complementaria,
       afinidad_estacional = EXCLUDED.afinidad_estacional, afinidad_ambigua = EXCLUDED.afinidad_ambigua,
       afinidad_fuera_de_foco = EXCLUDED.afinidad_fuera_de_foco,
       margen_autorizacion_excepcional = EXCLUDED.margen_autorizacion_excepcional,
       margen_revision_comercial = EXCLUDED.margen_revision_comercial,
       margen_apto_evaluacion = EXCLUDED.margen_apto_evaluacion, margen_sin_dato = EXCLUDED.margen_sin_dato,
       generado_en = now()`,
    [
      fecha, runId, totales.totalCandidatos, totales.recomendadas, totales.excedenteCategoria, totales.excedenteTotal,
      totales.afinidadPrincipal, totales.afinidadComplementaria, totales.afinidadEstacional, totales.afinidadAmbigua, totales.afinidadFueraDeFoco,
      totales.margenAutorizacionExcepcional, totales.margenRevisionComercial, totales.margenAptoEvaluacion, totales.margenSinDato
    ]
  );
}

async function upsertRentabilidadSnapshot({ fecha, runId, enPerdida, margenBajo, datosIncompletos, totalEvaluados }) {
  await pool.query(
    `INSERT INTO rentabilidad_snapshots_diarios (fecha, run_id, en_perdida, margen_bajo, datos_incompletos, total_evaluados, generado_en)
     VALUES ($1,$2,$3,$4,$5,$6, now())
     ON CONFLICT (fecha) DO UPDATE SET
       run_id = EXCLUDED.run_id, en_perdida = EXCLUDED.en_perdida, margen_bajo = EXCLUDED.margen_bajo,
       datos_incompletos = EXCLUDED.datos_incompletos, total_evaluados = EXCLUDED.total_evaluados, generado_en = now()`,
    [fecha, runId, enPerdida, margenBajo, datosIncompletos, totalEvaluados]
  );
}

// Lecturas para los gráficos (fase 3) — siempre ordenadas por fecha
// ascendente y acotadas a los últimos N días reales; si no hay snapshots
// anteriores a una fecha, la ausencia de filas ES la respuesta (nunca se
// rellena con ceros inventados).
async function listarStockSnapshots(desde) {
  const { rows } = await pool.query(`SELECT * FROM stock_snapshots_diarios WHERE fecha >= $1 ORDER BY fecha ASC`, [desde]);
  return rows;
}
async function listarOportunidadesSnapshots(desde) {
  const { rows } = await pool.query(`SELECT * FROM oportunidades_snapshots_diarios WHERE fecha >= $1 ORDER BY fecha ASC`, [desde]);
  return rows;
}
async function listarRentabilidadSnapshots(desde) {
  const { rows } = await pool.query(`SELECT * FROM rentabilidad_snapshots_diarios WHERE fecha >= $1 ORDER BY fecha ASC`, [desde]);
  return rows;
}
async function primeraFechaDisponible() {
  const { rows } = await pool.query(
    `SELECT LEAST(
       (SELECT min(fecha) FROM stock_snapshots_diarios),
       (SELECT min(fecha) FROM oportunidades_snapshots_diarios),
       (SELECT min(fecha) FROM rentabilidad_snapshots_diarios)
     ) AS fecha`
  );
  return rows[0] ? rows[0].fecha : null;
}

module.exports = {
  upsertStockSnapshot, upsertOportunidadesSnapshot, upsertRentabilidadSnapshot,
  listarStockSnapshots, listarOportunidadesSnapshots, listarRentabilidadSnapshots,
  primeraFechaDisponible
};
