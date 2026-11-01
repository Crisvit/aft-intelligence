// Capa de dominio (Clean Architecture) — regla de negocio pura, sin
// PostgreSQL, sin fetch, sin ningún require de infraestructura. Movida
// tal cual desde src/demanda.js (fase 1 de la refactorización, sin
// cambiar su comportamiento — ver test/demanda.test.js).

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

module.exports = { generarCandidatosDesdeCatalogo };
