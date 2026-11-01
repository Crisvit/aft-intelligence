// Capa de casos de uso (Clean Architecture) — orquesta la validación pura
// de dominio (src/domain/afinidadResolucion.js) con el repositorio SQL
// (src/repositories/afinidadResolucionRepo.js) y el registro de
// auditoría (src/repositories/auditoriaRepo.js). Ni aquí ni en el
// repositorio se decide NUNCA si esta resolución puede cambiar el
// comportamiento del ranking/filtro de oportunidades — eso sigue
// gobernado exclusivamente por OPORTUNIDADES_FILTRO_AFINIDAD_ACTIVO y
// OPORTUNIDADES_PESO_AFINIDAD (fase 2, modo observación por defecto).
// Resolver una categoría nunca activa esos interruptores por sí sola.
//
// La comprobación de PERMISO (rol) se hace en la capa HTTP (server.js)
// antes de llegar aquí — este módulo registra en la auditoría el
// resultado de la decisión de negocio, no la autorización de acceso.
const { validarResolucion, validarRevocacion } = require('../domain/afinidadResolucion');
const { normalizarCategoria } = require('../domain/afinidad');
const repo = require('../repositories/afinidadResolucionRepo');
const auditoria = require('../repositories/auditoriaRepo');

async function resolverCategoria({ categoria, clase, motivo, resueltoPor }) {
  const validacion = validarResolucion({ categoria, clase, motivo, resueltoPor });
  if (!validacion.ok) {
    await auditoria.registrar({ usuario: resueltoPor || 'desconocido', accion: 'afinidad.resolver', entidad: 'categoria', entidadId: String(categoria || ''), resultado: 'error', detalle: { errores: validacion.errores } });
    return { ok: false, errores: validacion.errores };
  }

  try {
    const fila = await repo.crearOReemplazarResolucion({
      categoriaNormalizada: validacion.categoriaNormalizada,
      categoriaOriginal: String(categoria || '').trim(),
      clase,
      motivo: String(motivo).trim(),
      resueltoPor: String(resueltoPor).trim()
    });
    await auditoria.registrar({ usuario: resueltoPor, accion: 'afinidad.resolver', entidad: 'categoria', entidadId: validacion.categoriaNormalizada, resultado: 'aplicado', detalle: { clase, motivo } });
    return { ok: true, resolucion: fila };
  } catch (e) {
    await auditoria.registrar({ usuario: resueltoPor, accion: 'afinidad.resolver', entidad: 'categoria', entidadId: validacion.categoriaNormalizada, resultado: 'error', detalle: { error: e.message } });
    throw e;
  }
}

async function revocarCategoria({ categoria, revocadoPor, revocadoMotivo }) {
  const validacion = validarRevocacion({ categoria, revocadoPor });
  if (!validacion.ok) {
    await auditoria.registrar({ usuario: revocadoPor || 'desconocido', accion: 'afinidad.revocar', entidad: 'categoria', entidadId: String(categoria || ''), resultado: 'error', detalle: { errores: validacion.errores } });
    return { ok: false, errores: validacion.errores };
  }

  const fila = await repo.revocarResolucion({
    categoriaNormalizada: validacion.categoriaNormalizada,
    revocadoPor: String(revocadoPor).trim(),
    revocadoMotivo: revocadoMotivo ? String(revocadoMotivo).trim() : null
  });
  if (!fila) {
    await auditoria.registrar({ usuario: revocadoPor, accion: 'afinidad.revocar', entidad: 'categoria', entidadId: validacion.categoriaNormalizada, resultado: 'error', detalle: { errores: ['No hay ninguna resolución activa para esa categoría.'] } });
    return { ok: false, errores: ['No hay ninguna resolución activa para esa categoría.'] };
  }
  await auditoria.registrar({ usuario: revocadoPor, accion: 'afinidad.revocar', entidad: 'categoria', entidadId: validacion.categoriaNormalizada, resultado: 'aplicado', detalle: { motivo: revocadoMotivo || null } });
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
