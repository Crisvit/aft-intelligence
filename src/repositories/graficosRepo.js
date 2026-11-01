// Capa de repositorio (Clean Architecture) — consultas agregadas para la
// página "Gráficos" (fase 3). Dos familias de fuente, nunca mezcladas sin
// decirlo: las tablas *_runs (historial real, append-only, existente
// desde antes de fase 3 — nunca se borra ninguna fila) y los snapshots
// diarios nuevos (src/repositories/snapshotsRepo.js), que solo tienen
// datos desde que ese código empezó a ejecutarse.
const { pool } = require('../db');

async function historialSyncRuns(desde) {
  const { rows } = await pool.query(
    `SELECT id, started_at, finished_at, status, total_matched, total_cambiarian, total_a_cero
     FROM sync_runs WHERE started_at >= $1 ORDER BY started_at ASC`,
    [desde]
  );
  return rows;
}

async function historialDemandaRuns(desde) {
  const { rows } = await pool.query(
    `SELECT id, started_at, finished_at, status, total_keywords, verificadas, sugeridas_sin_verificar
     FROM demanda_runs WHERE started_at >= $1 ORDER BY started_at ASC`,
    [desde]
  );
  return rows;
}

// Ejecuciones correctas vs fallidas de TODOS los agentes con historial
// real (sync, oportunidades, rentabilidad, demanda, fichas, reposición) —
// unión homogénea por tener todos la misma forma mínima
// (id/started_at/finished_at/status). 'running' (una ejecución todavía en
// curso en el momento de la consulta) se cuenta aparte, nunca como éxito
// ni como fallo.
async function historialEjecuciones(desde) {
  const { rows } = await pool.query(
    `SELECT 'sync' AS agente, started_at, status FROM sync_runs WHERE started_at >= $1
     UNION ALL
     SELECT 'oportunidades', started_at, status FROM oportunidades_runs WHERE started_at >= $1
     UNION ALL
     SELECT 'rentabilidad', started_at, status FROM rentabilidad_runs WHERE started_at >= $1
     UNION ALL
     SELECT 'demanda', started_at, status FROM demanda_runs WHERE started_at >= $1
     UNION ALL
     SELECT 'fichas', started_at, status FROM fichas_runs WHERE started_at >= $1
     UNION ALL
     SELECT 'reposicion', started_at, status FROM reposicion_runs WHERE started_at >= $1
     ORDER BY started_at ASC`,
    [desde]
  );
  return rows;
}

module.exports = { historialSyncRuns, historialDemandaRuns, historialEjecuciones };
