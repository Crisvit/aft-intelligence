const { test } = require('node:test');
const assert = require('node:assert/strict');
const { clasificarAfinidadComercial, normalizarCategoria } = require('../src/domain/afinidad');

test('clasificarAfinidadComercial: coincidencia con lista principal', () => {
  const r = clasificarAfinidadComercial('Taladro percutor Wolfpack');
  assert.equal(r.clase, 'principal');
  assert.equal(r.elegible, true);
  assert.match(r.motivo, /TALADRO/);
});

test('clasificarAfinidadComercial: coincidencia con lista complementaria', () => {
  const r = clasificarAfinidadComercial('Llave de carraca');
  assert.equal(r.clase, 'complementaria');
  assert.equal(r.elegible, true);
});

test('clasificarAfinidadComercial: categoría sin ninguna coincidencia -> ambigua, no fuera_de_foco', () => {
  const r = clasificarAfinidadComercial('Categoría totalmente desconocida XYZ123');
  assert.equal(r.clase, 'ambigua');
  assert.equal(r.elegible, null);
  assert.match(r.motivo, /no coincide con ninguna lista/);
});

test('clasificarAfinidadComercial: categoría vacía o nula -> ambigua', () => {
  assert.equal(clasificarAfinidadComercial('').clase, 'ambigua');
  assert.equal(clasificarAfinidadComercial(null).clase, 'ambigua');
  assert.equal(clasificarAfinidadComercial(undefined).clase, 'ambigua');
});

test('clasificarAfinidadComercial: fuera_de_foco SOLO si está explícitamente en esa lista inyectada', () => {
  // Fase 3: la lista inyectada lleva tildes a propósito ("DECORACIÓN
  // NAVIDEÑA") — antes de la normalización simétrica esto nunca coincidía
  // con la categoría normalizada ("DECORACION NAVIDENA") y caía en
  // 'ambigua' en silencio. Ahora la lista se normaliza igual que la
  // categoría de entrada, así que sí coincide.
  const listas = { principal: ['TALADRO'], complementaria: [], estacional: [], fueraDeFoco: ['DECORACIÓN NAVIDEÑA'] };
  const r = clasificarAfinidadComercial('Decoración navideña', listas);
  assert.equal(r.clase, 'fuera_de_foco');
  assert.equal(r.elegible, false);

  // Con la misma lista de fuera_de_foco, una categoría que no coincide con
  // NINGUNA lista (ni siquiera fuera_de_foco) debe seguir siendo ambigua,
  // nunca caer por defecto en fuera_de_foco.
  const r2 = clasificarAfinidadComercial('Otra categoría sin relación', listas);
  assert.equal(r2.clase, 'ambigua');
});

test('clasificarAfinidadComercial: estacional es elegible igual que principal/complementaria', () => {
  const listas = { principal: [], complementaria: [], estacional: ['DESCORCHADOR NAVIDAD'], fueraDeFoco: [] };
  const r = clasificarAfinidadComercial('Descorchador Navidad edición especial', listas);
  assert.equal(r.clase, 'estacional');
  assert.equal(r.elegible, true);
});

test('clasificarAfinidadComercial: insensible a mayúsculas/acentos', () => {
  const listas = { principal: ['POLEA'], complementaria: [], estacional: [], fueraDeFoco: [] };
  const r = clasificarAfinidadComercial('polea de tracción', listas);
  assert.equal(r.clase, 'principal');
});

test('clasificarAfinidadComercial: siempre incluye motivo trazable, nunca vacío', () => {
  for (const categoria of ['Taladro', 'Llave', 'Desconocida', '', null]) {
    const r = clasificarAfinidadComercial(categoria);
    assert.ok(r.motivo && r.motivo.length > 0);
  }
});

// --- Fase 3: normalización simétrica (categoría recibida Y listas
// configurables pasan por la misma normalizarCategoria) ---

test('[fase 3] normalizarCategoria: JARDÍN y JARDIN normalizan a la misma clave', () => {
  assert.equal(normalizarCategoria('JARDÍN'), normalizarCategoria('JARDIN'));
  assert.equal(normalizarCategoria('Jardín'), 'JARDIN');
});

test('[fase 3] normalizarCategoria: ILUMINACIÓN e ILUMINACION normalizan a la misma clave', () => {
  assert.equal(normalizarCategoria('ILUMINACIÓN'), normalizarCategoria('ILUMINACION'));
  assert.equal(normalizarCategoria('Iluminación técnica'), 'ILUMINACION TECNICA');
});

test('[fase 3] normalizarCategoria: insensible a diferencias de mayúsculas/minúsculas', () => {
  assert.equal(normalizarCategoria('jardín'), normalizarCategoria('JARDÍN'));
  assert.equal(normalizarCategoria('Jardín Y Exterior'), normalizarCategoria('jardín y exterior'));
});

