// Capa de casos de uso (Clean Architecture) — orquesta la validación pura
// de dominio (src/domain/afinidadResolucion.js) con el repositorio SQL
// (src/repositories/afinidadResolucionRepo.js). Ni aquí ni en el
// repositorio se decide NUNCA si esta resolución puede cambiar el
// comportamiento del ranking/filtro de oportunidades — eso sigue
// gobernado exclusivamente por OPORTUNIDADES_FILTRO_AFINIDAD_ACTIVO y
// OPORTUNIDADES_PESO_AFINIDAD (fase 2, modo observación por defecto).
// Resolver una categoría nunca activa esos interruptores por sí sola.
const { validarResolucion, validarRevocacion } = require('../domain/afinidadResolucion');
const { normalizarCategoria } = require('../domain/afinidad');
const repo = require('../repositories/afinidadResolucionRepo');

async function resolverCategoria({ categoria, clase, motivo, resueltoPor }) {
  const validacion = validarResolucion({ categoria, clase, motivo, resueltoPor });
  if (!validacion.ok) return { ok: false, errores: validacion.errores };

  const fila = await repo.crearOReemplazarResolucion({
    categoriaNormalizada: validacion.categoriaNormalizada,
    categoriaOriginal: String(categoria || '').trim(),
    clase,
    motivo: String(motivo).trim(),
    resueltoPor: String(resueltoPor).trim()
  });
  return { ok: true, resolucion: fila };
}

async function revocarCategoria({ categoria, revocadoPor, revocadoMotivo }) {
  const validacion = validarRevocacion({ categoria, revocadoPor });
  if (!validacion.ok) return { ok: false, errores: validacion.errores };

  const fila = await repo.revocarResolucion({
    categoriaNormalizada: validacion.categoriaNormalizada,
    revocadoPor: String(revocadoPor).trim(),
    revocadoMotivo: revocadoMotivo ? String(revocadoMotivo).trim() : null
  });
  if (!fila) return { ok: false, errores: ['No hay ninguna resolución activa para esa categoría.'] };
  return { ok: true, resolucion: fila };
}

async function historialCategoria(categoria) {
  const categoriaNormalizada = normalizarCategoria(categoria);
  if (!categoriaNormalizada) return [];
  return repo.historialPorCategoria(categoriaNormalizada);
}

async function historialCompleto(limite) {
  return repo.historialCompleto(limite);
}

module.exports = { resolverCategoria, revocarCategoria, historialCategoria, historialCompleto };
