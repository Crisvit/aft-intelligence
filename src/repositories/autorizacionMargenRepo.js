// Capa de repositorio (Clean Architecture) — único lugar con el SQL de
// autorizaciones_margen. Append-only: "decidir de nuevo" sobre la misma
// ref apaga la vigente anterior (vigente=false) y crea una fila nueva, en
// una sola transacción — el histórico completo queda siempre consultable.
const { pool } = require('../db');

async function buscarVigentePorRef(ref) {
  const { rows } = await pool.query(
    `SELECT * FROM autorizaciones_margen WHERE ref = $1 AND vigente = true`,
    [ref]
  );
  return rows[0] || null;
}

async function historialPorRef(ref) {
  const { rows } = await pool.query(
    `SELECT * FROM autorizaciones_margen WHERE ref = $1 ORDER BY decidido_en DESC`,
    [ref]
  );
  return rows;
}

async function listarVigentes() {
  const { rows } = await pool.query(`SELECT * FROM autorizaciones_margen WHERE vigente = true`);
  return rows;
}

async function historialReciente(limite) {
  const { rows } = await pool.query(`SELECT * FROM autorizaciones_margen ORDER BY decidido_en DESC LIMIT $1`, [limite || 50]);
  return rows;
}

async function registrarDecision({ ref, margenPct, estado, decididoPor, motivo }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`UPDATE autorizaciones_margen SET vigente = false WHERE ref = $1 AND vigente = true`, [ref]);
    const { rows } = await client.query(
      `INSERT INTO autorizaciones_margen (ref, margen_pct, estado, decidido_por, motivo)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [ref, margenPct, estado, decididoPor, motivo]
    );
    await client.query('COMMIT');
    return rows[0];
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

module.exports = { buscarVigentePorRef, historialPorRef, listarVigentes, historialReciente, registrarDecision };
