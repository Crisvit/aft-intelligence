// Capa de dominio (Clean Architecture) — resolución pura de usuarios y
// permisos del dashboard (fase 3, Aprobaciones). No toca HTTP ni
// PostgreSQL: recibe el entorno (o un objeto equivalente, en tests) y
// decide qué usuarios existen y qué puede hacer cada uno.
//
// Antes de fase 3 solo existía UN usuario compartido (DASHBOARD_USER/
// DASHBOARD_PASSWORD_HASH) con acceso a todo — "cualquier usuario
// autenticado" era, literalmente, el único usuario que había. Para que
// aprobar excepciones de margen o resolver afinidad requiera un permiso
// específico (y no "estar autenticado" a secas), server.js ahora puede
// definir varios usuarios con roles distintos vía DASHBOARD_USUARIOS_JSON
// — un array JSON de {"usuario","passwordHash","roles":[...]}. Si esa
// variable no está definida, se usa el usuario único de siempre
// (compatibilidad total con despliegues existentes) y se le conceden
// TODOS los roles, igual que su comportamiento actual.
const ROLES_VALIDOS = ['aprobar_afinidad', 'aprobar_margen'];

function resolverUsuarios(env) {
  const entorno = env || {};
  if (entorno.DASHBOARD_USUARIOS_JSON) {
    try {
      const lista = JSON.parse(entorno.DASHBOARD_USUARIOS_JSON);
      if (Array.isArray(lista)) {
        return lista
          .filter((u) => u && u.usuario && u.passwordHash)
          .map((u) => ({ usuario: u.usuario, passwordHash: u.passwordHash, roles: Array.isArray(u.roles) ? u.roles.filter((r) => ROLES_VALIDOS.includes(r)) : [] }));
      }
    } catch (e) {
      // DASHBOARD_USUARIOS_JSON mal formado: no se asume nada, se cae al
      // usuario único de siempre en vez de dejar el dashboard sin acceso.
    }
  }
  if (entorno.DASHBOARD_USER && entorno.DASHBOARD_PASSWORD_HASH) {
    return [{ usuario: entorno.DASHBOARD_USER, passwordHash: entorno.DASHBOARD_PASSWORD_HASH, roles: ROLES_VALIDOS.slice() }];
  }
  return [];
}

function buscarUsuario(usuarios, nombre) {
  return (usuarios || []).find((u) => u.usuario === nombre) || null;
}

function tienePermiso(usuario, rol) {
  return !!(usuario && Array.isArray(usuario.roles) && usuario.roles.includes(rol));
}

module.exports = { ROLES_VALIDOS, resolverUsuarios, buscarUsuario, tienePermiso };
