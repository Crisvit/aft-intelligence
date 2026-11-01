const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resolverUsuarios, buscarUsuario, tienePermiso, ROLES_VALIDOS } = require('../src/domain/permisos');

test('resolverUsuarios: sin ninguna variable de entorno, no hay usuarios (nunca se asume acceso)', () => {
  assert.deepEqual(resolverUsuarios({}), []);
});

test('resolverUsuarios: compatibilidad — DASHBOARD_USER/DASHBOARD_PASSWORD_HASH solos dan un usuario con TODOS los roles', () => {
  const usuarios = resolverUsuarios({ DASHBOARD_USER: 'admin', DASHBOARD_PASSWORD_HASH: 'hash123' });
  assert.equal(usuarios.length, 1);
  assert.equal(usuarios[0].usuario, 'admin');
  assert.deepEqual(usuarios[0].roles.sort(), ROLES_VALIDOS.slice().sort());
});

test('resolverUsuarios: DASHBOARD_USUARIOS_JSON define varios usuarios con roles distintos', () => {
  const json = JSON.stringify([
    { usuario: 'admin', passwordHash: 'h1', roles: ['aprobar_afinidad', 'aprobar_margen'] },
    { usuario: 'comercial1', passwordHash: 'h2', roles: ['aprobar_afinidad'] }
  ]);
  const usuarios = resolverUsuarios({ DASHBOARD_USUARIOS_JSON: json });
  assert.equal(usuarios.length, 2);
  assert.deepEqual(buscarUsuario(usuarios, 'comercial1').roles, ['aprobar_afinidad']);
});

test('resolverUsuarios: DASHBOARD_USUARIOS_JSON ignora roles desconocidos, nunca concede un permiso inventado', () => {
  const json = JSON.stringify([{ usuario: 'x', passwordHash: 'h', roles: ['aprobar_afinidad', 'superadmin_total'] }]);
  const usuarios = resolverUsuarios({ DASHBOARD_USUARIOS_JSON: json });
  assert.deepEqual(usuarios[0].roles, ['aprobar_afinidad']);
});

test('resolverUsuarios: DASHBOARD_USUARIOS_JSON mal formado cae al usuario único, no deja el dashboard sin acceso', () => {
  const usuarios = resolverUsuarios({ DASHBOARD_USUARIOS_JSON: '{esto no es JSON válido', DASHBOARD_USER: 'admin', DASHBOARD_PASSWORD_HASH: 'hash' });
  assert.equal(usuarios.length, 1);
  assert.equal(usuarios[0].usuario, 'admin');
});

test('resolverUsuarios: una entrada sin usuario o sin passwordHash se descarta', () => {
  const json = JSON.stringify([{ usuario: 'bueno', passwordHash: 'h', roles: [] }, { usuario: 'malo' }, { passwordHash: 'h2' }]);
  const usuarios = resolverUsuarios({ DASHBOARD_USUARIOS_JSON: json });
  assert.equal(usuarios.length, 1);
  assert.equal(usuarios[0].usuario, 'bueno');
});

test('buscarUsuario: encuentra por nombre exacto, null si no existe', () => {
  const usuarios = [{ usuario: 'a', passwordHash: 'h', roles: [] }];
  assert.equal(buscarUsuario(usuarios, 'a').usuario, 'a');
  assert.equal(buscarUsuario(usuarios, 'b'), null);
});

test('tienePermiso: true solo si el rol está en la lista del usuario', () => {
  const usuario = { usuario: 'comercial1', roles: ['aprobar_afinidad'] };
  assert.equal(tienePermiso(usuario, 'aprobar_afinidad'), true);
  assert.equal(tienePermiso(usuario, 'aprobar_margen'), false);
});

test('tienePermiso: usuario nulo o sin roles nunca tiene permiso (nunca se asume acceso por defecto)', () => {
  assert.equal(tienePermiso(null, 'aprobar_afinidad'), false);
  assert.equal(tienePermiso({ usuario: 'x' }, 'aprobar_afinidad'), false);
  assert.equal(tienePermiso({ usuario: 'x', roles: [] }, 'aprobar_afinidad'), false);
});
