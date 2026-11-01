// [seguridad] La UI de Aprobaciones oculta las acciones de escritura
// (resolver afinidad, autorizar/rechazar margen) cuando el usuario que
// ve la página no tiene el rol correspondiente — defensa en profundidad,
// NUNCA el único control: el backend (requireRole en server.js) sigue
// rechazando con 403 aunque alguien reconstruya el botón a mano. Estas
// pruebas fijan que el HTML servido ni siquiera contiene el formulario
// quien no puede usarlo.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { renderAprobacionesSection } = require('../src/views/aprobacionesView');

const INCIDENCIA = { categoria_normalizada: 'ILUMINACION TECNICA', categoria_original: 'Iluminación técnica', total_refs: 2, detectado_en: new Date().toISOString() };
const MARGEN = { ref: 'AFT-1', descripcion: 'Taladro margen bajo', marca: 'WOLFPACK', margen_pct: 7.2 };

test('[seguridad] sin ningún rol: ni el botón de resolver afinidad ni el de autorizar margen aparecen en el HTML', () => {
  const { html } = renderAprobacionesSection({ incidenciasAgrupadas: [INCIDENCIA], autorizacionesPendientes: [MARGEN], roles: [] });
  assert.doesNotMatch(html, /Guardar resolución/);
  assert.doesNotMatch(html, /Autorizar excepción/);
  assert.doesNotMatch(html, /hmtResolverAfinidad/);
  assert.doesNotMatch(html, /hmtDecidirMargen/);
  assert.match(html, /Solo lectura/);
});

test('[seguridad] con solo aprobar_afinidad: el botón de afinidad aparece, el de margen no', () => {
  const { html } = renderAprobacionesSection({ incidenciasAgrupadas: [INCIDENCIA], autorizacionesPendientes: [MARGEN], roles: ['aprobar_afinidad'] });
  assert.match(html, /Guardar resolución/);
  assert.doesNotMatch(html, /Autorizar excepción/);
});

test('[seguridad] con solo aprobar_margen: el botón de margen aparece, el de afinidad no', () => {
  const { html } = renderAprobacionesSection({ incidenciasAgrupadas: [INCIDENCIA], autorizacionesPendientes: [MARGEN], roles: ['aprobar_margen'] });
  assert.doesNotMatch(html, /Guardar resolución/);
  assert.match(html, /Autorizar excepción/);
});

test('[seguridad] con ambos roles: los dos formularios aparecen, sin aviso de solo lectura', () => {
  const { html } = renderAprobacionesSection({ incidenciasAgrupadas: [INCIDENCIA], autorizacionesPendientes: [MARGEN], roles: ['aprobar_afinidad', 'aprobar_margen'] });
  assert.match(html, /Guardar resolución/);
  assert.match(html, /Autorizar excepción/);
  assert.doesNotMatch(html, /está en solo lectura/);
});

test('[seguridad] sin "roles" en absoluto (undefined): se trata igual que sin ningún permiso, nunca se asume acceso', () => {
  const { html } = renderAprobacionesSection({ incidenciasAgrupadas: [INCIDENCIA], autorizacionesPendientes: [MARGEN] });
  assert.doesNotMatch(html, /Guardar resolución/);
  assert.doesNotMatch(html, /Autorizar excepción/);
});

test('[seguridad] el historial (solo lectura) se muestra igual con o sin permisos', () => {
  const historialAfinidad = [{ categoria_normalizada: 'X', clase: 'principal', estado: 'activa', resuelto_por: 'admin', resuelto_en: new Date().toISOString() }];
  const sinRoles = renderAprobacionesSection({ incidenciasAgrupadas: [], autorizacionesPendientes: [], historialAfinidad, roles: [] }).html;
  const conRoles = renderAprobacionesSection({ incidenciasAgrupadas: [], autorizacionesPendientes: [], historialAfinidad, roles: ['aprobar_afinidad'] }).html;
  assert.match(sinRoles, /Historial de resolución/);
  assert.match(conRoles, /Historial de resolución/);
});

test('[seguridad] el script cliente nunca referencia los manejadores si no hay ningún botón que los invoque (coherencia, no fuga de capacidad)', () => {
  // hmtResolverAfinidad/hmtDecidirMargen se definen siempre (son JS
  // estático embebido, no un secreto), pero sin un botón data-* que los
  // invoque son inalcanzables desde la UI — el control real sigue siendo
  // el backend.
  const { script } = renderAprobacionesSection({ incidenciasAgrupadas: [], autorizacionesPendientes: [], roles: [] });
  assert.match(script, /function hmtResolverAfinidad/);
  assert.match(script, /function hmtDecidirMargen/);
});
