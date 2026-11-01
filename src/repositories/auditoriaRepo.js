// Capa de repositorio (Clean Architecture) — registro de auditoría
// (append-only, nunca se edita ni se borra una fila). Un fallo al
// registrar la auditoría NUNCA debe impedir ni deshacer la acción ya
// aplicada (ver los usecases de Aprobaciones): se registra en el log del
// proceso y se continúa.
const { pool } = require('../db');

async function registrar({ usuario, accion, entidad, entidadId, resultado, detalle }) {
  try {
    await pool.query(
      `INSERT INTO auditoria_acciones (usuario, accion, entidad, entidad_id, resultado, detalle)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [usuario, accion, entidad || null, entidadId || null, resultado, detalle ? JSON.stringify(detalle) : null]
    );
  } catch (e) {
    console.error(`[auditoria] No se pudo registrar la acción "${accion}" de ${usuario}: ${e.message}`);
  }
}

async function listarRecientes(limite) {
  const { rows } = await pool.query(
    `SELECT * FROM auditoria_acciones ORDER BY creado_en DESC LIMIT $1`,
    [limite || 100]
  );
  return rows;
}

module.exports = { registrar, listarRecientes };
