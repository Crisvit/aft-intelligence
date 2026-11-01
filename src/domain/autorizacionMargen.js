// Capa de dominio (Clean Architecture) — validación pura de autorizaciones
// comerciales excepcionales de margen (fase 3, Aprobaciones). Nunca toca
// PostgreSQL. Deliberadamente SIN relación con
// src/domain/afinidadResolucion.js — son dos mecanismos de decisión
// distintos, nunca se mezclan (ni código, ni tabla, ni campo).
function validarAutorizacion({ ref, motivo, decididoPor }) {
  const errores = [];
  if (!ref || !String(ref).trim()) errores.push('Falta la referencia AFT.');
  if (!decididoPor || !String(decididoPor).trim()) errores.push('Falta registrar quién autoriza.');
  if (!motivo || !String(motivo).trim()) errores.push('Falta el motivo de la autorización.');
  return { ok: errores.length === 0, errores };
}

function validarRechazo({ ref, motivo, decididoPor }) {
  const errores = [];
  if (!ref || !String(ref).trim()) errores.push('Falta la referencia AFT.');
  if (!decididoPor || !String(decididoPor).trim()) errores.push('Falta registrar quién rechaza.');
  if (!motivo || !String(motivo).trim()) errores.push('Falta el motivo del rechazo.');
  return { ok: errores.length === 0, errores };
}

module.exports = { validarAutorizacion, validarRechazo };
