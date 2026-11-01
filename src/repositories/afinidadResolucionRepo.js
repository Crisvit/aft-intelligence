// Capa de repositorio (Clean Architecture) — único lugar que sabe el SQL
// exacto de afinidad_categorias_resueltas. Nunca decide reglas de negocio
// (eso es src/domain/afinidadResolucion.js) ni valida nada — solo lee y
// escribe lo que la capa de casos de uso le pide.
const { pool } = require('../db');

async function listarActivas() {
  const { rows } = await pool.query(
    `SELECT categoria_normalizada, categoria_original, clase, motivo, resuelto_por, resuelto_en
     FROM afinidad_categorias_resueltas WHERE estado = 'activa'`
  );
  return rows;
}

async function buscarActivaPorCategoria(categoriaNormalizada) {
  const { rows } = await pool.query(
    `SELECT * FROM afinidad_categorias_resueltas WHERE categoria_normalizada = $1 AND estado = 'activa'`,
    [categoriaNormalizada]
  );
  return rows[0] || null;
}

async function historialPorCategoria(categoriaNormalizada) {
  const { rows } = await pool.query(
    `SELECT * FROM afinidad_categorias_resueltas WHERE categoria_normalizada = $1 ORDER BY resuelto_en DESC`,
    [categoriaNormalizada]
  );
  return rows;
}

async function historialCompleto(limite) {
  const { rows } = await pool.query(
    `SELECT * FROM afinidad_categorias_resueltas ORDER BY resuelto_en DESC LIMIT $1`,
    [limite || 200]
  );
  return rows;
}

// Revoca (si existe) la resolución activa de esa categoría y crea una
// nueva, en una sola transacción — así "modificar" una decisión nunca
// deja dos filas 'activa' a la vez ni pierde el rastro de la anterior:
// la fila vieja queda en la tabla con estado='revocada', consultable para
// siempre vía historialPorCategoria(). También cierra en bloque las
// incidencias de afinidad_ambigua todavía pendientes de esa categoría —
// ya no tiene sentido mantenerlas abiertas si la categoría acaba de
// resolverse.
async function crearOReemplazarResolucion({ categoriaNormalizada, categoriaOriginal, clase, motivo, resueltoPor }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE afinidad_categorias_resueltas
       SET estado = 'revocada', revocado_por = $2, revocado_en = now(), revocado_motivo = 'Sustituida por una nueva resolución'
       WHERE categoria_normalizada = $1 AND estado = 'activa'`,
      [categoriaNormalizada, resueltoPor]
    );
    const { rows } = await client.query(
      `INSERT INTO afinidad_categorias_resueltas (categoria_normalizada, categoria_original, clase, motivo, resuelto_por)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [categoriaNormalizada, categoriaOriginal, clase, motivo, resueltoPor]
    );
    await client.query(
      `UPDATE incidencias SET estado = 'resuelta', resuelto_por = $2, resuelto_en = now(),
         resolucion = $3
       WHERE tipo = 'afinidad_ambigua' AND estado = 'pendiente' AND categoria_normalizada = $1`,
      [categoriaNormalizada, resueltoPor, `Categoría resuelta como "${clase}" — ${motivo}`]
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

async function revocarResolucion({ categoriaNormalizada, revocadoPor, revocadoMotivo }) {
  const { rows } = await pool.query(
    `UPDATE afinidad_categorias_resueltas
     SET estado = 'revocada', revocado_por = $2, revocado_en = now(), revocado_motivo = $3
     WHERE categoria_normalizada = $1 AND estado = 'activa'
     RETURNING *`,
    [categoriaNormalizada, revocadoPor, revocadoMotivo || null]
  );
  return rows[0] || null;
}

module.exports = {
  listarActivas, buscarActivaPorCategoria, historialPorCategoria, historialCompleto,
  crearOReemplazarResolucion, revocarResolucion
};
