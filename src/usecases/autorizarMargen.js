// Capa de casos de uso (Clean Architecture) — orquesta la validación pura
// (src/domain/autorizacionMargen.js), el repositorio
// (src/repositories/autorizacionMargenRepo.js) y el registro de
// auditoría (src/repositories/auditoriaRepo.js). Cada función asume que
// la comprobación de PERMISO (rol) ya se hizo en la capa HTTP
// (server.js) antes de llegar aquí — este módulo registra en la
// auditoría el RESULTADO de la decisión de negocio (validación,
// aplicado/error), no la autorización de acceso en sí.
const { validarAutorizacion, validarRechazo } = require('../domain/autorizacionMargen');
const repo = require('../repositories/autorizacionMargenRepo');
const auditoria = require('../repositories/auditoriaRepo');

async function autorizarExcepcion({ ref, margenPct, motivo, decididoPor }) {
  const validacion = validarAutorizacion({ ref, motivo, decididoPor });
  if (!validacion.ok) {
    await auditoria.registrar({ usuario: decididoPor || 'desconocido', accion: 'margen.autorizar', entidad: 'ref', entidadId: ref, resultado: 'error', detalle: { errores: validacion.errores } });
    return { ok: false, errores: validacion.errores };
  }
  try {
    const fila = await repo.registrarDecision({ ref, margenPct, estado: 'autorizada', decididoPor, motivo: String(motivo).trim() });
    await auditoria.registrar({ usuario: decididoPor, accion: 'margen.autorizar', entidad: 'ref', entidadId: ref, resultado: 'aplicado', detalle: { margenPct, motivo } });
    return { ok: true, autorizacion: fila };
  } catch (e) {
    await auditoria.registrar({ usuario: decididoPor, accion: 'margen.autorizar', entidad: 'ref', entidadId: ref, resultado: 'error', detalle: { error: e.message } });
    throw e;
  }
}

async function rechazarExcepcion({ ref, margenPct, motivo, decididoPor }) {
  const validacion = validarRechazo({ ref, motivo, decididoPor });
  if (!validacion.ok) {
    await auditoria.registrar({ usuario: decididoPor || 'desconocido', accion: 'margen.rechazar', entidad: 'ref', entidadId: ref, resultado: 'error', detalle: { errores: validacion.errores } });
    return { ok: false, errores: validacion.errores };
  }
  try {
    const fila = await repo.registrarDecision({ ref, margenPct, estado: 'rechazada', decididoPor, motivo: String(motivo).trim() });
    await auditoria.registrar({ usuario: decididoPor, accion: 'margen.rechazar', entidad: 'ref', entidadId: ref, resultado: 'aplicado', detalle: { margenPct, motivo } });
    return { ok: true, autorizacion: fila };
  } catch (e) {
    await auditoria.registrar({ usuario: decididoPor, accion: 'margen.rechazar', entidad: 'ref', entidadId: ref, resultado: 'error', detalle: { error: e.message } });
    throw e;
  }
}

async function historialPorRef(ref) {
  return repo.historialPorRef(ref);
}
async function listarVigentes() {
  return repo.listarVigentes();
}
async function historialReciente(limite) {
  return repo.historialReciente(limite);
}

module.exports = { autorizarExcepcion, rechazarExcepcion, historialPorRef, listarVigentes, historialReciente };