test('[fase 3] normalizarCategoria: recorta y colapsa espacios adicionales', () => {
  assert.equal(normalizarCategoria('  Jardín   y   exterior  '), 'JARDIN Y EXTERIOR');
  assert.equal(normalizarCategoria('Jardín y exterior'), normalizarCategoria('  Jardín   y   exterior  '));
});

test('[fase 3] clasificarAfinidadComercial: categoría de AFT con tilde coincide con lista configurada SIN tilde', () => {
  const listas = { principal: [], complementaria: ['JARDIN'], estacional: [], fueraDeFoco: [] };
  const r = clasificarAfinidadComercial('Jardín y exterior', listas);
  assert.equal(r.clase, 'complementaria');
  assert.equal(r.elegible, true);
});

test('[fase 3] clasificarAfinidadComercial: categoría de AFT SIN tilde coincide con lista configurada CON tilde', () => {
  const listas = { principal: [], complementaria: ['JARDÍN'], estacional: [], fueraDeFoco: [] };
  const r = clasificarAfinidadComercial('Jardin y exterior', listas);
  assert.equal(r.clase, 'complementaria');
  assert.equal(r.elegible, true);
});

test('[fase 3] clasificarAfinidadComercial: "Iluminación" (AFT) coincide con "ILUMINACION" (lista sin tilde)', () => {
  const listas = { principal: ['ILUMINACION'], complementaria: [], estacional: [], fueraDeFoco: [] };
  const r = clasificarAfinidadComercial('Iluminación técnica LED', listas);
  assert.equal(r.clase, 'principal');
});

test('[fase 3] clasificarAfinidadComercial: espacios adicionales en la categoría no impiden la coincidencia', () => {
  const listas = { principal: ['TALADRO'], complementaria: [], estacional: [], fueraDeFoco: [] };
  const r = clasificarAfinidadComercial('   Taladro    percutor   ', listas);
  assert.equal(r.clase, 'principal');
});

test('[fase 3] clasificarAfinidadComercial: diferencias de mayúsculas entre categoría y lista no impiden la coincidencia', () => {
  const listas = { principal: ['taladro'], complementaria: [], estacional: [], fueraDeFoco: [] };
  const r = clasificarAfinidadComercial('TALADRO PERCUTOR', listas);
  assert.equal(r.clase, 'principal');
});

test('[fase 3] clasificarAfinidadComercial: categorías desconocidas siguen siendo ambiguas, nunca se inventan', () => {
  const listas = { principal: ['JARDÍN'], complementaria: ['ILUMINACIÓN'], estacional: [], fueraDeFoco: [] };
  const r = clasificarAfinidadComercial('Ferretería general sin relación', listas);
  assert.equal(r.clase, 'ambigua');
  assert.equal(r.elegible, null);
});

test('[fase 3] clasificarAfinidadComercial: mantiene el valor original de la categoría para mostrarlo en el dashboard', () => {
  const r = clasificarAfinidadComercial('  Jardín   Y Exterior  ', { principal: [], complementaria: ['JARDIN'], estacional: [], fueraDeFoco: [] });
  // categoriaOriginal es el texto recortado tal cual llegó (con tildes,
  // mayúsculas/minúsculas y espaciado originales) — nunca la forma
  // normalizada usada internamente para comparar.
  assert.equal(r.categoriaOriginal, 'Jardín   Y Exterior');
});

test('[fase 3] clasificarAfinidadComercial: resolucion persistida prevalece sobre la clasificación automática', () => {
  const listas = { principal: ['JARDIN'], complementaria: [], estacional: [], fueraDeFoco: [] };
  const sinResolucion = clasificarAfinidadComercial('Jardín y exterior', listas);
  assert.equal(sinResolucion.clase, 'principal');

  const conResolucion = clasificarAfinidadComercial('Jardín y exterior', listas, {
    clase: 'complementaria', motivo: 'Decisión comercial manual', resueltoPor: 'admin', resueltoEn: '2026-01-01'
  });
  assert.equal(conResolucion.clase, 'complementaria');
  assert.equal(conResolucion.elegible, true);
  assert.equal(conResolucion.resuelta, true);
  assert.match(conResolucion.motivo, /resuelta manualmente/);
  assert.match(conResolucion.motivo, /admin/);
});

test('[fase 3] clasificarAfinidadComercial: sin resolucion, el campo "resuelta" es siempre false', () => {
  assert.equal(clasificarAfinidadComercial('Taladro').resuelta, false);
  assert.equal(clasificarAfinidadComercial('').resuelta, false);
});
