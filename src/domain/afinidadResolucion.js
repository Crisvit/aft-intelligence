// Capa de dominio (Clean Architecture) — validación pura de resoluciones
// humanas de afinidad comercial persistidas (fase 3). No toca PostgreSQL;
// la carga y el guardado viven en la capa exterior
// (src/repositories/afinidadResolucionRepo.js, src/usecases/resolverAfinidad.js).
//
// Una categoría nunca se "resuelve" como 'ambigua': el propósito de
// resolver es sacarla de la revisión humana, no dejarla donde estaba. Si
// de verdad hace falta mantenerla en revisión, se revoca la resolución
// anterior (o no se crea ninguna) en vez de resolverla como 'ambigua'.
const { normalizarCategoria, elegiblePorClase } = require('./afinidad');

const CLASES_RESOLUBLES = ['principal', 'complementaria', 'estacional', 'fuera_de_foco'];

function validarResolucion({ categoria, clase, motivo, resueltoPor }) {
  const errores = [];
  const categoriaNormalizada = normalizarCategoria(categoria);
  if (!categoriaNormalizada) errores.push('La categoría no puede estar vacía.');
  if (!CLASES_RESOLUBLES.includes(clase)) errores.push(`Clase "${clase}" no válida — debe ser una de: ${CLASES_RESOLUBLES.join(', ')}.`);
  if (!resueltoPor || !String(resueltoPor).trim()) errores.push('Falta registrar quién resuelve la categoría.');
  if (!motivo || !String(motivo).trim()) errores.push('Falta el motivo de la resolución.');
  return { ok: errores.length === 0, errores, categoriaNormalizada };
}

function validarRevocacion({ categoria, revocadoPor }) {
  const errores = [];
  const categoriaNormalizada = normalizarCategoria(categoria);
  if (!categoriaNormalizada) errores.push('La categoría no puede estar vacía.');
  if (!revocadoPor || !String(revocadoPor).trim()) errores.push('Falta registrar quién revoca la resolución.');
  return { ok: errores.length === 0, errores, categoriaNormalizada };
}

// Construye el objeto "resolucion" en la forma que espera
// clasificarAfinidadComercial() (src/domain/afinidad.js), a partir de una
// fila de afinidad_categorias_resueltas (estado='activa') ya leída de
// hmt-db. Puro: no decide si la fila sigue vigente, solo la traduce de
// forma — esa decisión es del WHERE estado='activa' de quien consulta.
function resolucionDesdeFila(fila) {
  if (!fila) return null;
  return {
    clase: fila.clase,
    motivo: fila.motivo,
    resueltoPor: fila.resuelto_por,
    resueltoEn: fila.resuelto_en ? new Date(fila.resuelto_en).toISOString().slice(0, 10) : null
  };
}

module.exports = { CLASES_RESOLUBLES, validarResolucion, validarRevocacion, resolucionDesdeFila, elegiblePorClase };
